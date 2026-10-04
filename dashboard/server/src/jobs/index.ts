// Background work: the Colorlight sync, which records the bags' data in
// PocketBase, and the rollups worked out from those records.

import { startColorlightSync } from "../colorlight/sync";
import { logger } from "../log";
import { startRollups } from "./rollups";
import { loadSyncState } from "./state";

const log = logger("jobs");

export async function startJobs(): Promise<void> {
  await loadSyncState().catch((err) => log.warn("couldn't load saved state", err));
  startRollups();
  await startColorlightSync();
}
