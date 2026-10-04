// Saved progress for background work (so restarts resume where they left off),
// the Colorlight sync's health shown in the dashboard, and the bag-days waiting to
// be recomputed.
// Health times and the waiting list are saved too, so a restart loses neither.

import type { SyncHealth } from "@digilite/shared";
import { getOneOrNull, pb, stableId, type RecordModel } from "../pb";

export async function getState<T>(key: string): Promise<T | null> {
  const rec = await getOneOrNull<RecordModel>("sync_state", stableId(`sync:${key}`));
  return (rec?.value as T | undefined) ?? null;
}

export async function setState(key: string, value: unknown): Promise<void> {
  const batch = pb.createBatch();
  batch.collection("sync_state").upsert({ id: stableId(`sync:${key}`), key, value });
  await batch.send();
}

export const health: SyncHealth = {
  enabled: true,
  colorlightOk: false,
  lastStatusSync: null,
  lastGpsSync: null,
  lastTrackSync: null,
  lastPlaysSync: null,
  backfill: { done: false, note: "Waiting to start" },
  error: null,
};

type SyncTime = "lastStatusSync" | "lastGpsSync" | "lastTrackSync" | "lastPlaysSync";
const SYNC_TIMES: SyncTime[] = ["lastStatusSync", "lastGpsSync", "lastTrackSync", "lastPlaysSync"];
let healthSavedAt = 0;

export function markOk(field: SyncTime) {
  health[field] = new Date().toISOString();
  health.colorlightOk = true;
  health.error = null;
  if (Date.now() - healthSavedAt > 60000) {
    healthSavedAt = Date.now();
    const times = Object.fromEntries(SYNC_TIMES.map((k) => [k, health[k]]));
    void setState("health", times).catch(() => {});
  }
}

export function markError(err: unknown) {
  health.colorlightOk = false;
  health.error = err instanceof Error ? err.message : String(err);
}

/** Saves the set a few seconds after it changes (restarts pick it up in loadSyncState). */
class SavedSet extends Set<string> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  add(value: string) {
    const had = this.has(value);
    super.add(value);
    if (!had) this.save();
    return this;
  }
  delete(value: string) {
    const removed = super.delete(value);
    if (removed) this.save();
    return removed;
  }
  private save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void setState("dirty_days", [...this]).catch(() => this.save());
    }, 5000);
    this.timer.unref?.();
  }
}

/** Bag-days whose points changed and need their rollup recomputed. */
export const dirtyDays = new SavedSet();
export function markDirty(bagId: string, day: string) {
  dirtyDays.add(`${bagId}|${day}`);
}

/** On start: the last sync times and any bag-days still waiting from before a restart. */
export async function loadSyncState(): Promise<void> {
  const times = await getState<Partial<Record<SyncTime, string | null>>>("health");
  for (const k of SYNC_TIMES) if (!health[k] && times?.[k]) health[k] = times[k]!;
  for (const key of (await getState<string[]>("dirty_days")) ?? []) dirtyDays.add(key);
}
