// Contracts for the payroll area, plus the small pure helpers both sides need
// (pay period maths, pay rule wording, rate parsing).
//
// Pay is per rider, from the bag's data while they held it: a shift belongs to
// the rider who had the bag when the shift started. Days are London days.

import { addDays, formatDuration } from "../time";

// ── Pay periods ───────────────────────────────────────────────────────────────

/** Fortnightly pay periods are anchored on this Monday (…, 14–27 Sep, 28 Sep–11 Oct, …). */
export const PAY_PERIOD_ANCHOR = "2026-09-14";
export const PAY_PERIOD_DAYS = 14;
/** Longest custom range payroll (and exports) will work on. */
export const PAY_MAX_DAYS = 31;

export interface PayRange {
  startDay: string;
  endDay: string;
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD day (calendar maths only, no time zone). */
export function payDayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Number of days from `startDay` to `endDay`, inclusive. */
export function payDayCount(startDay: string, endDay: string): number {
  return payDayNumber(endDay) - payDayNumber(startDay) + 1;
}

/** The fortnight (Monday to the Sunday a week later) that contains `day`. */
export function payFortnightOf(day: string): PayRange {
  const offset = payDayNumber(day) - payDayNumber(PAY_PERIOD_ANCHOR);
  const k = Math.floor(offset / PAY_PERIOD_DAYS);
  const startDay = addDays(PAY_PERIOD_ANCHOR, k * PAY_PERIOD_DAYS);
  return { startDay, endDay: addDays(startDay, PAY_PERIOD_DAYS - 1) };
}

/** The most recent fortnight that has fully ended before `today`. */
export function payLastCompletedFortnight(today: string): PayRange {
  const current = payFortnightOf(today);
  return payFortnightOf(addDays(current.startDay, -1));
}

export function payIsFortnight(r: PayRange): boolean {
  const f = payFortnightOf(r.startDay);
  return f.startDay === r.startDay && f.endDay === r.endDay;
}

/** Move a period back (n < 0) or forward (n > 0): by fortnights, or by its own length for a custom range. */
export function payStepPeriod(r: PayRange, n: number): PayRange {
  const len = payIsFortnight(r) ? PAY_PERIOD_DAYS : payDayCount(r.startDay, r.endDay);
  return { startDay: addDays(r.startDay, n * len), endDay: addDays(r.endDay, n * len) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

/** "Mon" for a YYYY-MM-DD day. */
export function payWeekday(day: string): string {
  return WEEKDAYS[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

/**
 * "14 – 27 September", "28 September – 11 October", "28 December 2026 – 10 January 2027".
 * `short` uses three-letter months; `year` always adds the year.
 */
export function payPeriodLabel(startDay: string, endDay: string, opts: { short?: boolean; year?: boolean } = {}): string {
  const a = parts(startDay);
  const b = parts(endDay);
  const mon = (m: number) => (opts.short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1]);
  const yr = (y: number) => (opts.year ? ` ${y}` : "");
  if (startDay === endDay) return `${a.d} ${mon(a.m)}${yr(a.y)}`;
  if (a.y !== b.y) return `${a.d} ${mon(a.m)} ${a.y} – ${b.d} ${mon(b.m)} ${b.y}`;
  if (a.m === b.m) return `${a.d} – ${b.d} ${mon(b.m)}${yr(b.y)}`;
  return `${a.d} ${mon(a.m)} – ${b.d} ${mon(b.m)}${yr(b.y)}`;
}

// ── Pay rules ─────────────────────────────────────────────────────────────────

/** What sends a rider-day to the review queue. Fixed; the pay rules themselves live in Settings. */
export const PAY_REVIEW = {
  /** One signal gap this long or longer, mid-shift */
  gapMin: 30,
  /** No single long gap, but this much no-signal time in one shift */
  gapTotalMin: 30,
  /** One stop this long or longer */
  stopHours: 2,
  /** Bag on for longer than this in one shift */
  longShiftHours: 10,
  /** Bag on at least this long … */
  neverMovedMin: 15,
  /** … but covered less than this */
  neverMovedKm: 0.3,
  /** "Longest shift they've done" needs at least this many paid hours … */
  longestMinHours: 6,
  /** … at least this many times their usual (median) shift … */
  longestVsMedian: 1.5,
  /** … and this many other shifts to compare against */
  longestMinHistory: 5,
} as const;

/** A pay rate typed in Settings ("12.50", "£12.50", "£12.50 per hour") as a number, or null if it isn't one. */
export function parsePayRate(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^£?\s*(\d{1,4}(?:\.\d{1,2})?)\s*(?:(?:\/|per|an?)\s*(?:h|hr|hour))?\s*$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatPay(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export interface PayRulesInput {
  paySignalGaps: boolean;
  stopMin: number;
  stopRadiusM: number;
  payMinHours: number;
}

/** The pay rules in one or two plain sentences (shown above the grid and in exports). */
export function payRulesSentence(r: PayRulesInput): string {
  const out: string[] = [];
  out.push(r.paySignalGaps ? "Paid time is when the bag is on and moving, plus time with no signal." : "Paid time is when the bag is on and moving.");
  out.push(`Stops of ${r.stopMin} min or more within ${r.stopRadiusM} m are not paid.`);
  out.push(
    r.paySignalGaps
      ? `A signal gap of ${PAY_REVIEW.gapMin} min or more goes to review.`
      : `Time with no signal isn't paid, and a gap of ${PAY_REVIEW.gapMin} min or more goes to review.`,
  );
  if (r.payMinHours > 0) out.push(`A rider needs at least ${r.payMinHours} h in the period to qualify.`);
  return out.join(" ");
}

/** Hours with two decimals (the unit payroll works in). */
export function payHours(seconds: number): number {
  return Math.round(seconds / 36) / 100;
}

export function payRound2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Review flags ──────────────────────────────────────────────────────────────

export type PayFlagKind = "gap" | "gaps" | "stop" | "long_shift" | "longest_shift" | "never_moved" | "two_bags";

export interface PayFlag {
  kind: PayFlagKind;
  /** Plain English, e.g. "No signal for 2h 10m mid-shift" */
  text: string;
  bagId: string | null;
  /** ISO time the thing started, when there is one */
  at: string | null;
}

export const payFlagText = {
  gap: (seconds: number) => `No signal for ${formatDuration(seconds)} mid-shift`,
  gaps: (seconds: number, n: number) => `No signal for ${formatDuration(seconds)} in total (${n} gaps)`,
  stop: (seconds: number) => `Stopped ${formatDuration(seconds)} in one place`,
  longShift: (onSeconds: number) => `Shift over ${PAY_REVIEW.longShiftHours} hours (bag on ${formatDuration(onSeconds)})`,
  longest: (hours: number) => `Longest shift they've done (${hours.toFixed(1)} h)`,
  neverMoved: (onSeconds: number) => `Bag on for ${formatDuration(onSeconds)} but never moved`,
  twoBags: (names: string[]) =>
    `Carried ${names.length === 2 ? "two" : names.length} bags on the same day (${names.slice(0, -1).join(", ")} and ${names[names.length - 1]})`,
};

// ── API shapes ────────────────────────────────────────────────────────────────

export interface PayShift {
  bagId: string;
  bagName: string;
  start: string;
  end: string;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  paidSeconds: number;
}

/** A person's change to one rider-day, kept with who made it and when. */
export interface PayAdjustment {
  id: string;
  riderId: string;
  day: string;
  /** Hours to pay for that day */
  hours: number;
  /** What was calculated when the change was made */
  calculatedHours: number;
  note: string;
  byId: string | null;
  byName: string;
  at: string;
}

export interface PayCell {
  day: string;
  /** From the data, under the pay rules (2 dp) */
  calculatedHours: number;
  /** What is paid: the change if there is one, else the calculated hours */
  hours: number;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  shifts: PayShift[];
  bagIds: string[];
  flags: PayFlag[];
  adjustment: PayAdjustment | null;
}

export interface PayRiderBag {
  bagId: string;
  bagName: string;
  /** Day they took it, when that was inside the period */
  from: string | null;
  /** Last day they had it, when they handed it back inside the period */
  to: string | null;
}

export interface PayRiderRow {
  riderId: string;
  riderName: string;
  demo: boolean;
  bags: PayRiderBag[];
  /** Days with data or a change, in day order */
  cells: PayCell[];
  calculatedHours: number;
  hours: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  shifts: number;
  /** Rider-days still needing a look */
  toReview: number;
  /** Meets the minimum hours for the period (always true when there's no minimum) */
  qualifies: boolean;
  /** hours × rate, when a rate is set and they qualify */
  pay: number | null;
}

export interface PayReviewItem {
  /** riderId:day */
  id: string;
  riderId: string;
  riderName: string;
  day: string;
  bagId: string | null;
  bagName: string | null;
  reasons: PayFlag[];
  calculatedHours: number;
  hours: number;
  /** Set once someone approved or changed the hours */
  adjustment: PayAdjustment | null;
}

export interface PayHandover {
  bagId: string;
  bagName: string;
  /** London day the change happened */
  day: string;
  at: string;
  fromRiderId: string | null;
  fromRiderName: string | null;
  toRiderId: string | null;
  toRiderName: string | null;
  text: string;
}

/** A bag that was out with nobody assigned to it: those hours aren't credited to anyone. */
export interface PayUnassigned {
  bagId: string;
  bagName: string;
  days: string[];
  shifts: number;
  movingSeconds: number;
  paidSeconds: number;
}

export interface PayRules extends PayRulesInput {
  payRate: string;
  /** The rate as a number, or null when it isn't set (money isn't shown then) */
  rate: number | null;
  sentence: string;
}

export interface PayTotals {
  /** Riders with paid hours */
  riders: number;
  /** Riders who held a bag at some point in the period */
  carrying: number;
  hours: number;
  calculatedHours: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  pay: number | null;
  underMinimum: number;
  toReview: number;
  reviewed: number;
}

export interface PayPeriodRef extends PayRange {
  status: "draft" | "approved";
}

export interface PayrollResponse extends PayRange {
  days: string[];
  kind: "fortnight" | "custom";
  /** The last day has finished (London) */
  ended: boolean;
  status: "draft" | "approved";
  approvedBy: string | null;
  approvedAt: string | null;
  /** Served from the snapshot taken at approval (numbers frozen) */
  fromSnapshot: boolean;
  rules: PayRules;
  riders: PayRiderRow[];
  /** Paid hours per day, aligned with `days` */
  dayTotals: number[];
  totals: PayTotals;
  review: PayReviewItem[];
  handovers: PayHandover[];
  unassigned: PayUnassigned[];
  /** Other saved periods that share days with this one */
  overlaps: PayPeriodRef[];
  computedAt: string;
  /**
   * Approved periods only: how the hours would differ if worked out from today's
   * data (late uploads from bags that were offline, for instance). Null when nothing
   * has changed. The frozen numbers stand until the period is reopened.
   */
  changedSinceApproval?: { deltaHours: number; riders: { riderId: string; riderName: string; deltaHours: number }[] } | null;
}

export interface PayAdjustRequest extends PayRange {
  riderId: string;
  day: string;
  hours: number;
  note: string;
  /** "Approve as calculated": pay whatever the data says right now (hours is then ignored) */
  asCalculated?: boolean;
}

export type PayPeriodRequest = PayRange;
