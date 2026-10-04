// Pure track analytics: shifts, signal gaps, stops, distance, time in zones.
// Used by the API to build bag days, payroll, rider performance and exports.
//
// Definitions (all configurable in Settings):
//   shift        a run of GPS points with no gap longer than shiftBreakMin
//   signal gap   a gap between signalGapMin and shiftBreakMin inside a shift
//                (the bag was on but sent no location)
//   stop         stayed within stopRadiusM of one point for stopMin or more
//   moving time  shift time minus stops minus signal gaps (= paid time by default)

import { haversineMeters, zoneAt, type ZoneShape } from "./geo";

export interface TrackPoint {
  /** epoch ms (UTC) */
  t: number;
  lat: number;
  lng: number;
  /** order within identical timestamps (late batch uploads) */
  seq?: number;
  late?: boolean;
}

export interface AnalyticsConfig {
  shiftBreakMin: number;
  signalGapMin: number;
  stopRadiusM: number;
  stopMin: number;
  /** ignore distance for implausible jumps (m/s) */
  maxSpeedMs: number;
}

export const DEFAULT_ANALYTICS: AnalyticsConfig = {
  shiftBreakMin: 45,
  signalGapMin: 5,
  stopRadiusM: 50,
  stopMin: 15,
  maxSpeedMs: 25,
};

export interface Interval {
  start: number;
  end: number;
}

export interface StopWindow extends Interval {
  lat: number;
  lng: number;
  seconds: number;
}

export interface GapWindow extends Interval {
  seconds: number;
  from: [number, number];
  to: [number, number];
}

export interface ShiftStats extends Interval {
  points: number;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  zoneSeconds: Record<string, number>;
}

export type TimelineKind = "moving" | "stopped" | "gap";

export interface TimelinePiece extends Interval {
  kind: TimelineKind;
}

export interface ZoneSegment extends Interval {
  zoneId: string | null;
}

export interface TrackAnalytics {
  points: number;
  late: number;
  first: number | null;
  last: number | null;
  shifts: ShiftStats[];
  stops: StopWindow[];
  gaps: GapWindow[];
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  zoneSeconds: Record<string, number>;
  zoneSegments: ZoneSegment[];
  timeline: TimelinePiece[];
}

export function sortPoints(points: TrackPoint[]): TrackPoint[] {
  return points.slice().sort((a, b) => a.t - b.t || (a.seq ?? 0) - (b.seq ?? 0));
}

/** How often a bag records a GPS fix (Colorlight's default, and every bag's setting today). */
export const GPS_INTERVAL_MS = 30_000;

/**
 * Bags buffer points while they have no signal and upload them together, all
 * stamped with the upload time. Place each such batch back in time and mark the
 * points as late:
 * - across the gap before it when the gap is short enough for the batch to have
 *   filled it (one fix per GPS interval);
 * - otherwise ending at the upload, one fix per GPS interval. A bag only keeps its
 *   last few minutes of fixes while offline (batches top out at 30 points, about
 *   15 minutes), and measured batches sit next to the first fix after the gap, not
 *   the last one before it. Spreading a few points across a long gap would invent
 *   hours of movement (and pay), so the rest of the gap stays a gap.
 */
export function spreadLatePoints(sorted: TrackPoint[], intervalMs = GPS_INTERVAL_MS): TrackPoint[] {
  const out: TrackPoint[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].t === sorted[i].t) j++;
    const n = j - i + 1;
    if (n === 1) {
      out.push(sorted[i]);
    } else {
      const t = sorted[i].t;
      const gap = out.length ? t - out[out.length - 1].t : Infinity;
      const span = Math.min(Math.max(gap, n * 1000), n * intervalMs);
      for (let k = 0; k < n; k++) {
        out.push({ ...sorted[i + k], t: Math.round(t - span + ((k + 1) * span) / n), late: true });
      }
    }
    i = j + 1;
  }
  return out;
}

function dist(a: TrackPoint, b: TrackPoint) {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

function findStops(pts: TrackPoint[], cfg: AnalyticsConfig): StopWindow[] {
  const out: StopWindow[] = [];
  const minMs = cfg.stopMin * 60000;
  let i = 0;
  while (i < pts.length) {
    let j = i;
    while (j + 1 < pts.length && dist(pts[i], pts[j + 1]) <= cfg.stopRadiusM) j++;
    if (pts[j].t - pts[i].t >= minMs) {
      out.push({
        start: pts[i].t,
        end: pts[j].t,
        lat: pts[i].lat,
        lng: pts[i].lng,
        seconds: (pts[j].t - pts[i].t) / 1000,
      });
      i = j + 1;
    } else {
      i++;
    }
  }
  return out;
}

function overlap(a: Interval, b: Interval) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

function analyseShift(pts: TrackPoint[], zones: ZoneShape[], cfg: AnalyticsConfig) {
  const gapMs = cfg.signalGapMin * 60000;
  const stops = findStops(pts, cfg);
  const gaps: GapWindow[] = [];
  let meters = 0;
  const zoneSeconds: Record<string, number> = {};
  const zoneSegments: ZoneSegment[] = [];

  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const dt = b.t - a.t;
    if (dt > gapMs) {
      gaps.push({ start: a.t, end: b.t, seconds: dt / 1000, from: [a.lng, a.lat], to: [b.lng, b.lat] });
      continue;
    }
    if (dt <= 0) continue;
    const d = dist(a, b);
    if (d / (dt / 1000) <= cfg.maxSpeedMs) meters += d;
    const z = zones.length ? zoneAt(a.lat, a.lng, zones) : null;
    const zid = z ? z.id : null;
    if (zid) zoneSeconds[zid] = (zoneSeconds[zid] ?? 0) + dt / 1000;
    const last = zoneSegments[zoneSegments.length - 1];
    if (last && last.zoneId === zid && last.end === a.t) last.end = b.t;
    else zoneSegments.push({ zoneId: zid, start: a.t, end: b.t });
  }

  const start = pts[0].t;
  const end = pts[pts.length - 1].t;
  const onMs = end - start;
  const stoppedMs = stops.reduce((s, x) => s + (x.end - x.start), 0);
  // A gap inside a stop is part of the stop, not extra unknown time.
  const gapMsTotal = gaps.reduce((s, g) => s + (g.end - g.start) - stops.reduce((o, st) => o + overlap(g, st), 0), 0);
  const movingMs = Math.max(0, onMs - stoppedMs - gapMsTotal);

  // Timeline pieces: stops win over gaps; the rest is moving.
  const marks: TimelinePiece[] = [
    ...stops.map((s) => ({ kind: "stopped" as const, start: s.start, end: s.end })),
    ...gaps.map((g) => ({ kind: "gap" as const, start: g.start, end: g.end })),
  ].sort((a, b) => a.start - b.start || (a.kind === "stopped" ? -1 : 1));
  const timeline: TimelinePiece[] = [];
  let cursor = start;
  for (const m of marks) {
    const s = Math.max(m.start, cursor);
    if (m.end <= s) continue;
    if (s > cursor) timeline.push({ kind: "moving", start: cursor, end: s });
    timeline.push({ kind: m.kind, start: s, end: m.end });
    cursor = m.end;
  }
  if (cursor < end) timeline.push({ kind: "moving", start: cursor, end });

  return {
    stats: {
      start,
      end,
      points: pts.length,
      onSeconds: onMs / 1000,
      movingSeconds: movingMs / 1000,
      stoppedSeconds: stoppedMs / 1000,
      gapSeconds: gapMsTotal / 1000,
      km: meters / 1000,
      zoneSeconds,
    } satisfies ShiftStats,
    stops,
    gaps,
    timeline,
    zoneSegments,
  };
}

export function analyseTrack(
  rawPoints: TrackPoint[],
  zones: ZoneShape[] = [],
  cfg: AnalyticsConfig = DEFAULT_ANALYTICS,
): TrackAnalytics {
  const pts = spreadLatePoints(sortPoints(rawPoints));
  const result: TrackAnalytics = {
    points: pts.length,
    late: pts.filter((p) => p.late).length,
    first: pts.length ? pts[0].t : null,
    last: pts.length ? pts[pts.length - 1].t : null,
    shifts: [],
    stops: [],
    gaps: [],
    onSeconds: 0,
    movingSeconds: 0,
    stoppedSeconds: 0,
    gapSeconds: 0,
    km: 0,
    zoneSeconds: {},
    zoneSegments: [],
    timeline: [],
  };
  if (!pts.length) return result;

  const breakMs = cfg.shiftBreakMin * 60000;
  let startIdx = 0;
  for (let i = 1; i <= pts.length; i++) {
    if (i === pts.length || pts[i].t - pts[i - 1].t > breakMs) {
      const shiftPts = pts.slice(startIdx, i);
      if (shiftPts.length >= 2) {
        const a = analyseShift(shiftPts, zones, cfg);
        result.shifts.push(a.stats);
        result.stops.push(...a.stops);
        result.gaps.push(...a.gaps);
        result.timeline.push(...a.timeline);
        result.zoneSegments.push(...a.zoneSegments);
        result.onSeconds += a.stats.onSeconds;
        result.movingSeconds += a.stats.movingSeconds;
        result.stoppedSeconds += a.stats.stoppedSeconds;
        result.gapSeconds += a.stats.gapSeconds;
        result.km += a.stats.km;
        for (const [z, s] of Object.entries(a.stats.zoneSeconds)) result.zoneSeconds[z] = (result.zoneSeconds[z] ?? 0) + s;
      }
      startIdx = i;
    }
  }
  return result;
}

/** Paid seconds for a shift under the pay rules. */
export function paidSeconds(s: Pick<ShiftStats, "movingSeconds" | "gapSeconds">, paySignalGaps: boolean): number {
  return s.movingSeconds + (paySignalGaps ? s.gapSeconds : 0);
}
