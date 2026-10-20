import { describe, expect, it } from "vitest";
import { exposureParts, HOURLY_SHARE, indexStations, nearestStation, roundEstimate, tapsOn, type FootfallStation } from "@digilite/shared";

// Two stations 300 m apart on an east–west line, in London.
const KX = 111320 * Math.cos((51.5 * Math.PI) / 180);
const at = (xM: number) => ({ lat: 51.5, lng: -0.1 + xM / KX });
const A: FootfallStation = { key: "a", name: "Alpha", ...at(0), taps: { "2026-09-28": 72_000, "2026-09-21": 50_000 } };
const B: FootfallStation = { key: "b", name: "Beta", ...at(300), taps: { "2026-09-28": 10_000 } };
const index = indexStations([A, B]);
const params = { radiusM: 250, streetShare: 0.25, visibility: 0.1 };

describe("station catchments", () => {
  it("finds the nearest station inside the radius, using real distance", () => {
    expect(nearestStation(index, at(10).lat, at(10).lng, 250)?.station.key).toBe("a");
    expect(nearestStation(index, at(240).lat, at(240).lng, 250)?.station.key).toBe("b");
    expect(nearestStation(index, at(600).lat, at(600).lng, 250)).toBeNull();
    expect(nearestStation(index, at(260).lat, at(260).lng, 250)?.metres).toBeCloseTo(40, 0);
  });

  it("counts an overlapping stretch once, for the nearest station only", () => {
    // 140 m from Alpha and 160 m from Beta: inside both catchments.
    const t0 = Date.UTC(2026, 8, 28, 8, 0, 0); // Monday 09:00 London
    const parts = exposureParts([{ t: t0, ...at(140) }, { t: t0 + 60_000, ...at(140) }], index, () => 1, params);
    expect(parts).toHaveLength(1);
    expect(parts[0].station?.key).toBe("a");
  });
});

describe("the impressions formula", () => {
  it("is daily movements × hourly share × fraction of the hour × street share × visibility × ad share", () => {
    const t0 = Date.UTC(2026, 8, 28, 8, 0, 0); // Monday 28 Sep, 09:00 London
    const parts = exposureParts([{ t: t0, ...at(0) }, { t: t0 + 60_000, ...at(0) }], index, () => 1 / 6, params);
    const expected = 72_000 * HOURLY_SHARE.weekday[9] * (60 / 3600) * 0.25 * 0.1 * (1 / 6);
    expect(parts[0].impressions).toBeCloseTo(expected, 6);
    // A 10 s ad in a 60 s loop counts one sixth of the time on screen.
    expect(parts[0].seconds).toBeCloseTo(10, 6);
  });

  it("caps a stretch at 60 s, so a gap in signal isn't counted as time there", () => {
    const t0 = Date.UTC(2026, 8, 28, 8, 0, 0);
    const parts = exposureParts([{ t: t0, ...at(0) }, { t: t0 + 20 * 60_000, ...at(0) }], index, () => 1, params);
    expect(parts[0].seconds).toBe(60);
  });

  it("skips time the screen (or the ad) wasn't on", () => {
    const t0 = Date.UTC(2026, 8, 28, 8, 0, 0);
    expect(exposureParts([{ t: t0, ...at(0) }, { t: t0 + 30_000, ...at(0) }], index, () => 0, params)).toHaveLength(0);
  });
});

describe("days TfL hasn't published yet", () => {
  it("use the same weekday of the latest week TfL has", () => {
    expect(tapsOn(A, "2026-09-28")).toBe(72_000);
    expect(tapsOn(A, "2026-10-05")).toBe(72_000); // a week later: Monday 28 Sep stands in
    expect(tapsOn(B, "2026-10-12")).toBe(10_000);
    expect(tapsOn(B, "2026-09-29")).toBe(0); // no Tuesday held
  });

  it("rounds estimates to two significant figures", () => {
    expect(roundEstimate(12_345)).toBe(12_000);
    expect(roundEstimate(987)).toBe(990);
    expect(roundEstimate(42)).toBe(42);
  });
});
