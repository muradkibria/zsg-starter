import { describe, expect, it } from "vitest";
import {
  parsePayRate,
  payDayCount,
  payFortnightOf,
  payIsFortnight,
  payLastCompletedFortnight,
  payPeriodLabel,
  payRulesSentence,
  payStepPeriod,
  type PayAdjustment,
} from "@digilite/shared";
import type { AssignmentRow } from "../src/domain/assignments";
import { computePayroll, effectiveAdjustments, payHandovers, type BagDayLite, type DayShift, type PayrollInput } from "../src/domain/payroll";

// ── Pay periods ───────────────────────────────────────────────────────────────

describe("pay periods", () => {
  it("fortnights are anchored on Monday 14 September 2026", () => {
    expect(payFortnightOf("2026-09-14")).toEqual({ startDay: "2026-09-14", endDay: "2026-09-27" });
    expect(payFortnightOf("2026-09-27")).toEqual({ startDay: "2026-09-14", endDay: "2026-09-27" });
    expect(payFortnightOf("2026-09-28")).toEqual({ startDay: "2026-09-28", endDay: "2026-10-11" });
    expect(payFortnightOf("2026-10-11")).toEqual({ startDay: "2026-09-28", endDay: "2026-10-11" });
  });

  it("works before the anchor and across years", () => {
    expect(payFortnightOf("2026-09-13")).toEqual({ startDay: "2026-08-31", endDay: "2026-09-13" });
    expect(payFortnightOf("2026-12-31")).toEqual({ startDay: "2026-12-21", endDay: "2027-01-03" });
  });

  it("defaults to the most recent completed fortnight", () => {
    expect(payLastCompletedFortnight("2026-09-29")).toEqual({ startDay: "2026-09-14", endDay: "2026-09-27" });
    // The first day of a new period: the one that just ended.
    expect(payLastCompletedFortnight("2026-09-28")).toEqual({ startDay: "2026-09-14", endDay: "2026-09-27" });
    // The last day of a period isn't over yet.
    expect(payLastCompletedFortnight("2026-09-27")).toEqual({ startDay: "2026-08-31", endDay: "2026-09-13" });
  });

  it("steps by fortnights, or by a custom range's own length", () => {
    const f = { startDay: "2026-09-14", endDay: "2026-09-27" };
    expect(payIsFortnight(f)).toBe(true);
    expect(payStepPeriod(f, 1)).toEqual({ startDay: "2026-09-28", endDay: "2026-10-11" });
    expect(payStepPeriod(f, -1)).toEqual({ startDay: "2026-08-31", endDay: "2026-09-13" });
    const custom = { startDay: "2026-09-01", endDay: "2026-09-30" };
    expect(payIsFortnight(custom)).toBe(false);
    expect(payStepPeriod(custom, 1)).toEqual({ startDay: "2026-10-01", endDay: "2026-10-30" });
  });

  it("counts days and labels ranges", () => {
    expect(payDayCount("2026-09-14", "2026-09-27")).toBe(14);
    expect(payDayCount("2026-10-20", "2026-10-30")).toBe(11); // across the clocks going back
    expect(payPeriodLabel("2026-09-14", "2026-09-27")).toBe("14 – 27 September");
    expect(payPeriodLabel("2026-09-28", "2026-10-11", { short: true })).toBe("28 Sep – 11 Oct");
    expect(payPeriodLabel("2026-12-21", "2027-01-03", { short: true })).toBe("21 Dec 2026 – 3 Jan 2027");
    expect(payPeriodLabel("2026-09-14", "2026-09-27", { short: true, year: true })).toBe("14 – 27 Sep 2026");
  });
});

describe("pay rules", () => {
  it("reads a rate only when it's a real number", () => {
    expect(parsePayRate("12.50")).toBe(12.5);
    expect(parsePayRate("£12.50 per hour")).toBe(12.5);
    expect(parsePayRate("£11/h")).toBe(11);
    expect(parsePayRate("")).toBeNull();
    expect(parsePayRate("[RATE]")).toBeNull();
    expect(parsePayRate("TBC")).toBeNull();
    expect(parsePayRate("0")).toBeNull();
  });

  it("describes the rules from settings", () => {
    const s = payRulesSentence({ paySignalGaps: false, stopMin: 15, stopRadiusM: 50, payMinHours: 0 });
    expect(s).toContain("on and moving");
    expect(s).toContain("Stops of 15 min or more within 50 m are not paid");
    expect(s).toContain("no signal isn't paid");
    expect(s).not.toContain("qualify");
    const t = payRulesSentence({ paySignalGaps: true, stopMin: 20, stopRadiusM: 80, payMinHours: 20 });
    expect(t).toContain("plus time with no signal");
    expect(t).toContain("at least 20 h in the period to qualify");
  });
});

// ── The calculation ───────────────────────────────────────────────────────────

const H = 3600;
const iso = (s: string) => new Date(s).toISOString();

function shift(start: string, end: string, o: Partial<DayShift> = {}): DayShift {
  const on = (Date.parse(end) - Date.parse(start)) / 1000;
  return { start: iso(start), end: iso(end), onSeconds: on, movingSeconds: on, stoppedSeconds: 0, gapSeconds: 0, km: 10, ...o };
}

function day(bagId: string, d: string, shifts: DayShift[], extra: Partial<BagDayLite> = {}): BagDayLite {
  return { bagId, day: d, shifts, stops: [], gaps: [], ...extra };
}

function asg(id: string, bagId: string, riderId: string, riderName: string, start: string, end: string | null = null): AssignmentRow {
  return { id, bagId, riderId, riderName, riderDemo: true, start: new Date(start), end: end ? new Date(end) : null };
}

const RANGE = { startDay: "2026-09-14", endDay: "2026-09-27" };

function input(o: Partial<PayrollInput>): PayrollInput {
  return {
    range: RANGE,
    today: "2026-09-29",
    bagDays: [],
    history: [],
    assignments: [],
    bagNames: new Map([
      ["bag6", "Bag 006"],
      ["bag14", "Bag 014"],
      ["bag21", "Bag 021"],
    ]),
    riders: new Map([
      ["amara", { name: "Amara Osei", demo: true }],
      ["grace", { name: "Grace Adu", demo: true }],
      ["ben", { name: "Ben Carter", demo: true }],
    ]),
    settings: { paySignalGaps: false, stopMin: 15, stopRadiusM: 50, payMinHours: 0, payRate: "" },
    adjustments: [],
    ...o,
  };
}

describe("payroll calculation", () => {
  it("pays moving time only, per London day, to whoever had the bag when the shift started", () => {
    const p = computePayroll(
      input({
        assignments: [asg("a1", "bag14", "amara", "Amara Osei", "2026-08-01T00:00:00Z", "2026-09-20T09:00:00Z"), asg("a2", "bag14", "grace", "Grace Adu", "2026-09-20T09:00:00Z")],
        bagDays: [
          // Started 08:00 London time on the 20th, before the 10:00 BST hand-over: all Amara's.
          day("bag14", "2026-09-20", [shift("2026-09-20T07:00:00Z", "2026-09-20T11:00:00Z", { movingSeconds: 3 * H, stoppedSeconds: 0.75 * H, gapSeconds: 0.25 * H })]),
          day("bag14", "2026-09-21", [shift("2026-09-21T16:00:00Z", "2026-09-21T20:00:00Z")]),
        ],
      }),
    );
    const amara = p.riders.find((r) => r.riderId === "amara")!;
    const grace = p.riders.find((r) => r.riderId === "grace")!;
    expect(amara.cells.map((c) => [c.day, c.hours])).toEqual([["2026-09-20", 3]]);
    expect(grace.cells.map((c) => [c.day, c.hours])).toEqual([["2026-09-21", 4]]);
    expect(p.totals.hours).toBe(7);
    expect(p.totals.stoppedSeconds).toBe(0.75 * H);
    expect(p.totals.gapSeconds).toBe(0.25 * H);
    expect(p.dayTotals[p.days.indexOf("2026-09-20")]).toBe(3);
    // Hand-over note names both riders.
    expect(p.handovers).toHaveLength(1);
    expect(p.handovers[0].text).toContain("Bag 014 changed hands on 20 Sep");
    expect(p.handovers[0].text).toContain("Amara Osei to 20 Sep");
    expect(p.handovers[0].text).toContain("Grace Adu from 20 Sep");
  });

  it("pays no-signal time only when the pay rules say so", () => {
    const base = input({
      assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z")],
      bagDays: [day("bag6", "2026-09-15", [shift("2026-09-15T16:00:00Z", "2026-09-15T20:00:00Z", { movingSeconds: 3 * H, gapSeconds: 0.5 * H, stoppedSeconds: 0.5 * H })])],
    });
    expect(computePayroll(base).totals.hours).toBe(3);
    expect(computePayroll({ ...base, settings: { ...base.settings, paySignalGaps: true } }).totals.hours).toBe(3.5);
  });

  it("sends odd shifts to review, in plain English", () => {
    const p = computePayroll(
      input({
        assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z"), asg("a2", "bag14", "ben", "Ben Carter", "2026-09-16T00:00:00Z", "2026-09-17T00:00:00Z")],
        bagDays: [
          day("bag6", "2026-09-15", [shift("2026-09-15T12:00:00Z", "2026-09-15T20:00:00Z", { movingSeconds: 3 * H, gapSeconds: 40 * 60 })], {
            gaps: [{ start: iso("2026-09-15T14:00:00Z"), end: iso("2026-09-15T14:40:00Z"), seconds: 40 * 60 }],
            stops: [{ start: iso("2026-09-15T16:00:00Z"), end: iso("2026-09-15T19:40:00Z"), seconds: 3 * H + 40 * 60 }],
          }),
          day("bag6", "2026-09-16", [shift("2026-09-16T08:00:00Z", "2026-09-16T19:00:00Z", { movingSeconds: 6 * H })]),
          day("bag14", "2026-09-16", [shift("2026-09-16T20:00:00Z", "2026-09-16T21:00:00Z", { movingSeconds: 0.5 * H })]),
          day("bag6", "2026-09-17", [shift("2026-09-17T17:00:00Z", "2026-09-17T17:24:00Z", { movingSeconds: 0, stoppedSeconds: 24 * 60, km: 0.1 })]),
        ],
      }),
    );
    const texts = (d: string) => p.review.find((r) => r.day === d)?.reasons.map((f) => f.text) ?? [];
    expect(texts("2026-09-15")).toEqual(["No signal for 40 min mid-shift", "Stopped 3h 40m in one place"]);
    expect(texts("2026-09-16")).toEqual(["Shift over 10 hours (bag on 11h)", "Carried two bags on the same day (Bag 006 and Bag 014)"]);
    expect(texts("2026-09-17")).toEqual(["Bag on for 24 min but never moved"]);
    expect(p.totals.toReview).toBe(3);
    expect(p.riders[0].toReview).toBe(3);
  });

  it("doesn't flag silence while stopped in one place (that's stop time)", () => {
    const p = computePayroll(
      input({
        assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z")],
        bagDays: [
          day("bag6", "2026-09-15", [shift("2026-09-15T12:00:00Z", "2026-09-15T16:00:00Z", { movingSeconds: 3 * H, stoppedSeconds: H })], {
            gaps: [{ start: iso("2026-09-15T13:10:00Z"), end: iso("2026-09-15T13:50:00Z"), seconds: 40 * 60 }],
            stops: [{ start: iso("2026-09-15T13:00:00Z"), end: iso("2026-09-15T14:00:00Z"), seconds: H }],
          }),
        ],
      }),
    );
    expect(p.review).toHaveLength(0);
  });

  it("flags the longest shift they've done only when it stands out from enough history", () => {
    const history = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((d) =>
      day("bag6", d, [shift(`${d}T16:00:00Z`, `${d}T20:00:00Z`)]),
    );
    const p = computePayroll(
      input({
        history,
        assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z")],
        bagDays: [
          day("bag6", "2026-09-15", [shift("2026-09-15T16:00:00Z", "2026-09-15T20:00:00Z")]),
          day("bag6", "2026-09-26", [shift("2026-09-26T10:00:00Z", "2026-09-26T19:54:00Z")]),
        ],
      }),
    );
    expect(p.review.map((r) => [r.day, r.reasons.map((f) => f.kind)])).toEqual([["2026-09-26", ["longest_shift"]]]);
    expect(p.review[0].reasons[0].text).toBe("Longest shift they've done (9.9 h)");
    // Without the history there's nothing to compare against.
    expect(computePayroll(input({ assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z")], bagDays: [day("bag6", "2026-09-26", [shift("2026-09-26T10:00:00Z", "2026-09-26T19:54:00Z")])] })).review).toHaveLength(0);
  });

  it("applies the latest change per rider-day and marks the review item checked", () => {
    const adj = (hours: number, at: string, note = "Checked the route"): PayAdjustment => ({
      id: at,
      riderId: "ben",
      day: "2026-09-15",
      hours,
      calculatedHours: 3,
      note,
      byId: "u1",
      byName: "Operations",
      at,
    });
    const p = computePayroll(
      input({
        assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z")],
        bagDays: [
          day("bag6", "2026-09-15", [shift("2026-09-15T16:00:00Z", "2026-09-15T20:00:00Z", { movingSeconds: 3 * H })], {
            stops: [{ start: iso("2026-09-15T17:00:00Z"), end: iso("2026-09-15T19:10:00Z"), seconds: 2 * H + 600 }],
          }),
        ],
        adjustments: [adj(2, "2026-09-28T10:00:00Z"), adj(3.5, "2026-09-28T11:00:00Z"), { ...adj(1, "2026-09-28T11:30:00Z"), day: "2026-09-30" }],
      }),
    );
    const cell = p.riders[0].cells[0];
    expect(cell.calculatedHours).toBe(3);
    expect(cell.hours).toBe(3.5);
    expect(cell.adjustment?.note).toBe("Checked the route");
    expect(p.review[0].adjustment?.hours).toBe(3.5);
    expect(p.totals).toMatchObject({ hours: 3.5, calculatedHours: 3, toReview: 0, reviewed: 1 });
    expect(p.riders[0].cells).toHaveLength(1); // the change outside the period is ignored
  });

  it("adds a day with no data when someone enters hours for it", () => {
    const p = computePayroll(
      input({
        assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z")],
        adjustments: [{ id: "x", riderId: "ben", day: "2026-09-18", hours: 4, calculatedHours: 0, note: "Bag failed, rode anyway", byId: null, byName: "Owner", at: "2026-09-28T10:00:00Z" }],
      }),
    );
    expect(p.riders[0].cells.map((c) => [c.day, c.calculatedHours, c.hours])).toEqual([["2026-09-18", 0, 4]]);
  });

  it("keeps shifts with nobody assigned visible instead of paying or dropping them", () => {
    const p = computePayroll(input({ bagDays: [day("bag21", "2026-09-15", [shift("2026-09-15T16:00:00Z", "2026-09-15T18:00:00Z")])] }));
    expect(p.riders).toHaveLength(0);
    expect(p.totals.hours).toBe(0);
    expect(p.unassigned).toEqual([{ bagId: "bag21", bagName: "Bag 021", days: ["2026-09-15"], shifts: 1, movingSeconds: 2 * H, paidSeconds: 2 * H }]);
  });

  it("lists riders who held a bag but weren't out, and counts them as carrying", () => {
    const p = computePayroll(
      input({
        assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z"), asg("a2", "bag14", "grace", "Grace Adu", "2026-09-01T00:00:00Z")],
        bagDays: [day("bag6", "2026-09-15", [shift("2026-09-15T16:00:00Z", "2026-09-15T18:00:00Z")])],
      }),
    );
    expect(p.riders.map((r) => [r.riderName, r.hours])).toEqual([
      ["Ben Carter", 2],
      ["Grace Adu", 0],
    ]);
    expect(p.totals).toMatchObject({ riders: 1, carrying: 2 });
  });

  it("works out money only from a real rate, and applies the minimum hours", () => {
    const base = input({
      assignments: [asg("a1", "bag6", "ben", "Ben Carter", "2026-01-01T00:00:00Z"), asg("a2", "bag14", "grace", "Grace Adu", "2026-01-01T00:00:00Z")],
      bagDays: [
        day("bag6", "2026-09-15", [shift("2026-09-15T12:00:00Z", "2026-09-15T20:00:00Z")]),
        day("bag14", "2026-09-15", [shift("2026-09-15T16:00:00Z", "2026-09-15T18:00:00Z")]),
      ],
    });
    const noRate = computePayroll(base);
    expect(noRate.totals.pay).toBeNull();
    expect(noRate.riders.every((r) => r.pay === null)).toBe(true);
    const rated = computePayroll({ ...base, settings: { ...base.settings, payRate: "£12.50", payMinHours: 5 } });
    expect(rated.rules.rate).toBe(12.5);
    expect(rated.riders.map((r) => [r.riderName, r.qualifies, r.pay])).toEqual([
      ["Ben Carter", true, 100],
      ["Grace Adu", false, 0],
    ]);
    expect(rated.totals).toMatchObject({ pay: 100, underMinimum: 1 });
  });

  it("uses the latest change for each rider-day", () => {
    const m = effectiveAdjustments([
      { id: "1", riderId: "r", day: "d", hours: 1, calculatedHours: 1, note: "", byId: null, byName: "", at: "" },
      { id: "2", riderId: "r", day: "d", hours: 2, calculatedHours: 1, note: "", byId: null, byName: "", at: "" },
    ]);
    expect(m.get("r:d")?.id).toBe("2");
  });

  it("notes a bag handed back with nobody taking it on", () => {
    const h = payHandovers(RANGE, [asg("a1", "bag14", "grace", "Grace Adu", "2026-08-01T00:00:00Z", "2026-09-26T23:00:00Z")], () => "Bag 014");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ day: "2026-09-26", toRiderId: null });
    expect(h[0].text).toBe("Grace Adu handed Bag 014 back after 26 Sep. Shifts after that aren't credited to anyone.");
  });
});
