// Ads & loops: the creative library, loops (Colorlight programs), sending a loop
// to bags through the write gate, and live delivery per bag.
//
// Identical copies of one file (Colorlight's library often holds several) are
// treated as one creative: they share a file key (the Colorlight file name,
// "F_<MD5>_<bytes>", which is also what play statistics report).

import { createHash } from "node:crypto";
import {
  bagStatus,
  creativeTypeOf,
  deliveryStateFor,
  diffLoopItems,
  isScreenShape,
  loopCyclesPerHour,
  loopTotalSeconds,
  programNameFromVsn,
  sameProgramName,
  todayLondon,
  type LibraryCampaignRef,
  type LibraryCreative,
  type LibraryLoopRef,
  type LoopBagRef,
  type LoopDeliveryInitial,
  type LoopDeliveryRow,
  type LoopDeliveryState,
  type LoopDeployment,
  type LoopDeploymentBrief,
  type LoopDeploymentStep,
  type LoopDeploymentTarget,
  type LoopDetail,
  type LoopDiff,
  type LoopDiffItem,
  type LoopItem,
  type LoopItemInput,
  type OnScreenResponse,
  type LoopListItem,
  type LoopPublishRequest,
  type LoopPublishResult,
  type LoopStatus,
  type SessionUser,
  type SettingsDto,
} from "@digilite/shared";
import { config } from "../config";
import { accountWritesAllowed, createProgram, decideFor, publishProgram, uploadMedia, type ProgramMediaItem } from "../colorlight/writes";
import type { GateDecision } from "../colorlight/gate";
import { logger } from "../log";
import { batchCreate, getAll, parsePbDate, pb, pbDate, q, type RecordModel } from "../pb";
import { audit } from "./audit";
import { invalidateBags, loadBags } from "./bags";
import { getSettings, updateSettings } from "./settings";

const log = logger("loops");
const DAY = 86400000;

// ── Small record helpers ──────────────────────────────────────────────────────

/** The key that identifies a file: Colorlight's file name, or our own id before it reaches Colorlight. */
export function fileKeyOf(c: Pick<RecordModel, "id"> & { colorlight_md5?: string }): string {
  return (c.colorlight_md5 || "").trim() || `id:${c.id}`;
}

/**
 * Colorlight names files "F_<MD5 in capitals>_<size in bytes>" and reports
 * plays under that name. Computing it for an upload lets plays line up once
 * the file reaches Colorlight, and spots files already in the library.
 */
export function colorlightFileName(bytes: Buffer): string {
  return `F_${createHash("md5").update(bytes).digest("hex").toUpperCase()}_${bytes.length}`;
}

// ── Files ────────────────────────────────────────────────────────────────────

/** What the file really is, from its first bytes (never trust the name alone). */
export function sniffType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  const box = buf.subarray(4, 8).toString("latin1");
  if (box === "ftyp") return buf.subarray(8, 12).toString("latin1") === "qt  " ? "video/quicktime" : "video/mp4";
  if (["moov", "mdat", "wide", "free", "skip", "pnot"].includes(box)) return "video/quicktime";
  return null;
}

/** Width × height from a PNG, GIF or JPEG header (null for anything else). */
export function imageSize(buf: Buffer, type: string): { width: number; height: number } | null {
  try {
    if (type === "image/png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === "image/gif" && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (type === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) return null;
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    /* unreadable header */
  }
  return null;
}

export const thumbUrlOf = (c: RecordModel) => (c.thumb ? `/api/creatives/${c.id}/thumb?v=${encodeURIComponent(c.thumb)}` : null);
const fileUrlOf = (c: RecordModel) => (c.file ? `/api/creatives/${c.id}/file?v=${encodeURIComponent(c.file)}` : null);

export function loopItemsOf(loop: RecordModel): LoopItemInput[] {
  const raw = Array.isArray(loop.items) ? (loop.items as unknown[]) : [];
  return raw
    .map((x) => x as { creative?: unknown; seconds?: unknown })
    .filter((x) => typeof x.creative === "string" && x.creative)
    .map((x) => ({ creative: x.creative as string, seconds: Number(x.seconds) > 0 ? Number(x.seconds) : 10 }));
}

/** The program name bags report for this loop (only loops that exist in Colorlight). */
export function programNameOf(loop: RecordModel): string | null {
  if (!loop.colorlight_program_id && loop.status !== "imported" && loop.status !== "published") return null;
  return (loop.colorlight_program_name || loop.name || "").trim() || null;
}

const bagPlaying = (b: RecordModel): string | null => b.playing_program || programNameFromVsn(b.playing_vsn);

function downloadedOf(b: RecordModel): { id: number; name: string }[] {
  const raw = Array.isArray(b.downloaded_programs) ? (b.downloaded_programs as { id?: unknown; name?: unknown }[]) : [];
  return raw.map((p) => ({ id: Number(p.id) || 0, name: String(p.name ?? "") }));
}

const iso = (s: string | null | undefined) => parsePbDate(s)?.toISOString() ?? null;
const isRetired = (b: RecordModel) => (b.lifecycle || "active") === "retired";

// ── Context: everything the library and loop screens need, loaded once ───────

let playsCache: { at: number; since: string; byKey: Map<string, number> } | null = null;

/** Plays per file over the last 7 days (measured, from Colorlight play statistics). */
async function plays7d(now: Date): Promise<Map<string, number>> {
  if (playsCache && now.getTime() - playsCache.at < 5 * 60000) return playsCache.byKey;
  const since = pbDate(new Date(now.getTime() - 7 * DAY));
  const rows = await getAll<RecordModel>("plays", { filter: `hour >= ${q(since)}`, fields: "media_md5,plays" });
  const byKey = new Map<string, number>();
  for (const r of rows) byKey.set(r.media_md5, (byKey.get(r.media_md5) ?? 0) + (r.plays || 0));
  playsCache = { at: now.getTime(), since, byKey };
  return byKey;
}

export interface LoopsContext {
  now: Date;
  settings: SettingsDto;
  creatives: RecordModel[];
  creativeById: Map<string, RecordModel>;
  /** fileKey → identical copies, primary first */
  groups: Map<string, RecordModel[]>;
  loops: RecordModel[];
  /** All bags (retired included); use `activeBags` for counts */
  bags: RecordModel[];
  activeBags: RecordModel[];
  plays: Map<string, number>;
  campaigns: Map<string, RecordModel>;
  /** Which loop each bag is playing right now (null: unknown loop or nothing) */
  playingLoop: Map<string, RecordModel | null>;
  fleetLoop: RecordModel | null;
}

/** Primary copy first: not archived, oldest in Colorlight, then oldest record. */
function primaryOrder(a: RecordModel, b: RecordModel): number {
  if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
  const ma = a.colorlight_media_id || Number.MAX_SAFE_INTEGER;
  const mb = b.colorlight_media_id || Number.MAX_SAFE_INTEGER;
  if (ma !== mb) return ma - mb;
  return String(a.created).localeCompare(String(b.created)) || a.id.localeCompare(b.id);
}

export function groupCopies(creatives: RecordModel[]): Map<string, RecordModel[]> {
  const groups = new Map<string, RecordModel[]>();
  for (const c of creatives) {
    const k = fileKeyOf(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const list of groups.values()) list.sort(primaryOrder);
  return groups;
}

/**
 * Which loop a bag is playing: the status sync's exact match on the Colorlight
 * file name first, then same-named loops told apart by what the bag downloaded.
 */
export function resolvePlayingLoop(bag: RecordModel, loops: RecordModel[]): RecordModel | null {
  if (bag.playing_loop) {
    const exact = loops.find((l) => l.id === bag.playing_loop);
    if (exact) return exact;
  }
  const name = bagPlaying(bag);
  if (!name) return null;
  const candidates = loops.filter((l) => l.status !== "archived" && sameProgramName(programNameOf(l), name));
  if (candidates.length <= 1) return candidates[0] ?? null;
  const ids = new Set(downloadedOf(bag).map((p) => p.id));
  return (
    candidates.find((l) => l.colorlight_program_id && ids.has(l.colorlight_program_id)) ??
    [...candidates].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at)))[0]
  );
}

export async function loadLoopsContext(): Promise<LoopsContext> {
  const now = new Date();
  const [settings, creatives, loops, bags, plays, campaigns] = await Promise.all([
    getSettings(),
    getAll<RecordModel>("creatives", { sort: "created" }),
    getAll<RecordModel>("loops", { sort: "-published_at" }),
    loadBags({ fresh: true }),
    plays7d(now),
    getAll<RecordModel>("campaigns", { fields: "id,name,advertiser,end_date,status" }).catch(() => [] as RecordModel[]),
  ]);
  const activeBags = bags.filter((b) => !isRetired(b));
  const playingLoop = new Map<string, RecordModel | null>();
  for (const b of bags) playingLoop.set(b.id, resolvePlayingLoop(b, loops));
  // The fleet loop: the loop named in Settings that most bags are playing.
  let fleetLoop: RecordModel | null = null;
  if (settings.fleetLoopName) {
    const named = loops.filter((l) => l.status !== "archived" && sameProgramName(programNameOf(l), settings.fleetLoopName));
    const playingCount = (l: RecordModel) => activeBags.filter((b) => playingLoop.get(b.id)?.id === l.id).length;
    fleetLoop = named.sort((a, b) => playingCount(b) - playingCount(a))[0] ?? null;
  }
  return {
    now,
    settings,
    creatives,
    creativeById: new Map(creatives.map((c) => [c.id, c])),
    groups: groupCopies(creatives),
    loops,
    bags,
    activeBags,
    plays,
    campaigns: new Map(campaigns.map((c) => [c.id, c])),
    playingLoop,
    fleetLoop,
  };
}

// ── Library DTOs ──────────────────────────────────────────────────────────────

function campaignRef(ctx: LoopsContext, id: string | undefined): LibraryCampaignRef | null {
  const c = id ? ctx.campaigns.get(id) : null;
  if (!c) return null;
  return { id: c.id, name: c.name, advertiser: c.advertiser || "", endDate: iso(c.end_date), status: c.status || null };
}

/** File keys each loop contains. */
function loopKeys(ctx: LoopsContext, loop: RecordModel): Set<string> {
  const keys = new Set<string>();
  for (const it of loopItemsOf(loop)) {
    const c = ctx.creativeById.get(it.creative);
    keys.add(c ? fileKeyOf(c) : `id:${it.creative}`);
  }
  return keys;
}

export function toLibraryCreative(ctx: LoopsContext, copies: RecordModel[], keysByLoop?: Map<string, Set<string>>): LibraryCreative {
  const c = copies[0];
  const key = fileKeyOf(c);
  const kbl = keysByLoop ?? new Map(ctx.loops.map((l) => [l.id, loopKeys(ctx, l)]));
  const loops: LibraryLoopRef[] = ctx.loops
    .filter((l) => l.status !== "archived" && kbl.get(l.id)?.has(key))
    .map((l) => ({ id: l.id, name: l.name, status: l.status as LoopStatus, isFleetLoop: l.id === ctx.fleetLoop?.id }));
  const bagsNow = ctx.activeBags.filter((b) => {
    const l = ctx.playingLoop.get(b.id);
    return !!l && !!kbl.get(l.id)?.has(key);
  }).length;
  const campaign = campaignRef(ctx, c.campaign);
  const today = todayLondon(ctx.now);
  const ended = !!campaign?.endDate && campaign.endDate.slice(0, 10) < today;
  const withThumb = copies.find((x) => x.thumb) ?? c;
  return {
    id: c.id,
    name: c.name,
    advertiser: c.advertiser || "",
    campaign,
    mediaType: c.media_type === "image" ? "image" : "video",
    durationS: c.duration_s ?? null,
    width: c.width || null,
    height: c.height || null,
    sizeBytes: c.size_bytes || null,
    thumbUrl: thumbUrlOf(withThumb),
    fileUrl: fileUrlOf(copies.find((x) => x.file) ?? c),
    source: copies.some((x) => x.source === "uploaded") ? "uploaded" : "colorlight",
    createdAt: iso(c.created) ?? "",
    archived: copies.every((x) => !!x.archived),
    plays7d: ctx.plays.get(key) ?? 0,
    loops,
    bagsNow,
    copies: copies.length,
    copyIds: copies.map((x) => x.id),
    fileKey: key,
    onColorlight: copies.some((x) => (x.colorlight_media_id || 0) > 0),
    screenShape: isScreenShape(c.width, c.height),
    endedStillPlaying: ended && bagsNow > 0,
  };
}

/** One entry per file, newest first. */
export function libraryList(ctx: LoopsContext): LibraryCreative[] {
  const kbl = new Map(ctx.loops.map((l) => [l.id, loopKeys(ctx, l)]));
  const out = [...ctx.groups.values()].map((copies) => toLibraryCreative(ctx, copies, kbl));
  const rank = (c: LibraryCreative) => {
    const rec = ctx.creativeById.get(c.id)!;
    // Uploaded (newest) first, then Colorlight media by upload order, newest first.
    return rec.source === "uploaded" ? [1, Date.parse(c.createdAt) || 0] : [0, rec.colorlight_media_id || 0];
  };
  return out.sort((a, b) => {
    const [ga, va] = rank(a);
    const [gb, vb] = rank(b);
    return gb - ga || vb - va;
  });
}

export function groupOf(ctx: LoopsContext, id: string): RecordModel[] | null {
  const c = ctx.creativeById.get(id);
  return c ? (ctx.groups.get(fileKeyOf(c)) ?? [c]) : null;
}

// ── Loop DTOs ─────────────────────────────────────────────────────────────────

export function toLoopItems(ctx: LoopsContext, items: LoopItemInput[]): LoopItem[] {
  return items.map((it) => {
    const c = ctx.creativeById.get(it.creative);
    if (!c) {
      return {
        creativeId: it.creative, seconds: it.seconds, name: "Ad no longer in the library", advertiser: "", mediaType: null,
        durationS: null, width: null, height: null, thumbUrl: null, fileKey: `id:${it.creative}`, missing: true, archived: false, screenShape: null,
      };
    }
    const group = ctx.groups.get(fileKeyOf(c)) ?? [c];
    return {
      creativeId: c.id,
      seconds: it.seconds,
      name: c.name,
      advertiser: c.advertiser || "",
      mediaType: c.media_type === "image" ? "image" : "video",
      durationS: c.duration_s ?? null,
      width: c.width || null,
      height: c.height || null,
      thumbUrl: thumbUrlOf(c) ?? thumbUrlOf(group.find((x) => x.thumb) ?? c),
      fileKey: fileKeyOf(c),
      missing: false,
      archived: !!c.archived,
      screenShape: isScreenShape(c.width, c.height),
    };
  });
}

function bagRef(b: RecordModel, now: Date): LoopBagRef {
  const last = parsePbDate(b.last_report_at);
  return {
    id: b.id,
    name: b.name,
    status: bagStatus(last, now.getTime()),
    isTestBag: config.testBagIds.includes(b.colorlight_id),
    lastReportAt: last?.toISOString() ?? null,
  };
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en", { numeric: true });

/** Each bag's loop, ad by ad, for the map's ads layer (only bags whose loop we know). */
export function onScreen(ctx: LoopsContext): OnScreenResponse {
  const out: OnScreenResponse = { bags: {}, loops: {} };
  for (const bag of ctx.activeBags) {
    const loop = ctx.playingLoop.get(bag.id);
    if (!loop) continue;
    out.bags[bag.id] = loop.id;
    if (!out.loops[loop.id]) {
      out.loops[loop.id] = {
        name: loop.name,
        slots: toLoopItems(ctx, loopItemsOf(loop)).map((i) => ({
          creativeId: i.creativeId,
          name: i.name,
          advertiser: i.advertiser,
          seconds: i.seconds,
          thumbUrl: i.thumbUrl,
        })),
      };
    }
  }
  return out;
}

export function toLoopListItem(ctx: LoopsContext, loop: RecordModel, last?: LoopDeploymentBrief | null): LoopListItem {
  const items = toLoopItems(ctx, loopItemsOf(loop));
  const published = parsePbDate(loop.published_at);
  const programId = loop.colorlight_program_id || null;
  const playing = ctx.activeBags.filter((b) => ctx.playingLoop.get(b.id)?.id === loop.id);
  const downloaded = programId ? ctx.activeBags.filter((b) => downloadedOf(b).some((p) => p.id === programId)) : [];
  return {
    id: loop.id,
    name: loop.name,
    status: loop.status as LoopStatus,
    items,
    totalSeconds: loopTotalSeconds(items),
    cyclesPerHour: loopCyclesPerHour(items),
    programName: programNameOf(loop),
    programId,
    publishedAt: published?.toISOString() ?? null,
    createdAt: iso(loop.created) ?? "",
    updatedAt: iso(loop.updated) ?? "",
    ageDays: published ? Math.max(0, Math.floor((ctx.now.getTime() - published.getTime()) / DAY)) : null,
    isFleetLoop: loop.id === ctx.fleetLoop?.id,
    bagsPlaying: playing.map((b) => bagRef(b, ctx.now)).sort(byName),
    bagsDownloaded: downloaded.length,
    lastDeployment: last ?? null,
  };
}

/** Loops screen order: the fleet loop, loops on bags, drafts, then the rest by date. */
export function loopListOrder(a: LoopListItem, b: LoopListItem): number {
  const rank = (l: LoopListItem) => (l.isFleetLoop ? 0 : l.bagsPlaying.length ? 1 : l.status === "draft" ? 2 : 3);
  return (
    rank(a) - rank(b) ||
    b.bagsPlaying.length - a.bagsPlaying.length ||
    (b.status === "draft" ? b.updatedAt : b.publishedAt ?? b.createdAt).localeCompare(a.status === "draft" ? a.updatedAt : a.publishedAt ?? a.createdAt)
  );
}

function toDiffItem(i: LoopItem): LoopDiffItem {
  return { fileKey: i.fileKey, creativeId: i.creativeId, name: i.name, advertiser: i.advertiser, thumbUrl: i.thumbUrl, width: i.width, height: i.height };
}

/** "What changes vs the fleet loop" for a loop, by file. Null when there is no fleet loop or it is the fleet loop. */
export function loopDiffVsFleet(ctx: LoopsContext, loop: RecordModel): LoopDiff | null {
  const fleet = ctx.fleetLoop;
  if (!fleet || fleet.id === loop.id) return null;
  const cur = toLoopItems(ctx, loopItemsOf(loop));
  const base = toLoopItems(ctx, loopItemsOf(fleet));
  const d = diffLoopItems(cur, base);
  return {
    against: { id: fleet.id, name: fleet.name },
    added: d.added.map(toDiffItem),
    removed: d.removed.map(toDiffItem),
    kept: d.kept.map(toDiffItem),
    orderChanged: d.orderChanged,
    secondsBefore: d.secondsBefore,
    secondsAfter: d.secondsAfter,
    same: d.same,
  };
}

export function readOnlyReason(loop: RecordModel): string | null {
  if (loop.status === "imported")
    return "Made in Colorlight's own editor. A loop that's been on bags is kept as it was, so duplicate it as a draft to make changes.";
  if (loop.status === "published") return "This loop has been sent to bags, so it's kept as it was. Duplicate it as a draft to make changes.";
  if (loop.status === "archived") {
    const replaced = String(loop.notes ?? "").match(/Replaced on [^.]+\./)?.[0];
    return replaced ? `This version was archived: ${replaced.charAt(0).toLowerCase()}${replaced.slice(1)}` : "This loop is archived.";
  }
  return null;
}

export function toLoopDetail(ctx: LoopsContext, loop: RecordModel, last?: LoopDeploymentBrief | null): LoopDetail {
  const base = toLoopListItem(ctx, loop, last);
  const programId = loop.colorlight_program_id || null;
  const downloaded = programId ? ctx.activeBags.filter((b) => downloadedOf(b).some((p) => p.id === programId)) : [];
  const testBags = ctx.bags
    .filter((b) => config.testBagIds.includes(b.colorlight_id))
    .map((b) => {
      const ref = bagRef(b, ctx.now);
      const online = ref.status === "now";
      const offlineDays = !online && ref.lastReportAt ? Math.floor((ctx.now.getTime() - Date.parse(ref.lastReportAt)) / DAY) : null;
      return { ...ref, online, offlineDays };
    });
  const fleet = ctx.fleetLoop && ctx.fleetLoop.id !== loop.id ? ctx.fleetLoop : null;
  const reason = readOnlyReason(loop);
  return {
    ...base,
    readOnly: !!reason,
    readOnlyReason: reason,
    notes: loop.notes || "",
    bagsDownloadedList: downloaded.map((b) => bagRef(b, ctx.now)).sort(byName),
    fleetLoop: fleet ? { id: fleet.id, name: fleet.name, items: toLoopItems(ctx, loopItemsOf(fleet)) } : null,
    diff: loopDiffVsFleet(ctx, loop),
    publish: {
      writeMode: config.COLORLIGHT_WRITES,
      fleetWritesEnabled: ctx.settings.fleetWritesEnabled,
      testBags,
      fleetBagCount: ctx.activeBags.length,
      fleetLoopName: ctx.settings.fleetLoopName || null,
    },
  };
}

// ── Items validation ──────────────────────────────────────────────────────────

/**
 * Check and normalise a loop's items: every creative must exist, and a video
 * always plays for its own length (only images take a chosen time).
 */
export function normaliseItems(ctx: Pick<LoopsContext, "creativeById">, items: LoopItemInput[]): { items: LoopItemInput[]; error: string | null } {
  const out: LoopItemInput[] = [];
  for (const it of items) {
    const c = ctx.creativeById.get(it.creative);
    if (!c) return { items: [], error: "One of the ads is no longer in the library. Remove it and try again." };
    let seconds = Math.round(Number(it.seconds) * 10) / 10;
    if (c.media_type !== "image" && c.duration_s > 0) seconds = Math.round(c.duration_s * 10) / 10;
    if (!(seconds >= 1 && seconds <= 600)) return { items: [], error: `"${c.name}" needs a time between 1 and 600 seconds.` };
    out.push({ creative: c.id, seconds });
  }
  return { items: out, error: null };
}

// ── Deployments ───────────────────────────────────────────────────────────────

interface StoredDeliveryBag {
  id: string;
  name: string;
  colorlightId: number;
  groupId: number | null;
}

interface StoredDelivery {
  initial: Record<string, LoopDeliveryInitial>;
  steps: LoopDeploymentStep[];
  message: string;
  programName: string | null;
  loopName: string;
}

const EMPTY_COUNTS = (): Record<LoopDeliveryState, number> => ({
  playing: 0, downloaded: 0, waiting_offline: 0, sent: 0, dry_run: 0, blocked: 0, failed: 0,
});

export function toDeploymentBrief(r: RecordModel): LoopDeploymentBrief {
  const bags = Array.isArray(r.bags) ? r.bags : [];
  return { id: r.id, target: r.target, status: r.status, bagCount: bags.length, createdAt: iso(r.created) ?? "" };
}

export function toDeployment(ctx: LoopsContext, r: RecordModel): LoopDeployment {
  const stored = (r.delivery ?? {}) as Partial<StoredDelivery>;
  const bags = (Array.isArray(r.bags) ? r.bags : []) as StoredDeliveryBag[];
  const loop = ctx.loops.find((l) => l.id === r.loop);
  const programId = r.colorlight_program_id || loop?.colorlight_program_id || null;
  const programName = stored.programName ?? (loop ? programNameOf(loop) : null);
  const counts = EMPTY_COUNTS();
  const delivery: LoopDeliveryRow[] = bags.map((sb) => {
    const b = ctx.bags.find((x) => x.id === sb.id);
    const initial = stored.initial?.[sb.id] ?? (r.status === "sent" ? "sent" : r.status === "blocked" ? "blocked" : r.status === "failed" ? "failed" : "dry_run");
    const last = b ? parsePbDate(b.last_report_at) : null;
    const status = bagStatus(last, ctx.now.getTime());
    const d = b
      ? deliveryStateFor(
          initial,
          {
            status,
            playing: bagPlaying(b),
            downloadedProgramIds: downloadedOf(b).map((p) => p.id),
            downloadedProgramNames: downloadedOf(b).map((p) => p.name),
            lastReportAt: last?.toISOString() ?? null,
          },
          { id: programId, name: programName },
          ctx.now.getTime(),
        )
      : { state: initial === "sent" ? ("sent" as const) : initial, label: "Bag no longer listed", note: null };
    counts[d.state]++;
    return {
      bagId: sb.id,
      bagName: b?.name ?? sb.name,
      isTestBag: config.testBagIds.includes(sb.colorlightId),
      bagStatus: status,
      state: d.state,
      label: d.label,
      note: d.note,
    };
  });
  const order: Record<LoopDeliveryState, number> = { failed: 0, blocked: 1, waiting_offline: 2, sent: 3, downloaded: 4, playing: 5, dry_run: 6 };
  delivery.sort((a, b) => Number(b.isTestBag) - Number(a.isTestBag) || order[a.state] - order[b.state] || byName({ name: a.bagName }, { name: b.bagName }));
  return {
    ...toDeploymentBrief(r),
    loopId: r.loop,
    loopName: loop?.name ?? stored.loopName ?? "Deleted loop",
    message: stored.message ?? "",
    error: r.error || null,
    requestedBy: (r.expand?.requested_by as RecordModel | undefined)?.name ?? null,
    steps: stored.steps ?? [],
    delivery,
    counts,
  };
}

export async function deploymentsFor(ctx: LoopsContext, loopId: string | null, limit = 20): Promise<LoopDeployment[]> {
  const res = await pb.collection("deployments").getList<RecordModel>(1, limit, {
    filter: loopId ? `loop = ${q(loopId)}` : "",
    sort: "-created",
    expand: "requested_by",
    skipTotal: true,
  });
  return res.items.map((r) => toDeployment(ctx, r));
}

/** Latest deployment per loop, for list badges. */
export async function latestDeploymentByLoop(): Promise<Map<string, LoopDeploymentBrief>> {
  const res = await pb.collection("deployments").getList<RecordModel>(1, 200, { sort: "-created", fields: "id,loop,target,status,bags,created", skipTotal: true });
  const out = new Map<string, LoopDeploymentBrief>();
  for (const r of res.items) if (!out.has(r.loop)) out.set(r.loop, toDeploymentBrief(r));
  return out;
}

/** The item Colorlight's program editor expects for one creative. */
export function programItemFor(c: RecordModel, seconds: number): ProgramMediaItem {
  const url = String(c.colorlight_url || "");
  const base = decodeURIComponent(url.split("?")[0].split("/").pop() || "") || String(c.colorlight_md5 || c.name);
  const ext = (base.includes(".") ? base.split(".").pop()! : c.media_type === "image" ? "jpg" : "mp4").toLowerCase();
  return {
    fileID: Number(c.colorlight_media_id),
    filename: base,
    sourceUrl: url,
    fileType: ext,
    type: c.media_type === "image" ? "image" : "video",
    durationSeconds: Math.max(1, Math.round(seconds)),
    width: c.width || 160,
    height: c.height || 120,
  };
}

async function readPbFile(collection: string, id: string, filename: string): Promise<Buffer> {
  const token = await pb.files.getToken();
  const url = new URL(`${pb.baseURL}/api/files/${collection}/${id}/${encodeURIComponent(filename)}`);
  url.searchParams.set("token", token);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read the stored file (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

const TARGET: Record<LoopPublishRequest["target"], LoopDeploymentTarget> = { test: "test_bag", bags: "bags", fleet: "fleet" };

function targetLabel(target: LoopDeploymentTarget, bags: RecordModel[]): string {
  if (target === "test_bag") return bags.length === 1 ? `the test bag (${bags[0].name})` : "the test bags";
  if (target === "fleet") return `the whole fleet (${bags.length} bags)`;
  return bags.length === 1 ? bags[0].name : `${bags.length} bags`;
}

export class PublishError extends Error {}

/**
 * Send a loop to bags. The gate decides send / dry run / block; every attempt
 * is recorded (deployment + a command per bag) and audited. A draft becomes
 * "published" only when it was actually sent.
 */
export async function publishLoop(loopId: string, req: LoopPublishRequest, user: SessionUser): Promise<LoopPublishResult> {
  let ctx = await loadLoopsContext();
  const loop = ctx.loops.find((l) => l.id === loopId);
  if (!loop) throw new PublishError("Loop not found");
  if (loop.status === "archived") throw new PublishError("This loop is archived. Duplicate it to send it again.");
  const inputs = loopItemsOf(loop);
  if (!inputs.length) throw new PublishError("Add at least one ad before sending this loop.");
  const missing = inputs.filter((i) => !ctx.creativeById.has(i.creative));
  if (missing.length) throw new PublishError("One of the ads is no longer in the library. Remove it and save before sending.");

  // Colorlight tells programs apart by name on the bag, so a new one must not reuse a name.
  if (!loop.colorlight_program_id) {
    const clash = ctx.loops.find((l) => l.id !== loop.id && l.status !== "archived" && sameProgramName(programNameOf(l), loop.name));
    if (clash) throw new PublishError(`A loop called "${clash.name}" is already in Colorlight. Rename this one before sending, so bags can tell them apart.`);
  }

  // 1. Which bags
  const target = TARGET[req.target];
  let bags: RecordModel[];
  if (req.target === "test") {
    bags = ctx.bags.filter((b) => config.testBagIds.includes(b.colorlight_id));
    if (!bags.length) throw new PublishError("No test bag is set up, so there is nowhere safe to try this loop.");
  } else if (req.target === "bags") {
    const ids = [...new Set(req.bagIds ?? [])];
    if (!ids.length) throw new PublishError("Pick at least one bag.");
    bags = ids.map((id) => ctx.bags.find((b) => b.id === id)).filter((b): b is RecordModel => !!b);
    if (bags.length !== ids.length) throw new PublishError("One of the bags you picked no longer exists.");
    if (bags.some(isRetired)) throw new PublishError("Retired bags can't be sent a loop.");
  } else {
    bags = ctx.activeBags;
  }
  bags = [...bags].sort((a, b) => byName({ name: String(a.name) }, { name: String(b.name) }));
  const terminalIds = bags.map((b) => Number(b.colorlight_id));
  const label = targetLabel(target, bags);

  // 2. Ask the gate first, so nothing is uploaded or created for a send that can't happen.
  const steps: LoopDeploymentStep[] = [];
  const initial: Record<string, LoopDeliveryInitial> = {};
  let decision: GateDecision = await decideFor(terminalIds);
  let status: "dry_run" | "blocked" | "sent" | "failed" | "partial";
  let error = "";
  let programId: number | null = loop.colorlight_program_id || null;
  let programName: string | null = programNameOf(loop);
  let message = decision.reason;

  if (decision.action === "block") {
    status = "blocked";
    error = decision.reason;
    const blocked = new Set(decision.blocked);
    const names = bags.filter((b) => blocked.has(Number(b.colorlight_id))).map((b) => b.name);
    if (names.length && names.length < bags.length) message = `${decision.reason} Not allowed: ${names.slice(0, 6).join(", ")}${names.length > 6 ? ` and ${names.length - 6} more` : ""}.`;
    for (const b of bags) initial[b.id] = "blocked";
    steps.push({ step: "publish", label: `Send to ${label}`, result: "blocked", note: decision.reason });
  } else {
    try {
      // 3. Files that aren't in Colorlight yet
      const needUpload = [...new Set(inputs.map((i) => i.creative))]
        .map((id) => ctx.creativeById.get(id)!)
        .filter((c) => !(c.colorlight_media_id > 0));
      let uploaded = false;
      for (const c of needUpload) {
        if (!c.file) throw new PublishError(`"${c.name}" has no file to upload.`);
        if (!accountWritesAllowed()) {
          // Changes are off: record what would happen without reading the file.
          steps.push({ step: "upload", label: `Upload "${c.name}" to Colorlight`, result: "dry_run" });
          continue;
        }
        const bytes = await readPbFile("creatives", c.id, c.file);
        const mime = (c.checks as { mime?: string } | null)?.mime ?? creativeTypeOf(null, c.file) ?? "application/octet-stream";
        const up = await uploadMedia(bytes, c.file, mime, c.name);
        if (up.dryRun) {
          steps.push({ step: "upload", label: `Upload "${c.name}" to Colorlight`, result: "dry_run" });
        } else {
          const m = up.media;
          await pb.collection("creatives").update(c.id, {
            colorlight_media_id: m.id,
            colorlight_md5: m.name || c.colorlight_md5,
            colorlight_url: m.source_url || "",
          });
          uploaded = true;
          steps.push({ step: "upload", label: `Upload "${c.name}" to Colorlight`, result: "done" });
        }
      }
      if (uploaded) ctx = await loadLoopsContext(); // pick up the new Colorlight ids

      // 4. The program (loop) in Colorlight
      if (!programId) {
        const items = inputs.map((i) => programItemFor(ctx.creativeById.get(i.creative)!, i.seconds));
        const made = await createProgram(loop.name, items);
        if (made.dryRun) {
          steps.push({ step: "program", label: `Create "${loop.name}" in Colorlight`, result: "dry_run" });
        } else {
          programId = made.program.id;
          programName = made.program.name || loop.name;
          await pb.collection("loops").update(loop.id, {
            colorlight_program_id: programId,
            colorlight_program_name: programName,
            colorlight_vsn: made.program.vsn ?? "",
          });
          steps.push({ step: "program", label: `Create "${loop.name}" in Colorlight`, result: "done" });
        }
      } else {
        steps.push({ step: "program", label: `"${programName ?? loop.name}" is already in Colorlight`, result: "skipped" });
      }

      // 5. Publish, one call per bag group (never group-wide: explicit bags only)
      const groups = new Map<number, RecordModel[]>();
      for (const b of bags) {
        const gid = Number(b.group_id) || 0;
        groups.set(gid, [...(groups.get(gid) ?? []), b]);
      }
      const results: ("send" | "dry_run" | "block" | "failed")[] = [];
      for (const [gid, gbags] of groups) {
        if (!gid) {
          for (const b of gbags) initial[b.id] = "failed";
          results.push("failed");
          error = `${gbags.map((b) => b.name).join(", ")} ${gbags.length === 1 ? "has" : "have"} no Colorlight group, so ${gbags.length === 1 ? "it" : "they"} can't be sent a loop.`;
          continue;
        }
        if (decision.action === "send" && !programId) throw new PublishError("The loop wasn't created in Colorlight, so it can't be sent.");
        try {
          const out = await publishProgram(programId ?? 0, gid, gbags.map((b) => Number(b.colorlight_id)));
          decision = out.decision;
          const r = out.decision.action;
          for (const b of gbags) initial[b.id] = r === "send" ? "sent" : r === "dry_run" ? "dry_run" : "blocked";
          results.push(r);
          if (r === "block") error = out.decision.reason;
        } catch (err) {
          for (const b of gbags) initial[b.id] = "failed";
          results.push("failed");
          error = (err as Error).message;
        }
      }
      const sent = results.filter((r) => r === "send").length;
      if (sent && sent === results.length) status = "sent";
      else if (sent) status = "partial";
      else if (results.includes("failed")) status = "failed";
      else if (results.includes("block")) status = "blocked";
      else status = "dry_run";
      message = status === "sent" ? `Sent to ${label}. Bags download it the next time they connect.` : status === "dry_run" ? decision.reason : error || decision.reason;
      steps.push({
        step: "publish",
        label: `Send to ${label}`,
        result: status === "sent" ? "done" : status === "dry_run" ? "dry_run" : status === "blocked" ? "blocked" : "failed",
        note: status === "partial" ? error : undefined,
      });
    } catch (err) {
      status = "failed";
      error = (err as Error).message;
      message = `Couldn't send: ${error}`;
      for (const b of bags) initial[b.id] ??= "failed";
      steps.push({ step: "publish", label: `Send to ${label}`, result: "failed", note: error });
      log.warn(`publishing loop ${loop.id} failed`, err);
    }
  }

  // 6. Record it: the deployment, a command per bag, and the audit trail.
  const stored: StoredDelivery = { initial, steps, message, programName, loopName: loop.name };
  const rec = await pb.collection("deployments").create<RecordModel>(
    {
      loop: loop.id,
      target,
      bags: bags.map((b) => ({ id: b.id, name: b.name, colorlightId: Number(b.colorlight_id), groupId: Number(b.group_id) || null })),
      colorlight_program_id: programId ?? null,
      status,
      delivery: stored,
      error: error.slice(0, 1900),
      requested_by: user.id,
    },
    { expand: "requested_by" },
  );
  await batchCreate(
    "commands",
    bags.map((b) => ({
      bag: b.id,
      type: "publish",
      value: { loopId: loop.id, loopName: loop.name, deploymentId: rec.id, programId },
      status: initial[b.id] === "sent" ? "sent" : initial[b.id] === "dry_run" ? "dry_run" : initial[b.id] === "blocked" ? "blocked" : "failed",
      error: initial[b.id] === "sent" || initial[b.id] === "dry_run" ? "" : error.slice(0, 1900),
      requested_by: user.id,
    })),
  ).catch((err) => log.warn("could not record per-bag publish commands", err));

  const summary = {
    sent: `Sent "${loop.name}" to ${label}`,
    partial: `Sent "${loop.name}" to some of ${label}`,
    dry_run: `Dry run of sending "${loop.name}" to ${label} — nothing sent`,
    blocked: `Blocked sending "${loop.name}" to ${label} — nothing sent`,
    failed: `Couldn't send "${loop.name}" to ${label}`,
  }[status];
  await audit(user, "loop.publish", summary, { type: "loop", id: loop.id }, {
    deploymentId: rec.id,
    target,
    status,
    bags: bags.map((b) => b.name),
    reason: message,
  });

  // A draft becomes published only when it actually reached bags.
  if ((status === "sent" || status === "partial") && loop.status === "draft") {
    await pb.collection("loops").update(loop.id, { status: "published", published_at: pbDate(new Date()) });
  }
  // Sending to every bag makes this the fleet loop.
  if (status === "sent" && target === "fleet" && programName && !sameProgramName(programName, ctx.settings.fleetLoopName)) {
    const before = ctx.settings.fleetLoopName;
    await updateSettings({ fleetLoopName: programName });
    await audit(user, "settings.update", `Fleet loop changed from "${before}" to "${programName}"`, { type: "settings", id: "main" });
  }
  invalidateBags();

  const fresh = await loadLoopsContext();
  const deployment = toDeployment(fresh, { ...rec, expand: rec.expand });
  const headline =
    status === "sent"
      ? `Sent to ${label}.`
      : status === "partial"
        ? `Sent to some bags. ${error}`
        : status === "dry_run"
          ? message
          : status === "blocked"
            ? `Blocked — nothing was sent. ${message}`
            : `Couldn't send. ${error}`;
  return { deployment, message: headline };
}
