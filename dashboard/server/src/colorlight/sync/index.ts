// The Colorlight sync. Colorlight is where every bag's data comes from (the only
// data source for now): these jobs pull bag status, GPS, plays, ads, loops,
// screenshots and device schedules on timers and record them in PocketBase, which
// keeps them permanently. Screens read those records, so they keep working, with
// the last update, whenever Colorlight is slow or down.

import { config } from "../../config";
import { getState, health, markError } from "../../jobs/state";
import { rollupDirtyDays } from "../../jobs/rollups";
import { logger } from "../../log";
import { backfillPlays, syncDeviceSchedules, syncMedia, syncPlays, syncPrograms, syncScreenshots } from "./content";
import { importHistory } from "./history";
import { reconcileLateData } from "./reconcile";
import { syncStatus } from "./status";
import { backfillTracks, syncLivePositions, syncTracks } from "./tracks";

const log = logger("colorlight");

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<void>;
  running?: boolean;
  lastError?: string;
}

async function runJob(job: Job) {
  if (job.running) return;
  job.running = true;
  try {
    await job.run();
    if (job.lastError) log.info(`${job.name} recovered`);
    job.lastError = undefined;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg !== job.lastError) log.warn(`${job.name} failed: ${msg}`);
    job.lastError = msg;
    markError(err);
  } finally {
    job.running = false;
  }
}

/** Late uploads (see reconcile.ts): reconnect checks and sweeps of recent days. */
const lateJob: Job = { name: "late data", everyMs: 10 * 60_000, run: () => reconcileLateData() };

/** Older history (see history.ts): repeats until every bag is complete. */
const historyJob: Job = { name: "history", everyMs: 30 * 60_000, run: importHistory };

/** How often each kind of update is pulled. */
const jobs: Job[] = [
  { name: "status", everyMs: 30_000, run: syncStatus },
  { name: "live positions", everyMs: 20_000, run: syncLivePositions },
  { name: "tracks", everyMs: 120_000, run: syncTracks },
  { name: "plays", everyMs: 15 * 60_000, run: syncPlays },
  { name: "screenshots", everyMs: 10 * 60_000, run: syncScreenshots },
  { name: "media", everyMs: 30 * 60_000, run: syncMedia },
  { name: "programs", everyMs: 30 * 60_000, run: syncPrograms },
  { name: "device schedules", everyMs: 60 * 60_000, run: syncDeviceSchedules },
  lateJob,
  historyJob,
];

const drainRollups = async () => {
  while ((await rollupDirtyDays(500)) > 0) {}
};

export async function startColorlightSync(): Promise<void> {
  if (!config.SYNC_ENABLED) {
    log.warn("Colorlight sync switched off (SYNC_ENABLED=false): showing the records already held");
    health.enabled = false;
    health.backfill = { done: true, note: "Sync is switched off" };
    return;
  }
  if (!config.colorlightConfigured) {
    log.warn("Colorlight login missing: sync not started");
    health.enabled = false;
    health.error = "Colorlight login is not configured";
    return;
  }

  // First pass in a sensible order, then each job on its own timer.
  await runJob(jobs[0]);
  await runJob(jobs[1]);
  for (const job of jobs) setInterval(() => void runJob(job), job.everyMs).unref();

  // Catching up: the recent days first (so today's screens are complete), then
  // everything older that Colorlight still holds. All of it resumes after a restart.
  void (async () => {
    const done = await getState<{ done: boolean; days: number }>("backfill");
    if (done?.done && done.days >= config.SYNC_BACKFILL_DAYS) {
      health.backfill = { done: true, note: `Routes recorded for the last ${config.SYNC_BACKFILL_DAYS} days` };
    }
    try {
      log.info(`catching up on the last ${config.SYNC_BACKFILL_DAYS} days (resumable)…`);
      await backfillTracks();
      // Then everything since each bag's last record, so time the server was down is filled now
      // rather than on the next timer.
      for (const name of ["tracks", "plays"]) await runJob(jobs.find((j) => j.name === name)!);
      await drainRollups();
      await runJob({ name: "media", everyMs: 0, run: syncMedia });
      await runJob({ name: "programs", everyMs: 0, run: syncPrograms });
      await backfillPlays();
      await drainRollups();
      await runJob({ name: "screenshots", everyMs: 0, run: syncScreenshots });
      log.info("recent days recorded");
      await runJob(lateJob);
      await drainRollups();
      await runJob(historyJob);
      await drainRollups();
    } catch (err) {
      log.error("catch-up stopped (it resumes on the next start)", err);
      markError(err);
    }
  })();
}
