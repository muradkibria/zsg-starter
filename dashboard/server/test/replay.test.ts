import { describe, expect, it } from "vitest";
import { buildReplayTrack, loopSlotAt, replayAt, replayPathAt, simplifyLine, simplifyTrack } from "@digilite/shared";

// Metres per degree of longitude in London.
const KX = 111320 * Math.cos((51.5 * Math.PI) / 180);
const T0 = Date.UTC(2026, 9, 1, 9, 0, 0);
const MIN = 60_000;

// A ride east along a straight road (about 70 m per step), stopping 10 minutes at step 5.
const at = (step: number, minute: number) => ({ lng: -0.1 + step * 0.001, lat: 51.5, t: T0 + minute * MIN });
const ride = [
  at(0, 0), at(1, 1), at(2, 2), at(3, 3), at(4, 4), at(5, 5),
  at(5, 7), at(5, 9), at(5, 11), at(5, 13), at(5, 15),
  at(6, 16), at(7, 17), at(8, 18), at(9, 19), at(10, 20),
];

describe("time-aware simplification", () => {
  it("keeps a stop on a straight road, which plain simplification drops", () => {
    expect(simplifyLine(ride.map((p) => [p.lng, p.lat]), 3)).toHaveLength(2);
    const kept = simplifyTrack(ride, 3);
    expect(kept[0]).toBe(0);
    expect(kept[kept.length - 1]).toBe(ride.length - 1);
    expect(kept).toContain(5);
    expect(kept).toContain(10);
  });

  it("drops fixes that a steady pace already accounts for", () => {
    const steady = [0, 1, 2, 3, 4, 5].map((i) => at(i, i));
    expect(simplifyTrack(steady, 3)).toEqual([0, 5]);
  });
});

describe("replaying a route", () => {
  const route = { segments: [ride.map((p) => [p.lng, p.lat] as [number, number])], times: [ride.map((p) => p.t / 1000)] };
  const track = buildReplayTrack(route);
  const lngAt = (m: number) => replayAt(track, T0 + m * MIN)!.lng;

  it("starts and finishes exactly where the route does", () => {
    expect(track.span).toEqual([T0, T0 + 20 * MIN]);
    expect(lngAt(0)).toBeCloseTo(-0.1, 9);
    expect(lngAt(20)).toBeCloseTo(-0.09, 9);
    expect(lngAt(-5)).toBeCloseTo(-0.1, 9);
  });

  it("never goes backwards, and holds still through the stop", () => {
    let prev = -Infinity;
    for (let s = 0; s <= 20 * 60; s += 5) {
      const lng = replayAt(track, T0 + s * 1000)!.lng;
      expect(lng).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = lng;
    }
    for (const m of [7, 10, 13]) expect(lngAt(m)).toBeCloseTo(-0.095, 6);
  });

  it("eases into the stop instead of halting at once", () => {
    // Before the stop it covers about 70 m a minute; the last 20 s before arriving it slows down.
    const speed = (s: number) => (replayAt(track, T0 + (s + 1) * 1000)!.lng - replayAt(track, T0 + s * 1000)!.lng) * KX;
    expect(speed(3 * 60)).toBeCloseTo(70 / 60, 1);
    expect(speed(5 * 60 - 5)).toBeLessThan(speed(3 * 60) * 0.8);
    expect(speed(5 * 60 - 5)).toBeGreaterThan(0);
  });

  it("draws the route covered so far, ending at the bag", () => {
    const path = replayPathAt(track, T0 + 17.5 * MIN);
    const end = path[0][path[0].length - 1];
    expect(end[0]).toBeCloseTo(replayAt(track, T0 + 17.5 * MIN)!.lng, 12);
    expect(replayPathAt(track, T0 - MIN)).toEqual([]);
  });

  it("holds at the last fix through a signal gap, and says so", () => {
    const later = { lng: -0.08, lat: 51.5, t: T0 + 60 * MIN };
    const withGap = buildReplayTrack({
      segments: [...route.segments, [[later.lng, later.lat], [later.lng + 0.001, later.lat]]],
      times: [...route.times, [later.t / 1000, later.t / 1000 + 60]],
    });
    const inGap = replayAt(withGap, T0 + 40 * MIN);
    expect(inGap).toMatchObject({ noSignal: true });
    expect(inGap?.lng).toBeCloseTo(-0.09, 9);
    expect(replayPathAt(withGap, T0 + 40 * MIN)).toHaveLength(1);
    expect(replayPathAt(withGap, T0 + 60.5 * MIN)).toHaveLength(2);
  });
});

describe("the ad a loop is on", () => {
  const slot = (name: string, seconds: number) => ({ creativeId: name, name, advertiser: "", seconds, thumbUrl: null });
  const loop = { name: "June 26", slots: [slot("a", 10), slot("b", 20), slot("a", 10), slot("c", 5)] };

  it("walks the loop in order, each ad for its slot's length, then starts again", () => {
    const atS = (s: number) => loopSlotAt(loop, s).name;
    expect([0, 9, 10, 29, 30, 39, 40, 44, 45, 55].map(atS)).toEqual(["a", "a", "b", "b", "a", "a", "c", "c", "a", "b"]);
  });
});
