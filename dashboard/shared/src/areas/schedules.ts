// Contracts and pure logic for the schedules area: loop rules resolved by
// priority, brightness plans that follow London's sunrise and sunset, and the
// shapes the schedules API sends and receives. Used by both the API and the web.

import { addDays, gbDateFormat, isDay, londonOffsetMinutes, londonParts, londonDayStart } from "../time";
import type { CommandSummary, WriteMode } from "../api";
import type { BagStatus, Lifecycle } from "../status";

// ── Model ─────────────────────────────────────────────────────────────────────

/** Monday first: index 0 = Monday … 6 = Sunday. */
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A loop playing on chosen dates, days and times. */
export interface LoopRule {
  id: string;
  loopId: string;
  /** First day it applies (London), YYYY-MM-DD */
  startDate: string;
  /** Last day it applies (inclusive), or null for no end */
  endDate: string | null;
  /** Monday … Sunday */
  weekdays: boolean[];
  /** "HH:MM" London time */
  startTime: string;
  /** "HH:MM"; "24:00" or "00:00" = midnight. At or before the start, it runs past midnight into the next day. */
  endTime: string;
  /** 1 is the top. When two rules overlap, the one with the smaller number plays. */
  priority: number;
}

/** When a brightness step starts: a fixed "HH:MM" or London's actual sunrise / sunset that day. */
export type BrightnessFrom = "sunrise" | "sunset" | (string & {});

export interface BrightnessStep {
  from: BrightnessFrom;
  /** 1–100 */
  pct: number;
}

/** What a schedule says. A fleet schedule and a bag's own schedule look the same. */
export interface ScheduleContent {
  /** Plays whenever no rule does. Null leaves those times with nothing scheduled. */
  defaultLoopId: string | null;
  rules: LoopRule[];
  brightness: BrightnessStep[];
}

export type ScheduleScope = "fleet" | "bag";

// ── API shapes ────────────────────────────────────────────────────────────────

/** A loop as the schedule editor needs it. */
export interface ScheduleLoop {
  id: string;
  name: string;
  status: string;
  programId: number | null;
  /** True when it can be put on a bag's schedule (on Colorlight, file name known). */
  ready: boolean;
  /** Why it can't be scheduled yet, in plain English. */
  problem: string | null;
}

export type ApplyTarget = "test" | "fleet" | "bag";
export type ApplyBagStatus = "dry_run" | "blocked" | "sent" | "failed" | "skipped";

export interface ScheduleApplyAttempt {
  at: string;
  target: ApplyTarget;
  mode: WriteMode;
  summary: string;
  counts: Partial<Record<ApplyBagStatus, number>>;
  by: string | null;
}

export interface ScheduleDto extends ScheduleContent {
  id: string;
  scope: ScheduleScope;
  bagId: string | null;
  bagName: string | null;
  name: string;
  /** "applied" = sent to at least one bag and not changed since. */
  status: "draft" | "applied";
  /** Last time it actually reached a bag (not a dry run). */
  appliedAt: string | null;
  changedSinceApply: boolean;
  lastAttempt: ScheduleApplyAttempt | null;
  updatedAt: string | null;
}

export interface ScheduleResponse {
  /** Null when a bag has no schedule of its own (it follows the fleet one). */
  schedule: ScheduleDto | null;
  loops: ScheduleLoop[];
  bag: { id: string; name: string; isTestBag: boolean } | null;
  /** Bags in service (not retired or lost), and how many have their own schedule. */
  bags: { total: number; own: number };
  today: string;
}

/** PUT /schedules/fleet and /schedules/bag/:id */
export type ScheduleSaveRequest = ScheduleContent;

export interface PreviewBlock {
  start: string;
  end: string;
  startMin: number;
  endMin: number;
  /** Null = nothing scheduled */
  loopId: string | null;
  loopName: string | null;
  /** Null = the default loop (or nothing) */
  ruleId: string | null;
  priority: number | null;
}

export interface PreviewStep {
  at: string;
  atMin: number;
  pct: number;
  from: BrightnessFrom;
}

export interface PreviewDay {
  day: string;
  blocks: PreviewBlock[];
  /** startPct carries over from the previous evening's last step. */
  brightness: { startPct: number | null; steps: PreviewStep[] };
  sunrise: string;
  sunset: string;
  clockChange: "forward" | "back" | null;
}

export interface SchedulePreview {
  weekOf: string;
  today: string;
  days: PreviewDay[];
}

export type CheckTone = "blocker" | "warning" | "info" | "ok";

export interface ScheduleCheck {
  kind: string;
  tone: CheckTone;
  title: string;
  body?: string;
  bags?: { id: string; name: string }[];
  href?: string;
  hrefLabel?: string;
}

export interface ScheduleChecks {
  writeMode: WriteMode;
  fleetSwitch: boolean;
  testBag: { id: string; name: string; status: BagStatus; lastReportAt: string | null } | null;
  checks: ScheduleCheck[];
  canTryTest: boolean;
  tryTestReason: string | null;
  /** The fleet (fleet schedule) or the one bag (a bag's own schedule). */
  canApply: boolean;
  applyReason: string | null;
  targets: { willGet: number; leftOut: number };
  /** Sunrise/sunset brightness times are written out up to this day. */
  brightnessUntil: string | null;
}

export interface ApplyRequest {
  target: ApplyTarget;
  /** target "test": try this bag's own schedule on the test bag (default: the fleet schedule).
   *  target "bag": send this bag its schedule. */
  bagId?: string;
}

export interface ApplyBagResult {
  bagId: string;
  bagName: string;
  status: ApplyBagStatus;
  message: string;
  /** True when the bag got its own schedule rather than the fleet one. */
  ownSchedule: boolean;
  /** Which schedule it got: "the fleet schedule", "its own schedule" or "Bag 012's own schedule". */
  scheduleName: string;
  commandId: string | null;
}

export interface ApplyResult {
  target: ApplyTarget;
  mode: WriteMode;
  at: string;
  summary: string;
  counts: Record<ApplyBagStatus, number>;
  results: ApplyBagResult[];
  brightnessUntil: string | null;
  parts: { loops: number; brightness: number };
}

export interface DeviceScheduleSummary {
  /** False when we haven't read the bag's schedule from Colorlight yet. */
  read: boolean;
  loops: string[];
  loopParts: number;
  brightnessChanges: number;
  otherCommands: number;
  updatedAt: string | null;
  text: string;
}

export interface ScheduleBagRow {
  id: string;
  name: string;
  isTestBag: boolean;
  status: BagStatus;
  lifecycle: Lifecycle;
  lastReportAt: string | null;
  clock: { label: string; ok: boolean | null };
  own: { rules: number; brightness: number; defaultLoop: string | null; updatedAt: string | null; appliedAt: string | null } | null;
  device: DeviceScheduleSummary;
  lastSent: { status: CommandSummary["status"]; at: string } | null;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/** "17:30" → 1050. "24:00" → 1440. Anything else invalid → null. */
export function hmToMin(hm: string | null | undefined): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hm ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h === 24 && mm === 0) return 1440;
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** 1050 → "17:30"; 1440 → "24:00". */
export function minToHm(min: number): string {
  const m = Math.max(0, Math.min(1440, Math.round(min)));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing `day`. */
export function mondayOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** Clocks change on this London day? (last Sunday of March / October) */
export function londonClockChange(day: string): "forward" | "back" | null {
  const before = londonOffsetMinutes(londonDayStart(day));
  const after = londonOffsetMinutes(new Date(londonDayStart(addDays(day, 1)).getTime() - 1000));
  if (after > before) return "forward";
  if (after < before) return "back";
  return null;
}

// ── London sunrise and sunset (NOAA solar calculator approximation) ───────────

export const LONDON = { lat: 51.5074, lng: -0.1278 } as const;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Solar declination (degrees) and equation of time (minutes) at a Julian day. */
function solarPosition(jd: number): { decl: number; eqTime: number } {
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const appLong = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong))));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime =
    4 *
    deg(
      y * Math.sin(2 * rad(l0)) -
        2 * e * Math.sin(rad(m)) +
        4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0)) -
        0.5 * y * y * Math.sin(4 * rad(l0)) -
        1.25 * e * e * Math.sin(2 * rad(m)),
    );
  return { decl, eqTime };
}

/** Sunrise or sunset on a UTC date as a UTC instant (standard refraction, upper limb: 90.833°). */
export function sunEvent(day: string, rising: boolean, lat: number = LONDON.lat, lng: number = LONDON.lng): Date | null {
  const [y, mo, d] = day.split("-").map(Number);
  const midnight = Date.UTC(y, mo - 1, d);
  let minutes = 720;
  // Solve at noon, then twice more at the event itself for better accuracy.
  for (let i = 0; i < 3; i++) {
    const jd = (midnight + minutes * 60000) / 86400000 + 2440587.5;
    const { decl, eqTime } = solarPosition(jd);
    const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    if (cosH < -1 || cosH > 1) return null; // midnight sun / polar night; never in London
    const ha = deg(Math.acos(cosH));
    const noon = 720 - 4 * lng - eqTime;
    minutes = rising ? noon - 4 * ha : noon + 4 * ha;
  }
  return new Date(Math.round((midnight + minutes * 60000) / 60000) * 60000);
}

export interface SunTimes {
  day: string;
  /** London local "HH:MM" (GMT or BST, whichever applies that day) */
  sunrise: string;
  sunset: string;
  sunriseMin: number;
  sunsetMin: number;
}

const sunCache = new Map<string, SunTimes>();

/** London's sunrise and sunset in London local time for a London day. */
export function londonSunTimes(day: string): SunTimes {
  const hit = sunCache.get(day);
  if (hit) return hit;
  const local = (d: Date | null, fallback: number) => {
    if (!d) return fallback;
    const p = londonParts(d);
    return p.hour * 60 + p.minute;
  };
  const sunriseMin = local(sunEvent(day, true), 6 * 60);
  const sunsetMin = local(sunEvent(day, false), 18 * 60);
  const out = { day, sunrise: minToHm(sunriseMin), sunset: minToHm(sunsetMin), sunriseMin, sunsetMin };
  if (sunCache.size > 4000) sunCache.clear();
  sunCache.set(day, out);
  return out;
}

// ── Loop rules → what plays when ──────────────────────────────────────────────

/** The rule's daily window in minutes. Overnight rules end the next day. */
export function ruleWindow(rule: Pick<LoopRule, "startTime" | "endTime">): { start: number; end: number; overnight: boolean } {
  const start = hmToMin(rule.startTime) ?? 0;
  let end = hmToMin(rule.endTime) ?? 1440;
  if (end === 0) end = 1440;
  return { start, end, overnight: end <= start };
}

/** Does the rule start a window on this day (date range + weekday)? */
export function ruleActiveOn(rule: LoopRule, day: string): boolean {
  if (day < rule.startDate) return false;
  if (rule.endDate && day > rule.endDate) return false;
  return !!rule.weekdays[weekdayIndex(day)];
}

/** Minute ranges [start, end) the rule covers on a London day, including the tail of last night's window. */
export function ruleSegments(rule: LoopRule, day: string): [number, number][] {
  const w = ruleWindow(rule);
  const out: [number, number][] = [];
  if (!w.overnight) {
    if (ruleActiveOn(rule, day)) out.push([w.start, w.end]);
    return out;
  }
  if (w.end > 0 && w.end < 1440 && ruleActiveOn(rule, addDays(day, -1))) out.push([0, w.end]);
  if (ruleActiveOn(rule, day)) out.push([w.start, 1440]);
  return out;
}

export interface DayBlock {
  start: number;
  end: number;
  loopId: string | null;
  ruleId: string | null;
  priority: number | null;
}

/**
 * What plays across a London day: the top-priority rule wherever rules overlap,
 * the default loop in any gap (or nothing when there's no default loop).
 */
export function resolveDay(content: ScheduleContent, day: string): DayBlock[] {
  const segs: { start: number; end: number; rule: LoopRule }[] = [];
  for (const rule of content.rules) {
    for (const [a, b] of ruleSegments(rule, day)) if (b > a) segs.push({ start: a, end: b, rule });
  }
  const cuts = [...new Set([0, 1440, ...segs.flatMap((s) => [s.start, s.end])])].sort((x, y) => x - y);
  const out: DayBlock[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    let best: (typeof segs)[number] | null = null;
    for (const s of segs) {
      if (s.start <= a && s.end >= b && (!best || s.rule.priority < best.rule.priority)) best = s;
    }
    const block: DayBlock = best
      ? { start: a, end: b, loopId: best.rule.loopId, ruleId: best.rule.id, priority: best.rule.priority }
      : { start: a, end: b, loopId: content.defaultLoopId, ruleId: null, priority: null };
    const last = out[out.length - 1];
    if (last && last.loopId === block.loopId && last.ruleId === block.ruleId) last.end = b;
    else out.push(block);
  }
  return out;
}

// ── Brightness plan → steps on a day ──────────────────────────────────────────

export interface ResolvedStep {
  at: number;
  pct: number;
  from: BrightnessFrom;
  index: number;
}

/** A plan's steps on a day, in time order, with sunrise/sunset resolved for London. */
export function brightnessStepsOn(steps: BrightnessStep[], day: string): ResolvedStep[] {
  if (!steps.length) return [];
  const sun = londonSunTimes(day);
  return steps
    .map((s, index) => ({
      at: s.from === "sunrise" ? sun.sunriseMin : s.from === "sunset" ? sun.sunsetMin : hmToMin(s.from) ?? 0,
      pct: s.pct,
      from: s.from,
      index,
    }))
    .sort((a, b) => a.at - b.at || a.index - b.index);
}

/** A day's brightness: the level carried over from the evening before, then each step. */
export function brightnessDay(steps: BrightnessStep[], day: string): { startPct: number | null; steps: ResolvedStep[] } {
  const today = brightnessStepsOn(steps, day);
  if (!today.length) return { startPct: null, steps: [] };
  const prev = brightnessStepsOn(steps, addDays(day, -1));
  return { startPct: prev[prev.length - 1].pct, steps: today };
}

// ── Validation (shared by the API and the editor) ─────────────────────────────

export const MAX_RULES = 40;
export const MAX_BRIGHTNESS_STEPS = 12;

export function isValidFrom(from: string): boolean {
  if (from === "sunrise" || from === "sunset") return true;
  const m = hmToMin(from);
  return m !== null && m < 1440;
}

/** Plain-English problems with a schedule; empty when it's fine. */
export function scheduleProblems(c: ScheduleContent, loopName: (id: string) => string | null = () => null): string[] {
  const out: string[] = [];
  if (c.rules.length > MAX_RULES) out.push(`Keep it to ${MAX_RULES} loop rules or fewer.`);
  const seen = new Set<number>();
  c.rules.forEach((r, i) => {
    const name = loopName(r.loopId);
    const n = name ? `The “${name}” rule` : `Rule ${i + 1}`;
    if (!r.loopId) out.push(`${n}: pick a loop.`);
    if (!isDay(r.startDate)) out.push(`${n}: the start date isn't a real date.`);
    if (r.endDate !== null && !isDay(r.endDate)) out.push(`${n}: the end date isn't a real date.`);
    if (isDay(r.startDate) && r.endDate && isDay(r.endDate) && r.endDate < r.startDate) out.push(`${n}: the end date is before the start date.`);
    if (!Array.isArray(r.weekdays) || r.weekdays.length !== 7) out.push(`${n}: the days of the week aren't right.`);
    else if (!r.weekdays.some(Boolean)) out.push(`${n}: pick at least one day of the week.`);
    const s = hmToMin(r.startTime);
    const e = hmToMin(r.endTime);
    if (s === null || s === 1440) out.push(`${n}: the start time isn't right.`);
    if (e === null) out.push(`${n}: the end time isn't right.`);
    if (s !== null && e !== null && s === e && s !== 0) out.push(`${n}: the start and end times are the same.`);
    if (!Number.isInteger(r.priority) || r.priority < 1) out.push(`${n}: the priority must be a whole number, 1 or more.`);
    else if (seen.has(r.priority)) out.push(`Two rules have priority ${r.priority}. Each rule needs its own.`);
    else seen.add(r.priority);
  });
  if (c.brightness.length > MAX_BRIGHTNESS_STEPS) out.push(`Keep brightness to ${MAX_BRIGHTNESS_STEPS} steps or fewer.`);
  const froms = new Set<string>();
  c.brightness.forEach((b, i) => {
    if (!isValidFrom(b.from)) out.push(`Brightness step ${i + 1}: the time isn't right.`);
    if (!Number.isInteger(b.pct) || b.pct < 1 || b.pct > 100) out.push(`Brightness step ${i + 1}: pick a level from 1% to 100%.`);
    if (froms.has(b.from)) out.push(`Two brightness steps start ${describeFrom(b.from)}. Keep one.`);
    froms.add(b.from);
  });
  return out;
}

/** Rules sorted by priority and renumbered 1…n (order kept). */
export function renumberRules(rules: LoopRule[]): LoopRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority).map((r, i) => ({ ...r, priority: i + 1 }));
}

// ── Plain-English descriptions ────────────────────────────────────────────────

const dayMonth = gbDateFormat({ timeZone: "UTC", day: "numeric", month: "short" });
const dayMonthYear = gbDateFormat({ timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** "5 Oct" (adds the year when it isn't `today`'s year). */
export function shortDay(day: string, today?: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return today && day.slice(0, 4) !== today.slice(0, 4) ? dayMonthYear.format(d) : dayMonth.format(d);
}

export function describeWeekdays(w: boolean[]): string {
  const on = w.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  if (on.length === 7) return "every day";
  if (on.length === 0) return "no days";
  if (on.length === 5 && on.every((i) => i < 5)) return "weekdays";
  if (on.length === 2 && w[5] && w[6]) return "Sat and Sun";
  const contiguous = on.every((i, k) => k === 0 || i === on[k - 1] + 1);
  if (contiguous && on.length >= 3) return `${WEEKDAY_SHORT[on[0]]} – ${WEEKDAY_SHORT[on[on.length - 1]]}`;
  const names = on.map((i) => WEEKDAY_SHORT[i]);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function describeDates(startDate: string, endDate: string | null, today: string): string {
  if (endDate && endDate < today) return `Ended ${shortDay(endDate, today)}`;
  if (!endDate) return startDate <= today ? (startDate === today ? "From today" : `Since ${shortDay(startDate, today)}`) : `From ${shortDay(startDate, today)}`;
  if (startDate === endDate) return shortDay(startDate, today);
  return `${shortDay(startDate, today)} – ${shortDay(endDate, today)}`;
}

export function describeTimes(startTime: string, endTime: string): string {
  const w = ruleWindow({ startTime, endTime });
  if (w.start === 0 && w.end === 1440) return "all day";
  return `${minToHm(w.start)} – ${minToHm(w.end === 1440 ? 1440 : w.end)}${w.overnight ? " (next day)" : ""}`;
}

/** "1 Oct – 31 Oct · every day · 17:00 – 23:30" */
export function describeRule(rule: LoopRule, today: string): string {
  return `${describeDates(rule.startDate, rule.endDate, today)} · ${describeWeekdays(rule.weekdays)} · ${describeTimes(rule.startTime, rule.endTime)}`;
}

export function describeFrom(from: BrightnessFrom): string {
  return from === "sunrise" ? "at sunrise" : from === "sunset" ? "at sunset" : `at ${from}`;
}

/** "85% at sunrise · 65% at sunset · 45% at 22:00" */
export function describeBrightness(steps: BrightnessStep[]): string {
  if (!steps.length) return "Not scheduled: bags keep their current brightness";
  return steps.map((s) => `${s.pct}% ${describeFrom(s.from)}`).join(" · ");
}

export function emptySchedule(): ScheduleContent {
  return { defaultLoopId: null, rules: [], brightness: [] };
}
