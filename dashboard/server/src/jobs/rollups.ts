// Bag-day rollups: routes, shifts, stops, zone time and plays per bag per London
// day, worked out from our own GPS and plays records. They run whether or not
// Colorlight is reachable.

import { londonDay } from "@digilite/shared";
import { loadBags } from "../domain/bags";
import { computeBagDay } from "../domain/tracks";
import { logger } from "../log";
import { dirtyDays } from "./state";

const log = logger("jobs:rollups");

/** Recompute bag-days whose points or plays changed. */
export async function rollupDirtyDays(limit = 200): Promise<number> {
  const items = [...dirtyDays].slice(0, limit);
  if (!items.length) return 0;
  const bags = await loadBags();
  for (const key of items) {
    dirtyDays.delete(key);
    const [bagId, day] = key.split("|");
    const bag = bags.find((b) => b.id === bagId);
    if (bag) await computeBagDay(bag, day);
  }
  return items.length;
}

let running = false;

export function startRollups(): void {
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await rollupDirtyDays();
    } catch (err) {
      log.warn(`rollups paused until the next minute: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  }, 60_000).unref();

  // Safety net: recompute yesterday for every bag once an hour.
  setInterval(async () => {
    try {
      const y = londonDay(new Date(Date.now() - 86400000));
      for (const b of await loadBags()) {
        if (b.last_report_at) dirtyDays.add(`${b.id}|${y}`);
      }
    } catch (err) {
      log.warn(`couldn't queue yesterday's recompute: ${(err as Error).message}`);
    }
  }, 3600_000).unref();
}
