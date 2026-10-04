import { describe, expect, it } from "vitest";
import {
  addDays,
  analyseTrack,
  bagStatus,
  clockMatchesLondon,
  DEFAULT_ANALYTICS,
  londonDay,
  londonDayBounds,
  parseColorlightTime,
  programNameFromVsn,
  spreadLatePoints,
  type TrackPoint,
} from "@digilite/shared";

describe("London days", () => {
  it("summer day starts at 23:00 UTC the day before", () => {
    const [s, e] = londonDayBounds("2026-09-28");
    expect(s.toISOString()).toBe("2026-09-27T23:00:00.000Z");
    expect(e.toISOString()).toBe("2026-09-28T23:00:00.000Z");
  });
  it("winter day starts at midnight UTC", () => {
    const [s] = londonDayBounds("2026-12-01");
    expect(s.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("handles the clocks going forward (23-hour day)", () => {
    const [s, e] = londonDayBounds("2026-03-29");
    expect((e.getTime() - s.getTime()) / 3600000).toBe(23);
  });
  it("handles the clocks going back (25-hour day)", () => {
    const [s, e] = londonDayBounds("2026-10-25");
    expect((e.getTime() - s.getTime()) / 3600000).toBe(25);
  });
  it("a 23:30 UTC point in summer belongs to the next London day", () => {
    expect(londonDay(new Date("2026-09-28T23:30:00Z"))).toBe("2026-09-29");
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  });
});

describe("Colorlight helpers", () => {
  it("parses UTC timestamps without Z", () => {
    expect(parseColorlightTime("2026-09-28T21:47:45.408")!.toISOString()).toBe("2026-09-28T21:47:45.408Z");
  });
  it("extracts program names from vsn file names", () => {
    expect(programNameFromVsn("June 26_83fca0e70b30cbf5090390702f9aa5c3_7174.vsn")).toBe("June 26");
    expect(programNameFromVsn("May 26- ads v2_76f1261bb6c1621fd9dcfd6bd7f60dfb_7163.vsn")).toBe("May 26- ads v2");
  });
  it("detects clocks not on London time", () => {
    const summer = new Date("2026-09-29T12:00:00Z");
    expect(clockMatchesLondon("+01", summer)).toBe(true);
    expect(clockMatchesLondon("+08", summer)).toBe(false);
    expect(clockMatchesLondon("+00", new Date("2026-12-01T12:00:00Z"))).toBe(true);
  });
  it("buckets bag status by last report", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(bagStatus(new Date(now - 60_000), now)).toBe("now");
    expect(bagStatus(new Date(now - 5 * 3600_000), now)).toBe("day");
    expect(bagStatus(new Date(now - 3 * 86400_000), now)).toBe("idle");
    expect(bagStatus(new Date(now - 30 * 86400_000), now)).toBe("gone");
    expect(bagStatus(null, now)).toBe("gone");
  });
});

// A synthetic evening: move east for 30 min, stop 20 min, signal gap 12 min, move 10 min.
function evening(): TrackPoint[] {
  const t0 = Date.parse("2026-09-28T17:00:00Z");
  const pts: TrackPoint[] = [];
  let t = t0;
  let lng = -0.08;
  for (let i = 0; i < 60; i++) pts.push({ t: (t += 30_000), lat: 51.52, lng: (lng += 0.0005) }); // ~34 m / 30 s
  for (let i = 0; i < 40; i++) pts.push({ t: (t += 30_000), lat: 51.52, lng }); // stopped 20 min
  t += 12 * 60_000; // signal gap
  for (let i = 0; i < 20; i++) pts.push({ t: (t += 30_000), lat: 51.52, lng: (lng += 0.0005) });
  return pts;
}

describe("track analytics", () => {
  it("finds one shift with a stop and a signal gap", () => {
    const a = analyseTrack(evening(), [], DEFAULT_ANALYTICS);
    expect(a.shifts).toHaveLength(1);
    expect(a.stops).toHaveLength(1);
    expect(Math.round(a.stops[0].seconds / 60)).toBeGreaterThanOrEqual(19);
    expect(a.gaps).toHaveLength(1);
    expect(Math.round(a.gaps[0].seconds / 60)).toBe(13);
    expect(a.movingSeconds).toBeGreaterThan(35 * 60);
    expect(a.movingSeconds).toBeLessThan(42 * 60);
    expect(a.km).toBeGreaterThan(2);
    expect(a.km).toBeLessThan(3.2);
    // moving + stopped + gap = time on
    expect(Math.round(a.movingSeconds + a.stoppedSeconds + a.gapSeconds)).toBe(Math.round(a.onSeconds));
  });

  it("splits shifts on long breaks", () => {
    const p = evening();
    const later = p.map((x) => ({ ...x, t: x.t + 3 * 3600_000 }));
    expect(analyseTrack([...p, ...later], [], DEFAULT_ANALYTICS).shifts).toHaveLength(2);
  });

  it("spreads late batch uploads across the gap before them", () => {
    const t = Date.parse("2026-09-28T18:56:38Z");
    const pts: TrackPoint[] = [
      { t: t - 20 * 60_000, lat: 51.5, lng: -0.1, seq: 0 },
      ...Array.from({ length: 5 }, (_, i) => ({ t, lat: 51.5, lng: -0.1 + i * 0.001, seq: i })),
    ];
    const out = spreadLatePoints(pts);
    const ts = out.map((p) => p.t);
    expect(new Set(ts).size).toBe(6);
    expect(ts[ts.length - 1]).toBe(t);
    expect(out.filter((p) => p.late)).toHaveLength(5);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });

  it("attributes time to zones", () => {
    const zone = { id: "z1", name: "Test", kind: "circle" as const, centerLat: 51.52, centerLng: -0.08, radiusM: 5000 };
    const a = analyseTrack(evening(), [zone], DEFAULT_ANALYTICS);
    expect(a.zoneSeconds.z1).toBeGreaterThan(50 * 60);
  });
});
