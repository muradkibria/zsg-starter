import { describe, expect, it } from "vitest";
import { gbDateFormat } from "@digilite/shared";
import type { ClProgram } from "../src/colorlight/types";
import { toCommandSummary } from "../src/domain/commands";
import { matchPlayingLoop, playsOlderCopy, type LoopRef } from "../src/domain/playing";
import { planPlayHours, planProgramRecord, programSlots } from "../src/colorlight/sync/content";
import { trackWindow } from "../src/colorlight/sync/tracks";
import { blocksToReread } from "../src/colorlight/sync/reconcile";
import { placeInWindow } from "../src/domain/tracks";
import { changesSince } from "../src/domain/payroll";
import { spreadLatePoints, type TrackPoint } from "@digilite/shared";

// A program as Colorlight's editor stores it: one page per slot, a file window per page.
const page = (fileID: number, durationInSecond: number, extra: Record<string, unknown> = {}) => ({
  type: "page",
  children: [{ type: "fileWindow", children: [{ fileID, durationInSecond, length: durationInSecond * 1000, Duration: 8000, playTime: 8, ...extra }] }],
});

describe("programSlots", () => {
  it("keeps order and repeats, one entry per slot, with each slot's own length", () => {
    const june26 = {
      id: 6696773,
      program_info: { children: [page(6482024, 10), page(6673291, 13), page(6482024, 10), page(6482025, 10), page(6482024, 10), page(6470519, 10)] },
    } as unknown as ClProgram;
    expect(programSlots(june26)).toEqual([
      { mediaId: 6482024, seconds: 10 },
      { mediaId: 6673291, seconds: 13 },
      { mediaId: 6482024, seconds: 10 },
      { mediaId: 6482025, seconds: 10 },
      { mediaId: 6482024, seconds: 10 },
      { mediaId: 6470519, seconds: 10 },
    ]);
  });

  it("reads several files in one window (how our own loops are built)", () => {
    const ours = {
      id: 1,
      program_info: { children: [{ children: [{ type: "fileWindow", children: [{ fileID: 5, durationInSecond: 12 }, { fileID: 6, durationInSecond: 8 }, { fileID: 5, durationInSecond: 12 }] }] }] },
    } as unknown as ClProgram;
    expect(programSlots(ours).map((s) => s.mediaId)).toEqual([5, 6, 5]);
  });

  it("falls back to the player spec, counting a file once even with its FileSource", () => {
    const spec = {
      id: 2,
      Programs: { Program: { Pages: [{ Regions: [{ Items: [{ Duration: 15000, FileSource: { Resource_ID: 9 } }] }] }, { Regions: [{ Items: [{ Duration: 5000, FileSource: { Resource_ID: 9 } }] }] }] } },
    } as unknown as ClProgram;
    expect(programSlots(spec)).toEqual([
      { mediaId: 9, seconds: 15 },
      { mediaId: 9, seconds: 5 },
    ]);
  });

  it("returns nothing for a program with no files", () => {
    expect(programSlots({ id: 3, program_info: { children: [] } } as unknown as ClProgram)).toEqual([]);
  });
});

describe("matchPlayingLoop", () => {
  const loops: LoopRef[] = [
    { id: "june", name: "June 26", status: "imported", colorlight_program_id: 6696773, colorlight_vsn: "June 26_83fca0e70b30cbf5090390702f9aa5c3_7174.vsn" },
    { id: "mtf-a", name: "MTF", status: "imported", colorlight_program_id: 4468296, colorlight_vsn: "MTF_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1.vsn" },
    { id: "mtf-b", name: "MTF", status: "imported", colorlight_program_id: 6436469, colorlight_vsn: "MTF_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_2.vsn" },
  ];

  it("matches the exact file, even between loops that share a name", () => {
    expect(matchPlayingLoop({ playing_vsn: "MTF_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_2.vsn" }, loops)?.id).toBe("mtf-b");
  });

  it("finds an older copy through the program ids the bag downloaded", () => {
    const bag = {
      playing_vsn: "MTF_cccccccccccccccccccccccccccccccc_9.vsn",
      downloaded_programs: [{ id: 6436469, name: "MTF" }, { id: 6696773, name: "June 26" }],
    };
    const loop = matchPlayingLoop(bag, loops);
    expect(loop?.id).toBe("mtf-b");
    expect(playsOlderCopy(bag, loop)).toBe(true);
  });

  it("doesn't guess when two same-named loops could be the one", () => {
    const bag = { playing_vsn: "MTF_cccccccccccccccccccccccccccccccc_9.vsn", downloaded_programs: [{ id: 4468296, name: "MTF" }, { id: 6436469, name: "MTF" }] };
    expect(matchPlayingLoop(bag, loops)).toBeNull();
  });

  it("falls back to a unique name, and is null for loops we can't see", () => {
    expect(matchPlayingLoop({ playing_vsn: "June 26_ffffffffffffffffffffffffffffffff_7200.vsn" }, loops)?.id).toBe("june");
    expect(matchPlayingLoop({ playing_vsn: "deliveroo test 4_7ae2be94722e4034870526c64cfc7286_1335.vsn" }, loops)).toBeNull();
    expect(matchPlayingLoop({ playing_vsn: "" }, loops)).toBeNull();
  });

  it("reports the latest copy as current", () => {
    const bag = { playing_vsn: loops[0].colorlight_vsn };
    expect(playsOlderCopy(bag, matchPlayingLoop(bag, loops))).toBe(false);
  });
});

describe("gbDateFormat", () => {
  it('writes "Sep", not "Sept"', () => {
    const f = gbDateFormat({ timeZone: "UTC", day: "numeric", month: "short" });
    expect(f.format(new Date("2026-09-28T12:00:00Z"))).toBe("28 Sep");
    expect(f.format(new Date("2026-10-06T12:00:00Z"))).toBe("6 Oct");
  });
});

describe("toCommandSummary", () => {
  it("lists a schedule send without its full Colorlight payload", () => {
    const summary = toCommandSummary({
      id: "c1",
      collectionId: "",
      collectionName: "commands",
      bag: "b1",
      type: "schedule",
      status: "dry_run",
      value: { summary: "Fleet schedule: 3 loop parts", loopParts: 3, payload: { big: "x".repeat(1000) } },
      created: "2026-09-29 19:00:00.000Z",
    });
    expect(summary.value).toEqual({ summary: "Fleet schedule: 3 loop parts", loopParts: 3 });
  });
});

describe("planProgramRecord", () => {
  const items = [{ creative: "a", seconds: 10 }, { creative: "b", seconds: 13 }];
  const rec = (o: Record<string, unknown>) => ({ id: "r1", collectionId: "", collectionName: "loops", name: "June 26", items, ...o }) as never;
  const p = { name: "June 26", vsn: "June 26_aa_1.vsn", items };

  it("creates a record for a program it hasn't seen", () => {
    expect(planProgramRecord(p, [])).toEqual({ action: "create" });
  });

  it("leaves the same version alone, and never rewrites one of our own loops", () => {
    expect(planProgramRecord(p, [rec({ status: "imported", colorlight_vsn: p.vsn })])).toEqual({ action: "none" });
    expect(planProgramRecord({ ...p, items: [] }, [rec({ status: "published", colorlight_vsn: p.vsn })])).toEqual({ action: "none" });
  });

  it("fills in ads that reached the library later, on the same imported version", () => {
    const plan = planProgramRecord(p, [rec({ status: "imported", colorlight_vsn: p.vsn, items: [items[0]] })]);
    expect(plan).toEqual({ action: "update", id: "r1", patch: { items } });
  });

  it("notes the new file name when only the name or nothing in the loop changed", () => {
    expect(planProgramRecord({ ...p, name: "June 26 v2", vsn: "June 26 v2_bb_2.vsn" }, [rec({ status: "imported", colorlight_vsn: p.vsn })])).toEqual({
      action: "update",
      id: "r1",
      patch: { colorlight_vsn: "June 26 v2_bb_2.vsn", name: "June 26 v2", colorlight_program_name: "June 26 v2" },
    });
  });

  it("records a version edited in Colorlight as a new loop and keeps the previous one", () => {
    const previous = rec({ status: "imported", colorlight_vsn: p.vsn });
    const plan = planProgramRecord({ ...p, vsn: "June 26_cc_3.vsn", items: [items[1], items[0]] }, [previous]);
    expect(plan).toEqual({ action: "replace", previous });
  });
});

describe("catching up after the server was down", () => {
  const H = 3600000;
  const now = Date.parse("2026-10-04T15:20:00Z");
  const hour = (iso: string) => Date.parse(iso);

  it("asks for a bag's track from its cursor (with a little overlap) up to a minute ago", () => {
    expect(trackWindow(now - 30000, now - 3 * 60000, now)).toEqual({ since: now - 13 * 60000, to: now - 60000 });
  });

  it("fills the gap for a bag that went offline while the server was down", () => {
    const w = trackWindow(now - 20 * H, now - 30 * H, now)!;
    expect(w.since).toBe(now - 30 * H - 10 * 60000);
    expect(w.to).toBe(now - 60000);
  });

  it("takes a long gap three days at a time, and skips a bag with nothing new", () => {
    const w = trackWindow(now, now - 10 * 24 * H, now)!;
    expect(w.to - w.since).toBe(3 * 24 * H);
    expect(trackWindow(now - 5 * H, now - 4 * H, now)).toBeNull();
  });

  it("reads plays hour by hour up to the bag's last report, re-reading the hour it's still in", () => {
    const plan = planPlayHours(now - 60000, hour("2026-10-04T13:00:00Z"), now)!;
    expect(plan.hours.map((h) => new Date(h).toISOString().slice(11, 13))).toEqual(["13", "14", "15"]);
    expect(plan.next).toBe(hour("2026-10-04T15:00:00Z"));
  });

  it("records the hours a bag worked while the server was down, then moves on once it's quiet", () => {
    const plan = planPlayHours(hour("2026-10-04T09:40:00Z"), hour("2026-10-04T06:00:00Z"), now)!;
    expect(plan.hours.length).toBe(4); // 06, 07, 08 and 09
    expect(plan.next).toBe(hour("2026-10-04T10:00:00Z"));
    expect(planPlayHours(hour("2026-10-04T09:40:00Z"), plan.next, now)).toBeNull();
  });

  it("never skips ahead: a five-day gap is read three days per run", () => {
    const plan = planPlayHours(now, now - 5 * 24 * H, now)!;
    expect(plan.hours.length).toBe(72);
    expect(plan.next).toBe(plan.hours[71] + H);
  });

  it("ignores a bag last seen long ago that has no cursor yet", () => {
    expect(planPlayHours(now - 200 * 24 * H, null, now)).toBeNull();
  });
});

describe("late GPS batches", () => {
  const at = (iso: string) => Date.parse(iso);
  const batch = (t: number, n: number): TrackPoint[] => Array.from({ length: n }, (_, i) => ({ t, lat: 51.5, lng: -0.1 + i * 0.0005, seq: i }));

  it("fills a short gap evenly", () => {
    const t = at("2026-10-01T18:10:00Z");
    const out = spreadLatePoints([{ t: t - 4 * 60_000, lat: 51.5, lng: -0.1 }, ...batch(t, 8)]);
    expect(out[1].t).toBe(t - 4 * 60_000 + 30_000); // 8 fixes across 4 minutes
    expect(out.at(-1)!.t).toBe(t);
  });

  it("leaves a long gap as a gap: the batch sits just before it arrived, one fix per 30 s", () => {
    const t = at("2026-10-01T18:00:00Z");
    const out = spreadLatePoints([{ t: t - 43 * 3600_000, lat: 51.5, lng: -0.1 }, ...batch(t, 30)]);
    const late = out.filter((p) => p.late);
    expect(late[0].t).toBe(t - 29 * 30_000);
    expect(late.at(-1)!.t).toBe(t);
    expect(late[0].t - out[0].t).toBeGreaterThan(42 * 3600_000); // still a 42-hour gap, not a 43-hour shift
  });

  it("places a batch with no earlier fix before its arrival", () => {
    const t = at("2026-10-01T08:00:00Z");
    const out = spreadLatePoints(batch(t, 10));
    expect(out[0].t).toBe(t - 9 * 30_000);
  });

  it("splits a batch that straddles midnight between the two days", () => {
    const midnight = at("2026-10-02T00:00:00Z");
    const raw = [{ t: midnight - 3 * 60_000, lat: 51.5, lng: -0.1 }, ...batch(midnight + 3 * 60_000, 12)];
    const before = placeInWindow(raw, midnight - 86400_000, midnight);
    const after = placeInWindow(raw, midnight, midnight + 86400_000);
    expect(before.filter((p) => p.late).length + after.length).toBe(12);
    expect(before.filter((p) => p.late).length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
  });
});

describe("blocksToReread", () => {
  it("re-reads only blocks that grew in Colorlight, never ones that shrank", () => {
    expect(blocksToReread([0, 120, 300, 0], [0, 120, 250, 5])).toEqual([2]);
    expect(blocksToReread([10, 0, 0, 0], [0, 0, 0, 0])).toEqual([0]);
  });
});

describe("changesSince (approved pay periods)", () => {
  const row = (riderId: string, riderName: string, hours: number) => ({ riderId, riderName, hours }) as never;
  it("is null when today's data gives the same hours", () => {
    expect(changesSince({ riders: [row("a", "Ben", 30.1)] }, { riders: [row("a", "Ben", 30.12)] })).toBeNull();
  });
  it("lists the riders whose hours moved, biggest first, and the total", () => {
    const c = changesSince({ riders: [row("a", "Ben", 30), row("b", "Ellie", 50)] }, { riders: [row("a", "Ben", 31.5), row("b", "Ellie", 49.8), row("c", "Grace", 2)] })!;
    expect(c.riders.map((r) => [r.riderName, r.deltaHours])).toEqual([["Grace", 2], ["Ben", 1.5], ["Ellie", -0.2]]);
    expect(c.deltaHours).toBe(3.3);
  });
});
