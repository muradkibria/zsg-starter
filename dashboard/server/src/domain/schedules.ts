// Schedules: the fleet schedule and bags' own schedules (loop rules by priority
// plus a brightness plan), their week preview, the checks before applying, and
// turning them into Colorlight per-bag schedules sent through the write gate.
//
// Colorlight plays every "rotation" entry whose window is open at once, in turn.
// To make "the higher rule wins" and "the default loop fills any gap" exact, the
// schedule is flattened here into windows that never overlap before it's sent.

import { createHash, randomBytes } from "node:crypto";
import {
  addDays,
  bagStatus,
  brightnessDay,
  clockMatchesLondon,
  describeBrightness,
  describeTz,
  emptySchedule,
  isValidFrom,
  londonClockChange,
  londonDayStart,
  londonOffsetMinutes,
  londonSunTimes,
  minToHm,
  mondayOf,
  parseTzHours,
  programNameFromVsn,
  renumberRules,
  resolveDay,
  ruleWindow,
  scheduleProblems,
  shortDay,
  todayLondon,
  weekdayIndex,
  type ApplyBagResult,
  type ApplyBagStatus,
  type ApplyRequest,
  type ApplyResult,
  type ApplyTarget,
  type BrightnessStep,
  type DeviceScheduleSummary,
  type LoopRule,
  type ScheduleApplyAttempt,
  type ScheduleBagRow,
  type ScheduleCheck,
  type ScheduleChecks,
  type ScheduleContent,
  type ScheduleDto,
  type ScheduleLoop,
  type SchedulePreview,
  type SessionUser,
  type WriteMode,
} from "@digilite/shared";
import { HttpError, badRequest, notFound } from "../api/http";
import { WriteBlockedError } from "../colorlight/gate";
import { putTerminalSchedule } from "../colorlight/writes";
import { config } from "../config";
import { logger } from "../log";
import { getAll, getFirst, getOneOrNull, parsePbDate, pb, pbDate, q, stableId, type RecordModel } from "../pb";
import { audit } from "./audit";
import { isTestBag, loadBags } from "./bags";
import { getSettings } from "./settings";

const log = logger("schedules");

/** Sunrise/sunset brightness times are written out this many days ahead (26 weeks). */
export const SUN_HORIZON_DAYS = 182;
/** Stand-in end date for "no end" (stays inside 32-bit device clocks). */
export const FAR_END = "2037-12-31";
/** Colorlight documents program priorities 0–100. */
export const MAX_LOOP_PARTS = 100;

const OUT_OF_SERVICE = new Set(["retired", "lost"]);
export const inService = (b: RecordModel) => !OUT_OF_SERVICE.has(b.lifecycle || "active");

// ── Records ───────────────────────────────────────────────────────────────────

export const FLEET_SCHEDULE_ID = stableId("schedule:fleet");
const bagScheduleId = (bagId: string) => stableId(`schedule:bag:${bagId}`);

interface AppliedTo {
  lastAttempt?: ScheduleApplyAttempt | null;
  /** Last real send to the fleet or the bag itself. */
  lastSent?: { at: string; hash: string; target: ApplyTarget } | null;
  /** Last real send to the test bag (doesn't count as applied). */
  lastTest?: { at: string; hash: string } | null;
}

export const newRuleId = () => randomBytes(5).toString("hex");

function sanitizeRule(x: unknown, i: number): LoopRule | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
  return {
    id: str(r.id, `r${i + 1}`) || `r${i + 1}`,
    loopId: str(r.loopId, ""),
    startDate: str(r.startDate, "2000-01-01"),
    endDate: typeof r.endDate === "string" && r.endDate ? r.endDate : null,
    weekdays: Array.isArray(r.weekdays) && r.weekdays.length === 7 ? r.weekdays.map(Boolean) : [true, true, true, true, true, true, true],
    startTime: str(r.startTime, "00:00"),
    endTime: str(r.endTime, "24:00"),
    priority: Number.isFinite(Number(r.priority)) ? Number(r.priority) : 999 + i,
  };
}

function sanitizeStep(x: unknown): BrightnessStep | null {
  if (!x || typeof x !== "object") return null;
  const s = x as Record<string, unknown>;
  if (typeof s.from !== "string" || !isValidFrom(s.from)) return null;
  const pct = Math.round(Number(s.pct));
  return Number.isFinite(pct) ? { from: s.from, pct } : null;
}

/** Stored shape: rules = {v, defaultLoopId, items}, brightness = {v, steps} (plain arrays also read). */
export function readContent(rec: RecordModel): ScheduleContent {
  const raw = rec.rules as unknown;
  let defaultLoopId: string | null = null;
  let items: unknown[] = [];
  if (Array.isArray(raw)) items = raw;
  else if (raw && typeof raw === "object") {
    const o = raw as { defaultLoopId?: unknown; items?: unknown };
    defaultLoopId = typeof o.defaultLoopId === "string" && o.defaultLoopId ? o.defaultLoopId : null;
    items = Array.isArray(o.items) ? o.items : [];
  }
  const b = rec.brightness as unknown;
  const steps: unknown[] = Array.isArray(b)
    ? b
    : b && typeof b === "object" && Array.isArray((b as { steps?: unknown }).steps)
      ? ((b as { steps: unknown[] }).steps)
      : [];
  return {
    defaultLoopId,
    rules: renumberRules(items.map(sanitizeRule).filter((r): r is LoopRule => !!r)),
    brightness: steps.map(sanitizeStep).filter((s): s is BrightnessStep => !!s),
  };
}

export function contentFields(c: ScheduleContent) {
  return { rules: { v: 1, defaultLoopId: c.defaultLoopId, items: c.rules }, brightness: { v: 1, steps: c.brightness } };
}

/** Identity of what a schedule says (ignores rule ids and numbering gaps). */
export function contentHash(c: ScheduleContent): string {
  const norm = {
    d: c.defaultLoopId,
    r: renumberRules(c.rules).map((r) => [r.loopId, r.startDate, r.endDate, r.weekdays.map(Number).join(""), r.startTime, r.endTime, r.priority]),
    b: c.brightness.map((s) => [s.from, s.pct]),
  };
  return createHash("sha1").update(JSON.stringify(norm)).digest("hex").slice(0, 16);
}

/** The fleet schedule record, created as an empty draft the first time. */
export async function fleetRecord(): Promise<RecordModel> {
  const byId = await getOneOrNull<RecordModel>("schedules", FLEET_SCHEDULE_ID);
  if (byId) return byId;
  const other = await getFirst<RecordModel>("schedules", 'scope = "fleet"', { sort: "created" });
  if (other) return other;
  try {
    return await pb.collection("schedules").create<RecordModel>({
      id: FLEET_SCHEDULE_ID,
      name: "Fleet schedule",
      scope: "fleet",
      ...contentFields(emptySchedule()),
      status: "draft",
      applied_to: {},
    });
  } catch (err) {
    const again = await getOneOrNull<RecordModel>("schedules", FLEET_SCHEDULE_ID);
    if (again) return again;
    throw err;
  }
}

export async function bagRecord(bagId: string): Promise<RecordModel | null> {
  return getFirst<RecordModel>("schedules", `scope = "bag" && bag = ${q(bagId)}`, { sort: "created" });
}

export async function bagRecords(): Promise<RecordModel[]> {
  return getAll<RecordModel>("schedules", { filter: 'scope = "bag"', sort: "created" });
}

export function toScheduleDto(rec: RecordModel, bagName: string | null): ScheduleDto {
  const content = readContent(rec);
  const at = (rec.applied_to ?? {}) as AppliedTo;
  const changed = !!at.lastSent && at.lastSent.hash !== contentHash(content);
  return {
    id: rec.id,
    scope: rec.scope === "bag" ? "bag" : "fleet",
    bagId: rec.bag || null,
    bagName,
    name: rec.name,
    ...content,
    status: at.lastSent && !changed ? "applied" : "draft",
    appliedAt: parsePbDate(rec.applied_at)?.toISOString() ?? null,
    changedSinceApply: changed,
    lastAttempt: at.lastAttempt ?? null,
    updatedAt: parsePbDate(rec.updated)?.toISOString() ?? null,
  };
}

/** Save what a schedule says (fleet, or a bag's own). Creates the bag's record when needed. */
export async function saveContent(
  scope: { bag: RecordModel } | null,
  content: ScheduleContent,
): Promise<{ rec: RecordModel; before: ScheduleContent | null }> {
  const clean: ScheduleContent = {
    defaultLoopId: content.defaultLoopId || null,
    rules: renumberRules(content.rules.map((r) => ({ ...r, id: r.id || newRuleId(), endDate: r.endDate || null }))),
    brightness: content.brightness.map((s) => ({ from: s.from, pct: Math.round(s.pct) })),
  };
  const existing = scope ? await bagRecord(scope.bag.id) : await fleetRecord();
  if (!existing) {
    const rec = await pb.collection("schedules").create<RecordModel>({
      id: bagScheduleId(scope!.bag.id),
      name: `${scope!.bag.name} schedule`,
      scope: "bag",
      bag: scope!.bag.id,
      ...contentFields(clean),
      status: "draft",
      applied_to: {},
    });
    return { rec, before: null };
  }
  const before = readContent(existing);
  const at = (existing.applied_to ?? {}) as AppliedTo;
  const unchangedSinceSend = !!at.lastSent && at.lastSent.hash === contentHash(clean);
  const rec = await pb.collection("schedules").update<RecordModel>(existing.id, {
    ...contentFields(clean),
    status: unchangedSinceSend ? "applied" : "draft",
  });
  return { rec, before };
}

// ── Loops: which can go on a bag's schedule ───────────────────────────────────

export interface LoopInfo {
  id: string;
  name: string;
  status: string;
  programId: number | null;
  programName: string;
  vsn: string | null;
  problem: string | null;
}

/** Colorlight file names (.vsn) that bags report holding, grouped by program name. */
export function vsnCandidates(bags: RecordModel[]): Map<string, Map<string, { bags: number; playing: number }>> {
  const idx = new Map<string, Map<string, { bags: number; playing: number }>>();
  for (const b of bags) {
    const names = new Set<string>();
    const contents = (b.device_status as { vsns?: { contents?: { content?: { name?: unknown }[] }[] } } | null)?.vsns?.contents;
    for (const c of Array.isArray(contents) ? contents : []) {
      for (const f of Array.isArray(c?.content) ? c.content : []) {
        if (typeof f?.name === "string" && /_[0-9a-f]{32}_\d+\.vsn$/i.test(f.name)) names.add(f.name);
      }
    }
    if (typeof b.playing_vsn === "string" && b.playing_vsn) names.add(b.playing_vsn);
    for (const n of names) {
      const program = programNameFromVsn(n);
      if (!program) continue;
      const m = idx.get(program) ?? new Map<string, { bags: number; playing: number }>();
      const e = m.get(n) ?? { bags: 0, playing: 0 };
      e.bags++;
      if (n === b.playing_vsn) e.playing++;
      m.set(n, e);
      idx.set(program, m);
    }
  }
  return idx;
}

export async function loadLoopInfo(bags?: RecordModel[]): Promise<LoopInfo[]> {
  return resolveLoopInfo(await getAll<RecordModel>("loops", { sort: "name" }), bags ?? (await loadBags()));
}

/** Which loops can go on a bag's schedule: on Colorlight, and with a file name we can name. */
export function resolveLoopInfo(rows: RecordModel[], bags: RecordModel[]): LoopInfo[] {
  const idx = vsnCandidates(bags);
  const nameCount = new Map<string, number>();
  for (const l of rows) {
    if (Number(l.colorlight_program_id) > 0) {
      const n = String(l.colorlight_program_name || l.name || "").trim();
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    }
  }
  return rows.map((l) => {
    const programId = Number(l.colorlight_program_id) > 0 ? Number(l.colorlight_program_id) : null;
    const programName = String(l.colorlight_program_name || l.name || "").trim();
    // A loops-area field for the file name wins if one exists; otherwise use what bags report.
    const explicit = [l.colorlight_vsn, l.vsn_name, l.vsn, l.colorlight_program_name].find(
      (v): v is string => typeof v === "string" && /\.vsn$/i.test(v),
    );
    let vsn: string | null = null;
    let problem: string | null = null;
    if (!programId) problem = "Not on Colorlight yet. Send it from Ads & loops first.";
    else if (explicit) vsn = explicit;
    else if ((nameCount.get(programName) ?? 0) > 1)
      problem = `Two loops on Colorlight are called “${programName}”, so their files can't be told apart. Rename one in Colorlight.`;
    else {
      const cands = [...(idx.get(programName)?.entries() ?? [])].sort((a, b) => b[1].playing - a[1].playing || b[1].bags - a[1].bags);
      if (!cands.length) problem = "No bag has downloaded it yet, so its Colorlight file isn't known.";
      else if (cands.length > 1 && cands[0][1].playing === cands[1][1].playing && cands[0][1].bags === cands[1][1].bags)
        problem = "Bags hold more than one version of it, so we can't tell which is current.";
      else vsn = cands[0][0];
    }
    return { id: l.id, name: l.name, status: l.status, programId, programName, vsn, problem };
  });
}

export function toScheduleLoop(l: LoopInfo): ScheduleLoop {
  return { id: l.id, name: l.name, status: l.status, programId: l.programId, ready: !l.problem, problem: l.problem };
}

// ── Week preview ──────────────────────────────────────────────────────────────

export function buildPreview(content: ScheduleContent, weekOf: string, loopNames: Map<string, string>, today: string): SchedulePreview {
  const monday = mondayOf(weekOf);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((day) => {
    const sun = londonSunTimes(day);
    const b = brightnessDay(content.brightness, day);
    return {
      day,
      blocks: resolveDay(content, day).map((x) => ({
        start: minToHm(x.start),
        end: minToHm(x.end),
        startMin: x.start,
        endMin: x.end,
        loopId: x.loopId,
        loopName: x.loopId ? loopNames.get(x.loopId) ?? "Removed loop" : null,
        ruleId: x.ruleId,
        priority: x.priority,
      })),
      brightness: { startPct: b.startPct, steps: b.steps.map((s) => ({ at: minToHm(s.at), atMin: s.at, pct: s.pct, from: s.from })) },
      sunrise: sun.sunrise,
      sunset: sun.sunset,
      clockChange: londonClockChange(day),
    };
  });
  return { weekOf: monday, today, days };
}

// ── Colorlight schedule (pure) ────────────────────────────────────────────────

export interface ProgramRef {
  programId: number;
  name: string;
  vsn: string;
}

export interface ColorlightScheduleOptions {
  /** First London day the schedule is written for (normally today). */
  fromDay: string;
  horizonDays?: number;
  /** settings.brightnessCommandScale: 100 or 255 */
  brightnessScale: number;
}

export interface ContentEntry {
  if_limit_date: boolean;
  limit_date: { start: string; start_time: string; end: string; end_time: string };
  if_limit_time: boolean;
  limit_time: { start_time: string; end_time: string };
  if_limit_weekday: boolean;
  limit_weekday: boolean[];
  name: "Play_Program";
  operation: { id: number; name: string; vsn: string; source: "internet" };
  priority: string;
  type: "rotation";
  type_priority: 200;
}

export interface CommandEntry {
  name: "Brightness_Control";
  type: "command";
  op_time: string[];
  if_limit_date: boolean;
  limit_date: { start: string; end: string };
  if_limit_weekday: boolean;
  limit_weekday: boolean[];
  content: { name: "Value"; value: number };
  operation: { author_url: "api/brightness"; karma: 2; content: string };
}

export interface TerminalScheduleJson {
  to_children: false;
  program_ids: number[];
  thumbnails: { id: number; src: string }[];
  schedules: { contentsSchedule: ContentEntry[]; commandSchedule: CommandEntry[] };
  [k: string]: unknown;
}

export interface ColorlightSchedule {
  scheduleJson: TerminalScheduleJson;
  loopParts: number;
  brightnessParts: number;
  brightnessUntil: string | null;
  /** Loop ids the schedule needs that have no Colorlight program (left out). */
  missing: string[];
}

const pad = (n: number) => String(n).padStart(2, "0");
const ALL_WEEK = () => [true, true, true, true, true, true, true];
const hmsStart = (min: number) => `${minToHm(Math.min(min, 1439))}:00`;
/** Inclusive end second of a window ending at `min` (so windows never touch). */
const hmsEnd = (min: number) => {
  const s = Math.max(0, min * 60 - 1);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000) + 1;

export interface Period {
  start: string;
  /** Inclusive; null = no end */
  end: string | null;
}

/** Date ranges (from `fromDay`) within which every day of a given weekday resolves the same. */
export function contentPeriods(content: ScheduleContent, fromDay: string): Period[] {
  const edges = new Set<string>([fromDay]);
  for (const r of content.rules) {
    const w = ruleWindow(r);
    const list = [r.startDate, r.endDate ? addDays(r.endDate, 1) : null];
    // An overnight window spills into the next day, so its effect starts and ends a day later too.
    if (w.overnight) list.push(addDays(r.startDate, 1), r.endDate ? addDays(r.endDate, 2) : null);
    for (const e of list) if (e && e > fromDay) edges.add(e);
  }
  const sorted = [...edges].sort();
  return sorted.map((start, i) => ({ start, end: i + 1 < sorted.length ? addDays(sorted[i + 1], -1) : null }));
}

export interface LoopWindow {
  start: number;
  end: number;
  loopId: string;
}

/** Per period, the loop windows for each weekday (null = that weekday doesn't occur in the period). */
export function flattenContent(content: ScheduleContent, fromDay: string): { period: Period; weekdays: (LoopWindow[] | null)[] }[] {
  const out: { period: Period; weekdays: (LoopWindow[] | null)[] }[] = [];
  for (const period of contentPeriods(content, fromDay)) {
    const len = period.end ? Math.min(7, dayCount(period.start, period.end)) : 7;
    const weekdays: (LoopWindow[] | null)[] = [null, null, null, null, null, null, null];
    for (let i = 0; i < len; i++) {
      const day = addDays(period.start, i);
      const windows: LoopWindow[] = [];
      for (const b of resolveDay(content, day)) {
        if (!b.loopId) continue;
        const last = windows[windows.length - 1];
        if (last && last.loopId === b.loopId && last.end === b.start) last.end = b.end;
        else windows.push({ start: b.start, end: b.end, loopId: b.loopId });
      }
      weekdays[weekdayIndex(day)] = windows;
    }
    const prev = out[out.length - 1];
    const same = (a: LoopWindow[] | null, b: LoopWindow[] | null) => !a || !b || JSON.stringify(a) === JSON.stringify(b);
    if (prev && prev.period.end && weekdays.every((w, i) => same(prev.weekdays[i], w))) {
      prev.period.end = period.end;
      prev.weekdays = prev.weekdays.map((w, i) => w ?? weekdays[i]);
    } else {
      out.push({ period: { ...period }, weekdays });
    }
  }
  return out;
}

/** Up-to-7-day stretches from `fromDay`, split where London's clocks change. */
export function sunChunks(fromDay: string, horizonDays: number): { start: string; end: string }[] {
  const until = addDays(fromDay, horizonDays - 1);
  const offsetAtNoon = (d: string) => londonOffsetMinutes(new Date(londonDayStart(d).getTime() + 12 * 3600000));
  const out: { start: string; end: string }[] = [];
  for (let start = fromDay; start <= until; ) {
    let end = addDays(start, 6);
    if (end > until) end = until;
    const off = offsetAtNoon(start);
    for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) {
      if (offsetAtNoon(d) !== off) {
        end = addDays(d, -1);
        break;
      }
    }
    out.push({ start, end });
    start = addDays(end, 1);
  }
  return out;
}

/** Brightness value in the device's units. */
export function scaleBrightness(pct: number, scale: number): number {
  const p = Math.max(1, Math.min(100, Math.round(pct)));
  return scale === 255 ? Math.round(p * 2.55) : p;
}

function brightnessEntry(pct: number, scale: number, opMin: number, limit: { start: string; end: string } | null, fromDay: string): CommandEntry {
  return {
    name: "Brightness_Control",
    type: "command",
    op_time: [hmsStart(opMin)],
    if_limit_date: !!limit,
    limit_date: limit ?? { start: fromDay, end: FAR_END },
    if_limit_weekday: false,
    limit_weekday: ALL_WEEK(),
    content: { name: "Value", value: Math.round(pct) },
    operation: { author_url: "api/brightness", karma: 2, content: JSON.stringify({ brightness: String(scaleBrightness(pct, scale)) }) },
  };
}

/**
 * Brightness plan → command-schedule entries. Fixed times run every day with no
 * end. Sunrise/sunset steps get one entry per week (split at clock changes) at
 * that week's time, written out `horizonDays` ahead.
 */
export function brightnessCommands(
  steps: BrightnessStep[],
  opts: ColorlightScheduleOptions,
): { entries: CommandEntry[]; until: string | null } {
  const horizon = opts.horizonDays ?? SUN_HORIZON_DAYS;
  const entries: CommandEntry[] = [];
  const sunSteps = steps.filter((s) => s.from === "sunrise" || s.from === "sunset");
  for (const s of steps) {
    if (s.from === "sunrise" || s.from === "sunset") continue;
    const m = /^(\d{2}):(\d{2})$/.exec(s.from);
    if (m) entries.push(brightnessEntry(s.pct, opts.brightnessScale, Number(m[1]) * 60 + Number(m[2]), null, opts.fromDay));
  }
  if (!sunSteps.length) return { entries, until: null };
  const chunks = sunChunks(opts.fromDay, horizon);
  for (const s of sunSteps) {
    let current: { start: string; end: string; opMin: number } | null = null;
    const flush = () => current && entries.push(brightnessEntry(s.pct, opts.brightnessScale, current.opMin, { start: current.start, end: current.end }, opts.fromDay));
    for (const c of chunks) {
      const times: number[] = [];
      for (let d = c.start; d <= c.end; d = addDays(d, 1)) {
        const sun = londonSunTimes(d);
        times.push(s.from === "sunrise" ? sun.sunriseMin : sun.sunsetMin);
      }
      const opMin = Math.round((Math.min(...times) + Math.max(...times)) / 2);
      if (current && current.opMin === opMin) current.end = c.end;
      else {
        flush();
        current = { start: c.start, end: c.end, opMin };
      }
    }
    flush();
  }
  entries.sort((a, b) => (a.if_limit_date ? a.limit_date.start : "").localeCompare(b.if_limit_date ? b.limit_date.start : "") || a.op_time[0].localeCompare(b.op_time[0]));
  return { entries, until: chunks[chunks.length - 1].end };
}

/**
 * A schedule → the body for Colorlight's per-terminal schedule endpoint
 * (PUT /wp-json/wp/v3/schedules/{terminalId}/terminalSchedules). Never names a
 * terminal group, never applies to sub-groups, and every loop part has its own
 * priority. Loop windows never overlap.
 */
export function buildColorlightSchedule(
  content: ScheduleContent,
  programs: Map<string, ProgramRef>,
  opts: ColorlightScheduleOptions,
): ColorlightSchedule {
  const missing = new Set<string>();
  const parts = new Map<string, { period: Period; loopId: string; start: number; end: number; mask: boolean[] }>();
  for (const f of flattenContent(content, opts.fromDay)) {
    for (let w = 0; w < 7; w++) {
      for (const win of f.weekdays[w] ?? []) {
        if (!programs.has(win.loopId)) {
          missing.add(win.loopId);
          continue;
        }
        const key = `${f.period.start}|${win.loopId}|${win.start}|${win.end}`;
        // Weekdays that don't occur in the period are "don't care": mark them on.
        const e = parts.get(key) ?? { period: f.period, loopId: win.loopId, start: win.start, end: win.end, mask: f.weekdays.map((x) => x === null) };
        e.mask[w] = true;
        parts.set(key, e);
      }
    }
  }
  const ordered = [...parts.values()].sort(
    (a, b) => a.period.start.localeCompare(b.period.start) || a.start - b.start || a.loopId.localeCompare(b.loopId),
  );
  const contentsSchedule: ContentEntry[] = ordered.map((e, i) => {
    const p = programs.get(e.loopId)!;
    const always = e.period.end === null && e.period.start <= opts.fromDay;
    return {
      if_limit_date: !always,
      limit_date: { start: e.period.start, start_time: "00:00:00", end: e.period.end ?? FAR_END, end_time: "23:59:59" },
      if_limit_time: !(e.start === 0 && e.end === 1440),
      limit_time: { start_time: hmsStart(e.start), end_time: hmsEnd(e.end) },
      if_limit_weekday: !e.mask.every(Boolean),
      limit_weekday: e.mask,
      name: "Play_Program",
      operation: { id: p.programId, name: p.name, vsn: p.vsn, source: "internet" },
      priority: String(i),
      type: "rotation",
      type_priority: 200,
    };
  });
  const bright = brightnessCommands(content.brightness, opts);
  const programIds = [...new Set(contentsSchedule.map((c) => c.operation.id))];
  return {
    scheduleJson: {
      to_children: false,
      program_ids: programIds,
      thumbnails: programIds.map((id) => ({ id, src: "" })),
      schedules: { contentsSchedule, commandSchedule: bright.entries },
    },
    loopParts: contentsSchedule.length,
    brightnessParts: bright.entries.length,
    brightnessUntil: bright.until,
    missing: [...missing],
  };
}

// ── Problems that stop a schedule going out ───────────────────────────────────

/** Rules that can still play (not ended before `today`). */
const liveRules = (c: ScheduleContent, today: string) => c.rules.filter((r) => !r.endDate || r.endDate >= today);

export function scheduleBlockers(content: ScheduleContent, loops: LoopInfo[], today: string): string[] {
  const byId = new Map(loops.map((l) => [l.id, l]));
  const out: string[] = [];
  if (!content.defaultLoopId && !liveRules(content, today).length && !content.brightness.length) {
    out.push("Nothing to apply yet. Add a loop rule, a default loop or a brightness step.");
    return out;
  }
  out.push(...scheduleProblems(content, (id) => byId.get(id)?.name ?? null));
  const used = [...new Set([...(content.defaultLoopId ? [content.defaultLoopId] : []), ...liveRules(content, today).map((r) => r.loopId)])];
  for (const id of used) {
    const l = byId.get(id);
    if (!l) out.push("A loop in this schedule no longer exists. Pick another.");
    else if (l.problem) out.push(`“${l.name}” can't go on a schedule yet: ${l.problem}`);
  }
  if (!out.length) {
    const built = buildForBags(content, loops, today, 100);
    if (built.loopParts > MAX_LOOP_PARTS)
      out.push(`This schedule has too many parts to send (${built.loopParts}; Colorlight takes ${MAX_LOOP_PARTS}). Use fewer date ranges.`);
  }
  return [...new Set(out)];
}

export function programRefs(loops: LoopInfo[]): Map<string, ProgramRef> {
  const m = new Map<string, ProgramRef>();
  for (const l of loops) if (l.programId && l.vsn && !l.problem) m.set(l.id, { programId: l.programId, name: l.programName, vsn: l.vsn });
  return m;
}

function buildForBags(content: ScheduleContent, loops: LoopInfo[], today: string, scale: number): ColorlightSchedule {
  return buildColorlightSchedule(content, programRefs(loops), { fromDay: today, brightnessScale: scale, horizonDays: SUN_HORIZON_DAYS });
}

/** "China time (+08)", or "UTC+1" for a clock that isn't following London (e.g. stuck on summer time). */
export function clockLabel(tz: string | null | undefined): string {
  const h = parseTzHours(tz);
  return describeTz(tz) === "London time" && h !== null ? `UTC${h >= 0 ? "+" : ""}${h}` : describeTz(tz);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Why a bag's clock makes a schedule unsafe, or null when it's on London time (or unknown). */
export function clockProblem(b: RecordModel, now = new Date()): string | null {
  if (clockMatchesLondon(b.timezone, now) !== false) return null;
  const h = parseTzHours(b.timezone);
  const label = clockLabel(b.timezone);
  if (h === null) return `Clock set to ${label}, so the schedule would run at the wrong time`;
  const diff = h * 60 - londonOffsetMinutes(now);
  const hrs = Math.abs(diff) / 60;
  const amount = `${Number.isInteger(hrs) ? hrs : hrs.toFixed(1)} ${hrs === 1 ? "hour" : "hours"}`;
  return `Clock on ${label}, so the schedule would run ${amount} ${diff > 0 ? "early" : "late"}`;
}

// ── Bags ──────────────────────────────────────────────────────────────────────

export function summarizeDeviceSchedule(raw: unknown): DeviceScheduleSummary {
  if (raw === null || raw === undefined) {
    return { read: false, loops: [], loopParts: 0, brightnessChanges: 0, otherCommands: 0, updatedAt: null, text: "Not read from the bag yet" };
  }
  const o = (raw ?? {}) as Record<string, unknown>;
  const bean = (o.scheduleJsonBean ?? o) as Record<string, unknown>;
  const sched = (bean.schedules ?? bean) as Record<string, unknown>;
  const contents = Array.isArray(sched.contentsSchedule) ? (sched.contentsSchedule as Record<string, unknown>[]) : [];
  const commands = Array.isArray(sched.commandSchedule) ? (sched.commandSchedule as Record<string, unknown>[]) : [];
  const loops = [
    ...new Set(
      contents
        .map((c) => c.operation as { name?: string; vsn?: string } | undefined)
        .map((op) => op?.name || programNameFromVsn(op?.vsn) || "")
        .filter(Boolean),
    ),
  ];
  const brightnessChanges = commands.filter((c) => c.name === "Brightness_Control").length;
  const t = Number(o.updateTerminalScheduleTime);
  const updatedAt = Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString() : null;
  const bits: string[] = [];
  if (loops.length) bits.push(`Plays ${loops.slice(0, 2).join(", ")}${loops.length > 2 ? ` and ${loops.length - 2} more` : ""}`);
  if (contents.length) bits.push(`${contents.length} loop ${contents.length === 1 ? "part" : "parts"}`);
  if (brightnessChanges) bits.push(`${brightnessChanges} brightness ${brightnessChanges === 1 ? "change" : "changes"}`);
  if (commands.length - brightnessChanges) bits.push(`${commands.length - brightnessChanges} other commands`);
  return {
    read: true,
    loops,
    loopParts: contents.length,
    brightnessChanges,
    otherCommands: commands.length - brightnessChanges,
    updatedAt,
    text: bits.length ? bits.join(" · ") : "No schedule on the bag",
  };
}

export async function scheduleBagRows(): Promise<ScheduleBagRow[]> {
  const now = new Date();
  const bags = await loadBags();
  const own = new Map((await bagRecords()).map((r) => [r.bag as string, r]));
  const loops = new Map((await getAll<RecordModel>("loops", { fields: "id,name" })).map((l) => [l.id, l.name as string]));
  const sent = await pb.collection("commands").getList<RecordModel>(1, 500, {
    filter: 'type = "schedule"',
    sort: "-created",
    fields: "bag,status,created",
    skipTotal: true,
  });
  const lastSent = new Map<string, RecordModel>();
  for (const c of sent.items) if (!lastSent.has(c.bag)) lastSent.set(c.bag, c);
  return bags.map((b) => {
    const rec = own.get(b.id);
    const content = rec ? readContent(rec) : null;
    const last = lastSent.get(b.id);
    const clockOk = clockMatchesLondon(b.timezone, now);
    return {
      id: b.id,
      name: b.name,
      isTestBag: isTestBag(b),
      status: bagStatus(parsePbDate(b.last_report_at), now.getTime()),
      lifecycle: b.lifecycle || "active",
      lastReportAt: parsePbDate(b.last_report_at)?.toISOString() ?? null,
      clock: { label: describeTz(b.timezone), ok: clockOk },
      own:
        rec && content
          ? {
              rules: content.rules.length,
              brightness: content.brightness.length,
              defaultLoop: content.defaultLoopId ? loops.get(content.defaultLoopId) ?? null : null,
              updatedAt: parsePbDate(rec.updated)?.toISOString() ?? null,
              appliedAt: parsePbDate(rec.applied_at)?.toISOString() ?? null,
            }
          : null,
      device: summarizeDeviceSchedule(b.device_schedule),
      lastSent: last ? { status: last.status, at: parsePbDate(last.created)?.toISOString() ?? "" } : null,
    };
  });
}

// ── Checks before applying ────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function fleetClosedReason(mode: WriteMode, fleetSwitch: boolean): string | null {
  if (mode === "off") return "Changes to bags are switched off, so only a dry run on the test bag is possible.";
  if (mode === "test") return "Only the test bag can be changed right now.";
  if (!fleetSwitch) return "Switch on “Allow changes to the whole fleet” in Settings first.";
  return null;
}

export async function scheduleChecks(bagId?: string): Promise<ScheduleChecks> {
  const now = new Date();
  const today = todayLondon(now);
  const settings = await getSettings();
  const mode = config.COLORLIGHT_WRITES;
  const fleetSwitch = settings.fleetWritesEnabled;
  const fleetOpen = mode === "fleet" && fleetSwitch;
  const bags = await loadBags();
  const loops = await loadLoopInfo(bags);
  const target = bagId ? bags.find((b) => b.id === bagId) : null;
  if (bagId && !target) throw notFound("Bag not found");
  const rec = target ? await bagRecord(target.id) : await fleetRecord();
  if (!rec) throw notFound(`${target!.name} follows the fleet schedule. Give it its own schedule first.`);
  const content = readContent(rec);
  const dto = toScheduleDto(rec, target?.name ?? null);

  const checks: ScheduleCheck[] = [];
  const blockers = scheduleBlockers(content, loops, today);
  for (const b of blockers) checks.push({ kind: "schedule", tone: "blocker", title: b });

  const testBags = bags.filter(isTestBag);
  const testBag = testBags[0] ?? null;
  const testStatus = testBag ? bagStatus(parsePbDate(testBag.last_report_at), now.getTime()) : null;
  const testClock = testBag ? clockProblem(testBag, now) : null;

  // Which bags this schedule reaches when applied.
  const own = new Map((await bagRecords()).map((r) => [r.bag as string, r]));
  const reach = target ? [target] : bags.filter(inService);
  const wrongClock = reach.filter((b) => clockProblem(b, now));
  const unknownClock = reach.filter((b) => clockMatchesLondon(b.timezone, now) === null);
  const ownBlocked: { name: string; problem: string }[] = [];
  if (!target) {
    for (const b of reach) {
      const o = own.get(b.id);
      if (!o || wrongClock.includes(b)) continue;
      const p = scheduleBlockers(readContent(o), loops, today);
      if (p.length) ownBlocked.push({ name: b.name, problem: p[0] });
    }
  }
  const willGet = reach.length - wrongClock.length - ownBlocked.length;

  if (wrongClock.length) {
    const first = clockProblem(wrongClock[0], now)!;
    const sameTz = wrongClock.every((b) => b.timezone === wrongClock[0].timezone);
    const effect = sameTz ? first.replace(/^Clock on [^,]+, so the schedule would run /, "") : "at the wrong time";
    const tzLabel = sameTz ? clockLabel(wrongClock[0].timezone).replace(/ \(.*\)$/, "") : "the wrong time zone";
    checks.push({
      kind: "clock",
      tone: "blocker",
      title: target
        ? `${target.name}'s clock is on ${tzLabel}, so this would run ${effect} on it.`
        : `${plural(wrongClock.length, "bag")} ${wrongClock.length === 1 ? "has its" : "have their"} clock on ${tzLabel}, so this would run ${effect} on ${wrongClock.length === 1 ? "it" : "them"}.`,
      body: target
        ? "Fix the clock before applying."
        : `${wrongClock.length === 1 ? "It's" : "They're"} left out until ${wrongClock.length === 1 ? "its clock is" : "their clocks are"} fixed:`,
      bags: wrongClock.map((b) => ({ id: b.id, name: b.name })),
      href: "/bags?issue=clock",
      hrefLabel: "Fix clocks",
    });
  }
  for (const o of ownBlocked) {
    checks.push({ kind: "own_schedule", tone: "warning", title: `${o.name}'s own schedule has a problem, so it will be left out.`, body: o.problem });
  }
  if (unknownClock.length) {
    checks.push({
      kind: "clock_unknown",
      tone: "warning",
      title: `We can't read the clock on ${plural(unknownClock.length, "bag")}.`,
      body: `Check ${unknownClock.length === 1 ? "it's" : "they're"} on London time:`,
      bags: unknownClock.map((b) => ({ id: b.id, name: b.name })),
    });
  }
  const live = liveRules(content, today);
  if (live.length && !content.defaultLoopId) {
    checks.push({
      kind: "gaps",
      tone: "warning",
      title: "No default loop, so nothing is scheduled outside the rules.",
      body: "Bags may show a blank screen then. Pick a default loop to fill the gaps.",
    });
  }
  if (!content.defaultLoopId && !live.length && content.brightness.length) {
    checks.push({ kind: "no_loops", tone: "info", title: "No loops in this schedule: bags keep playing what they play now." });
  }
  const leftOutNames = new Set([...wrongClock.map((b) => b.name as string), ...ownBlocked.map((o) => o.name)]);
  const offline = reach.filter((b) => !leftOutNames.has(b.name) && bagStatus(parsePbDate(b.last_report_at), now.getTime()) !== "now");
  if (offline.length) {
    checks.push({
      kind: "offline",
      tone: "info",
      title: target
        ? `${target.name} is offline. It'll pick this up when it next connects.`
        : `${plural(offline.length, "bag")} ${offline.length === 1 ? "is" : "are"} offline. They'll pick this up when they next connect.`,
    });
  }
  if (testBag && testStatus !== "now" && (!target || target.id !== testBag.id)) {
    const last = parsePbDate(testBag.last_report_at);
    const days = last ? Math.floor((now.getTime() - last.getTime()) / 86400000) : null;
    checks.push({
      kind: "test_offline",
      tone: "info",
      title:
        days === null
          ? `The test bag (${testBag.name}) has never connected.`
          : days >= 1
            ? `The test bag (${testBag.name}) has been offline for ${plural(days, "day")}.`
            : `The test bag (${testBag.name}) is offline.`,
      body: "Switch it on to check the change on it before it reaches the fleet.",
    });
  }
  if (testClock) checks.push({ kind: "test_clock", tone: "warning", title: `The test bag (${testBag!.name}) can't be used: ${lowerFirst(testClock)}.` });

  const sunSteps = content.brightness.some((s) => s.from === "sunrise" || s.from === "sunset");
  const brightnessUntil = sunSteps ? addDays(today, SUN_HORIZON_DAYS - 1) : null;
  if (!content.brightness.length) {
    checks.push({ kind: "brightness", tone: "info", title: "Brightness isn't scheduled: bags keep their current level." });
  } else if (brightnessUntil) {
    checks.push({
      kind: "brightness",
      tone: "info",
      title: `Sunrise and sunset times are set up to ${shortDay(brightnessUntil, today)}.`,
      body: "Apply again before then so brightness keeps following the sun.",
    });
  }
  if (dto.changedSinceApply && dto.appliedAt) {
    checks.push({ kind: "changed", tone: "info", title: `Changed since it was applied on ${shortDay(todayLondon(new Date(dto.appliedAt)), today)}. Apply again to update the bags.` });
  }
  if (mode === "off") {
    checks.push({ kind: "mode", tone: "info", title: "Changes are switched off, so this is a dry run.", body: "Nothing is sent to bags. Each change is recorded so you can see what would happen." });
  } else if (mode === "test") {
    checks.push({ kind: "mode", tone: "info", title: "Changes can only go to the test bag right now." });
  } else if (!fleetSwitch) {
    checks.push({
      kind: "mode",
      tone: "warning",
      title: "“Allow changes to the whole fleet” is off in Settings, so only the test bag can be changed.",
      href: "/settings",
      hrefLabel: "Settings",
    });
  } else {
    checks.push({ kind: "mode", tone: "warning", title: "Changes to the whole fleet are switched on. Applying reaches every bag." });
  }
  const rank = { blocker: 0, warning: 1, info: 2, ok: 3 };
  checks.sort((a, b) => rank[a.tone] - rank[b.tone]);
  if (!checks.some((c) => c.tone === "blocker" || c.tone === "warning")) {
    checks.unshift({ kind: "ok", tone: "ok", title: "Checked · ready to apply" });
  }

  let canTryTest = true;
  let tryTestReason: string | null = null;
  if (!testBag) [canTryTest, tryTestReason] = [false, "The test bag isn't in the fleet list."];
  else if (blockers.length) [canTryTest, tryTestReason] = [false, "Fix the problems above first."];
  else if (testClock) [canTryTest, tryTestReason] = [false, "The test bag's clock isn't on London time."];

  let canApply = true;
  let applyReason: string | null = null;
  // The test bag's own schedule can always go (a dry run while changes are off);
  // anything else needs changes switched to the fleet and the owner's switch on.
  const closed = target && isTestBag(target) ? null : fleetClosedReason(mode, fleetSwitch);
  if (blockers.length) [canApply, applyReason] = [false, "Fix the problems above first."];
  else if (target && clockProblem(target, now)) [canApply, applyReason] = [false, `Fix ${target.name}'s clock first.`];
  else if (closed) [canApply, applyReason] = [false, closed];
  else if (!target && willGet <= 0) [canApply, applyReason] = [false, "No bags can take it right now."];

  return {
    writeMode: mode,
    fleetSwitch,
    testBag: testBag
      ? { id: testBag.id, name: testBag.name, status: testStatus!, lastReportAt: parsePbDate(testBag.last_report_at)?.toISOString() ?? null }
      : null,
    checks,
    canTryTest,
    tryTestReason,
    canApply,
    applyReason,
    targets: { willGet: Math.max(0, willGet), leftOut: wrongClock.length + ownBlocked.length },
    brightnessUntil,
  };
}

// ── Apply ─────────────────────────────────────────────────────────────────────

async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
  }));
}

const STATUS_WORD: Record<ApplyBagStatus, string> = {
  dry_run: "dry run",
  blocked: "blocked",
  sent: "sent",
  failed: "failed",
  skipped: "left out",
};

interface Prepared {
  rec: RecordModel;
  content: ScheduleContent;
  hash: string;
  blocker: string | null;
  built: ColorlightSchedule | null;
}

export async function applySchedule(user: SessionUser, req: ApplyRequest): Promise<ApplyResult> {
  const now = new Date();
  const at = now.toISOString();
  const today = todayLondon(now);
  const settings = await getSettings();
  const mode = config.COLORLIGHT_WRITES;
  const fleetOpen = mode === "fleet" && settings.fleetWritesEnabled;
  const bags = await loadBags({ fresh: true });
  const loops = await loadLoopInfo(bags);
  const own = new Map((await bagRecords()).map((r) => [r.bag as string, r]));

  let targets: RecordModel[];
  let sourceFor: (b: RecordModel) => Promise<RecordModel>;
  let fleetSource: RecordModel | null = null;
  if (req.target === "test") {
    targets = bags.filter(isTestBag);
    if (!targets.length) throw badRequest("The test bag isn't in the fleet list.");
    const src = req.bagId ? own.get(req.bagId) : await fleetRecord();
    if (!src) throw notFound("That bag doesn't have its own schedule.");
    sourceFor = async () => src;
  } else if (req.target === "fleet") {
    const reason = fleetClosedReason(mode, settings.fleetWritesEnabled);
    if (reason) throw new HttpError(403, reason);
    targets = bags.filter(inService);
    if (!targets.length) throw badRequest("No bags can take it right now.");
    const fleet = await fleetRecord();
    sourceFor = async (b) => own.get(b.id) ?? fleet;
    fleetSource = fleet;
  } else {
    const bag = bags.find((b) => b.id === req.bagId);
    if (!bag) throw notFound("Bag not found");
    if (!isTestBag(bag) && !fleetOpen) {
      throw new HttpError(403, fleetClosedReason(mode, settings.fleetWritesEnabled) ?? "Only the test bag can be changed right now.");
    }
    targets = [bag];
    const fleet = await fleetRecord();
    sourceFor = async (b) => own.get(b.id) ?? fleet;
  }

  const prepared = new Map<string, Prepared>();
  const prepare = (rec: RecordModel): Prepared => {
    const hit = prepared.get(rec.id);
    if (hit) return hit;
    const content = readContent(rec);
    const blocker = scheduleBlockers(content, loops, today)[0] ?? null;
    const built = blocker ? null : buildForBags(content, loops, today, settings.brightnessCommandScale);
    const p: Prepared = { rec, content, hash: contentHash(content), blocker, built };
    prepared.set(rec.id, p);
    return p;
  };
  // Nothing is attempted when the schedule being applied has a problem
  // (for the fleet, bags' own schedules with problems are left out one by one).
  const main = prepare(fleetSource ?? (await sourceFor(targets[0])));
  if (main.blocker) throw badRequest(main.blocker);

  const results: (ApplyBagResult & { sourceId: string })[] = [];
  await mapLimit(targets, 4, async (bag) => {
    const src = await sourceFor(bag);
    const p = prepare(src);
    const ownSchedule = src.scope === "bag" && src.bag === bag.id;
    const scheduleName =
      src.scope !== "bag" ? "the fleet schedule" : ownSchedule ? "its own schedule" : `${bags.find((b) => b.id === src.bag)?.name ?? "another bag"}'s own schedule`;
    const base = { bagId: bag.id, bagName: bag.name, ownSchedule, scheduleName, sourceId: src.id, commandId: null as string | null };
    if (p.blocker || !p.built) {
      results.push({ ...base, status: "skipped", message: `Left out: its own schedule has a problem. ${p.blocker ?? ""}`.trim() });
      return;
    }
    const clock = clockProblem(bag, now);
    if (clock) {
      results.push({ ...base, status: "skipped", message: `Left out: ${lowerFirst(clock)}. Fix the clock first.` });
      return;
    }
    let status: ApplyBagStatus;
    let message: string;
    let error = "";
    let response: unknown = null;
    try {
      const outcome = await putTerminalSchedule(bag.colorlight_id, p.built.scheduleJson);
      response = outcome.response ?? null;
      if (outcome.decision.action === "send") {
        status = "sent";
        message = "Sent. It switches over when the bag next checks in.";
      } else if (outcome.decision.action === "dry_run") {
        status = "dry_run";
        message = "Dry run: nothing was sent.";
      } else {
        status = "blocked";
        error = outcome.decision.reason;
        message = `Blocked: ${outcome.decision.reason}`;
      }
    } catch (err) {
      if (err instanceof WriteBlockedError) {
        status = "blocked";
        error = err.message;
        message = `Blocked: ${err.message}`;
      } else {
        status = "failed";
        error = (err as Error).message;
        message = `Couldn't send: ${error}`;
        log.warn(`schedule for ${bag.name} failed`, err);
      }
    }
    const payloadSize = JSON.stringify(p.built.scheduleJson).length;
    const cmd = await pb.collection("commands").create<RecordModel>({
      bag: bag.id,
      type: "schedule",
      value: {
        summary: `${scheduleName.charAt(0).toUpperCase()}${scheduleName.slice(1)}: ${plural(p.built.loopParts, "loop part")}, ${plural(p.built.brightnessParts, "brightness change")}${p.built.brightnessUntil ? ` (sun times to ${shortDay(p.built.brightnessUntil, today)})` : ""}`,
        schedule: src.scope === "bag" ? (ownSchedule ? "own" : `copy of ${scheduleName}`) : "fleet",
        scheduleId: src.id,
        target: req.target,
        hash: p.hash,
        loopParts: p.built.loopParts,
        brightnessParts: p.built.brightnessParts,
        brightnessUntil: p.built.brightnessUntil,
        brightness: describeBrightness(p.content.brightness),
        payload: payloadSize < 150000 ? p.built.scheduleJson : null,
      },
      status,
      response,
      error,
      requested_by: user.id,
    });
    results.push({ ...base, status, message, commandId: cmd.id });
  });
  results.sort((a, b) => a.bagName.localeCompare(b.bagName, "en-GB", { numeric: true }));

  const counts: Record<ApplyBagStatus, number> = { dry_run: 0, blocked: 0, sent: 0, failed: 0, skipped: 0 };
  for (const r of results) counts[r.status]++;
  // The schedule this apply is "about": the fleet one for a fleet apply, else the only one.
  const first = main;
  const summary = summarizeApply(req.target, results, counts, first?.built ?? null, mode);

  // Remember the attempt on each schedule used; a real send marks it applied.
  const attempt: ScheduleApplyAttempt = { at, target: req.target, mode, summary, counts, by: user.name };
  for (const p of prepared.values()) {
    const mine = results.filter((r) => r.sourceId === p.rec.id);
    if (!mine.length) continue;
    const sentAny = mine.some((r) => r.status === "sent");
    const prev = (p.rec.applied_to ?? {}) as AppliedTo;
    const applied: AppliedTo = { ...prev, lastAttempt: attempt };
    if (sentAny && req.target === "test") applied.lastTest = { at, hash: p.hash };
    else if (sentAny) applied.lastSent = { at, hash: p.hash, target: req.target };
    await pb.collection("schedules").update(p.rec.id, {
      applied_to: applied,
      ...(sentAny && req.target !== "test" ? { status: "applied", applied_at: pbDate(now) } : {}),
    });
  }

  const sourceLabel = first?.rec.scope === "bag" && req.target !== "fleet" ? `${bags.find((b) => b.id === first.rec.bag)?.name ?? "A bag"}'s own schedule` : "Fleet schedule";
  const targetLabel =
    req.target === "test" ? `tried on the test bag (${targets.map((b) => b.name).join(", ")})` : req.target === "fleet" ? "applied to the fleet" : `applied to ${targets[0].name}`;
  await audit(
    user,
    "schedule.apply",
    `${sourceLabel} ${targetLabel}: ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS_WORD[k as ApplyBagStatus]}`).join(", ")}`,
    { type: "schedule", id: first?.rec.id ?? FLEET_SCHEDULE_ID },
    { target: req.target, mode, counts, bags: results.map((r) => `${r.bagName}: ${STATUS_WORD[r.status]}`) },
  );

  return {
    target: req.target,
    mode,
    at,
    summary,
    counts,
    results: results.map(({ sourceId: _s, ...r }) => r),
    brightnessUntil: first?.built?.brightnessUntil ?? null,
    parts: { loops: first?.built?.loopParts ?? 0, brightness: first?.built?.brightnessParts ?? 0 },
  };
}

function summarizeApply(
  target: ApplyTarget,
  results: ApplyBagResult[],
  counts: Record<ApplyBagStatus, number>,
  built: ColorlightSchedule | null,
  mode: WriteMode,
): string {
  const parts = built ? `${plural(built.loopParts, "loop part")}, ${plural(built.brightnessParts, "brightness change")}` : "";
  if (results.length === 1) {
    const r = results[0];
    if (r.status === "dry_run") return `Dry run: nothing was sent. ${r.bagName} would get ${r.scheduleName}${parts ? ` (${parts})` : ""}.`;
    if (r.status === "sent") return `Sent to ${r.bagName}. It switches over when the bag next checks in.`;
    return `${r.bagName}: ${r.message}`;
  }
  const bits: string[] = [];
  if (counts.sent) bits.push(`Sent to ${plural(counts.sent, "bag")}`);
  if (counts.dry_run) bits.push(`Dry run for ${plural(counts.dry_run, "bag")}: nothing was sent`);
  if (counts.blocked) bits.push(`${counts.blocked} blocked`);
  if (counts.failed) bits.push(`${counts.failed} failed`);
  if (counts.skipped) bits.push(`${counts.skipped} left out`);
  const tail = counts.sent && mode !== "off" ? " They switch over when they next check in." : "";
  return `${bits.join(". ")}.${tail}`;
}

// ── Save helpers used by the routes ───────────────────────────────────────────

export function describeContentChange(before: ScheduleContent | null, after: ScheduleContent, loopName: (id: string) => string): string {
  const bits: string[] = [];
  if (!before || before.defaultLoopId !== after.defaultLoopId) {
    bits.push(after.defaultLoopId ? `default loop “${loopName(after.defaultLoopId)}”` : "no default loop");
  }
  const ruleKey = (c: ScheduleContent) => JSON.stringify(renumberRules(c.rules).map((r) => [r.loopId, r.startDate, r.endDate, r.weekdays, r.startTime, r.endTime]));
  if (!before || ruleKey(before) !== ruleKey(after)) bits.push(plural(after.rules.length, "loop rule"));
  if (!before || JSON.stringify(before.brightness) !== JSON.stringify(after.brightness)) bits.push(`brightness ${describeBrightness(after.brightness)}`);
  return bits.length ? bits.join("; ") : "no changes";
}
