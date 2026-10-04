// Colorlight sync: live positions (one call for all active bags) and full GPS
// tracks, recorded in `gps_points`, plus catching up on recent days after a start.

import { addDays, londonDay, parseColorlightTime, toColorlightTime, todayLondon } from "@digilite/shared";
import { latestGps, track } from "../client";
import type { ClTrackPoint } from "../types";
import { invalidateBags, loadBags } from "../../domain/bags";
import { publish } from "../../events";
import { logger } from "../../log";
import { batchUpsert, pb, pbDate, parsePbDate, stableId, type RecordModel } from "../../pb";
import { config } from "../../config";
import { getState, health, markDirty, markOk, setState } from "../../jobs/state";

const log = logger("colorlight:gps");

const recentMs = (b: RecordModel, ms: number) => {
  const t = parsePbDate(b.last_report_at)?.getTime();
  return !!t && Date.now() - t <= ms;
};

// ── Live positions ────────────────────────────────────────────────────────────

export async function syncLivePositions(): Promise<void> {
  const bags = (await loadBags()).filter((b) => recentMs(b, 15 * 60000));
  if (!bags.length) return markOk("lastGpsSync");
  const byCl = new Map(bags.map((b) => [b.colorlight_id as number, b]));
  const fixes = await latestGps([...byCl.keys()]);
  const batch = pb.createBatch();
  const changed: string[] = [];
  for (const f of fixes) {
    const bag = byCl.get(f.terminalId);
    const t = parseColorlightTime(f.serverTime);
    if (!bag || !t || f.latitude == null || f.longitude == null) continue;
    const prev = parsePbDate(bag.last_gps_at)?.getTime() ?? 0;
    if (t.getTime() <= prev) continue;
    batch.collection("bags").update(bag.id, {
      lat: f.latitude,
      lng: f.longitude,
      speed: f.speed ?? null,
      heading: f.direct ?? null,
      last_gps_at: pbDate(t),
    });
    changed.push(bag.id);
  }
  if (changed.length) {
    await batch.send();
    invalidateBags();
    publish({ type: "bags.positions", bagIds: changed });
  }
  markOk("lastGpsSync");
}

// ── Track copy ────────────────────────────────────────────────────────────────

/** Turn a Colorlight track response into gps_points rows (stable ids → idempotent). */
export function trackRows(bagId: string, data: ClTrackPoint[]): Record<string, unknown>[] {
  const seqByTs = new Map<string, number>();
  const count = new Map<string, number>();
  for (const p of data) count.set(p.serverTime, (count.get(p.serverTime) ?? 0) + 1);
  const rows: Record<string, unknown>[] = [];
  for (const p of data) {
    const t = parseColorlightTime(p.serverTime);
    if (!t || p.latitude == null || p.longitude == null || (p.latitude === 0 && p.longitude === 0)) continue;
    const seq = seqByTs.get(p.serverTime) ?? 0;
    seqByTs.set(p.serverTime, seq + 1);
    const k = `${bagId}|${p.serverTime}|${seq}`;
    rows.push({
      id: stableId(`gps:${k}`),
      bag: bagId,
      ts: pbDate(t),
      seq,
      lat: p.latitude,
      lng: p.longitude,
      late: (count.get(p.serverTime) ?? 1) > 1,
      k: k.slice(0, 80),
    });
  }
  return rows;
}

/** Mark the London days these rows fall on for recomputing. */
export function markTrackDays(bagId: string, rows: Record<string, unknown>[]): void {
  const days = new Set<string>();
  for (const r of rows) days.add(londonDay(parsePbDate(r.ts as string)!));
  for (const d of days) markDirty(bagId, d);
}

/** UTC-day windows covering [from, to] (Colorlight tracks are queried per day). */
function utcDayWindows(from: Date, to: Date): [Date, Date][] {
  const out: [Date, Date][] = [];
  let s = new Date(from);
  while (s < to) {
    const dayEnd = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate(), 23, 59, 59));
    const e = dayEnd < to ? dayEnd : to;
    out.push([s, e]);
    s = new Date(dayEnd.getTime() + 1000);
  }
  return out;
}

export async function copyTrack(bag: RecordModel, from: Date, to: Date): Promise<{ points: number; last: Date | null }> {
  let points = 0;
  let last: Date | null = null;
  for (const [s, e] of utcDayWindows(from, to)) {
    const res = await track(bag.colorlight_id, toColorlightTime(s), toColorlightTime(e));
    const rows = trackRows(bag.id, res.data);
    if (!rows.length) continue;
    await batchUpsert("gps_points", rows);
    points += rows.length;
    markTrackDays(bag.id, rows);
    for (const r of rows) {
      const t = parsePbDate(r.ts as string)!;
      if (!last || t > last) last = t;
    }
  }
  return { points, last };
}

/**
 * Every bag that has reported since its track was last recorded, from there to
 * now. Driven by each bag's own cursor rather than "on right now", so time the
 * server was down (a restart, a deploy) is filled in even for a bag that has gone
 * offline since. Colorlight stamps points when it receives them, so a window that
 * has passed won't gain points later and the cursor can move past it.
 */
/** The window of track to ask for next, or null when the bag hasn't reported since. Times in ms. */
export function trackWindow(lastReport: number, until: number | null, now: number): { since: number; to: number } | null {
  if (until !== null && lastReport <= until) return null;
  const since = until !== null ? until - 10 * 60000 : now - 6 * 3600000;
  // A few days per run, so one long gap can't hold up the rest of the fleet.
  const to = Math.min(now - 60000, since + 3 * 86400000);
  return to > since ? { since, to } : null;
}

export async function syncTracks(): Promise<void> {
  const now = Date.now();
  const touched: string[] = [];
  for (const bag of await loadBags()) {
    const lastReport = parsePbDate(bag.last_report_at)?.getTime();
    if (!lastReport) continue;
    const cursor = await getState<{ until: string }>(`track:${bag.id}`);
    const w = trackWindow(lastReport, cursor ? Date.parse(cursor.until) : null, now);
    if (!w) continue;
    const { points, last } = await copyTrack(bag, new Date(w.since), new Date(w.to));
    await setState(`track:${bag.id}`, { until: new Date(Math.max(w.to, last?.getTime() ?? 0)).toISOString() });
    if (points) touched.push(bag.id);
  }
  if (touched.length) publish({ type: "tracks.updated", bagIds: touched });
  markOk("lastTrackSync");
}

/** One-off copy of the last N days for every bag seen in that period. Resumable. */
export async function backfillTracks(): Promise<void> {
  const days = config.SYNC_BACKFILL_DAYS;
  const today = todayLondon();
  const firstDay = addDays(today, -days);
  const cutoff = Date.now() - (days + 1) * 86400000;
  const bags = (await loadBags()).filter((b) => (parsePbDate(b.last_report_at)?.getTime() ?? 0) >= cutoff);
  let doneBags = 0;
  health.backfill = { done: false, note: `Copying ${days} days of routes for ${bags.length} bags` };
  const queue = [...bags];
  const worker = async () => {
    for (let bag = queue.shift(); bag; bag = queue.shift()) {
      const state = await getState<{ done: boolean; from: string }>(`backfill:${bag.id}`);
      if (state?.done && state.from <= firstDay) {
        doneBags++;
        continue;
      }
      const from = new Date(`${firstDay}T00:00:00Z`);
      from.setUTCHours(from.getUTCHours() - 1);
      try {
        const { points, last } = await copyTrack(bag, from, new Date());
        if (last) {
          const cur = await getState<{ until: string }>(`track:${bag.id}`);
          if (!cur || new Date(cur.until) < last) await setState(`track:${bag.id}`, { until: last.toISOString() });
        }
        await setState(`backfill:${bag.id}`, { done: true, from: firstDay });
        log.info(`backfilled ${bag.name}: ${points} points`);
      } catch (err) {
        log.warn(`backfill ${bag.name} failed, will retry next start`, err);
      }
      doneBags++;
      health.backfill = { done: false, note: `Copied routes for ${doneBags} of ${bags.length} bags` };
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  health.backfill = { done: true, note: `Routes copied for the last ${days} days` };
  await setState("backfill", { done: true, at: new Date().toISOString(), days });
}
