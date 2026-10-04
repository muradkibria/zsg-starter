// Riders: the pipeline, documents, assignments and performance.
//
// The bag owns every piece of telemetry. A rider's days, hours and routes are
// the bag's data inside their assignment windows (activeAt), and history is
// never moved from one rider to another when a bag changes hands: backdating an
// assignment over someone else's time is refused.
//
// The first half of this file is pure logic (tested in test/riders.test.ts);
// the second half loads from PocketBase and builds the API shapes.

import {
  addDays,
  bagStatus,
  DAY_OUT_MIN_SECONDS,
  daysBetween,
  DOC_DUE_DAYS,
  docsDue,
  londonDay,
  londonDayBounds,
  londonDayStart,
  paidSeconds,
  REQUIRED_DOC_KINDS,
  RIDER_DOC_KINDS,
  simplifyLine,
  sortPoints,
  spreadLatePoints,
  todayLondon,
  type FleetBaseline,
  type Lifecycle,
  type RiderActivity,
  type RiderBagRef,
  type RiderCoverage,
  type RiderDayRow,
  type RiderDetail,
  type RiderDocKind,
  type RiderDocStatus,
  type RiderDocsSummary,
  type RiderDocumentDto,
  type RiderLastOut,
  type RiderListItem,
  type RiderListResponse,
  type RiderPaySummary,
  type RiderPerformance,
  type RiderStage,
  type RiderStint,
  type RiderTotals,
  type SpareBag,
} from "@digilite/shared";
import { getAll, getFirst, parsePbDate, pb, pbDate, q, type RecordModel } from "../pb";
import { activeAt, allAssignments, invalidateAssignments, type AssignmentRow } from "./assignments";
import { isTestBag, loadBags } from "./bags";
import { analyticsConfig, getSettings } from "./settings";
import { buildRoute, loadPlacedPoints, loadPoints } from "./tracks";

// ══════════════════════════════════════════════════════════════════════════════
// Pure logic
// ══════════════════════════════════════════════════════════════════════════════

/** The `n` London days ending on `toDay`, oldest first. */
export function windowDays(toDay: string, n: number): string[] {
  return daysBetween(addDays(toDay, -(n - 1)), toDay);
}

// ── Stage ─────────────────────────────────────────────────────────────────────
/**
 * The stage we show. Assignments are the truth about bags: a rider with a
 * current or upcoming assignment is carrying a bag; an "active" rider whose bag
 * went to someone else is waiting. "Ended" always stays ended.
 */
export function effectiveStage(stored: RiderStage, hasBag: boolean): RiderStage {
  if (stored === "ended") return "ended";
  if (hasBag) return "active";
  if (stored === "active") return "waiting";
  return stored;
}

// ── Documents ─────────────────────────────────────────────────────────────────
export interface DocLite {
  kind: RiderDocKind;
  status: RiderDocStatus;
  /** London day it expires (inclusive), or null */
  expiresDay: string | null;
}

export function summariseDocs(docs: DocLite[], today: string): RiderDocsSummary {
  const dueBy = addDays(today, DOC_DUE_DAYS);
  const present = new Set<RiderDocKind>([...REQUIRED_DOC_KINDS, ...docs.map((d) => d.kind)]);
  const s: RiderDocsSummary = {
    state: "ok",
    required: REQUIRED_DOC_KINDS.length,
    checked: 0,
    missing: [],
    pending: [],
    expired: [],
    due: [],
    next: null,
  };
  const attention: { kind: RiderDocKind; expiresDay: string; expired: boolean }[] = [];
  for (const kind of RIDER_DOC_KINDS.filter((k) => present.has(k))) {
    const usable = docs.filter((d) => d.kind === kind && d.status !== "rejected");
    const checked = usable.filter((d) => d.status === "checked");
    const valid = checked.filter((d) => !d.expiresDay || d.expiresDay >= today);
    const pending = usable.some((d) => d.status === "pending");
    const required = REQUIRED_DOC_KINDS.includes(kind);
    if (valid.length) {
      if (required) s.checked++;
      // The best document of this kind: one that never expires, else the latest expiry.
      const best = valid.some((d) => !d.expiresDay) ? null : valid.map((d) => d.expiresDay!).sort().at(-1)!;
      if (best && best <= dueBy) {
        s.due.push(kind);
        attention.push({ kind, expiresDay: best, expired: false });
      }
    } else if (checked.length) {
      const last = checked.map((d) => d.expiresDay!).sort().at(-1)!;
      s.expired.push(kind);
      attention.push({ kind, expiresDay: last, expired: true });
      if (pending) s.pending.push(kind);
    } else if (pending) {
      s.pending.push(kind);
    } else if (required) {
      s.missing.push(kind);
    }
  }
  s.state = s.expired.length ? "expired" : s.missing.length ? "missing" : s.pending.length ? "pending" : s.due.length ? "due" : "ok";
  s.next = attention.sort((a, b) => a.expiresDay.localeCompare(b.expiresDay))[0] ?? null;
  return s;
}

// ── Attribution: bag days → rider days ───────────────────────────────────────
export interface StoredShift {
  start: string;
  end: string;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
}

export interface BagDayLite {
  bag: string;
  day: string;
  onSeconds: number;
  stoppedSeconds: number;
  gaps: number;
  km: number;
  shifts: StoredShift[];
  signalGaps: { start: string; end: string }[];
}

/** One rider's share of one London day (possibly across two bags if swapped mid-day). */
export interface DayPiece {
  day: string;
  bagId: string;
  first: number;
  last: number;
  /** Start of the day's latest shift */
  lastShiftStart: number;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  gaps: number;
  km: number;
}

/**
 * Split each bag-day's shifts and signal gaps between riders by assignment
 * (the rider holding the bag when a shift started gets the shift — the same
 * rule the bag and route views use). Returns riderId → day → piece.
 */
export function attributeBagDays(rows: BagDayLite[], assignments: AssignmentRow[], onlyRider?: string): Map<string, Map<string, DayPiece>> {
  const out = new Map<string, Map<string, DayPiece>>();
  const perBag = new Map<string, Map<string, number>>(); // `${rider}|${day}` → bag → on-seconds (to name the main bag)
  for (const row of rows) {
    for (const s of row.shifts) {
      const start = Date.parse(s.start);
      const who = activeAt(assignments, row.bag, new Date(start));
      if (!who || (onlyRider && who.riderId !== onlyRider)) continue;
      const days = out.get(who.riderId) ?? new Map<string, DayPiece>();
      out.set(who.riderId, days);
      const p = days.get(row.day) ?? {
        day: row.day,
        bagId: row.bag,
        first: start,
        last: Date.parse(s.end),
        lastShiftStart: start,
        onSeconds: 0,
        movingSeconds: 0,
        stoppedSeconds: 0,
        gapSeconds: 0,
        gaps: 0,
        km: 0,
      };
      p.first = Math.min(p.first, start);
      if (Date.parse(s.end) >= p.last) p.lastShiftStart = start;
      p.last = Math.max(p.last, Date.parse(s.end));
      p.onSeconds += s.onSeconds || 0;
      p.movingSeconds += s.movingSeconds || 0;
      p.stoppedSeconds += s.stoppedSeconds || 0;
      p.gapSeconds += s.gapSeconds || 0;
      p.km += s.km || 0;
      days.set(row.day, p);
      const key = `${who.riderId}|${row.day}`;
      const bags = perBag.get(key) ?? new Map<string, number>();
      bags.set(row.bag, (bags.get(row.bag) ?? 0) + (s.onSeconds || 0));
      perBag.set(key, bags);
      p.bagId = [...bags.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    for (const g of row.signalGaps) {
      const who = activeAt(assignments, row.bag, new Date(g.start));
      if (!who || (onlyRider && who.riderId !== onlyRider)) continue;
      const p = out.get(who.riderId)?.get(row.day);
      if (p) p.gaps++;
    }
  }
  return out;
}

/** Days (of `days`) when the rider held a bag at some point up to `now`. */
export function carryingFlags(assignments: AssignmentRow[], riderId: string, days: string[], now: Date): boolean[] {
  const mine = assignments.filter((a) => a.riderId === riderId);
  return days.map((day) => {
    const [s, e] = londonDayBounds(day);
    const until = Math.min(e.getTime(), now.getTime());
    return mine.some((a) => a.start.getTime() < until && (!a.end || a.end.getTime() > s.getTime()));
  });
}

export function summariseActivity(pieces: DayPiece[], daysCarrying: number): RiderActivity {
  const out = pieces.filter((p) => p.onSeconds >= DAY_OUT_MIN_SECONDS);
  const sum = (list: DayPiece[], k: keyof Pick<DayPiece, "onSeconds" | "movingSeconds" | "stoppedSeconds" | "gapSeconds" | "gaps" | "km">) =>
    list.reduce((t, p) => t + p[k], 0);
  const on = sum(pieces, "onSeconds");
  const n = out.length;
  return {
    daysOut: n,
    daysCarrying: Math.max(daysCarrying, n),
    onSeconds: Math.round(on),
    movingSeconds: Math.round(sum(pieces, "movingSeconds")),
    stoppedSeconds: Math.round(sum(pieces, "stoppedSeconds")),
    gapSeconds: Math.round(sum(pieces, "gapSeconds")),
    gaps: sum(pieces, "gaps"),
    km: Math.round(sum(pieces, "km") * 10) / 10,
    avgOnSeconds: n ? Math.round(sum(out, "onSeconds") / n) : null,
    stoppedPct: on > 0 ? Math.round((sum(pieces, "stoppedSeconds") / on) * 1000) / 10 : null,
    gapsPerDay: n ? Math.round((sum(out, "gaps") / n) * 10) / 10 : null,
    kmPerDay: n ? Math.round((sum(out, "km") / n) * 10) / 10 : null,
  };
}

/** Fleet averages per bag-day out over the same rows (test bags excluded). */
export function fleetBaseline(rows: BagDayLite[], excludeBagIds: Set<string>): FleetBaseline {
  const all = rows.filter((r) => !excludeBagIds.has(r.bag));
  const out = all.filter((r) => r.onSeconds >= DAY_OUT_MIN_SECONDS);
  const on = all.reduce((t, r) => t + r.onSeconds, 0);
  const n = out.length;
  return {
    bagDays: n,
    avgOnSeconds: n ? Math.round(out.reduce((t, r) => t + r.onSeconds, 0) / n) : null,
    stoppedPct: on > 0 ? Math.round((all.reduce((t, r) => t + r.stoppedSeconds, 0) / on) * 1000) / 10 : null,
    gapsPerDay: n ? Math.round((out.reduce((t, r) => t + r.gaps, 0) / n) * 10) / 10 : null,
    kmPerDay: n ? Math.round((out.reduce((t, r) => t + r.km, 0) / n) * 10) / 10 : null,
  };
}

/** Paid time under the pay rules (the same rule Payroll uses, per piece). */
export function paidFor(p: Pick<DayPiece, "movingSeconds" | "gapSeconds">, paySignalGaps: boolean): number {
  return Math.round(paidSeconds(p, paySignalGaps));
}

// ── Assignment planning ───────────────────────────────────────────────────────
export type AssignmentChange =
  | { op: "end"; id: string; end: Date }
  | { op: "reopen"; id: string; start: Date }
  | { op: "delete"; id: string }
  | { op: "create"; bagId: string; riderId: string; start: Date };

export type PlanConflict =
  /** The rider already carries this bag */
  | { kind: "already"; row: AssignmentRow }
  /** Another rider had the bag after the start: moving their history is refused */
  | { kind: "bag_history"; row: AssignmentRow }
  /** Another rider is booked to get the bag later */
  | { kind: "bag_booked"; row: AssignmentRow }
  /** The rider carried another bag after the start */
  | { kind: "rider_history"; row: AssignmentRow }
  /** The last day is before they got the bag */
  | { kind: "before_start"; row: AssignmentRow };

export interface Plan {
  changes: AssignmentChange[];
  conflict: PlanConflict | null;
  /** Riders whose assignment on the bag is ended by this plan */
  displaced: string[];
  /** planEnd: the assignment being ended (its bag is the one to hand on) */
  ended: AssignmentRow | null;
}

const blocked = (conflict: PlanConflict): Plan => ({ changes: [], conflict, displaced: [], ended: null });

/**
 * Give `bagId` to `riderId` from `start`.
 * - The bag's current rider (if any) is ended at `start`.
 * - The rider's own assignment on another bag is ended at `start`.
 * - Re-giving a bag to the rider who just had it reopens their assignment.
 * - A start in the past is allowed only over time nobody else had: it never
 *   takes days away from another rider (or from this rider's other bag).
 */
export function planAssign(rows: AssignmentRow[], p: { bagId: string; riderId: string; start: Date; now: Date }): Plan {
  const t = p.start.getTime();
  const now = p.now.getTime();
  const changes: AssignmentChange[] = [];
  const displaced: string[] = [];
  const runsPast = (r: AssignmentRow, at: number) => !r.end || r.end.getTime() > at;

  // Same rider, same bag: reopen instead of creating a second, overlapping assignment.
  let merged = false;
  const same = rows
    .filter((r) => r.bagId === p.bagId && r.riderId === p.riderId && (!r.end || r.end.getTime() >= t))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const r of same) {
    if (r.start.getTime() <= t && !r.end) return blocked({ kind: "already", row: r });
    if (!merged) {
      changes.push({ op: "reopen", id: r.id, start: r.start.getTime() <= t ? r.start : p.start });
      merged = true;
    } else {
      changes.push({ op: "delete", id: r.id });
    }
  }

  // Anyone else on this bag from the start onwards.
  for (const r of rows.filter((x) => x.bagId === p.bagId && x.riderId !== p.riderId && runsPast(x, t))) {
    if (r.start.getTime() < t) {
      const theirsUntil = Math.min(now, r.end?.getTime() ?? Infinity);
      if (t < theirsUntil) return blocked({ kind: "bag_history", row: r });
      changes.push({ op: "end", id: r.id, end: p.start });
      displaced.push(r.riderId);
    } else {
      return blocked({ kind: r.start.getTime() < now ? "bag_history" : "bag_booked", row: r });
    }
  }

  // This rider's other bags from the start onwards.
  for (const r of rows.filter((x) => x.riderId === p.riderId && x.bagId !== p.bagId && runsPast(x, t))) {
    if (r.start.getTime() < t) {
      if (t < Math.min(now, r.end?.getTime() ?? Infinity)) return blocked({ kind: "rider_history", row: r });
      changes.push({ op: "end", id: r.id, end: p.start });
    } else if (r.start.getTime() < now) {
      return blocked({ kind: "rider_history", row: r });
    } else {
      changes.push({ op: "delete", id: r.id }); // a booking on another bag that never started
    }
  }

  if (!merged) changes.push({ op: "create", bagId: p.bagId, riderId: p.riderId, start: p.start });
  return { changes, conflict: null, displaced, ended: null };
}

/**
 * End the rider's assignments at `endAt` (the end of their last London day).
 * Bookings that haven't started yet are removed; a last day before a bag they
 * already had is refused.
 */
export function planEnd(rows: AssignmentRow[], p: { riderId: string; endAt: Date; now: Date }): Plan {
  const e = p.endAt.getTime();
  const changes: AssignmentChange[] = [];
  let ended: AssignmentRow | null = null;
  for (const r of rows.filter((x) => x.riderId === p.riderId && (!x.end || x.end.getTime() > e))) {
    if (r.start.getTime() < e) {
      changes.push({ op: "end", id: r.id, end: p.endAt });
      if (!ended || r.start.getTime() > ended.start.getTime()) ended = r;
    } else if (r.start.getTime() < p.now.getTime()) {
      return blocked({ kind: "before_start", row: r });
    } else {
      changes.push({ op: "delete", id: r.id });
    }
  }
  return { changes, conflict: null, displaced: [], ended };
}

/** The assignment rows as they'd be after `changes` (for chaining plans). */
export function applyChanges(rows: AssignmentRow[], changes: AssignmentChange[]): AssignmentRow[] {
  let out = rows.map((r) => ({ ...r }));
  for (const c of changes) {
    if (c.op === "delete") out = out.filter((r) => r.id !== c.id);
    if (c.op === "end") out = out.map((r) => (r.id === c.id ? { ...r, end: c.end } : r));
    if (c.op === "reopen") out = out.map((r) => (r.id === c.id ? { ...r, start: c.start, end: null } : r));
    if (c.op === "create") {
      out.push({ id: `new:${c.bagId}:${c.riderId}`, bagId: c.bagId, riderId: c.riderId, riderName: "", riderDemo: false, start: c.start, end: null });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** No start day = now (to the second); otherwise the start of that London day. */
export function resolveStart(startDay: string | undefined, now: Date): Date {
  return startDay ? londonDayStart(startDay) : new Date(Math.floor(now.getTime() / 1000) * 1000);
}

/** The instant a rider's last day ends (midnight London time after it). */
export function endOfDay(day: string): Date {
  return londonDayBounds(day)[1];
}

// ══════════════════════════════════════════════════════════════════════════════
// Data access and API shapes
// ══════════════════════════════════════════════════════════════════════════════

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const pbIso = (s: string | null | undefined) => iso(parsePbDate(s));

export const WINDOW_DAYS = 14;

function toLite(r: RecordModel): BagDayLite {
  return {
    bag: r.bag,
    day: r.day,
    onSeconds: r.on_seconds ?? 0,
    stoppedSeconds: r.stopped_seconds ?? 0,
    gaps: r.gaps ?? 0,
    km: r.km ?? 0,
    shifts: (Array.isArray(r.shifts) ? r.shifts : []) as StoredShift[],
    signalGaps: (Array.isArray(r.signal_gaps) ? r.signal_gaps : []) as { start: string; end: string }[],
  };
}

const DAY_FIELDS = "bag,day,on_seconds,stopped_seconds,gaps,km,shifts,signal_gaps";
const windowCache = new Map<string, { at: number; rows: BagDayLite[] }>();

/** Every bag's days in a window — loaded once and shared by the list and rider views (60 s). */
async function fleetWindow(fromDay: string, toDay: string): Promise<BagDayLite[]> {
  const key = `${fromDay}|${toDay}`;
  const hit = windowCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const recs = await getAll<RecordModel>("bag_days", {
    filter: `day >= ${q(fromDay)} && day <= ${q(toDay)}`,
    fields: DAY_FIELDS,
    sort: "day",
  });
  const rows = recs.map(toLite);
  windowCache.set(key, { at: Date.now(), rows });
  if (windowCache.size > 8) windowCache.delete(windowCache.keys().next().value!);
  return rows;
}

async function bagWindow(bagIds: string[], fromDay: string, toDay: string): Promise<BagDayLite[]> {
  if (!bagIds.length) return [];
  const recs = await getAll<RecordModel>("bag_days", {
    filter: `day >= ${q(fromDay)} && day <= ${q(toDay)} && (${bagIds.map((id) => `bag = ${q(id)}`).join(" || ")})`,
    fields: DAY_FIELDS,
    sort: "day",
  });
  return recs.map(toLite);
}

async function testBagIds(): Promise<Set<string>> {
  return new Set((await loadBags()).filter(isTestBag).map((b) => b.id));
}

function lastOutOf(days: Map<string, DayPiece> | undefined): RiderLastOut | null {
  if (!days) return null;
  let best: DayPiece | null = null;
  for (const p of days.values()) if (!best || p.last > best.last) best = p;
  return best
    ? {
        day: best.day,
        bagId: best.bagId,
        start: new Date(best.first).toISOString(),
        end: new Date(best.last).toISOString(),
        shiftStart: new Date(best.lastShiftStart).toISOString(),
      }
    : null;
}

// ── Bag refs ──────────────────────────────────────────────────────────────────
function currentOrUpcoming(rows: AssignmentRow[], riderId: string, now: Date): AssignmentRow | null {
  const mine = rows.filter((r) => r.riderId === riderId);
  const t = now.getTime();
  const current = mine
    .filter((r) => r.start.getTime() <= t && (!r.end || r.end.getTime() > t))
    .sort((a, b) => b.start.getTime() - a.start.getTime())[0];
  if (current) return current;
  return mine.filter((r) => r.start.getTime() > t).sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;
}

function bagRef(a: AssignmentRow | null, bags: Map<string, RecordModel>, now: Date): RiderBagRef | null {
  if (!a) return null;
  const bag = bags.get(a.bagId);
  if (!bag) return null;
  const last = parsePbDate(bag.last_report_at);
  return {
    id: bag.id,
    name: bag.name,
    status: bagStatus(last, now.getTime()),
    lifecycle: (bag.lifecycle || "active") as Lifecycle,
    isTestBag: isTestBag(bag),
    lastReportAt: iso(last),
    assignmentId: a.id,
    since: a.start.toISOString(),
    until: iso(a.end),
    upcoming: a.start.getTime() > now.getTime(),
  };
}

// ── Documents ─────────────────────────────────────────────────────────────────
function docLite(r: RecordModel): DocLite {
  const exp = parsePbDate(r.expires_at);
  return { kind: r.kind as RiderDocKind, status: (r.status || "pending") as RiderDocStatus, expiresDay: exp ? londonDay(exp) : null };
}

export function toDocDto(r: RecordModel, canOpen: boolean): RiderDocumentDto {
  const exp = parsePbDate(r.expires_at);
  const file = String(r.file || "");
  return {
    id: r.id,
    kind: r.kind as RiderDocKind,
    status: (r.status || "pending") as RiderDocStatus,
    hasFile: !!file,
    fileType: file ? (/\.pdf$/i.test(file) ? "pdf" : "image") : null,
    expiresDay: exp ? londonDay(exp) : null,
    checkedAt: pbIso(r.checked_at),
    notes: canOpen ? r.notes || "" : null,
    createdAt: pbIso(r.created) ?? new Date(0).toISOString(),
  };
}

export async function riderDocuments(riderId: string): Promise<RecordModel[]> {
  return getAll<RecordModel>("rider_documents", { filter: `rider = ${q(riderId)}`, sort: "kind,-created" });
}

// ── List ──────────────────────────────────────────────────────────────────────
export async function listRiders(now = new Date()): Promise<RiderListResponse> {
  const today = todayLondon(now);
  const days = windowDays(today, WINDOW_DAYS);
  const [riders, docs, assignments, bagRecs, rows, tests] = await Promise.all([
    getAll<RecordModel>("riders", { sort: "name", fields: "id,name,phone,stage,demo,joined_at,ended_at" }),
    getAll<RecordModel>("rider_documents", { fields: "rider,kind,status,expires_at" }),
    allAssignments(),
    loadBags(),
    fleetWindow(days[0], today),
    testBagIds(),
  ]);
  const bags = new Map(bagRecs.map((b) => [b.id, b]));
  const docsBy = new Map<string, DocLite[]>();
  for (const d of docs) docsBy.set(d.rider, [...(docsBy.get(d.rider) ?? []), docLite(d)]);
  const attributed = attributeBagDays(rows, assignments);

  const counts = { applied: 0, checked: 0, waiting: 0, active: 0, ended: 0, docsDue: 0, outNow: 0 };
  const items: RiderListItem[] = riders.map((r) => {
    const bag = bagRef(currentOrUpcoming(assignments, r.id, now), bags, now);
    const stage = effectiveStage(r.stage as RiderStage, !!bag);
    const docSummary = summariseDocs(docsBy.get(r.id) ?? [], today);
    const mine = attributed.get(r.id);
    const carrying = carryingFlags(assignments, r.id, days, now);
    const pieces = [...(mine?.values() ?? [])];
    counts[stage]++;
    if (stage !== "ended" && docsDue(docSummary)) counts.docsDue++;
    if (bag && !bag.upcoming && bag.status === "now") counts.outNow++;
    return {
      id: r.id,
      name: r.name,
      phone: r.phone || "",
      stage,
      demo: !!r.demo,
      joinedAt: pbIso(r.joined_at),
      endedAt: pbIso(r.ended_at),
      bag,
      docs: docSummary,
      lastOut: lastOutOf(mine),
      activity: summariseActivity(pieces, carrying.filter(Boolean).length),
      movingHours: days.map((d, i) => {
        const p = mine?.get(d);
        if (p) return Math.round((p.movingSeconds / 3600) * 100) / 100;
        return carrying[i] ? 0 : null;
      }),
    };
  });
  return { asOf: now.toISOString(), days, fleet: fleetBaseline(rows, tests), counts, riders: items };
}

/**
 * For the fleet's attention list, counted the same way as the riders page:
 * stages follow assignments, and documents are due when expired, expiring
 * within 30 days or missing (ended riders aren't counted).
 */
export async function riderAttentionCounts(now = new Date()): Promise<{ waiting: number; docsDue: number }> {
  const today = todayLondon(now);
  const [riders, docs, assignments] = await Promise.all([
    getAll<RecordModel>("riders", { fields: "id,stage" }),
    getAll<RecordModel>("rider_documents", { fields: "rider,kind,status,expires_at" }),
    allAssignments(),
  ]);
  const docsBy = new Map<string, DocLite[]>();
  for (const d of docs) docsBy.set(d.rider, [...(docsBy.get(d.rider) ?? []), docLite(d)]);
  let waiting = 0;
  let due = 0;
  for (const r of riders) {
    const stage = effectiveStage(r.stage as RiderStage, !!currentOrUpcoming(assignments, r.id, now));
    if (stage === "waiting") waiting++;
    if (stage !== "ended" && docsDue(summariseDocs(docsBy.get(r.id) ?? [], today))) due++;
  }
  return { waiting, docsDue: due };
}

// ── One rider ─────────────────────────────────────────────────────────────────
export async function riderDetail(rec: RecordModel, now = new Date()): Promise<RiderDetail> {
  const today = todayLondon(now);
  const days = windowDays(today, WINDOW_DAYS);
  const [assignments, bagRecs, docs, raw, rows] = await Promise.all([
    allAssignments(),
    loadBags(),
    riderDocuments(rec.id),
    getAll<RecordModel>("assignments", { filter: `rider = ${q(rec.id)}`, sort: "-start_at" }),
    fleetWindow(days[0], today),
  ]);
  const bags = new Map(bagRecs.map((b) => [b.id, b]));
  const bag = bagRef(currentOrUpcoming(assignments, rec.id, now), bags, now);
  const stints: RiderStint[] = raw.map((a) => ({
    assignmentId: a.id,
    bagId: a.bag,
    bagName: bags.get(a.bag)?.name ?? "Removed bag",
    start: pbIso(a.start_at) ?? "",
    end: pbIso(a.end_at),
    endReason: a.end_reason || "",
  }));
  return {
    id: rec.id,
    name: rec.name,
    phone: rec.phone || "",
    email: rec.email || "",
    stage: effectiveStage(rec.stage as RiderStage, !!bag),
    demo: !!rec.demo,
    joinedAt: pbIso(rec.joined_at),
    endedAt: pbIso(rec.ended_at),
    endedReason: rec.ended_reason || "",
    notes: rec.notes || "",
    createdAt: pbIso(rec.created) ?? new Date(0).toISOString(),
    bag,
    stints,
    docs: summariseDocs(docs.map(docLite), today),
    lastOut: lastOutOf(attributeBagDays(rows, assignments, rec.id).get(rec.id)),
  };
}

// ── Performance ───────────────────────────────────────────────────────────────
async function riderBagsIn(riderId: string, from: Date, to: Date): Promise<string[]> {
  const rows = (await allAssignments()).filter(
    (a) => a.riderId === riderId && a.start.getTime() < to.getTime() && (!a.end || a.end.getTime() > from.getTime()),
  );
  return [...new Set(rows.map((a) => a.bagId))];
}

/** Plays per London day while the rider held the bag (plays are stored per bag per hour). */
async function playsByDay(riderId: string, bagIds: string[], from: Date, to: Date): Promise<Map<string, number>> {
  const assignments = await allAssignments();
  const out = new Map<string, number>();
  for (const bagId of bagIds) {
    const recs = await getAll<RecordModel>("plays", {
      filter: `bag = ${q(bagId)} && hour >= ${q(pbDate(from))} && hour < ${q(pbDate(to))}`,
      fields: "hour,plays",
    });
    for (const r of recs) {
      const at = parsePbDate(r.hour);
      if (!at || activeAt(assignments, bagId, at)?.riderId !== riderId) continue;
      const day = londonDay(at);
      out.set(day, (out.get(day) ?? 0) + (r.plays || 0));
    }
  }
  return out;
}

export async function riderPerformance(riderId: string, n: number, now = new Date()): Promise<RiderPerformance> {
  const today = todayLondon(now);
  const days = windowDays(today, n);
  const from = londonDayBounds(days[0])[0];
  const to = londonDayBounds(today)[1];
  const [assignments, bagRecs, settings, rows, tests] = await Promise.all([
    allAssignments(),
    loadBags(),
    getSettings(),
    fleetWindow(days[0], today),
    testBagIds(),
  ]);
  const bagIds = await riderBagsIn(riderId, from, to);
  const plays = await playsByDay(riderId, bagIds, from, to);
  const mine = attributeBagDays(rows, assignments, riderId).get(riderId);
  const carrying = carryingFlags(assignments, riderId, days, now);
  const names = new Map(bagRecs.map((b) => [b.id, b.name as string]));
  const dayRows: RiderDayRow[] = days.map((day, i) => {
    const p = mine?.get(day);
    // The bag they held that day (for days with no data, the one held at the day's start or end).
    const [s, e] = londonDayBounds(day);
    const heldId =
      p?.bagId ??
      (carrying[i]
        ? assignments.filter((a) => a.riderId === riderId && a.start < e && (!a.end || a.end > s)).sort((a, b) => b.start.getTime() - a.start.getTime())[0]?.bagId ?? null
        : null);
    return {
      day,
      carrying: carrying[i] || !!p,
      out: !!p && p.onSeconds >= DAY_OUT_MIN_SECONDS,
      bagId: heldId,
      bagName: heldId ? names.get(heldId) ?? null : null,
      first: p ? new Date(p.first).toISOString() : null,
      last: p ? new Date(p.last).toISOString() : null,
      onSeconds: Math.round(p?.onSeconds ?? 0),
      movingSeconds: Math.round(p?.movingSeconds ?? 0),
      stoppedSeconds: Math.round(p?.stoppedSeconds ?? 0),
      gapSeconds: Math.round(p?.gapSeconds ?? 0),
      gaps: p?.gaps ?? 0,
      km: Math.round((p?.km ?? 0) * 100) / 100,
      plays: plays.get(day) ?? 0,
      paidSeconds: p ? paidFor(p, settings.paySignalGaps) : 0,
    };
  });
  const pieces = [...(mine?.values() ?? [])];
  const totals: RiderTotals = {
    ...summariseActivity(pieces, carrying.filter(Boolean).length),
    plays: dayRows.reduce((t, r) => t + r.plays, 0),
    paidSeconds: dayRows.reduce((t, r) => t + r.paidSeconds, 0),
  };
  return {
    fromDay: days[0],
    toDay: today,
    rows: dayRows,
    totals,
    fleet: fleetBaseline(rows, tests),
    paySignalGaps: settings.paySignalGaps,
    payMinHours: settings.payMinHours,
  };
}

// ── Coverage ("where they ride") ──────────────────────────────────────────────
const COVERAGE_MAX_POINTS = 8000;

export async function riderCoverage(riderId: string, n: number, now = new Date()): Promise<RiderCoverage> {
  const today = todayLondon(now);
  const days = windowDays(today, n);
  const ws = londonDayBounds(days[0])[0];
  const we = new Date(Math.min(now.getTime(), londonDayBounds(today)[1].getTime()));
  const assignments = await allAssignments();
  const mineA = assignments.filter((a) => a.riderId === riderId && a.start < we && (!a.end || a.end > ws));
  const cfg = await analyticsConfig();
  const gapMs = cfg.signalGapMin * 60_000;
  const raw: [number, number][][] = [];
  for (const a of mineA) {
    const from = new Date(Math.max(ws.getTime(), a.start.getTime()));
    const to = new Date(Math.min(we.getTime(), a.end?.getTime() ?? Infinity));
    if (to <= from) continue;
    const pts = await loadPlacedPoints(a.bagId, from, to);
    let cur: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      if (i > 0 && pts[i].t - pts[i - 1].t > gapMs) {
        if (cur.length > 1) raw.push(cur);
        cur = [];
      }
      cur.push([pts[i].lng, pts[i].lat]);
    }
    if (cur.length > 1) raw.push(cur);
  }
  // Simplify to ~8 m; loosen until the whole picture fits the point budget.
  let tol = 8;
  let lines = raw.map((l) => simplifyLine(l, tol));
  let count = lines.reduce((t, l) => t + l.length, 0);
  while (count > COVERAGE_MAX_POINTS && tol < 256) {
    tol *= 2;
    lines = raw.map((l) => simplifyLine(l, tol));
    count = lines.reduce((t, l) => t + l.length, 0);
  }

  // Their most recent day out, drawn in full on top — clipped to their time with the bag.
  // Days out and the latest day come from the same attribution as the performance figures.
  const rows = await fleetWindow(days[0], today);
  const mine = attributeBagDays(rows, assignments, riderId).get(riderId);
  const daysWithData = [...(mine?.values() ?? [])].filter((p) => p.onSeconds >= DAY_OUT_MIN_SECONDS).length;
  const lastOut = lastOutOf(mine);
  let last: RiderCoverage["last"] = null;
  if (lastOut) {
    const bag = (await loadBags()).find((b) => b.id === lastOut.bagId);
    const [ds, de] = londonDayBounds(lastOut.day);
    const held = assignments
      .filter((a) => a.riderId === riderId && a.bagId === lastOut.bagId && a.start < de && (!a.end || a.end > ds))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (bag && held.length) {
      const from = new Date(Math.max(ds.getTime(), held[0].start.getTime()));
      const endAt = held.at(-1)!.end;
      const to = new Date(Math.min(de.getTime(), endAt ? endAt.getTime() : de.getTime()));
      last = await buildRoute(bag, from, to, lastOut.day);
    }
  }
  return { fromDay: days[0], toDay: today, lines, points: count, daysWithData, last };
}

// ── Pay ───────────────────────────────────────────────────────────────────────
export async function riderPay(riderId: string, toDay: string): Promise<RiderPaySummary> {
  const settings = await getSettings();
  const period = await getFirst<RecordModel>("payroll_periods", 'status = "approved"', { sort: "-end_day" });
  if (!period) {
    return { lastApproved: null, fromDay: null, toDay, paidSeconds: null, daysOut: null, paySignalGaps: settings.paySignalGaps };
  }
  const lastApproved = { startDay: period.start_day as string, endDay: period.end_day as string };
  const fromDay = addDays(lastApproved.endDay, 1);
  if (fromDay > toDay) return { lastApproved, fromDay, toDay, paidSeconds: 0, daysOut: 0, paySignalGaps: settings.paySignalGaps };
  const from = londonDayBounds(fromDay)[0];
  const to = londonDayBounds(toDay)[1];
  const bagIds = await riderBagsIn(riderId, from, to);
  const rows = await bagWindow(bagIds, fromDay, toDay);
  const mine = attributeBagDays(rows, await allAssignments(), riderId).get(riderId);
  const pieces = [...(mine?.values() ?? [])];
  return {
    lastApproved,
    fromDay,
    toDay,
    paidSeconds: pieces.reduce((t, p) => t + paidFor(p, settings.paySignalGaps), 0),
    daysOut: pieces.filter((p) => p.onSeconds >= DAY_OUT_MIN_SECONDS).length,
    paySignalGaps: settings.paySignalGaps,
  };
}

// ── Spare bags ────────────────────────────────────────────────────────────────
export async function spareBags(now = new Date()): Promise<SpareBag[]> {
  const [bags, assignments] = await Promise.all([loadBags(), allAssignments()]);
  const t = now.getTime();
  const busy = new Set(assignments.filter((a) => !a.end || a.end.getTime() > t).map((a) => a.bagId));
  return bags
    .filter((b) => (b.lifecycle || "active") !== "retired" && !busy.has(b.id))
    .map((b) => {
      const last = parsePbDate(b.last_report_at);
      const prev = assignments
        .filter((a) => a.bagId === b.id && a.end)
        .sort((x, y) => y.end!.getTime() - x.end!.getTime())[0];
      return {
        id: b.id,
        name: b.name,
        status: bagStatus(last, t),
        lifecycle: (b.lifecycle || "active") as Lifecycle,
        isTestBag: isTestBag(b),
        lastReportAt: iso(last),
        lastRider: prev ? { id: prev.riderId, name: prev.riderName, until: prev.end!.toISOString() } : null,
      };
    })
    .sort((a, b) => (b.lastReportAt ?? "").localeCompare(a.lastReportAt ?? "") || a.name.localeCompare(b.name));
}

// ── Writing assignments ───────────────────────────────────────────────────────
/** Fresh (uncached) assignment rows for planning. */
export async function freshAssignments(): Promise<AssignmentRow[]> {
  invalidateAssignments();
  return allAssignments();
}

/** Queue a plan's changes on a PocketBase batch (so a whole hand-over is one transaction). */
export function queueChanges(batch: ReturnType<typeof pb.createBatch>, changes: AssignmentChange[], reason: string) {
  for (const c of changes) {
    if (c.op === "end") batch.collection("assignments").update(c.id, { end_at: pbDate(c.end), end_reason: reason.slice(0, 500) });
    if (c.op === "reopen") batch.collection("assignments").update(c.id, { start_at: pbDate(c.start), end_at: "", end_reason: "" });
    if (c.op === "delete") batch.collection("assignments").delete(c.id);
    if (c.op === "create") batch.collection("assignments").create({ bag: c.bagId, rider: c.riderId, start_at: pbDate(c.start) });
  }
}

/** Riders (of `ids`) left with no current or upcoming bag once `rows` apply. */
export function leftWithoutBag(rows: AssignmentRow[], ids: string[], now: Date): string[] {
  return [...new Set(ids)].filter((id) => !currentOrUpcoming(rows, id, now));
}

export { currentOrUpcoming };
