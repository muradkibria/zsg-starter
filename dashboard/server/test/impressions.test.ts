import { describe, expect, it } from "vitest";
import { areaFlow, exposureParts, HOURLY_SHARE, indexStations, londonClock, roundEstimate, tapsOn, WALKING_MS, type FootfallStation } from "@digilite/shared";

// Stations on an east–west line in London, positions in metres.
const KX = 111320 * Math.cos((51.5 * Math.PI) / 180);
const at = (xM: number) => ({ lat: 51.5, lng: -0.1 + xM / KX });
const A: FootfallStation = { key: "a", name: "Alpha", ...at(0), taps: { "2026-09-28": 72_000, "2026-09-21": 50_000 } };
const B: FootfallStation = { key: "b", name: "Beta", ...at(5000), taps: { "2026-09-28": 10_000 } };
const index = indexStations([A, B]);
const params = { spreadM: 300, flowPerTap: 0.5, minFlow: 100, visibility: 0.1 };
const MON_9AM = Date.UTC(2026, 8, 28, 8, 0, 0); // Monday 28 Sep, 09:00 London
const clock = londonClock();

describe("how busy a street is", () => {
  const moveAt9 = 72_000 * HOURLY_SHARE.weekday[9];

  it("is the minimum flow plus station movements that hour, fading with distance", () => {
    expect(areaFlow(index, at(0).lat, at(0).lng, clock(MON_9AM), params)).toBeCloseTo(100 + 0.5 * moveAt9, 3);
    const at300 = areaFlow(index, at(300).lat, at(300).lng, clock(MON_9AM), params);
    expect(Math.abs(at300 - (100 + 0.5 * moveAt9 * Math.exp(-0.5)))).toBeLessThan(5);
  });

  it("falls to the minimum far from any station, rather than stopping at an edge", () => {
    expect(areaFlow(index, at(2500).lat, at(2500).lng, clock(MON_9AM), params)).toBeCloseTo(100, 6);
    const near = areaFlow(index, at(400).lat, at(400).lng, clock(MON_9AM), params);
    const nearer = areaFlow(index, at(350).lat, at(350).lng, clock(MON_9AM), params);
    expect(nearer).toBeGreaterThan(near);
  });
});

describe("who a moving screen meets", () => {
  it("counts people along the street it covers plus those walking past meanwhile", () => {
    // 240 m in 60 s, far from stations: flow 100 people/hour.
    const parts = exposureParts([{ t: MON_9AM, ...at(2500) }, { t: MON_9AM + 60_000, ...at(2740) }], index, () => 1, params);
    const met = (100 / 3600 / WALKING_MS) * 240 + (100 * 60) / 3600;
    expect(parts[0].met).toBeCloseTo(met, 1);
    expect(parts[0].impressions).toBeCloseTo(met * 0.1, 2);
  });

  it("counts only the people walking past when stopped", () => {
    const parts = exposureParts([{ t: MON_9AM, ...at(2500) }, { t: MON_9AM + 60_000, ...at(2500) }], index, () => 1, params);
    expect(parts[0].met).toBeCloseTo((100 * 60) / 3600, 6);
  });

  it("meets far more people in a busy area than a quiet one", () => {
    const busy = exposureParts([{ t: MON_9AM, ...at(0) }, { t: MON_9AM + 60_000, ...at(240) }], index, () => 1, params)[0].impressions;
    const quiet = exposureParts([{ t: MON_9AM, ...at(2500) }, { t: MON_9AM + 60_000, ...at(2740) }], index, () => 1, params)[0].impressions;
    expect(busy).toBeGreaterThan(quiet * 10);
  });

  it("weights by the advertiser's share, and skips time the screen wasn't on", () => {
    const pts = [{ t: MON_9AM, ...at(0) }, { t: MON_9AM + 60_000, ...at(240) }];
    const all = exposureParts(pts, index, () => 1, params)[0];
    const sixth = exposureParts(pts, index, () => 1 / 6, params)[0];
    expect(sixth.impressions).toBeCloseTo(all.impressions / 6, 6);
    expect(sixth.seconds).toBeCloseTo(10, 6);
    expect(exposureParts(pts, index, () => 0, params)).toHaveLength(0);
  });

  it("counts a signal gap as 60 s in place, not as distance", () => {
    const parts = exposureParts([{ t: MON_9AM, ...at(2500) }, { t: MON_9AM + 20 * 60_000, ...at(4000) }], index, () => 1, params);
    expect(parts[0].seconds).toBe(60);
    expect(parts[0].met).toBeCloseTo((100 * 60) / 3600, 6);
  });
});

describe("days TfL hasn't published yet", () => {
  it("use the same weekday of the latest week TfL has", () => {
    expect(tapsOn(A, "2026-09-28")).toBe(72_000);
    expect(tapsOn(A, "2026-10-05")).toBe(72_000);
    expect(tapsOn(B, "2026-09-29")).toBe(0);
  });

  it("rounds estimates to two significant figures", () => {
    expect(roundEstimate(12_345)).toBe(12_000);
    expect(roundEstimate(987)).toBe(990);
    expect(roundEstimate(42)).toBe(42);
  });
});
