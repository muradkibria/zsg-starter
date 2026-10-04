import { describe, expect, it } from "vitest";
import { docsDue, londonDayBounds } from "@digilite/shared";
import type { AssignmentRow } from "../src/domain/assignments";
import {
  applyChanges,
  attributeBagDays,
  carryingFlags,
  effectiveStage,
  endOfDay,
  fleetBaseline,
  leftWithoutBag,
  planAssign,
  planEnd,
  resolveStart,
  summariseActivity,
  summariseDocs,
  type BagDayLite,
} from "../src/domain/riders";

const T = (s: string) => new Date(s);
const row = (id: string, bagId: string, riderId: string, start: string, end: string | null = null): AssignmentRow => ({
  id,
  bagId,
  riderId,
  riderName: riderId.toUpperCase(),
  riderDemo: false,
  start: T(start),
  end: end ? T(end) : null,
});

const NOW = T("2026-09-29T18:00:00Z");

describe("giving a bag (planAssign)", () => {
  it("a spare bag just gets a new assignment", () => {
    const p = planAssign([], { bagId: "b1", riderId: "r1", start: NOW, now: NOW });
    expect(p.conflict).toBeNull();
    expect(p.changes).toEqual([{ op: "create", bagId: "b1", riderId: "r1", start: NOW }]);
  });

  it("ends the bag's current rider at the start, and reports them as displaced", () => {
    const rows = [row("a1", "b1", "amara", "2026-08-01T00:00:00Z")];
    const p = planAssign(rows, { bagId: "b1", riderId: "leah", start: NOW, now: NOW });
    expect(p.conflict).toBeNull();
    expect(p.changes).toContainEqual({ op: "end", id: "a1", end: NOW });
    expect(p.changes).toContainEqual({ op: "create", bagId: "b1", riderId: "leah", start: NOW });
    expect(p.displaced).toEqual(["amara"]);
    expect(leftWithoutBag(applyChanges(rows, p.changes), p.displaced, NOW)).toEqual(["amara"]);
  });

  it("refuses to backdate over another rider's days (history never moves)", () => {
    const rows = [row("a1", "b1", "amara", "2026-08-01T00:00:00Z")];
    const p = planAssign(rows, { bagId: "b1", riderId: "leah", start: T("2026-09-20T23:00:00Z"), now: NOW });
    expect(p.conflict?.kind).toBe("bag_history");
    expect(p.changes).toEqual([]);
  });

  it("allows backdating over time when nobody had the bag", () => {
    const rows = [row("a1", "b1", "amara", "2026-08-01T00:00:00Z", "2026-09-10T23:00:00Z")];
    const start = T("2026-09-20T23:00:00Z");
    const p = planAssign(rows, { bagId: "b1", riderId: "leah", start, now: NOW });
    expect(p.conflict).toBeNull();
    expect(p.changes).toEqual([{ op: "create", bagId: "b1", riderId: "leah", start }]);
  });

  it("a future start ends the current rider then, without touching their past", () => {
    const rows = [row("a1", "b1", "amara", "2026-08-01T00:00:00Z")];
    const start = T("2026-09-30T23:00:00Z");
    const p = planAssign(rows, { bagId: "b1", riderId: "leah", start, now: NOW });
    expect(p.conflict).toBeNull();
    expect(p.changes).toContainEqual({ op: "end", id: "a1", end: start });
    // Amara still has the bag until then.
    expect(leftWithoutBag(applyChanges(rows, p.changes), p.displaced, NOW)).toEqual([]);
  });

  it("moving a rider to another bag ends their old one at the same moment", () => {
    const rows = [row("a1", "b1", "leah", "2026-08-01T00:00:00Z")];
    const p = planAssign(rows, { bagId: "b2", riderId: "leah", start: NOW, now: NOW });
    expect(p.changes).toEqual([
      { op: "end", id: "a1", end: NOW },
      { op: "create", bagId: "b2", riderId: "leah", start: NOW },
    ]);
  });

  it("refuses a backdated move while the rider was carrying another bag", () => {
    const rows = [row("a1", "b1", "leah", "2026-08-01T00:00:00Z")];
    const p = planAssign(rows, { bagId: "b2", riderId: "leah", start: T("2026-09-25T23:00:00Z"), now: NOW });
    expect(p.conflict?.kind).toBe("rider_history");
  });

  it("refuses to give a rider the bag they already carry", () => {
    const rows = [row("a1", "b1", "leah", "2026-08-01T00:00:00Z")];
    expect(planAssign(rows, { bagId: "b1", riderId: "leah", start: NOW, now: NOW }).conflict?.kind).toBe("already");
  });

  it("refuses a bag that is booked for someone else later", () => {
    const rows = [row("a1", "b1", "ife", "2026-10-01T23:00:00Z")];
    expect(planAssign(rows, { bagId: "b1", riderId: "leah", start: NOW, now: NOW }).conflict?.kind).toBe("bag_booked");
  });

  it("re-giving the same bag from the same start reopens the ended assignment (a clean undo)", () => {
    const start = T("2026-08-04T23:00:00Z");
    const rows = [row("a1", "b1", "ben", "2026-08-04T23:00:00Z", "2026-09-29T23:00:00Z")];
    const p = planAssign(rows, { bagId: "b1", riderId: "ben", start, now: NOW });
    expect(p.conflict).toBeNull();
    expect(p.changes).toEqual([{ op: "reopen", id: "a1", start }]);
    const after = applyChanges(rows, p.changes);
    expect(after).toHaveLength(1);
    expect(after[0].end).toBeNull();
  });
});

describe("ending an assignment (planEnd)", () => {
  it("ends at midnight after the last London day (BST aware)", () => {
    expect(endOfDay("2026-09-29").toISOString()).toBe("2026-09-29T23:00:00.000Z");
    expect(endOfDay("2026-12-01").toISOString()).toBe("2026-12-02T00:00:00.000Z");
  });

  it("ends the current assignment and hands the bag on from the next day", () => {
    const rows = [row("a1", "b1", "leah", "2026-08-01T00:00:00Z")];
    const endAt = endOfDay("2026-09-29");
    const p = planEnd(rows, { riderId: "leah", endAt, now: NOW });
    expect(p.conflict).toBeNull();
    expect(p.changes).toEqual([{ op: "end", id: "a1", end: endAt }]);
    expect(p.ended?.bagId).toBe("b1");
    const give = planAssign(applyChanges(rows, p.changes), { bagId: "b1", riderId: "ife", start: endAt, now: NOW });
    expect(give.conflict).toBeNull();
    expect(give.changes).toEqual([{ op: "create", bagId: "b1", riderId: "ife", start: endAt }]);
  });

  it("a past last day with the next rider from the day after is allowed (no one else had it)", () => {
    const rows = [row("a1", "b1", "leah", "2026-08-01T00:00:00Z")];
    const endAt = endOfDay("2026-09-25");
    const p = planEnd(rows, { riderId: "leah", endAt, now: NOW });
    const give = planAssign(applyChanges(rows, p.changes), { bagId: "b1", riderId: "ife", start: endAt, now: NOW });
    expect(give.conflict).toBeNull();
  });

  it("removes bookings that haven't started and refuses a last day before a bag they had", () => {
    const booked = [row("a2", "b2", "leah", "2026-10-02T23:00:00Z")];
    expect(planEnd(booked, { riderId: "leah", endAt: endOfDay("2026-09-29"), now: NOW }).changes).toEqual([{ op: "delete", id: "a2" }]);
    const had = [row("a1", "b1", "leah", "2026-09-26T12:00:00Z")];
    expect(planEnd(had, { riderId: "leah", endAt: endOfDay("2026-09-20"), now: NOW }).conflict?.kind).toBe("before_start");
  });
});

describe("start times", () => {
  it("no day = now to the second; a day = its London midnight", () => {
    expect(resolveStart(undefined, T("2026-09-29T18:04:05.678Z")).toISOString()).toBe("2026-09-29T18:04:05.000Z");
    expect(resolveStart("2026-09-30", NOW).toISOString()).toBe("2026-09-29T23:00:00.000Z");
  });
});

describe("stage", () => {
  it("follows the assignments", () => {
    expect(effectiveStage("waiting", true)).toBe("active");
    expect(effectiveStage("active", false)).toBe("waiting");
    expect(effectiveStage("ended", true)).toBe("ended");
    expect(effectiveStage("applied", false)).toBe("applied");
  });
});

describe("documents", () => {
  const today = "2026-09-29";
  const all = (extra: Partial<Record<string, string | null>> = {}) =>
    (["id", "right_to_work", "address", "agreement"] as const).map((kind) => ({
      kind,
      status: "checked" as const,
      expiresDay: (extra[kind] as string | null | undefined) ?? null,
    }));

  it("all four checked = complete", () => {
    const s = summariseDocs(all(), today);
    expect(s.state).toBe("ok");
    expect(s.checked).toBe(4);
  });

  it("expiring within 30 days is due", () => {
    const s = summariseDocs(all({ right_to_work: "2026-10-11" }), today);
    expect(s.state).toBe("due");
    expect(s.next).toEqual({ kind: "right_to_work", expiresDay: "2026-10-11", expired: false });
  });

  it("expired beats everything, and still counts as not checked", () => {
    const s = summariseDocs(all({ right_to_work: "2026-09-28" }), today);
    expect(s.state).toBe("expired");
    expect(s.checked).toBe(3);
  });

  it("a newer checked copy replaces an expiring one", () => {
    const docs = [...all({ right_to_work: "2026-10-05" }), { kind: "right_to_work" as const, status: "checked" as const, expiresDay: "2027-10-05" }];
    expect(summariseDocs(docs, today).state).toBe("ok");
  });

  it("'documents due' means expired, expiring within 30 days or missing — not just waiting to be checked", () => {
    expect(docsDue(summariseDocs(all({ right_to_work: "2026-10-11" }), today))).toBe(true);
    expect(docsDue(summariseDocs(all({ right_to_work: "2026-09-01" }), today))).toBe(true);
    expect(docsDue(summariseDocs([], today))).toBe(true);
    expect(docsDue(summariseDocs(all({ right_to_work: "2026-12-31" }), today))).toBe(false);
    const pendingOnly = [...all().filter((d) => d.kind !== "agreement"), { kind: "agreement" as const, status: "pending" as const, expiresDay: null }];
    expect(docsDue(summariseDocs(pendingOnly, today))).toBe(false);
  });

  it("rejected-only counts as missing; an upload waiting is pending", () => {
    const docs = all().filter((d) => d.kind !== "agreement");
    expect(summariseDocs([...docs, { kind: "agreement", status: "rejected", expiresDay: null }], today).missing).toEqual(["agreement"]);
    expect(summariseDocs([...docs, { kind: "agreement", status: "pending", expiresDay: null }], today).state).toBe("pending");
    expect(summariseDocs([], today).missing).toHaveLength(4);
  });
});

describe("rider days come from the bag's data inside the assignment", () => {
  // Bag b1: Amara until 28 Sep 15:00 UTC, Leah after.
  const rows = [row("a1", "b1", "amara", "2026-09-01T00:00:00Z", "2026-09-28T15:00:00Z"), row("a2", "b1", "leah", "2026-09-28T15:00:00Z")];
  const shift = (start: string, end: string, on: number, stopped: number, km: number) => ({
    start,
    end,
    onSeconds: on,
    movingSeconds: on - stopped,
    stoppedSeconds: stopped,
    gapSeconds: 0,
    km,
  });
  const days: BagDayLite[] = [
    {
      bag: "b1",
      day: "2026-09-28",
      onSeconds: 7200 + 10800,
      stoppedSeconds: 1800 + 3600,
      gaps: 2,
      km: 50,
      shifts: [shift("2026-09-28T10:00:00Z", "2026-09-28T12:00:00Z", 7200, 1800, 20), shift("2026-09-28T17:00:00Z", "2026-09-28T20:00:00Z", 10800, 3600, 30)],
      signalGaps: [
        { start: "2026-09-28T11:00:00Z", end: "2026-09-28T11:08:00Z" },
        { start: "2026-09-28T18:00:00Z", end: "2026-09-28T18:10:00Z" },
      ],
    },
  ];

  it("splits a day's shifts between the riders who held the bag", () => {
    const by = attributeBagDays(days, rows);
    const amara = by.get("amara")!.get("2026-09-28")!;
    const leah = by.get("leah")!.get("2026-09-28")!;
    expect([amara.onSeconds, amara.km, amara.gaps]).toEqual([7200, 20, 1]);
    expect([leah.onSeconds, leah.km, leah.gaps]).toEqual([10800, 30, 1]);
    expect(new Date(leah.first).toISOString()).toBe("2026-09-28T17:00:00.000Z");
  });

  it("summarises activity against the fleet", () => {
    const leah = [...attributeBagDays(days, rows, "leah").get("leah")!.values()];
    const a = summariseActivity(leah, 2);
    expect(a.daysOut).toBe(1);
    expect(a.stoppedPct).toBeCloseTo(33.3, 1);
    expect(a.avgOnSeconds).toBe(10800);
    const f = fleetBaseline(days, new Set());
    expect(f.bagDays).toBe(1);
    expect(f.stoppedPct).toBe(30);
  });

  it("marks the London days a rider had a bag", () => {
    const flags = carryingFlags(rows, "leah", ["2026-09-27", "2026-09-28", "2026-09-29"], NOW);
    expect(flags).toEqual([false, true, true]);
    const [s] = londonDayBounds("2026-09-28");
    expect(s.toISOString()).toBe("2026-09-27T23:00:00.000Z");
  });
});
