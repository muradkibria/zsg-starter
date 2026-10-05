// Geometry helpers shared by the API (analytics) and the web app (map).

export interface LatLng {
  lat: number;
  lng: number;
}

const R = 6371000;
const toRad = (x: number) => (x * Math.PI) / 180;

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ray-casting point-in-polygon. `ring` is [[lng, lat], ...] (GeoJSON order). */
export function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface ZoneShape {
  id: string;
  name: string;
  kind: "circle" | "polygon";
  centerLat?: number | null;
  centerLng?: number | null;
  radiusM?: number | null;
  /** GeoJSON-style ring: [[lng, lat], ...] */
  polygon?: [number, number][] | null;
}

export function pointInZone(lat: number, lng: number, z: ZoneShape): boolean {
  if (z.kind === "circle") {
    if (z.centerLat == null || z.centerLng == null || !z.radiusM) return false;
    return haversineMeters(lat, lng, z.centerLat, z.centerLng) <= z.radiusM;
  }
  return !!z.polygon && z.polygon.length >= 3 && pointInRing(lat, lng, z.polygon);
}

/** First matching zone (zones are expected not to overlap much; first wins). */
export function zoneAt(lat: number, lng: number, zones: ZoneShape[]): ZoneShape | null {
  for (const z of zones) if (pointInZone(lat, lng, z)) return z;
  return null;
}

/** Polygon approximation of a circle zone, for drawing. Returns [lng, lat][] closed ring. */
export function circleRing(lat: number, lng: number, radiusM: number, steps = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(toRad(lat)));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification on [lng, lat] coordinates; tolerance in metres. */
export function simplifyLine(coords: [number, number][], toleranceM: number): [number, number][] {
  if (coords.length <= 2) return coords.slice();
  const lat0 = coords[0][1];
  const kx = 111320 * Math.cos(toRad(lat0));
  const ky = 110540;
  const pts = coords.map(([lng, lat]) => [lng * kx, lat * ky] as [number, number]);
  const keep = new Uint8Array(coords.length);
  keep[0] = keep[coords.length - 1] = 1;
  const stack: [number, number][] = [[0, coords.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-12;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

/**
 * Simplify a timed track, keeping its timing: Ramer–Douglas–Peucker on the
 * synchronised distance (how far each fix is from where a steady pace between the
 * kept fixes would put it at that moment). So a bag stopped halfway along a
 * straight road keeps that stop, which plain RDP would drop. Spatially the result
 * is still within `toleranceM` of every fix. Returns the indexes kept.
 */
export function simplifyTrack(points: { lng: number; lat: number; t: number }[], toleranceM: number): number[] {
  const n = points.length;
  if (n <= 2) return points.map((_, i) => i);
  const kx = 111320 * Math.cos(toRad(points[0].lat));
  const ky = 110540;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a];
    const pb = points[b];
    const dt = pb.t - pa.t;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const f = dt > 0 ? (p.t - pa.t) / dt : 0;
      const ex = (pa.lng + f * (pb.lng - pa.lng) - p.lng) * kx;
      const ey = (pa.lat + f * (pb.lat - pa.lat) - p.lat) * ky;
      const d2 = ex * ex + ey * ey;
      if (d2 > maxD) {
        maxD = d2;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

export function bbox(coords: [number, number][]): [number, number, number, number] | null {
  if (!coords.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}
