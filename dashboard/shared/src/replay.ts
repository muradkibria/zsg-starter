// Replaying a route. The bag moves along the route's line, straight from one GPS
// fix to the next, at the pace the fixes give, eased over about 45 seconds of the
// day so it glides through changes of speed, and into and out of stops, instead of
// lurching at every fix. Between pieces of track (no signal) it waits at the last fix.

import type { RouteResponse } from "./api";

export interface ReplayPoint {
  lng: number;
  lat: number;
  /** True between two pieces of track: no signal, so this is the last fix before it */
  noSignal: boolean;
}

interface Piece {
  coords: [number, number][];
  /** Metres along `coords` at each of its points */
  along: number[];
  /** First and last moment (epoch s) */
  t0: number;
  t1: number;
  /** Metres along at t0, t0 + step, t0 + 2·step, … (eased) */
  s: Float64Array;
  step: number;
}

export interface ReplayTrack {
  pieces: Piece[];
  /** First and last fix (epoch ms), or null when there's nothing to replay */
  span: [number, number] | null;
}

/** Seconds of the day the pace is eased over. */
export const REPLAY_EASE_S = 45;
const MAX_SAMPLES = 50_000;

/** Prepare a route for replay (once per route). */
export function buildReplayTrack(route: Pick<RouteResponse, "segments" | "times">): ReplayTrack {
  const pieces: Piece[] = [];
  route.segments.forEach((coords, k) => {
    const times = route.times?.[k] ?? [];
    if (coords.length >= 2 && coords.length === times.length) pieces.push(toPiece(coords, times));
  });
  const last = pieces[pieces.length - 1];
  return { pieces, span: last ? [pieces[0].t0 * 1000, last.t1 * 1000] : null };
}

function toPiece(coords: [number, number][], times: number[]): Piece {
  const kx = 111320 * Math.cos((coords[0][1] * Math.PI) / 180);
  const along = [0];
  for (let i = 1; i < coords.length; i++) {
    along.push(along[i - 1] + Math.hypot((coords[i][0] - coords[i - 1][0]) * kx, (coords[i][1] - coords[i - 1][1]) * 110540));
  }
  const t = times.slice();
  for (let i = 1; i < t.length; i++) if (t[i] <= t[i - 1]) t[i] = t[i - 1] + 0.001;
  const t0 = t[0];
  const t1 = t[t.length - 1];
  const step = Math.max(1, (t1 - t0) / MAX_SAMPLES);
  const n = Math.floor((t1 - t0) / step) + 1;
  // Distance along over time, a steady pace between points…
  const raw = new Float64Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const at = Math.min(t1, t0 + i * step);
    while (j < t.length - 2 && t[j + 1] < at) j++;
    const f = Math.min(1, Math.max(0, (at - t[j]) / (t[j + 1] - t[j])));
    raw[i] = along[j] + f * (along[j + 1] - along[j]);
  }
  raw[n - 1] = along[along.length - 1];
  // …eased: averaged twice over the window (a triangle), narrowing at the ends so it
  // still starts and finishes exactly, and never going backwards.
  const half = Math.max(1, Math.round(REPLAY_EASE_S / step / 2));
  const s = average(average(raw, half), half);
  for (let i = 1; i < n; i++) if (s[i] < s[i - 1]) s[i] = s[i - 1];
  return { coords, along, t0, t1, s, step };
}

function average(v: Float64Array, half: number): Float64Array {
  const sum = new Float64Array(v.length + 1);
  for (let i = 0; i < v.length; i++) sum[i + 1] = sum[i] + v[i];
  const out = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const h = Math.min(half, i, v.length - 1 - i);
    out[i] = (sum[i + h + 1] - sum[i - h]) / (2 * h + 1);
  }
  return out;
}

/** Metres along the piece at `at` (epoch s). */
function progress(p: Piece, at: number): number {
  if (at <= p.t0) return 0;
  if (at >= p.t1) return p.along[p.along.length - 1];
  const x = (at - p.t0) / p.step;
  const i = Math.min(Math.floor(x), p.s.length - 1);
  const next = p.s[Math.min(i + 1, p.s.length - 1)];
  return p.s[i] + (x - i) * (next - p.s[i]);
}

/** The point `metres` along the piece, and the index of the point just before it. */
function pointAlong(p: Piece, metres: number): { at: [number, number]; k: number } {
  let lo = 0;
  let hi = p.along.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p.along[mid] <= metres) lo = mid;
    else hi = mid - 1;
  }
  const span = p.along[lo + 1] - p.along[lo];
  const f = span > 0 ? Math.min(1, Math.max(0, (metres - p.along[lo]) / span)) : 0;
  const [a, b] = [p.coords[lo], p.coords[lo + 1]];
  return { at: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], k: lo };
}

/** Where the bag was at `atMs` (epoch ms). */
export function replayAt(track: ReplayTrack, atMs: number): ReplayPoint | null {
  const at = atMs / 1000;
  let before: [number, number] | null = null;
  for (const p of track.pieces) {
    if (at < p.t0) {
      const [lng, lat] = before ?? p.coords[0];
      return { lng, lat, noSignal: !!before };
    }
    if (at <= p.t1) {
      const [lng, lat] = pointAlong(p, progress(p, at)).at;
      return { lng, lat, noSignal: false };
    }
    before = p.coords[p.coords.length - 1];
  }
  return before ? { lng: before[0], lat: before[1], noSignal: false } : null;
}

/** The route covered by `atMs`, as pieces of [lng, lat], ending where the bag was then. */
export function replayPathAt(track: ReplayTrack, atMs: number): [number, number][][] {
  const at = atMs / 1000;
  const out: [number, number][][] = [];
  for (const p of track.pieces) {
    if (at < p.t0) break;
    if (at >= p.t1) {
      out.push(p.coords);
      continue;
    }
    const here = pointAlong(p, progress(p, at));
    out.push([...p.coords.slice(0, here.k + 1), here.at]);
    break;
  }
  return out;
}
