import { describe, expect, it } from "vitest";
import {
  analyseTrack,
  auditGroup,
  auditGroupLabel,
  circleToRing,
  DEFAULT_ANALYTICS,
  humaniseSettingChange,
  measureZonePairs,
  offsetLngLat,
  ringAreaM2,
  ringSelfIntersects,
  ringToCircle,
  trackPairs,
  validateZoneShape,
  ZONE_MAX_POINTS,
  type TrackPoint,
  type ZoneShape,
} from "@digilite/shared";
import { randomCode, SignInGate } from "../src/domain/signin";
import { teamChangeProblem } from "../src/domain/team";

const SHOREDITCH = { lat: 51.53275, lng: -0.0745 };

/** A square outline `sizeM` across, centred on a point, as [lng, lat]. */
function square(lat: number, lng: number, sizeM: number): [number, number][] {
  const h = sizeM / 2;
  return [offsetLngLat(lng, lat, -h, -h), offsetLngLat(lng, lat, h, -h), offsetLngLat(lng, lat, h, h), offsetLngLat(lng, lat, -h, h)];
}

describe("zone shape validation", () => {
  it("accepts a circle inside London and rounds it", () => {
    const r = validateZoneShape({ kind: "circle", centerLat: 51.532751234567, centerLng: -0.07451234567, radiusM: 1040.4 });
    expect(r).toEqual({ ok: true, shape: { kind: "circle", centerLat: 51.532751, centerLng: -0.074512, radiusM: 1040, polygon: null } });
  });

  it("keeps the radius between 50 m and 5 km", () => {
    expect(validateZoneShape({ kind: "circle", centerLat: 51.5, centerLng: -0.1, radiusM: 49 }).ok).toBe(false);
    expect(validateZoneShape({ kind: "circle", centerLat: 51.5, centerLng: -0.1, radiusM: 5001 }).ok).toBe(false);
    expect(validateZoneShape({ kind: "circle", centerLat: 51.5, centerLng: -0.1, radiusM: 50 }).ok).toBe(true);
    expect(validateZoneShape({ kind: "circle", centerLat: 51.5, centerLng: -0.1, radiusM: 5000 }).ok).toBe(true);
  });

  it("refuses shapes outside Greater London", () => {
    const paris = validateZoneShape({ kind: "circle", centerLat: 48.8566, centerLng: 2.3522, radiusM: 500 });
    expect(paris).toEqual({ ok: false, error: "Keep the zone inside Greater London" });
    const brighton = validateZoneShape({ kind: "polygon", polygon: square(50.82, -0.14, 800) });
    expect(brighton.ok).toBe(false);
  });

  it("needs a centre for a circle", () => {
    expect(validateZoneShape({ kind: "circle", centerLat: null, centerLng: -0.1, radiusM: 500 })).toEqual({ ok: false, error: "Pick a centre for the circle" });
  });

  it("needs at least 3 distinct points for an outline", () => {
    const [a, b] = square(SHOREDITCH.lat, SHOREDITCH.lng, 800);
    expect(validateZoneShape({ kind: "polygon", polygon: [a, b] }).ok).toBe(false);
    // A closed ring of 3 points plus the repeated first point is fine.
    const tri = square(SHOREDITCH.lat, SHOREDITCH.lng, 800).slice(0, 3);
    const closed = validateZoneShape({ kind: "polygon", polygon: [...tri, tri[0]] });
    expect(closed.ok && closed.shape.polygon?.length).toBe(3);
    // Repeated points don't count twice.
    expect(validateZoneShape({ kind: "polygon", polygon: [a, a, b, b, a] }).ok).toBe(false);
  });

  it("refuses an outline that crosses itself", () => {
    const [a, b, c, d] = square(SHOREDITCH.lat, SHOREDITCH.lng, 800);
    const bowTie: [number, number][] = [a, c, b, d];
    expect(ringSelfIntersects(bowTie)).toBe(true);
    expect(ringSelfIntersects([a, b, c, d])).toBe(false);
    const r = validateZoneShape({ kind: "polygon", polygon: bowTie });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/crosses itself/);
  });

  it("refuses tiny or flat outlines and too many points", () => {
    expect(validateZoneShape({ kind: "polygon", polygon: square(SHOREDITCH.lat, SHOREDITCH.lng, 30) }).ok).toBe(false);
    const flat: [number, number][] = [
      [-0.08, 51.53],
      [-0.07, 51.53],
      [-0.06, 51.53],
    ];
    expect(validateZoneShape({ kind: "polygon", polygon: flat }).ok).toBe(false);
    const many = circleToRing(SHOREDITCH.lat, SHOREDITCH.lng, 1000, ZONE_MAX_POINTS + 1);
    expect(validateZoneShape({ kind: "polygon", polygon: many }).ok).toBe(false);
    expect(validateZoneShape({ kind: "polygon", polygon: many.slice(0, ZONE_MAX_POINTS) }).ok).toBe(true);
  });

  it("rejects points that aren't numbers", () => {
    expect(validateZoneShape({ kind: "polygon", polygon: [[Number.NaN, 51.5], [-0.1, 51.5], [-0.1, 51.51]] as [number, number][] }).ok).toBe(false);
  });
});

describe("zone geometry", () => {
  it("measures the area of a 1 km square within 1%", () => {
    expect(ringAreaM2(square(SHOREDITCH.lat, SHOREDITCH.lng, 1000)) / 1_000_000).toBeCloseTo(1, 1);
  });

  it("turns a circle into an outline and back", () => {
    const ring = circleToRing(SHOREDITCH.lat, SHOREDITCH.lng, 1000, 8);
    expect(ring).toHaveLength(8);
    const c = ringToCircle(ring);
    expect(c.centerLat).toBeCloseTo(SHOREDITCH.lat, 4);
    expect(c.centerLng).toBeCloseTo(SHOREDITCH.lng, 4);
    expect(Math.abs(c.radiusM - 1000)).toBeLessThanOrEqual(10);
  });
});

// ── Preview timing must equal what the daily rollup records ───────────────────
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** A wandering track with jitter, signal gaps, a shift break and a late batch. */
function syntheticTrack(seed: number): TrackPoint[] {
  const r = rng(seed);
  const pts: TrackPoint[] = [];
  let t = Date.UTC(2026, 8, 28, 16, 0, 0);
  let lat = SHOREDITCH.lat - 0.01;
  let lng = SHOREDITCH.lng - 0.012;
  for (let i = 0; i < 900; i++) {
    const roll = r();
    if (roll < 0.01) t += (6 + r() * 20) * 60_000; // signal gap
    else if (roll < 0.012) t += 60 * 60_000; // shift break
    else t += 10_000 + r() * 50_000;
    lat += (r() - 0.45) * 0.0012;
    lng += (r() - 0.45) * 0.0018;
    pts.push({ t, lat, lng, seq: 0 });
  }
  // A late upload: several points stamped with the same time.
  const tLate = t + 15 * 60_000;
  for (let k = 0; k < 6; k++) pts.push({ t: tLate, lat: lat + k * 0.0003, lng, seq: k });
  // Shuffle a little: the analysis must sort.
  return pts.sort(() => r() - 0.5);
}

describe("preview pair timing", () => {
  const zones: ZoneShape[] = [
    { id: "a", name: "A", kind: "circle", centerLat: SHOREDITCH.lat, centerLng: SHOREDITCH.lng, radiusM: 1040 },
    { id: "b", name: "B", kind: "polygon", polygon: square(SHOREDITCH.lat - 0.006, SHOREDITCH.lng - 0.004, 1400) },
    { id: "c", name: "C", kind: "circle", centerLat: SHOREDITCH.lat - 0.012, centerLng: SHOREDITCH.lng - 0.01, radiusM: 800 },
  ];

  for (const seed of [1, 7, 42, 99]) {
    it(`matches analyseTrack's zone time for every zone (track ${seed})`, () => {
      const pts = syntheticTrack(seed);
      const expected = analyseTrack(pts, zones, DEFAULT_ANALYTICS).zoneSeconds;
      expect(Object.keys(expected).length).toBeGreaterThanOrEqual(2); // the track really visits zones
      const pairs = trackPairs("bag1", pts, DEFAULT_ANALYTICS);
      for (const z of zones) {
        const m = measureZonePairs([pairs], zones, z.id);
        expect(m.seconds).toBeCloseTo(expected[z.id] ?? 0, 6);
      }
    });
  }

  it("honours different signal-gap and shift-break rules", () => {
    const pts = syntheticTrack(5);
    const cfg = { ...DEFAULT_ANALYTICS, signalGapMin: 2, shiftBreakMin: 20 };
    const expected = analyseTrack(pts, zones, cfg).zoneSeconds;
    const m = measureZonePairs([trackPairs("bag1", pts, cfg)], zones, "a");
    expect(m.seconds).toBeCloseTo(expected.a ?? 0, 6);
  });

  it("gives overlapping time to the zone listed first and reports it", () => {
    const pts = syntheticTrack(42);
    const pairs = [trackPairs("bag1", pts, DEFAULT_ANALYTICS)];
    const big: ZoneShape = { id: "big", name: "Big", kind: "circle", centerLat: SHOREDITCH.lat, centerLng: SHOREDITCH.lng, radiusM: 3000 };
    const alone = measureZonePairs(pairs, [big], "big");
    const behind = measureZonePairs(pairs, [...zones, big], "big");
    const overlap = [...behind.overlap.values()].reduce((s, x) => s + x, 0);
    expect(overlap).toBeGreaterThan(0);
    expect(behind.seconds + overlap).toBeCloseTo(alone.seconds, 6);
  });

  it("counts each bag once", () => {
    const a = trackPairs("bag1", syntheticTrack(1), DEFAULT_ANALYTICS);
    const b = trackPairs("bag1", syntheticTrack(2), DEFAULT_ANALYTICS);
    const c = trackPairs("bag2", syntheticTrack(3), DEFAULT_ANALYTICS);
    const m = measureZonePairs([a, b, c], zones, "a");
    expect(m.bags).toBeLessThanOrEqual(2);
    expect(m.bags).toBeGreaterThan(0);
  });

  it("an empty track records nothing", () => {
    expect(measureZonePairs([trackPairs("x", [], DEFAULT_ANALYTICS)], zones, "a")).toMatchObject({ seconds: 0, bags: 0 });
  });
});

describe("team rules", () => {
  const users = [
    { id: "own1", role: "owner" as const, disabled: false },
    { id: "ops1", role: "ops" as const, disabled: false },
    { id: "own2", role: "owner" as const, disabled: true },
  ];

  it("you can't switch yourself off or change your own role", () => {
    expect(teamChangeProblem(users, "own1", "own1", { disabled: true })).toMatch(/your own login/);
    expect(teamChangeProblem(users, "own1", "own1", { role: "ops" })).toMatch(/your own role/);
    expect(teamChangeProblem(users, "own1", "own1", { role: "owner" })).toBeNull();
  });

  it("keeps at least one owner who can sign in", () => {
    const withOther = [...users, { id: "own3", role: "owner" as const, disabled: false }];
    // own3 is an active owner, so own1 can demote it; but own3 can't demote the last other one.
    expect(teamChangeProblem(withOther, "own1", "own3", { role: "sales" })).toBeNull();
    expect(teamChangeProblem(users, "ops1", "own1", { role: "ops" })).toMatch(/at least one owner/);
    expect(teamChangeProblem(users, "ops1", "own1", { disabled: true })).toMatch(/at least one owner/);
    // A switched-off owner doesn't count as a working owner.
    expect(teamChangeProblem(users, "own1", "own2", { role: "viewer" })).toBeNull();
  });

  it("allows ordinary changes", () => {
    expect(teamChangeProblem(users, "own1", "ops1", { role: "sales", disabled: true })).toBeNull();
    expect(teamChangeProblem(users, "own1", "nobody", {})).toMatch(/isn't on the team/);
  });

});

describe("sign-in codes", () => {
  it("makes six-digit codes, leading zeros included", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = randomCode();
      expect(c).toMatch(/^\d{6}$/);
      seen.add(c);
    }
    // Random over a million: 2,000 draws repeat a few times at most.
    expect(seen.size).toBeGreaterThan(1990);
  });

  const MIN = 60_000;
  const limits = { perAddress: 5, addressWindowMs: 15 * MIN, overall: 50, overallWindowMs: 60 * MIN };

  it("rations wrong codes per address, and lets them try again later", () => {
    const gate = new SignInGate(limits);
    for (let i = 0; i < 5; i++) {
      expect(gate.blocked("a", i)).toBeNull();
      gate.wrong("a", i);
    }
    expect(gate.blocked("a", 10)).toMatch(/Try again in 15 minutes/);
    expect(gate.blocked("b", 10)).toBeNull();
    expect(gate.blocked("a", 15 * MIN + 5)).toBeNull();
  });

  it("a right code clears that address's wrong ones", () => {
    const gate = new SignInGate(limits);
    for (let i = 0; i < 4; i++) gate.wrong("a", i);
    gate.right("a");
    for (let i = 0; i < 4; i++) gate.wrong("a", 10 + i);
    expect(gate.blocked("a", 20)).toBeNull();
  });

  it("pauses everyone after too many wrong codes from many addresses, for an hour", () => {
    const gate = new SignInGate(limits);
    for (let i = 0; i < 50; i++) gate.wrong(`addr${i}`, i * 1000);
    expect(gate.blocked("someone-new", 60_000)).toMatch(/paused/);
    expect(gate.blocked("someone-new", 60 * MIN + 49_001)).toBeNull();
  });
});

describe("audit wording", () => {
  it("turns settings changes into plain English", () => {
    expect(humaniseSettingChange("shiftBreakMin: 45 → 60")).toBe("Shift break: 45 min → 60 min");
    expect(humaniseSettingChange("paySignalGaps: false → true")).toBe("Pay for signal-gap time: off → on");
    expect(humaniseSettingChange('payRate: "" → "£12.00/hour"')).toBe('Pay rate: not set → "£12.00/hour"');
    expect(humaniseSettingChange("something else")).toBe("something else");
  });

  it("labels groups, including ones it doesn't know", () => {
    expect(auditGroupLabel("auth")).toBe("Sign-ins");
    expect(auditGroupLabel("zone")).toBe("Zones");
    expect(auditGroupLabel("rider_docs")).toBe("Rider docs");
    expect(auditGroupLabel(auditGroup("rider.document.view"))).toBe("Rider documents");
    expect(auditGroupLabel(auditGroup("rider.create"))).toBe("Riders");
    expect(auditGroupLabel(auditGroup("bag.brightness"))).toBe("Bags");
    expect(auditGroupLabel(auditGroup("payroll.reopen"))).toBe("Payroll");
    expect(auditGroupLabel(auditGroup("export.download"))).toBe("Exports");
    expect(auditGroupLabel(auditGroup("creative.upload"))).toBe("Ads");
    expect(auditGroupLabel(auditGroup("something_new.happened"))).toBe("Something new");
  });
});
