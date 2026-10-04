// Payroll: paid hours per rider per London day, from the bag's data while they
// held it. A shift belongs to the rider who had the bag when the shift started.
// Paid time = moving time (+ time with no signal, if Settings say so); stops are
// never paid. Anything odd goes to the review queue — never silently paid or
// dropped. Approving a period freezes a snapshot; after that it's read-only.

import { randomBytes } from "node:crypto";
import ExcelJS from "exceljs";
import {
  PAY_REVIEW,
  addDays,
  daysBetween,
  formatPay,
  londonDay,
  londonDayBounds,
  paidSeconds,
  parsePayRate,
  payFlagText,
  payHours,
  payIsFortnight,
  payPeriodLabel,
  payRound2,
  payRulesSentence,
  payWeekday,
  todayLondon,
  type PayAdjustment,
  type PayCell,
  type PayFlag,
  type PayHandover,
  type PayPeriodRef,
  type PayRange,
  type PayReviewItem,
  type PayRiderBag,
  type PayRiderRow,
  type PayrollResponse,
  type PayShift,
  type PayUnassigned,
  type SessionUser,
  type SettingsDto,
} from "@digilite/shared";
import { getAll, getFirst, getOneOrNull, pb, parsePbDate, pbDate, q, type RecordModel } from "../pb";
import { HttpError } from "../api/http";
import { activeAt, allAssignments, type AssignmentRow } from "./assignments";
import { audit } from "./audit";
import { loadBags } from "./bags";
import { csvLine, CSV_BOM } from "./exports";
import { getSettings } from "./settings";

// ── Inputs ────────────────────────────────────────────────────────────────────

export interface DayShift {
  start: string;
  end: string;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
}

export interface BagDayLite {
  bagId: string;
  day: string;
  shifts: DayShift[];
  stops: { start: string; end: string; seconds: number }[];
  gaps: { start: string; end: string; seconds: number }[];
}

export type PaySettings = Pick<SettingsDto, "paySignalGaps" | "stopMin" | "stopRadiusM" | "payMinHours" | "payRate">;

export interface PayrollInput {
  range: PayRange;
  today: string;
  /** bag_days inside the period */
  bagDays: BagDayLite[];
  /** bag_days before the period (only for "longest shift they've done") */
  history: BagDayLite[];
  assignments: AssignmentRow[];
  bagNames: Map<string, string>;
  riders: Map<string, { name: string; demo: boolean }>;
  settings: PaySettings;
  /** Every change ever made in this period; the latest per rider-day counts */
  adjustments: PayAdjustment[];
}

export type ComputedPayroll = Omit<PayrollResponse, "status" | "approvedBy" | "approvedAt" | "fromSnapshot" | "overlaps">;

const dayLabel = (day: string) => `${payWeekday(day)} ${payPeriodLabel(day, day, { short: true })}`;

/** Latest change per rider-day. */
export function effectiveAdjustments(list: PayAdjustment[]): Map<string, PayAdjustment> {
  const out = new Map<string, PayAdjustment>();
  for (const a of list) out.set(`${a.riderId}:${a.day}`, a);
  return out;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Bag hand-overs (and hand-backs) inside the period, in plain English. */
export function payHandovers(range: PayRange, assignments: AssignmentRow[], bagName: (id: string) => string): PayHandover[] {
  const from = londonDayBounds(range.startDay)[0].getTime();
  const to = londonDayBounds(range.endDay)[1].getTime();
  const byBag = new Map<string, AssignmentRow[]>();
  for (const a of assignments) byBag.set(a.bagId, [...(byBag.get(a.bagId) ?? []), a]);
  const out: PayHandover[] = [];
  for (const [bagId, list] of byBag) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    list.forEach((a, i) => {
      const s = a.start.getTime();
      const prev = list[i - 1];
      if (prev && s >= from && s < to) {
        const day = londonDay(a.start);
        const prevLast = prev.end ? londonDay(new Date(Math.min(prev.end.getTime(), s) - 1)) : day;
        out.push({
          bagId,
          bagName: bagName(bagId),
          day,
          at: a.start.toISOString(),
          fromRiderId: prev.riderId,
          fromRiderName: prev.riderName,
          toRiderId: a.riderId,
          toRiderName: a.riderName,
          text:
            `${bagName(bagId)} changed hands on ${payPeriodLabel(day, day, { short: true })}. Each shift is credited to whoever had the bag when it started ` +
            `(${prev.riderName} to ${payPeriodLabel(prevLast, prevLast, { short: true })}, ${a.riderName} from ${payPeriodLabel(day, day, { short: true })}).`,
        });
      }
      const e = a.end?.getTime();
      const next = list[i + 1];
      if (e !== undefined && e > from && e <= to && !(next && next.start.getTime() < to)) {
        const last = londonDay(new Date(e - 1));
        out.push({
          bagId,
          bagName: bagName(bagId),
          day: last,
          at: a.end!.toISOString(),
          fromRiderId: a.riderId,
          fromRiderName: a.riderName,
          toRiderId: null,
          toRiderName: null,
          text: `${a.riderName} handed ${bagName(bagId)} back after ${payPeriodLabel(last, last, { short: true })}. Shifts after that aren't credited to anyone.`,
        });
      }
    });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ── The calculation (pure) ────────────────────────────────────────────────────

interface CellAcc extends PayCell {
  paid: number;
}

export function computePayroll(input: PayrollInput): ComputedPayroll {
  const { range, settings, assignments } = input;
  const days = daysBetween(range.startDay, range.endDay);
  const inPeriod = new Set(days);
  const from = londonDayBounds(range.startDay)[0].getTime();
  const to = londonDayBounds(range.endDay)[1].getTime();
  const bagName = (id: string) => input.bagNames.get(id) ?? "Unknown bag";
  const rate = parsePayRate(settings.payRate);

  const cells = new Map<string, Map<string, CellAcc>>();
  const cellFor = (riderId: string, day: string): CellAcc => {
    let byDay = cells.get(riderId);
    if (!byDay) cells.set(riderId, (byDay = new Map()));
    let c = byDay.get(day);
    if (!c) {
      c = { day, calculatedHours: 0, hours: 0, onSeconds: 0, movingSeconds: 0, stoppedSeconds: 0, gapSeconds: 0, km: 0, shifts: [], bagIds: [], flags: [], adjustment: null, paid: 0 };
      byDay.set(day, c);
    }
    return c;
  };
  const unassigned = new Map<string, PayUnassigned>();
  /** Every shift a rider did (history + period), for "longest shift they've done". */
  const riderShifts = new Map<string, { paid: number; day: string; bagId: string; start: string; inPeriod: boolean }[]>();
  const noteShift = (riderId: string, x: { paid: number; day: string; bagId: string; start: string; inPeriod: boolean }) =>
    riderShifts.set(riderId, [...(riderShifts.get(riderId) ?? []), x]);

  for (const bd of input.history) {
    for (const s of bd.shifts) {
      const who = activeAt(assignments, bd.bagId, new Date(s.start));
      if (who) noteShift(who.riderId, { paid: paidSeconds(s, settings.paySignalGaps), day: bd.day, bagId: bd.bagId, start: s.start, inPeriod: false });
    }
  }

  for (const bd of input.bagDays) {
    if (!inPeriod.has(bd.day)) continue;
    for (const s of bd.shifts) {
      const paid = paidSeconds(s, settings.paySignalGaps);
      const who = activeAt(assignments, bd.bagId, new Date(s.start));
      if (!who) {
        const u = unassigned.get(bd.bagId) ?? { bagId: bd.bagId, bagName: bagName(bd.bagId), days: [], shifts: 0, movingSeconds: 0, paidSeconds: 0 };
        if (!u.days.includes(bd.day)) u.days.push(bd.day);
        u.shifts++;
        u.movingSeconds += s.movingSeconds;
        u.paidSeconds += paid;
        unassigned.set(bd.bagId, u);
        continue;
      }
      const c = cellFor(who.riderId, bd.day);
      c.paid += paid;
      c.onSeconds += s.onSeconds;
      c.movingSeconds += s.movingSeconds;
      c.stoppedSeconds += s.stoppedSeconds;
      c.gapSeconds += s.gapSeconds;
      c.km += s.km;
      c.shifts.push({
        bagId: bd.bagId,
        bagName: bagName(bd.bagId),
        start: s.start,
        end: s.end,
        onSeconds: s.onSeconds,
        movingSeconds: s.movingSeconds,
        stoppedSeconds: s.stoppedSeconds,
        gapSeconds: s.gapSeconds,
        km: s.km,
        paidSeconds: paid,
      } satisfies PayShift);
      if (!c.bagIds.includes(bd.bagId)) c.bagIds.push(bd.bagId);
      noteShift(who.riderId, { paid, day: bd.day, bagId: bd.bagId, start: s.start, inPeriod: true });

      // Odd things about this shift.
      const t0 = Date.parse(s.start);
      const t1 = Date.parse(s.end);
      const inShift = (x: { start: string }) => {
        const t = Date.parse(x.start);
        return t >= t0 && t <= t1;
      };
      const flag = (f: Omit<PayFlag, "bagId">) => c.flags.push({ ...f, bagId: bd.bagId });
      const stops = bd.stops.filter(inShift);
      // Silence while stopped in one place is stop time (as in the analytics), so
      // only the part of a gap outside stops counts towards review.
      const outsideStops = (g: { start: string; end: string; seconds: number }) => {
        const a = Date.parse(g.start);
        const b = Date.parse(g.end);
        const inStops = stops.reduce((o, st) => o + Math.max(0, Math.min(b, Date.parse(st.end)) - Math.max(a, Date.parse(st.start))), 0);
        return g.seconds - inStops / 1000;
      };
      const gaps = bd.gaps.filter(inShift).filter((g) => outsideStops(g) >= 60);
      const longGaps = gaps.filter((g) => outsideStops(g) >= PAY_REVIEW.gapMin * 60);
      for (const g of longGaps) flag({ kind: "gap", text: payFlagText.gap(g.seconds), at: g.start });
      if (!longGaps.length && s.gapSeconds >= PAY_REVIEW.gapTotalMin * 60) {
        flag(
          gaps.length > 1
            ? { kind: "gaps", text: payFlagText.gaps(s.gapSeconds, gaps.length), at: gaps[0]?.start ?? s.start }
            : { kind: "gap", text: payFlagText.gap(s.gapSeconds), at: gaps[0]?.start ?? s.start },
        );
      }
      for (const st of stops) {
        if (st.seconds >= PAY_REVIEW.stopHours * 3600) flag({ kind: "stop", text: payFlagText.stop(st.seconds), at: st.start });
      }
      if (s.onSeconds > PAY_REVIEW.longShiftHours * 3600) flag({ kind: "long_shift", text: payFlagText.longShift(s.onSeconds), at: s.start });
      if (s.onSeconds >= PAY_REVIEW.neverMovedMin * 60 && s.km < PAY_REVIEW.neverMovedKm) {
        flag({ kind: "never_moved", text: payFlagText.neverMoved(s.onSeconds), at: s.start });
      }
    }
  }

  // Longest shift they've done: well above their usual, with enough history to say so.
  for (const [riderId, list] of riderShifts) {
    if (list.length < PAY_REVIEW.longestMinHistory + 1) continue;
    for (const x of list) {
      if (!x.inPeriod || x.paid < PAY_REVIEW.longestMinHours * 3600) continue;
      const others = list.filter((y) => y !== x).map((y) => y.paid);
      if (x.paid > Math.max(...others) && x.paid >= PAY_REVIEW.longestVsMedian * median(others)) {
        cellFor(riderId, x.day).flags.push({ kind: "longest_shift", text: payFlagText.longest(payHours(x.paid)), bagId: x.bagId, at: x.start });
      }
    }
  }

  // Two bags on the same day.
  for (const byDay of cells.values()) {
    for (const c of byDay.values()) {
      if (c.bagIds.length > 1) {
        c.flags.push({ kind: "two_bags", text: payFlagText.twoBags(c.bagIds.map(bagName)), bagId: c.bagIds[0], at: c.shifts[0]?.start ?? null });
      }
    }
  }

  // Changes people made.
  const adjustments = effectiveAdjustments(input.adjustments.filter((a) => inPeriod.has(a.day)));
  for (const a of adjustments.values()) cellFor(a.riderId, a.day);

  // Riders: everyone who held a bag during the period, plus anyone with hours or a change.
  const holding = assignments.filter((a) => a.start.getTime() < to && (!a.end || a.end.getTime() > from));
  const riderIds = new Set<string>([...holding.map((a) => a.riderId), ...cells.keys()]);
  const nameOf = (id: string) => input.riders.get(id)?.name ?? assignments.find((a) => a.riderId === id)?.riderName ?? "Unknown rider";

  const rows: PayRiderRow[] = [];
  const review: PayReviewItem[] = [];
  for (const riderId of riderIds) {
    const byDay = cells.get(riderId) ?? new Map<string, CellAcc>();
    const riderCells: PayCell[] = [];
    for (const day of days) {
      const acc = byDay.get(day);
      if (!acc) continue;
      const { paid, ...cell } = acc;
      const adj = adjustments.get(`${riderId}:${day}`) ?? null;
      cell.calculatedHours = payHours(paid);
      cell.hours = adj ? adj.hours : cell.calculatedHours;
      cell.adjustment = adj;
      cell.km = Math.round(cell.km * 100) / 100;
      riderCells.push(cell);
      if (cell.flags.length) {
        const bagId = cell.flags[0].bagId ?? cell.bagIds[0] ?? null;
        review.push({
          id: `${riderId}:${day}`,
          riderId,
          riderName: nameOf(riderId),
          day,
          bagId,
          bagName: bagId ? bagName(bagId) : null,
          reasons: cell.flags,
          calculatedHours: cell.calculatedHours,
          hours: cell.hours,
          adjustment: adj,
        });
      }
    }
    const bags: PayRiderBag[] = holding
      .filter((a) => a.riderId === riderId)
      .map((a) => ({
        bagId: a.bagId,
        bagName: bagName(a.bagId),
        from: a.start.getTime() >= from ? londonDay(a.start) : null,
        to: a.end && a.end.getTime() <= to ? londonDay(new Date(a.end.getTime() - 1)) : null,
      }));
    for (const c of riderCells) for (const id of c.bagIds) if (!bags.some((b) => b.bagId === id)) bags.push({ bagId: id, bagName: bagName(id), from: null, to: null });
    const sum = (f: (c: PayCell) => number) => riderCells.reduce((s, c) => s + f(c), 0);
    const hours = payRound2(sum((c) => c.hours));
    const qualifies = settings.payMinHours <= 0 || hours >= settings.payMinHours;
    rows.push({
      riderId,
      riderName: nameOf(riderId),
      demo: input.riders.get(riderId)?.demo ?? holding.find((a) => a.riderId === riderId)?.riderDemo ?? false,
      bags,
      cells: riderCells,
      calculatedHours: payRound2(sum((c) => c.calculatedHours)),
      hours,
      movingSeconds: sum((c) => c.movingSeconds),
      stoppedSeconds: sum((c) => c.stoppedSeconds),
      gapSeconds: sum((c) => c.gapSeconds),
      km: Math.round(sum((c) => c.km) * 10) / 10,
      shifts: sum((c) => c.shifts.length),
      toReview: riderCells.filter((c) => c.flags.length && !c.adjustment).length,
      qualifies,
      pay: rate === null ? null : qualifies ? payRound2(hours * rate) : 0,
    });
  }
  rows.sort((a, b) => a.riderName.localeCompare(b.riderName, "en-GB"));
  review.sort((a, b) => Number(!!a.adjustment) - Number(!!b.adjustment) || a.day.localeCompare(b.day) || a.riderName.localeCompare(b.riderName));

  const dayTotals = days.map((d) => payRound2(rows.reduce((s, r) => s + (r.cells.find((c) => c.day === d)?.hours ?? 0), 0)));
  const paidRiders = rows.filter((r) => r.hours > 0);
  const totalPay = rate === null ? null : payRound2(rows.reduce((s, r) => s + (r.pay ?? 0), 0));

  return {
    startDay: range.startDay,
    endDay: range.endDay,
    days,
    kind: payIsFortnight(range) ? "fortnight" : "custom",
    ended: range.endDay < input.today,
    rules: {
      paySignalGaps: settings.paySignalGaps,
      stopMin: settings.stopMin,
      stopRadiusM: settings.stopRadiusM,
      payMinHours: settings.payMinHours,
      payRate: settings.payRate,
      rate,
      sentence: payRulesSentence(settings),
    },
    riders: rows,
    dayTotals,
    totals: {
      riders: paidRiders.length,
      carrying: new Set(holding.map((a) => a.riderId)).size,
      hours: payRound2(rows.reduce((s, r) => s + r.hours, 0)),
      calculatedHours: payRound2(rows.reduce((s, r) => s + r.calculatedHours, 0)),
      movingSeconds: rows.reduce((s, r) => s + r.movingSeconds, 0),
      stoppedSeconds: rows.reduce((s, r) => s + r.stoppedSeconds, 0),
      gapSeconds: rows.reduce((s, r) => s + r.gapSeconds, 0),
      pay: totalPay,
      underMinimum: settings.payMinHours > 0 ? paidRiders.filter((r) => !r.qualifies).length : 0,
      toReview: review.filter((r) => !r.adjustment).length,
      reviewed: review.filter((r) => r.adjustment).length,
    },
    review,
    handovers: payHandovers(range, assignments, bagName),
    unassigned: [...unassigned.values()]
      .map((u) => ({ ...u, days: u.days.sort() }))
      .sort((a, b) => a.bagName.localeCompare(b.bagName, "en-GB", { numeric: true })),
    computedAt: new Date().toISOString(),
  };
}

// ── Loading ───────────────────────────────────────────────────────────────────

function toLite(r: RecordModel, withDetail: boolean): BagDayLite {
  const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);
  return {
    bagId: r.bag,
    day: r.day,
    shifts: arr<DayShift>(r.shifts),
    stops: withDetail ? arr(r.stops) : [],
    gaps: withDetail ? arr(r.signal_gaps) : [],
  };
}

/** How far back to look for "longest shift they've done". */
const HISTORY_DAYS = 28;

async function loadInput(range: PayRange, adjustments: PayAdjustment[]): Promise<PayrollInput> {
  const [settings, dayRows, historyRows, bags, riderRecs, assignments] = await Promise.all([
    getSettings(),
    getAll<RecordModel>("bag_days", {
      filter: `day >= ${q(range.startDay)} && day <= ${q(range.endDay)}`,
      fields: "bag,day,shifts,stops,signal_gaps",
    }),
    getAll<RecordModel>("bag_days", {
      filter: `day >= ${q(addDays(range.startDay, -HISTORY_DAYS))} && day < ${q(range.startDay)}`,
      fields: "bag,day,shifts",
    }),
    loadBags(),
    getAll<RecordModel>("riders", { fields: "id,name,demo" }),
    allAssignments(),
  ]);
  return {
    range,
    today: todayLondon(),
    bagDays: dayRows.map((r) => toLite(r, true)),
    history: historyRows.map((r) => toLite(r, false)),
    assignments,
    bagNames: new Map(bags.map((b) => [b.id, b.name as string])),
    riders: new Map(riderRecs.map((r) => [r.id, { name: r.name as string, demo: !!r.demo }])),
    settings,
    adjustments,
  };
}

// ── Pay periods (saved records) ───────────────────────────────────────────────

export async function findPeriod(range: PayRange): Promise<RecordModel | null> {
  return getFirst<RecordModel>("payroll_periods", `start_day = ${q(range.startDay)} && end_day = ${q(range.endDay)}`);
}

async function overlapping(range: PayRange): Promise<PayPeriodRef[]> {
  const recs = await getAll<RecordModel>("payroll_periods", {
    filter: `start_day <= ${q(range.endDay)} && end_day >= ${q(range.startDay)}`,
    fields: "start_day,end_day,status",
    sort: "start_day",
  });
  return recs
    .filter((r) => !(r.start_day === range.startDay && r.end_day === range.endDay))
    .map((r) => ({ startDay: r.start_day, endDay: r.end_day, status: r.status }));
}

function adjustmentsOf(rec: RecordModel | null): PayAdjustment[] {
  return Array.isArray(rec?.adjustments) ? (rec!.adjustments as PayAdjustment[]) : [];
}

/** The period as the page shows it: the frozen snapshot once approved, else calculated now. */
export async function payrollFor(range: PayRange): Promise<PayrollResponse> {
  const [rec, overlaps] = await Promise.all([findPeriod(range), overlapping(range)]);
  if (rec?.status === "approved" && rec.snapshot && Array.isArray((rec.snapshot as PayrollResponse).riders)) {
    const snap = rec.snapshot as PayrollResponse;
    const live = computePayroll(await loadInput(range, adjustmentsOf(rec)));
    return {
      ...snap,
      status: "approved",
      approvedBy: snap.approvedBy ?? "Unknown",
      approvedAt: parsePbDate(rec.approved_at)?.toISOString() ?? snap.approvedAt,
      fromSnapshot: true,
      ended: range.endDay < todayLondon(),
      overlaps,
      changedSinceApproval: changesSince(snap, live),
    };
  }
  const computed = computePayroll(await loadInput(range, adjustmentsOf(rec)));
  return { ...computed, status: "draft", approvedBy: null, approvedAt: null, fromSnapshot: false, overlaps };
}

/** Riders whose paid hours differ by 3 minutes or more between the snapshot and today's data. */
export function changesSince(snap: Pick<PayrollResponse, "riders">, live: Pick<PayrollResponse, "riders">): PayrollResponse["changedSinceApproval"] {
  const before = new Map(snap.riders.map((r) => [r.riderId, r]));
  const ids = new Set([...before.keys(), ...live.riders.map((r) => r.riderId)]);
  const now = new Map(live.riders.map((r) => [r.riderId, r]));
  const riders: { riderId: string; riderName: string; deltaHours: number }[] = [];
  for (const id of ids) {
    const delta = Math.round(((now.get(id)?.hours ?? 0) - (before.get(id)?.hours ?? 0)) * 100) / 100;
    if (Math.abs(delta) >= 0.05) riders.push({ riderId: id, riderName: now.get(id)?.riderName ?? before.get(id)!.riderName, deltaHours: delta });
  }
  if (!riders.length) return null;
  riders.sort((a, b) => Math.abs(b.deltaHours) - Math.abs(a.deltaHours));
  return { deltaHours: Math.round(riders.reduce((n, r) => n + r.deltaHours, 0) * 100) / 100, riders };
}

// One change at a time per period (the adjustments list is read-modify-write).
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(range: PayRange, fn: () => Promise<T>): Promise<T> {
  const key = `${range.startDay}|${range.endDay}`;
  const run = (locks.get(key) ?? Promise.resolve()).then(fn, fn);
  locks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

const label = (r: PayRange) => payPeriodLabel(r.startDay, r.endDay, { short: true, year: true });
const fmtHours = (h: number) => `${h.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 2 })} h`;

/** Hours calculated for one rider-day right now (what a change is compared against). */
async function calculatedFor(riderId: string, day: string): Promise<number> {
  const [settings, rows, assignments] = await Promise.all([
    getSettings(),
    getAll<RecordModel>("bag_days", { filter: `day = ${q(day)}`, fields: "bag,day,shifts" }),
    allAssignments(),
  ]);
  let paid = 0;
  for (const r of rows) {
    for (const s of toLite(r, false).shifts) {
      if (activeAt(assignments, r.bag, new Date(s.start))?.riderId === riderId) paid += paidSeconds(s, settings.paySignalGaps);
    }
  }
  return payHours(paid);
}

export async function adjustHours(
  range: PayRange,
  body: { riderId: string; day: string; hours: number; note: string; asCalculated?: boolean },
  who: SessionUser,
): Promise<PayAdjustment> {
  if (body.day < range.startDay || body.day > range.endDay) throw new HttpError(400, "That day isn't in this pay period");
  const rider = await getOneOrNull<RecordModel>("riders", body.riderId);
  if (!rider) throw new HttpError(404, "Rider not found");
  return withLock(range, async () => {
    const rec = await findPeriod(range);
    if (rec?.status === "approved") throw new HttpError(409, "This period is approved, so its hours can't change. The owner can reopen it.");
    const calculatedHours = await calculatedFor(body.riderId, body.day);
    const hours = body.asCalculated ? calculatedHours : payRound2(body.hours);
    const note = body.note.trim();
    const asCalculated = Math.abs(hours - calculatedHours) < 0.005;
    if (!asCalculated && !note) throw new HttpError(400, "Add a short note saying why the hours changed");
    const adj: PayAdjustment = {
      id: randomBytes(6).toString("hex"),
      riderId: body.riderId,
      day: body.day,
      hours,
      calculatedHours,
      note: note || "Approved as calculated",
      byId: who.id,
      byName: who.name,
      at: new Date().toISOString(),
    };
    const list = [...adjustmentsOf(rec), adj];
    const saved = rec
      ? await pb.collection("payroll_periods").update(rec.id, { adjustments: list })
      : await pb.collection("payroll_periods").create({ start_day: range.startDay, end_day: range.endDay, status: "draft", adjustments: list });
    await audit(
      who,
      "payroll.adjust",
      asCalculated
        ? `Approved ${rider.name}'s ${fmtHours(hours)} on ${dayLabel(body.day)} as calculated`
        : `Changed ${rider.name}'s hours on ${dayLabel(body.day)} to ${fmtHours(hours)} (calculated ${fmtHours(calculatedHours)})`,
      { type: "payroll_period", id: saved.id },
      { startDay: range.startDay, endDay: range.endDay, riderId: body.riderId, day: body.day, hours, calculatedHours, note: adj.note },
    );
    return adj;
  });
}

/** Snapshots over the JSON field's limit drop the per-shift detail (the hours stay). */
function fitSnapshot(r: PayrollResponse): PayrollResponse {
  if (JSON.stringify(r).length < 1_800_000) return r;
  return { ...r, riders: r.riders.map((row) => ({ ...row, cells: row.cells.map((c) => ({ ...c, shifts: [] })) })) };
}

export async function approvePeriod(range: PayRange, who: SessionUser): Promise<PayrollResponse> {
  const today = todayLondon();
  if (range.endDay >= today) {
    throw new HttpError(400, `This period isn't over yet. You can approve it from ${dayLabel(addDays(range.endDay, 1))}.`);
  }
  const clash = (await overlapping(range)).find((p) => p.status === "approved");
  if (clash) {
    throw new HttpError(
      400,
      `Some of these days are already in the approved period ${payPeriodLabel(clash.startDay, clash.endDay, { short: true })}. Reopen that period first, or pick other days.`,
    );
  }
  return withLock(range, async () => {
    const rec = await findPeriod(range);
    if (rec?.status === "approved") throw new HttpError(409, "This period is already approved");
    const computed = computePayroll(await loadInput(range, adjustmentsOf(rec)));
    const now = new Date();
    const snapshot = fitSnapshot({
      ...computed,
      status: "approved",
      approvedBy: who.name,
      approvedAt: now.toISOString(),
      fromSnapshot: true,
      overlaps: [],
    });
    const data = { status: "approved", snapshot, approved_by: who.id, approved_at: pbDate(now) };
    const saved = rec
      ? await pb.collection("payroll_periods").update(rec.id, data)
      : await pb.collection("payroll_periods").create({ start_day: range.startDay, end_day: range.endDay, adjustments: [], ...data });
    const t = computed.totals;
    await audit(
      who,
      "payroll.approve",
      `Approved pay period ${label(range)}: ${fmtHours(t.hours)} for ${t.riders} ${t.riders === 1 ? "rider" : "riders"}` +
        (t.toReview ? ` (${t.toReview} unchecked, approved as calculated)` : ""),
      { type: "payroll_period", id: saved.id },
      { startDay: range.startDay, endDay: range.endDay, hours: t.hours, riders: t.riders, pay: t.pay, unchecked: t.toReview },
    );
    return { ...snapshot, overlaps: await overlapping(range) };
  });
}

export async function reopenPeriod(range: PayRange, who: SessionUser): Promise<PayrollResponse> {
  if (who.role !== "owner") throw new HttpError(403, "Only the owner can reopen an approved period");
  await withLock(range, async () => {
    const rec = await findPeriod(range);
    if (!rec || rec.status !== "approved") throw new HttpError(409, "This period isn't approved");
    const snap = rec.snapshot as PayrollResponse | null;
    await pb.collection("payroll_periods").update(rec.id, { status: "draft", snapshot: null, approved_by: "", approved_at: "" });
    await audit(
      who,
      "payroll.reopen",
      `Reopened pay period ${label(range)}` + (snap?.approvedBy ? ` (approved by ${snap.approvedBy})` : ""),
      { type: "payroll_period", id: rec.id },
      { startDay: range.startDay, endDay: range.endDay, approvedHours: snap?.totals?.hours ?? null },
    );
  });
  return payrollFor(range);
}

// ── Export for payroll ────────────────────────────────────────────────────────

const PAY_DETAIL_HEADER = [
  "Rider",
  "Date",
  "Day",
  "Bags",
  "Shifts",
  "First out",
  "Last in",
  "Moving (h)",
  "Stopped (h)",
  "No signal (h)",
  "Calculated (h)",
  "Paid (h)",
  "Changed by",
  "Note",
  "Needs a look",
];

const h2 = (s: number) => Math.round(s / 36) / 100;
const hhmm = (iso: string | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
};

function detailRows(p: PayrollResponse): (string | number | null)[][] {
  const out: (string | number | null)[][] = [];
  for (const r of p.riders) {
    for (const c of r.cells) {
      const changed = c.adjustment && Math.abs(c.adjustment.hours - c.calculatedHours) >= 0.005;
      out.push([
        r.riderName,
        c.day,
        payWeekday(c.day),
        [...new Set(c.shifts.map((s) => s.bagName))].join(", "),
        c.shifts.length,
        hhmm(c.shifts[0]?.start),
        hhmm(c.shifts[c.shifts.length - 1]?.end),
        h2(c.movingSeconds),
        h2(c.stoppedSeconds),
        h2(c.gapSeconds),
        c.calculatedHours,
        c.hours,
        c.adjustment ? c.adjustment.byName : "",
        c.adjustment ? (changed ? c.adjustment.note : "Checked: approved as calculated") : "",
        c.flags.map((f) => f.text).join("; "),
      ]);
    }
  }
  return out;
}

export function payrollCsv(p: PayrollResponse): string {
  return CSV_BOM + csvLine(PAY_DETAIL_HEADER) + detailRows(p).map(csvLine).join("");
}

function statusLine(p: PayrollResponse): string {
  if (p.status === "approved") return `Approved by ${p.approvedBy ?? "unknown"} on ${p.approvedAt ? new Date(p.approvedAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }) : "unknown date"}`;
  return p.ended ? "Draft — not approved yet" : "Draft — the period isn't over yet";
}

export async function payrollXlsx(p: PayrollResponse): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DigiLite Hub";
  const bold = { bold: true };
  const head = (ws: ExcelJS.Worksheet) => {
    const row = ws.getRow(1);
    row.font = bold;
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEBE2" } };
  };

  // Summary
  const sum = wb.addWorksheet("Summary");
  sum.columns = [
    { key: "k", width: 26 },
    { key: "v", width: 100 },
  ];
  const t = p.totals;
  const rows: [string, string | number][] = [
    ["Pay period", payPeriodLabel(p.startDay, p.endDay, { year: true })],
    ["Status", statusLine(p)],
    ["Pay rules", p.rules.sentence],
    ["Rate", p.rules.rate !== null ? `${formatPay(p.rules.rate)} per hour` : p.rules.payRate.trim() || "Not set in Settings"],
    ["Paid hours", t.hours],
    ["Riders with paid hours", t.riders],
    ["To pay", t.pay !== null ? formatPay(t.pay) : "Set an hourly rate in Settings to work this out"],
    ["Stopped (not paid), h", h2(t.stoppedSeconds)],
    [p.rules.paySignalGaps ? "No signal (paid), h" : "No signal (not paid), h", h2(t.gapSeconds)],
    ["Checked by hand", `${t.reviewed} of ${t.reviewed + t.toReview} rider-days that needed a look`],
    ["Days", "London days, midnight to midnight. A shift is credited to whoever had the bag when it started."],
  ];
  for (const h of p.handovers) rows.push(["Hand-over", h.text]);
  for (const u of p.unassigned) rows.push(["No rider", `${u.bagName} was out on ${u.days.length} ${u.days.length === 1 ? "day" : "days"} with nobody assigned (${h2(u.paidSeconds)} h). Not credited to anyone.`]);
  if (t.underMinimum) rows.push(["Under the minimum", `${t.underMinimum} ${t.underMinimum === 1 ? "rider has" : "riders have"} fewer than ${p.rules.payMinHours} h and ${t.underMinimum === 1 ? "doesn't" : "don't"} qualify.`]);
  for (const [k, v] of rows) sum.addRow([k, v]);
  sum.getColumn(1).font = bold;

  // Hours grid: riders × days
  const grid = wb.addWorksheet("Hours", { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  grid.columns = [
    { header: "Rider", key: "rider", width: 24 },
    ...p.days.map((d) => ({ header: `${payWeekday(d)} ${payPeriodLabel(d, d, { short: true })}`, key: d, width: 10 })),
    { header: "Total (h)", key: "total", width: 11 },
    ...(p.rules.rate !== null ? [{ header: "Pay", key: "pay", width: 12 }] : []),
    { header: "Changes", key: "changes", width: 70 },
  ];
  head(grid);
  for (const r of p.riders) {
    const byDay = new Map(r.cells.map((c) => [c.day, c]));
    const changes = r.cells
      .filter((c) => c.adjustment && Math.abs(c.adjustment.hours - c.calculatedHours) >= 0.005)
      .map((c) => `${payPeriodLabel(c.day, c.day, { short: true })}: ${c.hours} h (calculated ${c.calculatedHours} h) by ${c.adjustment!.byName} — ${c.adjustment!.note}`)
      .join("; ");
    grid.addRow([
      r.riderName + (r.qualifies ? "" : " (under the minimum)"),
      ...p.days.map((d) => byDay.get(d)?.hours ?? null),
      r.hours,
      ...(p.rules.rate !== null ? [r.pay !== null ? formatPay(r.pay) : ""] : []),
      changes,
    ]);
  }
  const totalRow = grid.addRow(["Total", ...p.dayTotals, t.hours, ...(p.rules.rate !== null ? [t.pay !== null ? formatPay(t.pay) : ""] : []), ""]);
  totalRow.font = bold;

  // Detail: one row per rider per day
  const detail = wb.addWorksheet("Detail", { views: [{ state: "frozen", ySplit: 1 }] });
  detail.columns = PAY_DETAIL_HEADER.map((h) => ({ header: h, key: h, width: h === "Note" || h === "Needs a look" ? 48 : h === "Rider" ? 24 : 12 }));
  head(detail);
  for (const row of detailRows(p)) detail.addRow(row);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function payrollFilename(r: PayRange, format: "csv" | "xlsx"): string {
  return `digilite-payroll-${r.startDay}-to-${r.endDay}.${format}`;
}

export async function auditPayrollExport(who: SessionUser, p: PayrollResponse, format: "csv" | "xlsx") {
  const rec = await findPeriod(p);
  await audit(
    who,
    "payroll.export",
    `Exported pay period ${label(p)} (${format === "xlsx" ? "Excel" : "CSV"}, ${p.status === "approved" ? "approved" : "draft"})`,
    { type: "payroll_period", id: rec?.id ?? `${p.startDay}_${p.endDay}` },
    { startDay: p.startDay, endDay: p.endDay, format, status: p.status, hours: p.totals.hours },
  );
}
