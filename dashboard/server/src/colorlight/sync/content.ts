// Colorlight sync: ad plays, the ad library (files included), loops, screenshots
// and device schedules, recorded in PocketBase.

import { addDays, londonDay, parseColorlightTime, toColorlightTime, todayLondon } from "@digilite/shared";
import {
  fetchColorlightFile,
  fetchScreenshot,
  getTerminalSchedule,
  listMedia,
  listPrograms,
  playTimes,
} from "../client";
import type { ClMedia, ClProgram } from "../types";
import { config } from "../../config";
import { invalidateBags, loadBags } from "../../domain/bags";
import { confirmScheduleCommands } from "../../domain/commands";
import { logger } from "../../log";
import { batchUpsert, getAll, getFirst, pb, pbDate, parsePbDate, q, stableId, type RecordModel } from "../../pb";
import { getState, health, markDirty, markOk, setState } from "../../jobs/state";

const log = logger("colorlight:content");
const HOUR = 3600000;

// ── Plays ─────────────────────────────────────────────────────────────────────

export async function copyPlaysHour(bag: RecordModel, hourStart: Date): Promise<number> {
  const end = new Date(hourStart.getTime() + HOUR);
  const res = await playTimes(bag.colorlight_id, toColorlightTime(hourStart).slice(0, 16), toColorlightTime(end).slice(0, 16));
  if (!res.statistic.length) return 0;
  const hourIso = hourStart.toISOString();
  await batchUpsert(
    "plays",
    res.statistic.map((s) => ({
      id: stableId(`plays:${bag.id}:${hourIso}:${s.mediaMd5}`),
      bag: bag.id,
      hour: pbDate(hourStart),
      media_md5: s.mediaMd5,
      media_name: s.mediaName,
      media_type: (s.mediaType || "").toLowerCase(),
      plays: s.totalPlayTimes,
      seconds: s.totalPlayDuration,
    })),
  );
  markDirty(bag.id, londonDay(hourStart));
  return res.statistic.reduce((n, s) => n + s.totalPlayTimes, 0);
}

const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);

/**
 * Every bag with hours not yet recorded, hour by hour from its cursor up to the
 * hour of its last report. Never skips ahead, so time the server was down is filled
 * in. A bag's latest hour is read again until the bag has been quiet for an hour,
 * because plays keep arriving while it's on.
 */
/**
 * The hours of plays to ask for next (at most three days' worth per run) and where
 * the cursor goes after, or null when there's nothing new. Times in ms.
 */
export function planPlayHours(lastReport: number, cursor: number | null, now: number): { hours: number[]; next: number } | null {
  const nowHour = Math.floor(now / HOUR) * HOUR;
  const stopAt = Math.min(nowHour, Math.floor(lastReport / HOUR) * HOUR);
  let h = cursor ?? Math.max(stopAt - 6 * HOUR, nowHour - 6 * HOUR);
  if (h > stopAt) return null;
  const hours: number[] = [];
  for (; h <= stopAt && hours.length < 72; h += HOUR) hours.push(h);
  // Finished: the latest hour is read again until the bag has been quiet for an hour.
  const quiet = now - lastReport > HOUR;
  return { hours, next: h > stopAt ? (quiet ? stopAt + HOUR : stopAt) : h };
}

export async function syncPlays(): Promise<void> {
  const now = Date.now();
  for (const bag of await loadBags()) {
    const lastReport = parsePbDate(bag.last_report_at)?.getTime();
    if (!lastReport) continue;
    const cur = await getState<{ hour: string }>(`plays:${bag.id}`);
    const plan = planPlayHours(lastReport, cur ? Date.parse(cur.hour) : null, now);
    if (!plan) continue;
    for (const h of plan.hours) await copyPlaysHour(bag, new Date(h));
    await setState(`plays:${bag.id}`, { hour: new Date(plan.next).toISOString() });
  }
  markOk("lastPlaysSync");
}

/** One-off: plays for every hour a bag was out in the backfill window. */
export async function backfillPlays(): Promise<void> {
  const firstDay = addDays(todayLondon(), -config.SYNC_BACKFILL_DAYS);
  const days = await getAll<RecordModel>("bag_days", { filter: `day >= ${q(firstDay)} && points > 0`, sort: "day" });
  const byBag = new Map<string, RecordModel[]>();
  for (const d of days) byBag.set(d.bag, [...(byBag.get(d.bag) ?? []), d]);
  const bags = await loadBags();
  let done = 0;
  const queue = [...byBag.entries()];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const [bagId, bagDays] = item;
      const bag = bags.find((b) => b.id === bagId);
      if (!bag) continue;
      const state = await getState<{ done: boolean; from: string }>(`plays_backfill:${bagId}`);
      if (state?.done && state.from <= firstDay) continue;
      try {
        for (const d of bagDays) {
          const first = parsePbDate(d.first_at);
          const last = parsePbDate(d.last_at);
          if (!first || !last) continue;
          for (let h = floorHour(first); h <= last; h = new Date(h.getTime() + HOUR)) await copyPlaysHour(bag, h);
        }
        await setState(`plays_backfill:${bagId}`, { done: true, from: firstDay });
      } catch (err) {
        log.warn(`plays backfill for ${bag.name} failed`, err);
      }
      done++;
      health.backfill = { done: false, note: `Copying ad plays: ${done} of ${byBag.size} bags` };
    }
  };
  await Promise.all([worker(), worker()]);
  health.backfill = { done: true, note: `Routes and plays copied for the last ${config.SYNC_BACKFILL_DAYS} days` };
}

// ── Media library → creatives ─────────────────────────────────────────────────

function mediaFields(m: ClMedia) {
  const isVideo = (m.mime_type ?? "").startsWith("video") || m.file_type === "mp4";
  return {
    name: m.title_raw || m.title?.raw || m.title?.rendered || m.name || `Media ${m.id}`,
    source: "colorlight",
    media_type: isVideo ? "video" : "image",
    duration_s: m.media_details?.playtime_seconds ?? (isVideo ? null : 10),
    width: m.media_details?.width ?? null,
    height: m.media_details?.height ?? null,
    size_bytes: m.media_details?.filesize ?? null,
    colorlight_media_id: m.id,
    colorlight_md5: m.name ?? "",
    colorlight_url: m.source_url ?? "",
  };
}

const FILE_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif" };
/** Most we copy per run, so a big library arrives over a few runs rather than all at once. */
const FILE_BUDGET_BYTES = 250 * 1024 * 1024;
const FILE_MAX_BYTES = 100 * 1024 * 1024;

/** Keep our own copy of an ad file, so it plays in the dashboard without going to Colorlight. */
async function copyMediaFile(rec: RecordModel, m: ClMedia): Promise<number> {
  const url = m.source_url ?? "";
  const ext = (url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] ?? "").toLowerCase();
  const type = FILE_TYPES[ext];
  if (!url || !type) return 0;
  const bytes = await fetchColorlightFile(url, { timeoutMs: 180000 });
  if (bytes.length > FILE_MAX_BYTES) return 0;
  const form = new FormData();
  form.append("file", new Blob([bytes], { type }), url.split("/").pop() || `media-${m.id}.${ext}`);
  await pb.collection("creatives").update(rec.id, form);
  return bytes.length;
}

export async function syncMedia(): Promise<void> {
  const media = await listMedia();
  // Media id → our current record for it (an archived one only when nothing newer exists).
  const existing = new Map(
    (await getAll<RecordModel>("creatives", { filter: "colorlight_media_id > 0", sort: "-archived,created" })).map((c) => [c.colorlight_media_id, c]),
  );
  let thumbs = 0;
  let copied = 0;
  for (const m of media) {
    const fields = mediaFields(m);
    const found = existing.get(m.id);
    let rec: RecordModel;
    if (!found) {
      rec = await pb.collection("creatives").create<RecordModel>(fields);
    } else if (fields.colorlight_md5 && found.colorlight_md5 && found.colorlight_md5 !== fields.colorlight_md5) {
      // The file behind this media id changed. Ads are ours and plays are recorded against
      // the file, so the old record (and its history) stays, archived, and the new file is a
      // new record that keeps the name, advertiser and campaign given to the old one.
      rec = await pb.collection("creatives").create<RecordModel>({
        ...fields,
        name: found.name,
        advertiser: found.advertiser ?? "",
        campaign: found.campaign ?? "",
      });
      await pb.collection("creatives").update(found.id, { archived: true });
      log.info(`the file for "${found.name}" changed in Colorlight: recorded as a new ad, the old one archived`);
    } else if (found.colorlight_url !== fields.colorlight_url || (!found.colorlight_md5 && fields.colorlight_md5)) {
      rec = await pb.collection("creatives").update<RecordModel>(found.id, { colorlight_md5: fields.colorlight_md5, colorlight_url: fields.colorlight_url });
    } else {
      rec = found;
    }
    const thumbUrl = m.video_thumbnail_jpg || (fields.media_type === "image" ? m.source_url : null);
    if (!rec.thumb && thumbUrl && thumbs < 25) {
      try {
        const bytes = await fetchColorlightFile(thumbUrl);
        const form = new FormData();
        const ext = thumbUrl.toLowerCase().endsWith(".png") ? "png" : "jpg";
        form.append("thumb", new Blob([bytes], { type: ext === "png" ? "image/png" : "image/jpeg" }), `thumb.${ext}`);
        await pb.collection("creatives").update(rec.id, form);
        thumbs++;
      } catch (err) {
        log.debug(`thumbnail for media ${m.id} skipped`, err);
      }
    }
    const size = fields.size_bytes ?? 0;
    if (!rec.file && size <= FILE_MAX_BYTES && copied + size <= FILE_BUDGET_BYTES) {
      try {
        copied += await copyMediaFile(rec, m);
      } catch (err) {
        log.debug(`file for media ${m.id} not copied`, err);
      }
    }
  }
  if (copied) log.info(`copied ${(copied / 1e6).toFixed(1)} MB of ad files from Colorlight`);
}

// ── Programs → loops ──────────────────────────────────────────────────────────

export interface ProgramSlot {
  mediaId: number;
  /** How long the slot plays; null when the program doesn't say. */
  seconds: number | null;
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const pos = (x: unknown): number | null => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const ms = (x: unknown) => (pos(x) ? pos(x)! / 1000 : null);

/** Colorlight stores a slot's length several ways; `durationInSecond` matches the measured plays. */
function slotSeconds(f: Obj): number | null {
  const s = pos(f.durationInSecond) ?? ms(f.length) ?? pos(f.playTime) ?? ms(f.Duration) ?? ms(f.PlayLength);
  return s ? Math.round(s * 10) / 10 : null;
}

const mediaIdOf = (f: Obj) => pos(f.fileID) ?? pos(obj(f.FileSource)?.Resource_ID);

/**
 * The files a Colorlight program plays, in order, one entry per slot: a file
 * that appears three times is listed three times. Reads the editor metadata
 * (`program_info`: pages → file windows → files), then the player spec
 * (`Programs`: pages → regions → items), then any file reference in document order.
 */
export function programSlots(p: ClProgram): ProgramSlot[] {
  const out: ProgramSlot[] = [];
  const push = (f: Obj | null) => {
    const id = f ? mediaIdOf(f) : null;
    if (f && id) out.push({ mediaId: id, seconds: slotSeconds(f) });
  };

  for (const page of arr(obj(p.program_info)?.children)) {
    for (const region of arr(obj(page)?.children)) for (const file of arr(obj(region)?.children)) push(obj(file));
  }
  if (out.length) return out;

  const spec = obj(obj(p.Programs)?.Program) ?? obj(p.Programs);
  for (const page of arr(spec?.Pages)) {
    for (const region of arr(obj(page)?.Regions)) for (const item of arr(obj(region)?.Items)) push(obj(item));
  }
  if (out.length) return out;

  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk);
    const o = obj(x);
    if (!o) return;
    if (mediaIdOf(o)) return push(o); // a file: don't count its FileSource twice
    for (const v of Object.values(o)) walk(v);
  };
  walk(p.program_info ?? p.Programs);
  return out;
}

type LoopItemRow = { creative: string; seconds: number };

export type ProgramRecordPlan =
  | { action: "none" }
  | { action: "create" }
  | { action: "update"; id: string; patch: Record<string, unknown> }
  | { action: "replace"; previous: RecordModel };

/**
 * What to record for one Colorlight program, given the loop records already held
 * for it (newest first). Loops are ours: a version already recorded is never
 * rewritten with different content. A change made in Colorlight's own editor gives
 * the program a new file name (vsn) and arrives as a new record; the previous one
 * is kept and archived.
 */
export function planProgramRecord(p: { name: string; vsn: string; items: LoopItemRow[] }, records: RecordModel[]): ProgramRecordPlan {
  const sameItems = (r: RecordModel) => JSON.stringify(r.items ?? []) === JSON.stringify(p.items);
  const exact = p.vsn ? records.find((r) => r.colorlight_vsn === p.vsn) : undefined;
  if (exact) {
    // The same version. An imported record can still gain ads that reached the library later.
    if (exact.status !== "imported") return { action: "none" };
    const patch: Record<string, unknown> = {};
    if (exact.name !== p.name) Object.assign(patch, { name: p.name, colorlight_program_name: p.name });
    if (!sameItems(exact)) patch.items = p.items;
    return Object.keys(patch).length ? { action: "update", id: exact.id, patch } : { action: "none" };
  }
  const current = records.find((r) => r.status !== "archived") ?? records[0];
  if (!current) return { action: "create" };
  if (!current.colorlight_vsn || sameItems(current)) {
    // Recorded before file names were kept, or renamed/re-saved with the same content.
    const patch: Record<string, unknown> = { colorlight_vsn: p.vsn };
    if (current.status === "imported" && current.name !== p.name) Object.assign(patch, { name: p.name, colorlight_program_name: p.name });
    if (current.status === "imported" && !sameItems(current)) patch.items = p.items;
    return { action: "update", id: current.id, patch };
  }
  return { action: "replace", previous: current };
}

export async function syncPrograms(): Promise<void> {
  const programs = await listPrograms();
  // Media id → creative; when a file was replaced, the current record wins over the archived one.
  const creatives = new Map(
    (await getAll<RecordModel>("creatives", { filter: "colorlight_media_id > 0", fields: "id,colorlight_media_id,duration_s,archived", sort: "-archived,created" })).map(
      (c) => [c.colorlight_media_id as number, c],
    ),
  );
  const byProgram = new Map<number, RecordModel[]>();
  for (const l of await getAll<RecordModel>("loops", { filter: "colorlight_program_id > 0", sort: "-created" })) {
    const list = byProgram.get(l.colorlight_program_id) ?? [];
    list.push(l);
    byProgram.set(l.colorlight_program_id, list);
  }
  let missing = 0;
  for (const p of programs) {
    const name = p.title_raw || p.title?.raw || p.title?.rendered || `Program ${p.id}`;
    const vsn = typeof p.vsn_name === "string" ? p.vsn_name : "";
    const slots = programSlots(p);
    const items = slots.flatMap((s) => {
      const c = creatives.get(s.mediaId);
      return c ? [{ creative: c.id, seconds: s.seconds ?? (c.duration_s || 10) }] : [];
    });
    missing += slots.length - items.length;
    const fresh = {
      name,
      status: "imported",
      items,
      colorlight_program_id: p.id,
      colorlight_program_name: name,
      colorlight_vsn: vsn,
      published_at: pbDate(parseColorlightTime(p.modified_gmt ?? p.date_gmt ?? null) ?? new Date()),
    };
    const plan = planProgramRecord({ name, vsn, items }, byProgram.get(p.id) ?? []);
    if (plan.action === "create") {
      await pb.collection("loops").create(fresh);
    } else if (plan.action === "update") {
      await pb.collection("loops").update(plan.id, plan.patch);
    } else if (plan.action === "replace") {
      const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date());
      const note = `Replaced on ${when} by a newer version made in Colorlight's own editor.`;
      await pb.collection("loops").update(plan.previous.id, {
        status: "archived",
        notes: [plan.previous.notes, note].filter(Boolean).join("\n").slice(0, 2000),
      });
      await pb.collection("loops").create(fresh);
      log.info(`"${name}" was changed in Colorlight: recorded as a new version, the previous one archived`);
    }
  }
  if (missing) log.debug(`${missing} loop slot(s) use media that isn't in the library yet`);
}

// ── Screenshots ───────────────────────────────────────────────────────────────

export async function syncScreenshots(): Promise<void> {
  const bags = (await loadBags()).filter((b) => b.last_screenshot_at);
  for (const bag of bags) {
    const takenAt = parsePbDate(bag.last_screenshot_at)!;
    const id = stableId(`shot:${bag.id}:${takenAt.toISOString()}`);
    const have = await getFirst<RecordModel>("screenshots", `id = ${q(id)}`, { fields: "id" });
    if (have) continue;
    try {
      const bytes = await fetchScreenshot(bag.colorlight_id);
      const form = new FormData();
      form.append("id", id);
      form.append("bag", bag.id);
      form.append("taken_at", pbDate(takenAt));
      form.append("file", new Blob([bytes], { type: "image/jpeg" }), `${bag.colorlight_id}.jpg`);
      await pb.collection("screenshots").create(form);
    } catch (err) {
      log.debug(`screenshot for ${bag.name} not available`, err);
    }
  }
}

// ── Device schedules ──────────────────────────────────────────────────────────

export async function syncDeviceSchedules(): Promise<void> {
  const bags = (await loadBags()).filter((b) => {
    const t = parsePbDate(b.last_report_at)?.getTime();
    return !!t && Date.now() - t < 7 * 24 * HOUR;
  });
  for (const bag of bags) {
    try {
      const sched = await getTerminalSchedule(bag.colorlight_id);
      if (JSON.stringify(sched) !== JSON.stringify(bag.device_schedule ?? null)) {
        await pb.collection("bags").update(bag.id, { device_schedule: sched });
      }
      await confirmScheduleCommands(bag, sched);
    } catch (err) {
      log.debug(`schedule for ${bag.name} unavailable`, err);
    }
  }
  invalidateBags();
}
