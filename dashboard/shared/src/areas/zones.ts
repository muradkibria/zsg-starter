// Contracts and pure helpers for the zones area: shape validation, simple
// geometry for the editor, and the pair-timing rule used to preview how much
// time a new shape would have recorded.

import { sortPoints, spreadLatePoints, type AnalyticsConfig, type TrackPoint } from "../analytics";
import type { ZoneDto } from "../api";
import { haversineMeters, pointInZone, zoneAt, type ZoneShape } from "../geo";

// ── Vocabulary & limits ───────────────────────────────────────────────────────
export type ZoneType = ZoneDto["type"];
export type ZoneKind = ZoneDto["kind"];

export const ZONE_TYPES: ZoneType[] = ["neighbourhood", "high_street", "station", "other"];

export const ZONE_TYPE_LABEL: Record<ZoneType, string> = {
  neighbourhood: "Neighbourhood",
  high_street: "High street",
  station: "Station",
  other: "Other",
};

export const ZONE_RADIUS_MIN = 50;
export const ZONE_RADIUS_MAX = 5000;
export const ZONE_MAX_POINTS = 200;
/** Smallest outline we accept (about a 40 m circle). */
export const ZONE_MIN_AREA_M2 = 5000;
/** Days of GPS a shape preview is measured over. */
export const ZONE_PREVIEW_DAYS = 14;
/** Longest period the stats endpoint accepts. */
export const ZONE_STATS_MAX_DAYS = 92;

/** Greater London, with a small margin. */
export const GREATER_LONDON = { minLat: 51.28, maxLat: 51.7, minLng: -0.52, maxLng: 0.34 };

// ── Requests & responses ──────────────────────────────────────────────────────
/** The geometry of a zone. Polygon rings are [lng, lat] points, not closed. */
export interface ZoneShapeInput {
  kind: ZoneKind;
  centerLat?: number | null;
  centerLng?: number | null;
  radiusM?: number | null;
  polygon?: [number, number][] | null;
}

/** POST /zones */
export interface ZoneWrite extends ZoneShapeInput {
  name: string;
  type: ZoneType;
  active?: boolean;
}

/** PATCH /zones/:id */
export type ZonePatch = Partial<ZoneWrite>;

export interface ZoneStat {
  zoneId: string;
  /** Seconds inside the zone over the period */
  seconds: number;
  /** Distinct bags that spent any time inside it */
  bags: number;
  /** Its seconds as a share (0–1) of all time out over the period */
  share: number;
  /** Seconds per day for the sparkline (aligned with `sparkDays`) */
  daily: number[];
}

export interface RecomputeStatus {
  reason: string;
  fromDay: string;
  toDay: string;
  total: number;
  remaining: number;
  startedAt: string;
  finishedAt: string | null;
}

/** GET /zones/stats?fromDay&toDay */
export interface ZoneStatsResponse {
  fromDay: string;
  toDay: string;
  days: number;
  /** Days in the period with any bag out */
  daysWithData: number;
  /** Earliest day the Hub has routes for (earlier days show nothing) */
  firstDataDay: string | null;
  /** The 7 days ending `toDay` (for sparklines) */
  sparkDays: string[];
  /** Whether each spark day has any data */
  sparkHasData: boolean[];
  /** All time out (bags on) over the period, in seconds */
  onSeconds: number;
  /** Time inside any zone over the period, in seconds */
  zoneSeconds: number;
  /** Share (0–1) of all time out that was inside any zone */
  share: number;
  /** Distinct bags out over the period */
  bagsOut: number;
  zones: ZoneStat[];
  /** A zone-time recompute in progress (after a zone or tracking-rule change) */
  recompute: RecomputeStatus | null;
}

/** POST /zones/preview */
export interface ZonePreviewRequest {
  /** The zone being edited; omit for a new zone */
  zoneId?: string | null;
  shape: ZoneShapeInput;
}

export interface ZoneMeasure {
  seconds: number;
  bags: number;
}

export interface ZonePreviewResponse {
  fromDay: string;
  toDay: string;
  days: number;
  /** Bag-days sampled */
  bagDays: number;
  /** True when the sample had to be cut short (very busy period) */
  capped: boolean;
  /** Time this shape would have recorded */
  shape: ZoneMeasure;
  /** Time inside the shape that counts for another zone listed earlier */
  overlap: { zoneId: string; name: string; seconds: number }[];
  /** The saved shape, measured the same way (existing zones only) */
  current: ZoneMeasure | null;
  ms: number;
}

/** GET /zones/heat — where bags spent time, for drawing zones in the right place */
export interface ZoneHeatResponse {
  fromDay: string;
  toDay: string;
  /** [lng, lat, seconds] per ~150 m cell */
  cells: [number, number, number][];
  maxSeconds: number;
}

/** POST /settings/recompute */
export interface RecomputeRequest {
  days: number;
}

/** GET /settings/fleet-loop-options */
export interface FleetLoopOption {
  name: string;
  /** Bags reporting this loop right now */
  playingOn: number;
  /** In the loops list (synced from Colorlight or made in the Hub) */
  known: boolean;
}

// ── Local planar geometry (fine for areas the size of a borough) ─────────────
const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

function project(ring: [number, number][]): { pts: [number, number][]; lat0: number; lng0: number } {
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const lng0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const kx = mPerDegLng(lat0);
  return { pts: ring.map(([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * M_PER_DEG_LAT]), lat0, lng0 };
}

/** Area of a ring ([lng, lat], open or closed) in square metres. */
export function ringAreaM2(ring: [number, number][]): number {
  const r = openRing(ring);
  if (r.length < 3) return 0;
  const { pts } = project(r);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function zoneAreaM2(shape: ZoneShapeInput): number {
  if (shape.kind === "circle") return shape.radiusM ? Math.PI * shape.radiusM ** 2 : 0;
  return shape.polygon ? ringAreaM2(shape.polygon) : 0;
}

/** Area-weighted centre of a ring, as [lng, lat]. */
export function ringCentroid(ring: [number, number][]): [number, number] {
  const r = openRing(ring);
  if (!r.length) return [0, 0];
  const { pts, lat0, lng0 } = project(r);
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const f = x1 * y2 - x2 * y1;
    a += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) return [lng0, lat0];
  cx /= 3 * a;
  cy /= 3 * a;
  return [lng0 + cx / mPerDegLng(lat0), lat0 + cy / M_PER_DEG_LAT];
}

/** Move a point by metres east (dx) and north (dy). Returns [lng, lat]. */
export function offsetLngLat(lng: number, lat: number, dxM: number, dyM: number): [number, number] {
  return [lng + dxM / mPerDegLng(lat), lat + dyM / M_PER_DEG_LAT];
}

/** An open ring approximating a circle, for turning a circle into an outline. */
export function circleToRing(lat: number, lng: number, radiusM: number, points = 8): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * 2 * Math.PI + Math.PI / 2;
    out.push(offsetLngLat(lng, lat, radiusM * Math.cos(a), radiusM * Math.sin(a)));
  }
  return out;
}

/** The circle that best stands in for an outline (centre + average distance). */
export function ringToCircle(ring: [number, number][]): { centerLat: number; centerLng: number; radiusM: number } {
  const r = openRing(ring);
  const [lng, lat] = ringCentroid(r);
  const avg = r.length ? r.reduce((s, [x, y]) => s + haversineMeters(lat, lng, y, x), 0) / r.length : 500;
  return { centerLat: lat, centerLng: lng, radiusM: clampRadius(avg) };
}

export function clampRadius(m: number): number {
  return Math.round(Math.min(ZONE_RADIUS_MAX, Math.max(ZONE_RADIUS_MIN, m)) / 10) * 10;
}

/** Drop a closing duplicate point and consecutive duplicates. */
export function openRing(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
}

function cross(a: [number, number], b: [number, number], c: [number, number]): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a: [number, number], b: [number, number], p: [number, number]): boolean {
  return Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1]);
}

function segmentsTouch(p1: [number, number], p2: [number, number], p3: [number, number], p4: [number, number]): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const eps = 1e-6;
  if (Math.abs(d1) < eps && onSegment(p3, p4, p1)) return true;
  if (Math.abs(d2) < eps && onSegment(p3, p4, p2)) return true;
  if (Math.abs(d3) < eps && onSegment(p1, p2, p3)) return true;
  if (Math.abs(d4) < eps && onSegment(p1, p2, p4)) return true;
  return false;
}

/** True when any two non-neighbouring edges of the ring cross or touch. */
export function ringSelfIntersects(ring: [number, number][]): boolean {
  const r = openRing(ring);
  const n = r.length;
  if (n < 4) return false;
  const { pts } = project(r);
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbours share a point
      if (segmentsTouch(a1, a2, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

const inLondon = (lat: number, lng: number) =>
  lat >= GREATER_LONDON.minLat && lat <= GREATER_LONDON.maxLat && lng >= GREATER_LONDON.minLng && lng <= GREATER_LONDON.maxLng;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface NormalisedZoneShape {
  kind: ZoneKind;
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  polygon: [number, number][] | null;
}

export type ZoneShapeCheck = { ok: true; shape: NormalisedZoneShape } | { ok: false; error: string };

/** Validate and normalise a zone shape. Errors are plain English, shown to users. */
export function validateZoneShape(shape: ZoneShapeInput): ZoneShapeCheck {
  if (shape.kind === "circle") {
    const { centerLat: lat, centerLng: lng, radiusM: r } = shape;
    if (!finite(lat) || !finite(lng)) return { ok: false, error: "Pick a centre for the circle" };
    if (!inLondon(lat, lng)) return { ok: false, error: "Keep the zone inside Greater London" };
    if (!finite(r) || r < ZONE_RADIUS_MIN || r > ZONE_RADIUS_MAX) {
      return { ok: false, error: `The radius must be between ${ZONE_RADIUS_MIN} m and ${ZONE_RADIUS_MAX / 1000} km` };
    }
    return { ok: true, shape: { kind: "circle", centerLat: round6(lat), centerLng: round6(lng), radiusM: Math.round(r), polygon: null } };
  }
  if (shape.kind === "polygon") {
    const raw = shape.polygon;
    if (!Array.isArray(raw)) return { ok: false, error: "An outline needs at least 3 points" };
    for (const p of raw) {
      if (!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) return { ok: false, error: "Some points of the outline aren't valid" };
    }
    const ring = openRing(raw.map((p) => [round6(p[0]), round6(p[1])] as [number, number]));
    if (ring.length < 3) return { ok: false, error: "An outline needs at least 3 points" };
    if (ring.length > ZONE_MAX_POINTS) return { ok: false, error: `An outline can have at most ${ZONE_MAX_POINTS} points` };
    if (ring.some(([lng, lat]) => !inLondon(lat, lng))) return { ok: false, error: "Keep the zone inside Greater London" };
    if (ringSelfIntersects(ring)) return { ok: false, error: "The outline crosses itself. Move a point so its edges don't cross." };
    if (ringAreaM2(ring) < ZONE_MIN_AREA_M2) return { ok: false, error: "The outline is too small to measure. Make it bigger." };
    return { ok: true, shape: { kind: "polygon", centerLat: null, centerLng: null, radiusM: null, polygon: ring } };
  }
  return { ok: false, error: "Pick a circle or an outline" };
}

export function validateZoneName(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "Give the zone a name";
  if (name.trim().length > 120) return "Keep the name under 120 characters";
  return null;
}

/** "Circle · 1.04 km across" / "Outline · 8 points" */
export function describeZoneShape(shape: ZoneShapeInput): string {
  if (shape.kind === "circle") {
    const r = shape.radiusM ?? 0;
    return `Circle · ${r >= 1000 ? `${(r / 1000).toFixed(2).replace(/\.?0+$/, "")} km` : `${Math.round(r)} m`} radius`;
  }
  const n = openRing(shape.polygon ?? []).length;
  return `Outline · ${n} ${n === 1 ? "point" : "points"}`;
}

/** "about 2.9 km²" / "about 45,000 m²" */
export function describeArea(m2: number): string {
  if (m2 >= 100_000) return `about ${(m2 / 1_000_000).toFixed(m2 >= 10_000_000 ? 0 : 1)} km²`;
  return `about ${(Math.round(m2 / 1000) * 1000).toLocaleString("en-GB")} m²`;
}

// ── Pair timing (same rule as analyseTrack) ───────────────────────────────────
//
// analyseTrack credits each pair of consecutive points (a → b) inside a shift
// to the first zone that contains point a, when 0 < b.t − a.t ≤ signalGapMin
// (longer pairs are signal gaps or shift breaks and count for nothing). A
// preview keeps only those countable pairs, so any shape can be measured fast.

export interface PairTrack {
  bag: string;
  /** Latitude / longitude of the first point of each countable pair */
  lat: Float64Array;
  lng: Float64Array;
  /** Seconds each pair lasted */
  dt: Float64Array;
}

export function trackPairs(
  bag: string,
  raw: TrackPoint[],
  cfg: Pick<AnalyticsConfig, "shiftBreakMin" | "signalGapMin">,
): PairTrack {
  const pts = spreadLatePoints(sortPoints(raw));
  const maxMs = Math.min(cfg.signalGapMin, cfg.shiftBreakMin) * 60000;
  const lat: number[] = [];
  const lng: number[] = [];
  const dt: number[] = [];
  for (let k = 0; k + 1 < pts.length; k++) {
    const d = pts[k + 1].t - pts[k].t;
    if (d > 0 && d <= maxMs) {
      lat.push(pts[k].lat);
      lng.push(pts[k].lng);
      dt.push(d / 1000);
    }
  }
  return { bag, lat: Float64Array.from(lat), lng: Float64Array.from(lng), dt: Float64Array.from(dt) };
}

export function zoneBounds(z: ZoneShape): { minLat: number; maxLat: number; minLng: number; maxLng: number } | null {
  if (z.kind === "circle") {
    if (z.centerLat == null || z.centerLng == null || !z.radiusM) return null;
    const dLat = (z.radiusM * 1.01) / M_PER_DEG_LAT;
    const dLng = (z.radiusM * 1.01) / mPerDegLng(z.centerLat);
    return { minLat: z.centerLat - dLat, maxLat: z.centerLat + dLat, minLng: z.centerLng - dLng, maxLng: z.centerLng + dLng };
  }
  if (!z.polygon || z.polygon.length < 3) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lng, lat] of z.polygon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

export interface ZonePairMeasure {
  seconds: number;
  bags: number;
  /** Time inside the target shape claimed by a zone listed before it */
  overlap: Map<string, number>;
}

/**
 * Time the target zone records over the given tracks. `zones` is the full,
 * ordered list of counted zones (first match wins), with the target in it.
 */
export function measureZonePairs(tracks: PairTrack[], zones: ZoneShape[], targetId: string): ZonePairMeasure {
  const out: ZonePairMeasure = { seconds: 0, bags: 0, overlap: new Map() };
  const idx = zones.findIndex((z) => z.id === targetId);
  if (idx < 0) return out;
  const target = zones[idx];
  const earlier = zones.slice(0, idx);
  const box = zoneBounds(target);
  if (!box) return out;
  const bags = new Set<string>();
  for (const t of tracks) {
    let hit = false;
    for (let i = 0; i < t.dt.length; i++) {
      const la = t.lat[i];
      const ln = t.lng[i];
      if (la < box.minLat || la > box.maxLat || ln < box.minLng || ln > box.maxLng) continue;
      if (!pointInZone(la, ln, target)) continue;
      const first = earlier.length ? zoneAt(la, ln, earlier) : null;
      if (first) out.overlap.set(first.id, (out.overlap.get(first.id) ?? 0) + t.dt[i]);
      else {
        out.seconds += t.dt[i];
        hit = true;
      }
    }
    if (hit) bags.add(t.bag);
  }
  out.bags = bags.size;
  return out;
}
