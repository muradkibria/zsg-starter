// History import. Colorlight only keeps about three months of GPS and six months
// of ad plays (measured October 2026), and drops older data every day. DigiLite
// Hub keeps everything, so the sync works back through what Colorlight still holds
// and records it, oldest first, since that's what disappears next.
//
// To keep the requests down it asks about a 30-day stretch first. Inside a stretch
// with plays it asks per day, then per 6 hours, then per hour, so plays are
// recorded by the hour like everything else. GPS is asked for every day Colorlight
// might still have it, and beyond that only on days with plays.
//
// Each bag remembers how far it has got (sync_state `history:<bag>`), and only
// moves on past stretches that finished, so a restart or an error loses nothing.
// It runs every 30 minutes until every bag is complete, then costs nothing.

import { addDays, gbDateFormat, todayLondon } from "@digilite/shared";
import { config } from "../../config";
import { loadBags } from "../../domain/bags";
import { getState, health, setState } from "../../jobs/state";
import { logger } from "../../log";
import { parsePbDate, type RecordModel } from "../../pb";
import { playTimes } from "../client";
import { copyPlaysHour } from "./content";
import { copyTrack } from "./tracks";

const log = logger("colorlight:history");
const HOUR = 3600000;
const STRETCH_DAYS = 30;
/** Colorlight's GPS goes back about 90 days; past this, GPS is only asked for on days with plays. */
const GPS_DAYS = 100;

interface Cursor {
  /** The first UTC day not yet recorded */
  next: string;
  complete?: boolean;
}

const at = (day: string, hour = 0) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const minute = (d: Date) => d.toISOString().slice(0, 16);
const daysAgo = (day: string, today: string) => Math.round((Date.parse(today) - Date.parse(day)) / 86400000);
const dayText = (day: string) => gbDateFormat({ timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(at(day));

async function playsBetween(bag: RecordModel, from: Date, to: Date): Promise<number> {
  const res = await playTimes(bag.colorlight_id, minute(from), minute(to));
  return res.statistic.reduce((n, s) => n + (s.totalPlayTimes || 0), 0);
}

/** One UTC day for one bag: GPS where Colorlight may still have it, and plays by the hour. */
async function importDay(bag: RecordModel, day: string, today: string, stretchHasPlays: boolean) {
  const start = at(day);
  const end = at(addDays(day, 1));
  const plays = stretchHasPlays ? await playsBetween(bag, start, end) : 0;
  let points = 0;
  if (plays > 0 || daysAgo(day, today) <= GPS_DAYS) {
    points = (await copyTrack(bag, start, new Date(end.getTime() - 1000))).points;
  }
  if (plays > 0) {
    for (let block = 0; block < 24; block += 6) {
      const s = at(day, block);
      const e = new Date(s.getTime() + 6 * HOUR);
      if (!(await playsBetween(bag, s, e))) continue;
      for (let h = s; h < e; h = new Date(h.getTime() + HOUR)) await copyPlaysHour(bag, h);
    }
  }
  return { points, plays };
}

interface Stretch {
  bag: RecordModel;
  from: string;
  to: string;
}

export async function importHistory(): Promise<void> {
  const today = todayLondon();
  const start = addDays(today, -config.SYNC_HISTORY_DAYS);
  // Newer days are recorded by the recent catch-up and the regular sync.
  const end = addDays(today, -config.SYNC_BACKFILL_DAYS);
  if (start >= end) return;

  // A bag last seen before the window has nothing in it.
  const bags = (await loadBags()).filter((b) => {
    const last = parsePbDate(b.last_report_at);
    return !!last && last.toISOString().slice(0, 10) >= start;
  });

  const stretches: Stretch[] = [];
  const order = new Map<string, string[]>();
  for (const bag of bags) {
    const cur = await getState<Cursor>(`history:${bag.id}`);
    if (cur?.complete) continue;
    const froms: string[] = [];
    for (let from = cur?.next && cur.next > start ? cur.next : start; from < end; from = addDays(from, STRETCH_DAYS)) {
      const to = addDays(from, STRETCH_DAYS) < end ? addDays(from, STRETCH_DAYS) : end;
      stretches.push({ bag, from, to });
      froms.push(from);
    }
    if (froms.length) order.set(bag.id, froms);
  }
  if (!stretches.length) return;

  // Oldest first across the whole fleet: that's what Colorlight drops next.
  stretches.sort((a, b) => a.from.localeCompare(b.from) || String(a.bag.name).localeCompare(String(b.bag.name)));
  log.info(`recording history back to ${start}: ${order.size} bags, ${stretches.length} stretches`);

  const finished = new Map<string, Set<string>>();
  const toOf = new Map(stretches.map((s) => [`${s.bag.id}|${s.from}`, s.to]));
  let done = 0;
  let points = 0;
  let plays = 0;
  let failed = 0;

  /** Move a bag's cursor past every stretch finished without a gap. */
  const advance = async (bagId: string) => {
    const froms = order.get(bagId)!;
    const fin = finished.get(bagId)!;
    let next: string | null = null;
    for (const f of froms) {
      if (!fin.has(f)) break;
      next = toOf.get(`${bagId}|${f}`)!;
    }
    if (next) await setState(`history:${bagId}`, { next, complete: next >= end } satisfies Cursor);
  };

  const queue = [...stretches];
  let failedInARow = 0;
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const hasPlays = (await playsBetween(s.bag, at(s.from), at(s.to))) > 0;
        for (let d = s.from; d < s.to; d = addDays(d, 1)) {
          if (!hasPlays && daysAgo(d, today) > GPS_DAYS) continue;
          const r = await importDay(s.bag, d, today, hasPlays);
          points += r.points;
          plays += r.plays;
        }
        if (!finished.has(s.bag.id)) finished.set(s.bag.id, new Set());
        finished.get(s.bag.id)!.add(s.from);
        await advance(s.bag.id);
        failedInARow = 0;
      } catch (err) {
        failed++;
        log.warn(`history for ${s.bag.name} from ${s.from} stopped here; it will be tried again: ${(err as Error).message}`);
        // Colorlight (or the network) isn't answering: stop, and let the next run pick it up.
        if (++failedInARow >= 3 && queue.length) {
          log.warn(`pausing the history import: ${queue.length} part(s) left for the next run`);
          failed += queue.length;
          queue.length = 0;
        }
      }
      done++;
      health.backfill = { done: false, note: `Recording older history back to ${dayText(start)}: ${done} of ${stretches.length} parts done` };
    }
  };
  // Two at a time, so the regular sync keeps most of Colorlight's request capacity.
  await Promise.all([worker(), worker()]);

  health.backfill = {
    done: true,
    note: failed ? `History recorded back to ${dayText(start)}, apart from ${failed} part(s) to try again shortly` : `History recorded back to ${dayText(start)}`,
  };
  log.info(`history: ${points.toLocaleString("en-GB")} GPS points and ${plays.toLocaleString("en-GB")} plays recorded${failed ? `, ${failed} stretch(es) to retry` : ""}`);
}
