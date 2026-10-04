// Late data. A bag without signal keeps working: it plays ads and records GPS,
// and uploads what it kept when it reconnects, sometimes hours or days later.
// - GPS from the backlog arrives stamped with the upload time, so the regular
//   sync records it as new (and spreadLatePoints puts it back in time).
// - Plays are filed under the hour they were played, so an hour the regular sync
//   has already passed can still grow.
//
// This compares each bag-day's totals with Colorlight's (one call for GPS, one for
// plays) and re-reads only what differs: the day's GPS from the same response, and
// plays for the 6-hour blocks whose totals grew. Every repair marks the London days
// it touches for recomputing, so routes, hours, pay, zone time and campaign figures
// follow, and open screens are told to refresh. Nothing already recorded is deleted.
//
// When:
// - a bag back after 30+ minutes away: the days since it was last seen, 20 minutes
//   after it reconnects and again after 2 hours (time to upload its backlog);
// - every bag: the last 2 days every 2 hours, and the last 14 days once a day.

import { addDays, todayLondon } from "@digilite/shared";
import { loadBags } from "../../domain/bags";
import { publish } from "../../events";
import { getState, setState } from "../../jobs/state";
import { logger } from "../../log";
import { batchUpsert, getAll, parsePbDate, pb, pbDate, q, type RecordModel } from "../../pb";
import { playTimes, track } from "../client";
import { copyPlaysHour } from "./content";
import { markTrackDays, trackRows } from "./tracks";

const log = logger("colorlight:late");
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const RECENT_DAYS = 2;
const FULL_DAYS = 14;
/** A bag away this long is treated as reconnecting, and checked for a backlog. */
export const RECONNECT_GAP_MS = 30 * 60_000;
const RECONNECT_CHECKS_MS = [20 * 60_000, 2 * HOUR];

interface Reconnect {
  bagId: string;
  /** Last report before it went quiet */
  from: string;
  /** When to check (epoch ms), earliest first */
  due: number[];
}

const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const minute = (t: number) => new Date(t).toISOString().slice(0, 16);
const second = (t: number) => new Date(t).toISOString().slice(0, 19);

/** The 6-hour blocks whose plays grew in Colorlight (never re-read to shrink what we hold). */
export function blocksToReread(colorlight: number[], ours: number[]): number[] {
  return colorlight.flatMap((n, i) => (n > (ours[i] ?? 0) ? [i] : []));
}

/** Called by the status sync when a bag reports again after a long silence. */
export async function noteReconnect(bagId: string, lastSeen: Date, now = Date.now()): Promise<void> {
  const list = (await getState<Reconnect[]>("late:reconnects")) ?? [];
  const existing = list.find((r) => r.bagId === bagId);
  const due = RECONNECT_CHECKS_MS.map((ms) => now + ms);
  if (existing) {
    if (lastSeen.toISOString() < existing.from) existing.from = lastSeen.toISOString();
    existing.due = due;
  } else {
    list.push({ bagId, from: lastSeen.toISOString(), due });
  }
  await setState("late:reconnects", list);
}

async function ourGpsCount(bagId: string, from: number, to: number): Promise<number> {
  const res = await pb
    .collection("gps_points")
    .getList(1, 1, { filter: `bag = ${q(bagId)} && ts >= ${q(pbDate(new Date(from)))} && ts < ${q(pbDate(new Date(to)))}`, fields: "id" });
  return res.totalItems;
}

async function ourPlaysByBlock(bagId: string, dayStart: number): Promise<number[]> {
  const rows = await getAll<RecordModel>("plays", {
    filter: `bag = ${q(bagId)} && hour >= ${q(pbDate(new Date(dayStart)))} && hour < ${q(pbDate(new Date(dayStart + DAY)))}`,
    fields: "hour,plays",
  });
  const blocks = [0, 0, 0, 0];
  for (const r of rows) blocks[Math.floor((parsePbDate(r.hour)!.getTime() - dayStart) / (6 * HOUR))] += r.plays || 0;
  return blocks;
}

const playsIn = async (bag: RecordModel, from: number, to: number) =>
  (await playTimes(bag.colorlight_id, minute(from), minute(to))).statistic.reduce((n, s) => n + (s.totalPlayTimes || 0), 0);

/** One bag, one UTC day: bring GPS and plays level with Colorlight. Returns what was added. */
export async function reconcileBagDay(bag: RecordModel, day: string, now = Date.now()): Promise<{ points: number; plays: number }> {
  const start = Date.parse(`${day}T00:00:00Z`);
  // Today: only what's settled (the regular sync is still reading the current hour).
  const end = Math.min(start + DAY, now - HOUR);
  if (end <= start) return { points: 0, plays: 0 };
  let points = 0;
  let plays = 0;

  const t = await track(bag.colorlight_id, second(start), second(end - 1000));
  const held = await ourGpsCount(bag.id, start, end);
  if (t.data.length > held) {
    const rows = trackRows(bag.id, t.data);
    if (rows.length) await batchUpsert("gps_points", rows);
    markTrackDays(bag.id, rows);
    points = Math.max(0, rows.length - held);
  }

  const settledBlocks = Math.floor((end - start) / (6 * HOUR));
  if (settledBlocks > 0) {
    const theirs = await playsIn(bag, start, start + settledBlocks * 6 * HOUR);
    const oursBlocks = await ourPlaysByBlock(bag.id, start);
    const ours = oursBlocks.slice(0, settledBlocks).reduce((a, b) => a + b, 0);
    if (theirs > ours) {
      const theirBlocks: number[] = [];
      for (let b = 0; b < settledBlocks; b++) theirBlocks.push(await playsIn(bag, start + b * 6 * HOUR, start + (b + 1) * 6 * HOUR));
      for (const b of blocksToReread(theirBlocks, oursBlocks)) {
        for (let h = start + b * 6 * HOUR; h < start + (b + 1) * 6 * HOUR; h += HOUR) await copyPlaysHour(bag, new Date(h));
        plays += theirBlocks[b] - oursBlocks[b];
      }
    }
  }
  return { points, plays };
}

/** Bag-days to check: a bag can only have data on days up to its last report. */
async function sweep(days: number, label: string, now = Date.now()): Promise<void> {
  const first = Date.parse(`${addDays(todayLondon(new Date(now)), -(days - 1))}T00:00:00Z`);
  const bags = (await loadBags()).filter((b) => (parsePbDate(b.last_report_at)?.getTime() ?? 0) >= first);
  await repair(bags.map((bag) => ({ bag, from: first })), label, now);
}

async function repair(items: { bag: RecordModel; from: number }[], label: string, now: number): Promise<void> {
  const fixed: string[] = [];
  let points = 0;
  let plays = 0;
  for (const { bag, from } of items) {
    const last = Math.min(parsePbDate(bag.last_report_at)?.getTime() ?? now, now);
    for (let d = utcDay(from); d <= utcDay(last); d = addDays(d, 1)) {
      const r = await reconcileBagDay(bag, d, now);
      if (r.points || r.plays) {
        log.info(`${label}: ${bag.name} ${d}: +${r.points.toLocaleString("en-GB")} GPS points, +${r.plays.toLocaleString("en-GB")} plays`);
        points += r.points;
        plays += r.plays;
        if (!fixed.includes(bag.id)) fixed.push(bag.id);
      }
    }
  }
  if (fixed.length) {
    publish({ type: "tracks.updated", bagIds: fixed });
    log.info(`${label}: late data recorded for ${fixed.length} bag(s): ${points.toLocaleString("en-GB")} GPS points, ${plays.toLocaleString("en-GB")} plays`);
  }
}

/** The job: due reconnect checks first, then the 2-day and 14-day sweeps when they're due. */
export async function reconcileLateData(now = Date.now()): Promise<void> {
  const list = (await getState<Reconnect[]>("late:reconnects")) ?? [];
  const due = list.filter((r) => r.due.length && r.due[0] <= now);
  if (due.length) {
    const bags = new Map((await loadBags()).map((b) => [b.id, b]));
    await repair(
      due.flatMap((r) => (bags.has(r.bagId) ? [{ bag: bags.get(r.bagId)!, from: Date.parse(r.from) }] : [])),
      "after reconnecting",
      now,
    );
    const remaining = list.map((r) => (due.includes(r) ? { ...r, due: r.due.slice(1) } : r)).filter((r) => r.due.length);
    await setState("late:reconnects", remaining);
  }

  const times = (await getState<{ recent?: number; full?: number }>("late:sweeps")) ?? {};
  if (!times.full || now - times.full >= DAY) {
    await sweep(FULL_DAYS, `last ${FULL_DAYS} days`, now);
    await setState("late:sweeps", { recent: now, full: now });
  } else if (!times.recent || now - times.recent >= 2 * HOUR) {
    await sweep(RECENT_DAYS, `last ${RECENT_DAYS} days`, now);
    await setState("late:sweeps", { ...times, recent: now });
  }
}
