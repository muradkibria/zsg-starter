// The zone being edited ("draft") and the small geometry the editor needs.

import {
  circleRing,
  circleToRing,
  clampRadius,
  haversineMeters,
  offsetLngLat,
  openRing,
  ringSelfIntersects,
  ringToCircle,
  type ZoneDto,
  type ZoneShapeInput,
  type ZoneType,
} from "@digilite/shared";

export interface ShapeState {
  kind: "circle" | "polygon";
  /** Circle centre as [lng, lat] */
  center: [number, number];
  radiusM: number;
  /** Outline as [lng, lat] points (open ring) */
  ring: [number, number][];
}

export interface Draft extends ShapeState {
  /** null for a zone that hasn't been saved yet */
  id: string | null;
  name: string;
  type: ZoneType;
  active: boolean;
}

export function shapeOfZone(z: ZoneDto): ShapeState {
  if (z.kind === "circle") {
    return { kind: "circle", center: [z.centerLng ?? 0, z.centerLat ?? 0], radiusM: z.radiusM ?? 500, ring: [] };
  }
  const ring = openRing(z.polygon ?? []);
  const c = ring.length >= 3 ? ringToCircle(ring) : { centerLat: z.centerLat ?? 0, centerLng: z.centerLng ?? 0, radiusM: 500 };
  return { kind: "polygon", center: [c.centerLng, c.centerLat], radiusM: c.radiusM, ring };
}

export function draftFromZone(z: ZoneDto): Draft {
  return { id: z.id, name: z.name, type: z.type, active: z.active, ...shapeOfZone(z) };
}

export function newDraft(kind: "circle" | "polygon", center: [number, number]): Draft {
  return { id: null, name: "", type: "neighbourhood", active: true, kind, center, radiusM: 500, ring: [] };
}

export function toShapeInput(s: ShapeState): ZoneShapeInput {
  return s.kind === "circle"
    ? { kind: "circle", centerLat: round6(s.center[1]), centerLng: round6(s.center[0]), radiusM: Math.round(s.radiusM) }
    : { kind: "polygon", polygon: s.ring.map(([x, y]) => [round6(x), round6(y)] as [number, number]) };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function shapeKey(s: ShapeState): string {
  return JSON.stringify(toShapeInput(s));
}

export function isDirty(d: Draft, z: ZoneDto | null): boolean {
  if (!z) return true;
  return d.name.trim() !== z.name || d.type !== z.type || d.active !== z.active || shapeKey(d) !== shapeKey(shapeOfZone(z));
}

/** Switch between a circle and an outline, keeping roughly the same area. */
export function switchKind(s: ShapeState, kind: "circle" | "polygon"): ShapeState {
  if (kind === s.kind) return s;
  if (kind === "polygon") return { ...s, kind, ring: circleToRing(s.center[1], s.center[0], s.radiusM, 8) };
  if (s.ring.length >= 3) {
    const c = ringToCircle(s.ring);
    return { ...s, kind, center: [c.centerLng, c.centerLat], radiusM: c.radiusM };
  }
  return { ...s, kind };
}

/** The outline to draw for a shape ([lng, lat], closed for polygons with 3+ points). */
export function drawRing(s: ShapeState): [number, number][] {
  if (s.kind === "circle") return circleRing(s.center[1], s.center[0], s.radiusM);
  return s.ring.length >= 3 ? [...s.ring, s.ring[0]] : s.ring;
}

// Local flat projection in metres around London (accurate enough for picking edges).
const KX = 111320 * Math.cos((51.5 * Math.PI) / 180);
const KY = 110540;
const xy = ([lng, lat]: [number, number]) => [lng * KX, lat * KY] as const;

function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const [px, py] = xy(p);
  const [ax, ay] = xy(a);
  const [bx, by] = xy(b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

/**
 * Add a point to an outline where it fits best: on the nearest edge whose
 * split doesn't make the outline cross itself. Returns the new ring and the
 * index of the added point.
 */
export function insertPoint(ring: [number, number][], p: [number, number]): { ring: [number, number][]; index: number } {
  if (ring.length < 3) return { ring: [...ring, p], index: ring.length };
  const edges = ring.map((a, i) => ({ i, d: distToSegment(p, a, ring[(i + 1) % ring.length]) })).sort((x, y) => x.d - y.d);
  for (const { i } of edges) {
    const next = [...ring.slice(0, i + 1), p, ...ring.slice(i + 1)];
    if (!ringSelfIntersects(next)) return { ring: next, index: i + 1 };
  }
  const i = edges[0].i;
  return { ring: [...ring.slice(0, i + 1), p, ...ring.slice(i + 1)], index: i + 1 };
}

export function midpoints(ring: [number, number][]): [number, number][] {
  if (ring.length < 2) return [];
  const n = ring.length >= 3 ? ring.length : 1;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  return out;
}

/** Where to put the radius handle: on the circle's edge at the given angle (radians, 0 = east). */
export function edgePoint(s: ShapeState, angle: number): [number, number] {
  return offsetLngLat(s.center[0], s.center[1], s.radiusM * Math.cos(angle), s.radiusM * Math.sin(angle));
}

export function radiusTo(s: ShapeState, p: [number, number]): { radiusM: number; angle: number } {
  const r = haversineMeters(s.center[1], s.center[0], p[1], p[0]);
  const [cx, cy] = xy(s.center);
  const [px, py] = xy(p);
  return { radiusM: clampRadius(r), angle: Math.atan2(py - cy, px - cx) };
}

export function nudge(p: [number, number], key: string, stepM: number): [number, number] | null {
  const d: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const v = d[key];
  return v ? offsetLngLat(p[0], p[1], v[0] * stepM, v[1] * stepM) : null;
}
