// Zone editing support: time-in-zone stats from the bag-day rollups, fast
// previews of a new shape from sampled GPS, a "where bags spend time" grid,
// and recomputing zone time after zones or tracking rules change.

import {
  addDays,
  daysBetween,
  londonDayBounds,
  measureZonePairs,
  todayLondon,
  trackPairs,
  ZONE_PREVIEW_DAYS,
  type NormalisedZoneShape,
  type PairTrack,
  type RecomputeStatus,
  type ZoneDto,
  type ZoneHeatResponse,
  type ZonePreviewResponse,
  type ZoneShape,
  type ZoneStatsResponse,
} from "@digilite/shared";
import { logger } from "../log";
import { ClientResponseError, getAll, getFirst, pb, q, type RecordModel } from "../pb";
import { dirtyDays, getState, markDirty, setState } from "../jobs/state";
import { loadBags } from "./bags";
import { analyticsConfig } from "./settings";
import { computeBagDay, loadPoints } from "./tracks";
import { listZones } from "./zones";

const log = logger("zones");

/** Reads are safe to repeat: try once more if the connection to PocketBase dropped. */
async function retryRead<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ClientResponseError) || err.status !== 0) throw err;
    await new Promise((r) => setTimeout(r, 200));
    return fn();
  }
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>, stop?: () => boolean): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (stop?.()) return;
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ── PocketBase record fields for a validated shape ────────────────────────────
export function shapeFields(shape: NormalisedZoneShape, centroid?: [number, number]): Record<string, unknown> {
  if (shape.kind === "circle") {
    return { kind: "circle", center_lat: shape.centerLat, center_lng: shape.centerLng, radius_m: shape.radiusM, polygon: null };
  }
  // Outlines keep their centre too (handy for labels); radius is not used.
  return { kind: "polygon", center_lat: centroid?.[1] ?? 0, center_lng: centroid?.[0] ?? 0, radius_m: 0, polygon: shape.polygon };
}

export function shapeOf(z: ZoneDto): NormalisedZoneShape {
  return z.kind === "circle"
    ? { kind: "circle", centerLat: z.centerLat, centerLng: z.centerLng, radiusM: z.radiusM, polygon: null }
    : { kind: "polygon", centerLat: null, centerLng: null, radiusM: null, polygon: z.polygon };
}

export function sameShape(a: NormalisedZoneShape, b: NormalisedZoneShape): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "circle") return a.centerLat === b.centerLat && a.centerLng === b.centerLng && a.radiusM === b.radiusM;
  return JSON.stringify(a.polygon) === JSON.stringify(b.polygon);
}

// ── Stats (from bag-day rollups) ──────────────────────────────────────────────
let firstDayCache: { at: number; day: string | null } | null = null;

/** Earliest London day with any stored GPS rollup. */
async function firstDataDay(): Promise<string | null> {
  if (firstDayCache && Date.now() - firstDayCache.at < 10 * 60_000) return firstDayCache.day;
  const row = await getFirst<RecordModel>("bag_days", "points > 0", { sort: "day", fields: "day" });
  firstDayCache = { at: Date.now(), day: (row?.day as string | undefined) ?? null };
  return firstDayCache.day;
}

export async function zoneStats(fromDay: string, toDay: string): Promise<ZoneStatsResponse> {
  const sparkDays = daysBetween(addDays(toDay, -6), toDay);
  const first = fromDay < sparkDays[0] ? fromDay : sparkDays[0];
  const [rows, zones, firstDay] = await Promise.all([
    retryRead(() =>
      getAll<RecordModel>("bag_days", {
        filter: `day >= ${q(first)} && day <= ${q(toDay)} && points > 0`,
        fields: "bag,day,on_seconds,zones",
      }),
    ),
    retryRead(() => listZones({ fresh: true })),
    retryRead(() => firstDataDay()),
  ]);
  const sparkIndex = new Map(sparkDays.map((d, i) => [d, i]));
  const per = new Map(zones.map((z) => [z.id, { seconds: 0, bags: new Set<string>(), daily: sparkDays.map(() => 0) }]));
  const dataDays = new Set<string>();
  const bagsOut = new Set<string>();
  let onSeconds = 0;
  let zoneSeconds = 0;
  for (const r of rows) {
    const inRange = r.day >= fromDay && r.day <= toDay;
    const si = sparkIndex.get(r.day);
    if (inRange) {
      dataDays.add(r.day);
      bagsOut.add(r.bag);
      onSeconds += r.on_seconds ?? 0;
    }
    for (const [zid, sec] of Object.entries((r.zones ?? {}) as Record<string, number>)) {
      const z = per.get(zid);
      if (!z || !(sec > 0)) continue;
      if (inRange) {
        z.seconds += sec;
        z.bags.add(r.bag);
        zoneSeconds += sec;
      }
      if (si !== undefined) z.daily[si] += sec;
    }
  }
  return {
    fromDay,
    toDay,
    days: daysBetween(fromDay, toDay).length,
    daysWithData: dataDays.size,
    sparkDays,
    sparkHasData: sparkDays.map((d) => !!firstDay && d >= firstDay),
    onSeconds: Math.round(onSeconds),
    zoneSeconds: Math.round(zoneSeconds),
    share: onSeconds > 0 ? Math.round((zoneSeconds / onSeconds) * 1000) / 1000 : 0,
    bagsOut: bagsOut.size,
    zones: zones.map((z) => {
      const s = per.get(z.id)!;
      return {
        zoneId: z.id,
        seconds: Math.round(s.seconds),
        bags: s.bags.size,
        share: onSeconds > 0 ? Math.round((s.seconds / onSeconds) * 1000) / 1000 : 0,
        daily: s.daily.map((x) => Math.round(x)),
      };
    }),
    recompute: recomputeStatus(),
    firstDataDay: firstDay,
  };
}

// ── GPS sample for previews (cached) ──────────────────────────────────────────
interface PointWindow {
  key: string;
  fromDay: string;
  toDay: string;
  days: number;
  tracks: PairTrack[];
  bagDays: number;
  capped: boolean;
}

const WINDOW_TTL_MS = 10 * 60_000;
const LOAD_BUDGET_MS = 2200;
const MAX_BAG_DAYS = 700;
const MIN_DAYS = 7;
let windowCache: { key: string; at: number; promise: Promise<PointWindow> } | null = null;

/**
 * Countable GPS pairs for the last 14 London days including today (the same
 * days a saved change recomputes), cached for 10 minutes.
 */
async function pointWindow(): Promise<PointWindow> {
  const cfg = await analyticsConfig();
  const toDay = todayLondon();
  const fromDay = addDays(toDay, -(ZONE_PREVIEW_DAYS - 1));
  const key = `${fromDay}|${toDay}|${cfg.signalGapMin}|${cfg.shiftBreakMin}`;
  if (windowCache && windowCache.key === key && Date.now() - windowCache.at < WINDOW_TTL_MS) return windowCache.promise;
  const promise = loadWindow(key, fromDay, toDay, cfg);
  windowCache = { key, at: Date.now(), promise };
  promise.catch(() => {
    if (windowCache?.promise === promise) windowCache = null;
  });
  return promise;
}

async function loadWindow(
  key: string,
  fromDay: string,
  toDay: string,
  cfg: { signalGapMin: number; shiftBreakMin: number },
): Promise<PointWindow> {
  const started = Date.now();
  const rows = await retryRead(() =>
    getAll<RecordModel>("bag_days", {
      filter: `day >= ${q(fromDay)} && day <= ${q(toDay)} && points > 1`,
      fields: "bag,day",
      sort: "-day,bag",
    }),
  );
  // Newest days first; stop early (keeping at least a week) if it gets slow.
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + 1);
  const days = [...perDay.keys()].sort().reverse();
  let capped = false;
  let planned = rows;
  if (rows.length > MAX_BAG_DAYS) {
    let n = 0;
    const keep = new Set<string>();
    for (const d of days) {
      if (n + perDay.get(d)! > MAX_BAG_DAYS && keep.size >= MIN_DAYS) break;
      keep.add(d);
      n += perDay.get(d)!;
    }
    planned = rows.filter((r) => keep.has(r.day));
    capped = true;
  }
  // Count down each day's bag-days so we know how many whole days are in.
  const left = new Map<string, number>();
  for (const r of planned) left.set(r.day, (left.get(r.day) ?? 0) + 1);
  let wholeDays = 0;
  const results = await mapLimit(
    planned,
    8,
    async (r) => {
      const [from, to] = londonDayBounds(r.day);
      const pairs = trackPairs(r.bag, await retryRead(() => loadPoints(r.bag, from, to)), cfg);
      const n = left.get(r.day)! - 1;
      left.set(r.day, n);
      if (n === 0) wholeDays++;
      return { day: r.day as string, pairs };
    },
    // Past the time budget, stop starting new days once a week is in.
    () => Date.now() - started > LOAD_BUDGET_MS && wholeDays >= MIN_DAYS,
  );
  // Keep only days whose every bag-day loaded.
  const complete = new Map<string, boolean>();
  planned.forEach((r, i) => complete.set(r.day, (complete.get(r.day) ?? true) && !!results[i]));
  const fullDays = [...complete.entries()].filter(([, ok]) => ok).map(([d]) => d).sort();
  if (fullDays.length < complete.size) capped = true;
  const effFrom = capped && fullDays.length ? fullDays[0] : fromDay;
  const tracks = results.filter((x): x is { day: string; pairs: PairTrack } => !!x && x.day >= effFrom).map((x) => x.pairs);
  const w: PointWindow = {
    key,
    fromDay: effFrom,
    toDay,
    days: daysBetween(effFrom, toDay).length,
    tracks,
    bagDays: tracks.length,
    capped,
  };
  log.info(`preview sample: ${w.bagDays} bag-days over ${w.days} days in ${Date.now() - started} ms${capped ? " (capped)" : ""}`);
  return w;
}

/** The ordered list of counted zones with `target` in its place (or last, for a new zone). */
function zonesWith(all: ZoneDto[], target: ZoneShape | null, targetId: string | null): ZoneShape[] {
  const list: ZoneShape[] = [];
  let placed = false;
  for (const z of all) {
    if (targetId && z.id === targetId) {
      if (target) list.push(target);
      placed = true;
    } else if (z.active) list.push(z);
  }
  if (!placed && target) list.push(target);
  return list;
}

export async function previewZone(zoneId: string | null, shape: NormalisedZoneShape): Promise<ZonePreviewResponse> {
  const started = Date.now();
  const [w, all] = await Promise.all([pointWindow(), listZones({ fresh: true })]);
  const existing = zoneId ? all.find((z) => z.id === zoneId) ?? null : null;
  const id = existing?.id ?? "__new__";
  const name = existing?.name ?? "New zone";
  const candidate: ZoneShape = { id, name, ...shape };
  const m = measureZonePairs(w.tracks, zonesWith(all, candidate, existing?.id ?? null), id);
  let current = null;
  if (existing) {
    const saved: ZoneShape = { ...existing, ...shapeOf(existing) };
    const c = measureZonePairs(w.tracks, zonesWith(all, saved, existing.id), existing.id);
    current = { seconds: Math.round(c.seconds), bags: c.bags };
  }
  const names = new Map(all.map((z) => [z.id, z.name]));
  return {
    fromDay: w.fromDay,
    toDay: w.toDay,
    days: w.days,
    bagDays: w.bagDays,
    capped: w.capped,
    shape: { seconds: Math.round(m.seconds), bags: m.bags },
    overlap: [...m.overlap.entries()]
      .map(([zid, seconds]) => ({ zoneId: zid, name: names.get(zid) ?? "Another zone", seconds: Math.round(seconds) }))
      .filter((o) => o.seconds >= 60)
      .sort((a, b) => b.seconds - a.seconds),
    current,
    ms: Date.now() - started,
  };
}

// ── Where bags spend time (for drawing zones in the right places) ─────────────
const CELL_LAT = 0.00135; // ≈ 150 m
const CELL_LNG = 0.00216; // ≈ 150 m at London's latitude
const GX_OFFSET = 500_000;
let heatCache: { key: string; body: ZoneHeatResponse } | null = null;

export async function zoneHeat(): Promise<ZoneHeatResponse> {
  const w = await pointWindow();
  if (heatCache?.key === w.key) return heatCache.body;
  const grid = new Map<number, number>();
  for (const t of w.tracks) {
    for (let i = 0; i < t.dt.length; i++) {
      const gy = Math.floor(t.lat[i] / CELL_LAT);
      const gx = Math.floor(t.lng[i] / CELL_LNG) + GX_OFFSET; // keep west-of-Greenwich cells positive
      const k = gy * 1_000_000 + gx;
      grid.set(k, (grid.get(k) ?? 0) + t.dt[i]);
    }
  }
  const cells: [number, number, number][] = [];
  let max = 0;
  for (const [k, s] of grid) {
    if (s < 120) continue; // under two minutes in 14 days: noise
    const gy = Math.floor(k / 1_000_000);
    const gx = k - gy * 1_000_000 - GX_OFFSET;
    const lat = (gy + 0.5) * CELL_LAT;
    const lng = (gx + 0.5) * CELL_LNG;
    cells.push([Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5, Math.round(s)]);
    if (s > max) max = s;
  }
  cells.sort((a, b) => b[2] - a[2]);
  const body: ZoneHeatResponse = { fromDay: w.fromDay, toDay: w.toDay, cells: cells.slice(0, 6000), maxSeconds: Math.round(max) };
  heatCache = { key: w.key, body };
  return body;
}

// ── Recompute zone time / tracking after a change ─────────────────────────────
const RESUME_KEY = "zones:recompute";
interface RecomputeJob {
  reason: string;
  fromDay: string;
  toDay: string;
  keys: string[];
  cursor: number;
  startedAt: number;
  finishedAt: number | null;
}

let job: RecomputeJob | null = null;
const inFlight = new Set<string>();
let draining = false;

/**
 * Mark every stored bag-day of the last `days` London days as dirty so the
 * rollups (routes, hours, zone time) are worked out again, and start working
 * through them straight away rather than waiting for the minute-by-minute job.
 */
export async function recomputeRecent(days: number, reason: string): Promise<RecomputeStatus> {
  const toDay = todayLondon();
  const fromDay = addDays(toDay, -(days - 1));
  const rows = await getAll<RecordModel>("bag_days", {
    filter: `day >= ${q(fromDay)} && day <= ${q(toDay)} && points > 0`,
    fields: "bag,day",
    sort: "-day",
  });
  const keys = new Set<string>();
  for (const r of rows) {
    markDirty(r.bag, r.day);
    keys.add(`${r.bag}|${r.day}`);
  }
  // Anything still waiting from an earlier change stays in the new job.
  if (job && !job.finishedAt) for (const k of job.keys) if (dirtyDays.has(k) || inFlight.has(k)) keys.add(k);
  job = {
    reason,
    fromDay: job && !job.finishedAt && job.fromDay < fromDay ? job.fromDay : fromDay,
    toDay,
    keys: [...keys],
    cursor: 0,
    startedAt: Date.now(),
    finishedAt: null,
  };
  // Remember it, so a restart part-way through picks it up again (the dirty list lives in memory).
  await setState(RESUME_KEY, { reason, fromDay: job.fromDay }).catch(() => {});
  void drain();
  return recomputeStatus()!;
}

function nextKey(): string | null {
  while (job && job.cursor < job.keys.length) {
    const k = job.keys[job.cursor++];
    if (dirtyDays.has(k)) return k;
  }
  return null;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const bags = new Map((await loadBags({ fresh: true })).map((b) => [b.id, b]));
    const worker = async () => {
      for (let k = nextKey(); k; k = nextKey()) {
        dirtyDays.delete(k);
        inFlight.add(k);
        const [bagId, day] = k.split("|");
        try {
          const bag = bags.get(bagId);
          if (bag) await computeBagDay(bag, day);
        } catch (err) {
          markDirty(bagId, day); // the rollup job will retry it
          log.warn(`recompute of one bag-day failed: ${(err as Error).message}`);
        } finally {
          inFlight.delete(k);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } finally {
    draining = false;
  }
  if (job && job.cursor < job.keys.length) return void drain(); // a new change arrived meanwhile
  if (job && !job.keys.some((k) => dirtyDays.has(k) || inFlight.has(k))) {
    job.finishedAt ??= Date.now();
    await setState(RESUME_KEY, null).catch(() => {});
    log.info(`recompute finished: ${job.keys.length} bag-days (${job.reason})`);
  }
}

export function recomputeStatus(): RecomputeStatus | null {
  if (!job) return null;
  const remaining = job.keys.filter((k) => dirtyDays.has(k) || inFlight.has(k)).length;
  if (remaining === 0 && !job.finishedAt && !draining) {
    job.finishedAt = Date.now();
    void setState(RESUME_KEY, null).catch(() => {});
  }
  if (job.finishedAt && Date.now() - job.finishedAt > 2 * 60_000) return null;
  return {
    reason: job.reason,
    fromDay: job.fromDay,
    toDay: job.toDay,
    total: job.keys.length,
    remaining,
    startedAt: new Date(job.startedAt).toISOString(),
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
  };
}

/** Forget cached samples (after tracking rules change). */
export function invalidatePreviewCache() {
  windowCache = null;
  heatCache = null;
}

/** After a restart, carry on with a recompute that was cut short. */
async function resumeRecompute(): Promise<void> {
  const saved = await getState<{ reason: string; fromDay: string } | null>(RESUME_KEY);
  if (!saved?.fromDay) return;
  const days = Math.min(31, daysBetween(saved.fromDay, todayLondon()).length);
  if (days < 1) return void (await setState(RESUME_KEY, null));
  log.info(`resuming an unfinished recompute of the last ${days} days (${saved.reason})`);
  await recomputeRecent(days, saved.reason);
}

function scheduleResume(attempt = 0) {
  const t = setTimeout(() => {
    if (!pb.authStore.isValid) return attempt < 60 ? scheduleResume(attempt + 1) : undefined;
    resumeRecompute().catch((err) => log.warn(`could not resume a recompute: ${(err as Error).message}`));
  }, 3000);
  t.unref?.();
}

if (!process.env.VITEST) scheduleResume();
