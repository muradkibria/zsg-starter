// Contracts and small pure helpers for the bags area (the register and the
// bag page). Owned by the bags feature. Names are prefixed "bag"/"Bag" so they
// never collide with other areas in the shared barrel.

import type { BagIssueKind, BagSummary } from "../api";
import type { BagStatus, Lifecycle } from "../status";

// ── Lifecycle ─────────────────────────────────────────────────────────────────

export const BAG_LIFECYCLES: Lifecycle[] = ["active", "storage", "repair", "lost", "retired"];

export const BAG_LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  active: "Active",
  storage: "In storage",
  repair: "In repair",
  lost: "Lost",
  retired: "Retired",
};

export const BAG_LIFECYCLE_HINT: Record<Lifecycle, string> = {
  active: "In the fleet. Flagged if it stops reporting for a week.",
  storage: "Kept at the depot. Not counted as missing.",
  repair: "Being fixed. Not counted as missing.",
  lost: "Can't be found. Not counted as missing.",
  retired: "Out of the fleet for good. Hidden from the map and the counts.",
};

/** POST /api/bags/lifecycle — mark several bags at once (e.g. "in storage"). */
export interface BagsLifecycleRequest {
  bagIds: string[];
  lifecycle: Lifecycle;
  lifecycleNote?: string;
}

export interface BagsLifecycleResult {
  /** Every requested bag after the change */
  bags: BagSummary[];
  /** Ids whose lifecycle actually changed */
  changed: string[];
}

// ── Issues ────────────────────────────────────────────────────────────────────

/** Most urgent first — the order issue filters are shown in. */
export const BAG_ISSUE_ORDER: BagIssueKind[] = ["not_seen", "clock", "no_rider", "old_loop", "brightness", "software"];

export const BAG_ISSUE_META: Record<BagIssueKind, { chip: string; tone: "red" | "amber"; explain: string }> = {
  not_seen: {
    chip: "Missing 7+ days",
    tone: "red",
    explain: "Not seen for over a week and still marked active. In storage, broken or lost? Mark them so they stop counting as missing.",
  },
  clock: {
    chip: "Clock not London time",
    tone: "red",
    explain: "Schedules would run at the wrong time on these bags. Fix the clock before applying any.",
  },
  no_rider: {
    chip: "Out without a rider",
    tone: "amber",
    explain: "Their hours and routes can't be credited to anyone until a rider is assigned.",
  },
  old_loop: {
    chip: "Different loop",
    tone: "amber",
    explain: "Playing something other than the fleet loop.",
  },
  brightness: {
    chip: "Brightness off target",
    tone: "amber",
    explain: "Brighter or dimmer than the fleet brightness.",
  },
  software: {
    chip: "Older software",
    tone: "amber",
    explain: "The rest of the fleet runs newer software.",
  },
};

export function isBagIssueKind(v: unknown): v is BagIssueKind {
  return typeof v === "string" && (BAG_ISSUE_ORDER as string[]).includes(v);
}

// ── "When was it last seen" ───────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Plain-English "last seen" text for a bag:
 * "Out now", "Seen 40 min ago", "Seen 4 h ago", "Seen 2 days ago",
 * "Not seen for 48 days", "Never seen".
 */
export function bagSeenLabel(status: BagStatus, lastReportAt: string | null | undefined, now: number = Date.now()): string {
  if (!lastReportAt) return "Never seen";
  if (status === "now") return "Out now";
  const age = Math.max(0, now - Date.parse(lastReportAt));
  if (status === "gone") {
    const d = Math.floor(age / DAY);
    return `Not seen for ${d} ${d === 1 ? "day" : "days"}`;
  }
  if (age < HOUR) return `Seen ${Math.max(1, Math.floor(age / MIN))} min ago`;
  if (age < DAY) return `Seen ${Math.floor(age / HOUR)} h ago`;
  const d = Math.floor(age / DAY);
  return `Seen ${d} ${d === 1 ? "day" : "days"} ago`;
}

/** "3 months", "12 days", "5 h" — how long between two instants (end defaults to now). */
export function bagSpanLabel(startIso: string, endIso: string | null | undefined, now: number = Date.now()): string {
  const ms = Math.max(0, (endIso ? Date.parse(endIso) : now) - Date.parse(startIso));
  if (ms < DAY) return `${Math.max(1, Math.round(ms / HOUR))} h`;
  const days = Math.round(ms / DAY);
  if (days < 60) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} months`;
  return `${Math.round(days / 365.25)} years`;
}

// ── Device schedule → plain English ───────────────────────────────────────────
//
// Colorlight hasn't returned a schedule for any of our bags yet, so the exact
// shape isn't confirmed. This reads the shapes Colorlight documents (program
// and command schedules with dates, times, weekdays and a priority)
// defensively. Anything it can't read is counted, never guessed.

export interface BagScheduleLine {
  kind: "loop" | "brightness" | "screen_off" | "screen_on" | "restart" | "other";
  /** e.g. Loop "Autumn loop" · Brightness 60% */
  title: string;
  /** e.g. "1 Oct – 31 Oct · Mon–Fri · 17:00–23:30"; "Every day, all day" when unlimited */
  when: string;
  priority: number | null;
}

export type BagScheduleSummary =
  | { state: "none" }
  | { state: "rules"; lines: BagScheduleLine[]; unreadable: number };

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

function pick(o: Rec, keys: string[]): unknown {
  for (const k of keys) {
    const hit = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
    if (hit && o[hit] !== undefined && o[hit] !== null && o[hit] !== "") return o[hit];
  }
  return undefined;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

function unwrap(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return unwrap(JSON.parse(raw));
    } catch {
      return raw.trim() ? raw : null;
    }
  }
  if (isRec(raw) && Object.keys(raw).length === 1 && ("data" in raw || "schedule" in raw)) {
    return unwrap(raw.data ?? raw.schedule);
  }
  return raw;
}

/** Rule-like items from whatever the bag returned. */
function collectItems(raw: unknown): Rec[] | null {
  const v = unwrap(raw);
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x) => (isRec(x) && hasListKeys(x) ? collectItems(x) ?? [] : isRec(x) ? [x] : []));
  if (!isRec(v)) return null;
  if (hasListKeys(v)) {
    const out: Rec[] = [];
    for (const [k, list] of Object.entries(v)) {
      if (!Array.isArray(list) || !/schedule|items|list|rules/i.test(k)) continue;
      const kind = /command/i.test(k) ? "command" : /program/i.test(k) ? "program" : null;
      for (const item of list) if (isRec(item)) out.push(kind && !item.__kind ? { ...item, __kind: kind } : item);
    }
    return out;
  }
  return Object.keys(v).length ? [v] : [];
}

function hasListKeys(o: Rec): boolean {
  return Object.entries(o).some(([k, v]) => Array.isArray(v) && /schedule|items|list|rules/i.test(k));
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Weekdays as Monday-first indexes 0–6, or null when unlimited/unknown. */
function weekdays(v: unknown): number[] | null {
  let list: unknown[] | null = null;
  if (Array.isArray(v)) list = v;
  else if (typeof v === "string" && /^[\d\s,]+$/.test(v)) list = v.split(",").map((s) => Number(s.trim()));
  if (!list) return null;
  const nums = list.map((x) => (typeof x === "boolean" ? (x ? 1 : 0) : Number(x))).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  // Seven on/off flags, Monday first.
  if (nums.length === 7 && nums.every((n) => n === 0 || n === 1)) {
    return nums.map((n, i) => (n ? i : -1)).filter((i) => i >= 0);
  }
  // Day numbers: 0 = Sunday … 6 = Saturday when a 0 is present, else 1 = Monday … 7 = Sunday.
  const sundayZero = nums.includes(0);
  const out = new Set<number>();
  for (const n of nums) {
    if (sundayZero && n >= 0 && n <= 6) out.add((n + 6) % 7);
    else if (!sundayZero && n >= 1 && n <= 7) out.add(n - 1);
  }
  return [...out].sort((a, b) => a - b);
}

function describeWeekdays(days: number[] | null): string | null {
  if (!days || days.length === 0 || days.length === 7) return null;
  const key = days.join(",");
  if (key === "0,1,2,3,4") return "Mon–Fri";
  if (key === "5,6") return "Sat and Sun";
  // Consecutive run of three or more → "Tue–Thu".
  const run = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (run && days.length >= 3) return `${DAY_NAMES[days[0]]}–${DAY_NAMES[days[days.length - 1]]}`;
  if (days.length === 2) return `${DAY_NAMES[days[0]]} and ${DAY_NAMES[days[1]]}`;
  return days.map((d) => DAY_NAMES[d]).join(", ");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-01", "2026/10/1", "2026-10-01 00:00:00" → "1 Oct" (year added when not this year). */
function shortDay(v: unknown, thisYear: number): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12) return null;
  return `${d} ${MONTHS[mo - 1]}${y !== thisYear ? ` ${y}` : ""}`;
}

/** "17:00:00" / "17:00" / 1020 (minutes) → "17:00". */
function clock(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 24 * 60) {
    return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
  }
  const s = str(v);
  if (!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

function brightnessPctFrom(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n > 100 ? Math.round((Math.min(n, 255) / 255) * 100) : Math.round(n);
}

function describeItem(o: Rec, loopNames: Record<string, string>, thisYear: number): BagScheduleLine | null {
  const command = str(pick(o, ["commandType", "command", "operation", "action", "type", "cmd"]));
  const programObj = pick(o, ["program"]);
  const nested = isRec(programObj) ? programObj : null;
  const programName =
    str(pick(o, ["programName", "program_name", "programTitle", "loopName", "name", "title"])) ??
    (nested ? str(pick(nested, ["name", "title_raw", "title"])) : null);
  const programId = str(pick(o, ["programId", "program_id", "program"])) ?? (nested ? str(pick(nested, ["id"])) : null);
  const isCommand = o.__kind === "command" || (!!command && !programId && /bright|sleep|wake|reboot|restart|power|screen/i.test(command));

  let kind: BagScheduleLine["kind"];
  let title: string;
  if (isCommand) {
    const c = (command ?? "").toLowerCase();
    if (/bright/.test(c)) {
      const pct = brightnessPctFrom(pick(o, ["value", "brightness", "commandValue", "param", "arg"]));
      kind = "brightness";
      title = pct != null ? `Brightness ${pct}%` : "Brightness change";
    } else if (/sleep|off/.test(c)) {
      kind = "screen_off";
      title = "Screen off";
    } else if (/wake|on\b|poweron/.test(c)) {
      kind = "screen_on";
      title = "Screen on";
    } else if (/reboot|restart/.test(c)) {
      kind = "restart";
      title = "Restart";
    } else {
      return null;
    }
  } else if (programName || programId) {
    kind = "loop";
    const name = programName ?? (programId ? loopNames[programId] : undefined);
    title = name ? `Loop “${name}”` : `Loop #${programId}`;
  } else {
    return null;
  }

  // Dates, then weekdays, then times: "1 Oct – 31 Oct · Mon–Fri · 17:00–23:30".
  const from = shortDay(pick(o, ["startDate", "start_date", "dateStart", "startDay", "beginDate", "fromDate"]), thisYear);
  const to = shortDay(pick(o, ["endDate", "end_date", "dateEnd", "endDay", "finishDate", "toDate"]), thisYear);
  const datePart = from && to ? (from === to ? from : `${from} – ${to}`) : from ? `from ${from}` : to ? `until ${to}` : null;

  const dayPart = describeWeekdays(weekdays(pick(o, ["weeks", "weekdays", "week", "days", "limitWeek", "weekDays"]))) ?? "every day";

  const at = clock(pick(o, ["operationTime", "executeTime", "time", "at", "runTime"]));
  const start = clock(pick(o, ["startTime", "start_time", "timeStart", "beginTime", "fromTime"]));
  const end = clock(pick(o, ["endTime", "end_time", "timeEnd", "finishTime", "toTime"]));
  let timePart: string | null;
  if (isCommand) timePart = at ?? start ? `at ${at ?? start}` : null;
  else if (start && end && !(start === "00:00" && (end === "23:59" || end === "24:00"))) timePart = `${start}–${end}`;
  else if (start && !end && start !== "00:00") timePart = `from ${start}`;
  else timePart = "all day";

  const when = [datePart, dayPart, timePart].filter(Boolean).join(" · ");
  const pr = Number(pick(o, ["priority", "level", "order"]));
  return { kind, title, when: when.charAt(0).toUpperCase() + when.slice(1), priority: Number.isFinite(pr) ? pr : null };
}

/**
 * The bag's own schedule (as Colorlight reports it) in plain English.
 * `loopNames` maps Colorlight program ids to names, when known.
 */
export function describeBagSchedule(raw: unknown, loopNames: Record<string, string> = {}, now: Date = new Date()): BagScheduleSummary {
  const items = collectItems(raw);
  if (items === null) return { state: "rules", lines: [], unreadable: 1 };
  if (!items.length) return { state: "none" };
  const lines: BagScheduleLine[] = [];
  let unreadable = 0;
  for (const it of items) {
    const line = describeItem(it, loopNames, now.getUTCFullYear());
    if (line) lines.push(line);
    else unreadable++;
  }
  lines.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  return { state: "rules", lines, unreadable };
}
