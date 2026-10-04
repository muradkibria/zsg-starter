// Contracts and pure helpers for the Ads & loops area.
//
// Vocabulary: a creative is one ad file; a loop is an ordered set of creatives
// (a Colorlight "program"); a deployment is one attempt to send a loop to bags.
// Names here are prefixed (Library*, Loop*) so they never clash with other areas.

import type { WriteMode } from "../api";
import type { BagStatus } from "../status";

// ── Screen & upload rules ─────────────────────────────────────────────────────

/** Every bag's LED screen. */
export const LOOP_SCREEN = { width: 160, height: 120 } as const;
export const CREATIVE_MAX_BYTES = 100 * 1024 * 1024;
export const CREATIVE_MAX_SECONDS = 60;
/** Images have no length of their own; they show for this long unless changed. */
export const IMAGE_DEFAULT_SECONDS = 10;

export const CREATIVE_TYPES: Record<string, { ext: string[]; media: LibraryMediaType; label: string }> = {
  "video/mp4": { ext: ["mp4", "m4v"], media: "video", label: "MP4" },
  "video/quicktime": { ext: ["mov"], media: "video", label: "MOV" },
  "image/jpeg": { ext: ["jpg", "jpeg"], media: "image", label: "JPG" },
  "image/png": { ext: ["png"], media: "image", label: "PNG" },
  "image/gif": { ext: ["gif"], media: "image", label: "GIF" },
};

export type LibraryMediaType = "video" | "image";
export type LibrarySource = "uploaded" | "colorlight";

/** Resolve a file's type from its MIME type, falling back to the extension. */
export function creativeTypeOf(mime: string | null | undefined, filename: string): string | null {
  const m = (mime ?? "").toLowerCase();
  if (CREATIVE_TYPES[m]) return m;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  for (const [type, def] of Object.entries(CREATIVE_TYPES)) if (def.ext.includes(ext)) return type;
  return null;
}

export type CreativeProblemKind = "unsupported" | "too_big" | "too_long" | "wrong_shape" | "unreadable";

export interface CreativeProblem {
  kind: CreativeProblemKind;
  /** Short heading, e.g. "Wrong shape" */
  title: string;
  /** One plain sentence with the fix */
  detail: string;
  /** Hard problems can't be added at all; soft ones can be added anyway. */
  hard: boolean;
}

export interface CreativeFileFacts {
  filename: string;
  mime: string | null;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationS: number | null;
  /** The browser could not decode the file */
  unreadable?: boolean;
}

export interface CreativeCheck {
  ok: boolean;
  type: string | null;
  mediaType: LibraryMediaType | null;
  problems: CreativeProblem[];
  /** Soft problems only (can still be added on purpose) */
  canAddAnyway: boolean;
}

export function creativeSizeLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** True when w × h is the screen's 4:3 shape (within 2%). */
export function isScreenShape(width: number | null | undefined, height: number | null | undefined): boolean | null {
  if (!width || !height) return null;
  const want = LOOP_SCREEN.width / LOOP_SCREEN.height;
  return Math.abs(width / height - want) / want <= 0.02;
}

function shapeName(w: number, h: number): string {
  const r = w / h;
  if (Math.abs(r - 1) < 0.02) return "square";
  if (Math.abs(r - 16 / 9) < 0.03) return "widescreen (16:9)";
  if (Math.abs(r - 9 / 16) < 0.03) return "portrait (9:16)";
  return r > 1 ? "wider than the screen" : "taller than the screen";
}

/**
 * The upload check, shared by the browser (before upload) and the server.
 * Returns problems only — a clean file is simply `ok`.
 */
export function checkCreativeFile(f: CreativeFileFacts): CreativeCheck {
  const problems: CreativeProblem[] = [];
  const type = creativeTypeOf(f.mime, f.filename);
  const mediaType = type ? CREATIVE_TYPES[type].media : null;
  if (!type) {
    const ext = f.filename.includes(".") ? `.${f.filename.split(".").pop()}` : "this file";
    problems.push({
      kind: "unsupported",
      title: "Can't use this file type",
      detail: `${ext} isn't supported. Use MP4, MOV, JPG, PNG or GIF.`,
      hard: true,
    });
  }
  if (f.sizeBytes > CREATIVE_MAX_BYTES) {
    problems.push({
      kind: "too_big",
      title: "Too big",
      detail: `${creativeSizeLabel(f.sizeBytes)} is over the 100 MB limit. Export a smaller file.`,
      hard: true,
    });
  }
  if (type && f.unreadable) {
    const video = mediaType === "video";
    problems.push({
      kind: "unreadable",
      title: video ? "Couldn't play this video here" : "Couldn't read this file",
      detail: video
        ? "Its size and length couldn't be checked, and it may not play on the bags. Export it as an MP4 (H.264) if you can."
        : "It may be damaged. Try exporting it again.",
      hard: !video,
    });
  }
  if (mediaType === "video" && f.durationS != null && f.durationS > CREATIVE_MAX_SECONDS + 0.5) {
    problems.push({
      kind: "too_long",
      title: "Too long",
      detail: `It runs ${Math.round(f.durationS)} s. Keep ads to ${CREATIVE_MAX_SECONDS} s or less so the loop keeps moving.`,
      hard: false,
    });
  }
  if (f.width && f.height && isScreenShape(f.width, f.height) === false) {
    problems.push({
      kind: "wrong_shape",
      title: "Wrong size",
      detail: `${f.width} × ${f.height} is ${shapeName(f.width, f.height)}. The screen is ${LOOP_SCREEN.width} × ${LOOP_SCREEN.height} (4:3), so it will look squashed.`,
      hard: false,
    });
  }
  const hard = problems.some((p) => p.hard);
  return { ok: problems.length === 0, type, mediaType, problems, canAddAnyway: !hard && problems.length > 0 };
}

/** Clean a filename into a readable ad name: "kungpao_oct-v2.mp4" → "kungpao oct v2". */
export function creativeNameFromFile(filename: string): string {
  const base = filename.replace(/\.[a-z0-9]{2,4}$/i, "");
  return base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "New ad";
}

// ── Library (creatives) ───────────────────────────────────────────────────────

export interface LibraryCampaignRef {
  id: string;
  name: string;
  advertiser: string;
  endDate: string | null;
  status: string | null;
}

export interface LibraryLoopRef {
  id: string;
  name: string;
  status: LoopStatus;
  isFleetLoop: boolean;
}

export interface LibraryCreative {
  id: string;
  name: string;
  advertiser: string;
  campaign: LibraryCampaignRef | null;
  mediaType: LibraryMediaType;
  durationS: number | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  /** Same-origin thumbnail (`/api/creatives/:id/thumb`), or null when none is cached */
  thumbUrl: string | null;
  /** The playable file (uploads, and Colorlight files once the sync has recorded them) */
  fileUrl: string | null;
  source: LibrarySource;
  createdAt: string;
  archived: boolean;
  /** Plays in the last 7 days across all bags (measured) */
  plays7d: number;
  loops: LibraryLoopRef[];
  /** Bags whose current loop contains this file */
  bagsNow: number;
  /** Identical copies of this file in the Colorlight library (shown once here) */
  copies: number;
  copyIds: string[];
  /** Key that identifies the file itself (Colorlight file name, or our id) */
  fileKey: string;
  /** True once the file exists in Colorlight */
  onColorlight: boolean;
  /** 4:3 like the screen? null when the size is unknown */
  screenShape: boolean | null;
  /** Campaign has ended but the ad is still on bags */
  endedStillPlaying: boolean;
}

export interface LibraryCreativePatch {
  name?: string;
  advertiser?: string;
  campaign?: string | null;
  archived?: boolean;
}

// ── Loops ─────────────────────────────────────────────────────────────────────

export type LoopStatus = "draft" | "published" | "imported" | "archived";

/** How a loop item is stored: `loops.items` = [{ creative, seconds }]. */
export interface LoopItemInput {
  creative: string;
  seconds: number;
}

export interface LoopItem {
  creativeId: string;
  seconds: number;
  name: string;
  advertiser: string;
  mediaType: LibraryMediaType | null;
  /** The file's own length (videos) */
  durationS: number | null;
  width: number | null;
  height: number | null;
  thumbUrl: string | null;
  fileKey: string;
  /** Creative record no longer exists */
  missing: boolean;
  archived: boolean;
  screenShape: boolean | null;
}

export interface LoopBagRef {
  id: string;
  name: string;
  status: BagStatus;
  isTestBag: boolean;
  lastReportAt: string | null;
}

export interface LoopListItem {
  id: string;
  name: string;
  status: LoopStatus;
  items: LoopItem[];
  totalSeconds: number;
  /** Times the whole loop plays in an hour of screen time */
  cyclesPerHour: number;
  programName: string | null;
  programId: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Days since it was published (or created in Colorlight) */
  ageDays: number | null;
  isFleetLoop: boolean;
  bagsPlaying: LoopBagRef[];
  bagsDownloaded: number;
  lastDeployment: LoopDeploymentBrief | null;
}

export interface LoopDiffItem {
  fileKey: string;
  creativeId: string;
  name: string;
  advertiser: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
}

export interface LoopDiff {
  against: { id: string; name: string };
  added: LoopDiffItem[];
  removed: LoopDiffItem[];
  kept: LoopDiffItem[];
  orderChanged: boolean;
  secondsBefore: number;
  secondsAfter: number;
  same: boolean;
}

export interface LoopTestBag extends LoopBagRef {
  online: boolean;
  /** Whole days since it last reported, when offline */
  offlineDays: number | null;
}

export interface LoopPublishContext {
  writeMode: WriteMode;
  fleetWritesEnabled: boolean;
  testBags: LoopTestBag[];
  /** Non-retired bags (what "whole fleet" sends to) */
  fleetBagCount: number;
  fleetLoopName: string | null;
}

export interface LoopFleetRef {
  id: string;
  name: string;
  items: LoopItem[];
}

export interface LoopDetail extends LoopListItem {
  readOnly: boolean;
  /** Why it's read-only, in plain English */
  readOnlyReason: string | null;
  notes: string;
  bagsDownloadedList: LoopBagRef[];
  /** The fleet loop to compare against (null when this is it, or none is set) */
  fleetLoop: LoopFleetRef | null;
  diff: LoopDiff | null;
  publish: LoopPublishContext;
}

export interface LoopCreateRequest {
  name?: string;
  /** Duplicate this loop's items (any loop, including imported ones) */
  from?: string;
  items?: LoopItemInput[];
}

export interface LoopPatch {
  name?: string;
  items?: LoopItemInput[];
  notes?: string;
}

// ── Deployments (sending a loop to bags) ──────────────────────────────────────

export type LoopPublishTarget = "test" | "bags" | "fleet";
export type LoopDeploymentTarget = "test_bag" | "bags" | "fleet";
export type LoopDeploymentStatus = "dry_run" | "blocked" | "sending" | "sent" | "failed" | "confirmed" | "partial";

export interface LoopPublishRequest {
  target: LoopPublishTarget;
  bagIds?: string[];
}

/** What we recorded for each bag when the send was attempted. */
export type LoopDeliveryInitial = "sent" | "dry_run" | "blocked" | "failed";

/** Live state of one bag for a deployment. */
export type LoopDeliveryState = "playing" | "downloaded" | "waiting_offline" | "sent" | "dry_run" | "blocked" | "failed";

export interface LoopDeliveryRow {
  bagId: string;
  bagName: string;
  isTestBag: boolean;
  bagStatus: BagStatus;
  state: LoopDeliveryState;
  /** Plain-English state, e.g. "Playing — confirmed by the bag" */
  label: string;
  /** Extra context, e.g. "Offline for 60 days" */
  note: string | null;
}

export interface LoopDeploymentStep {
  step: "upload" | "program" | "publish";
  label: string;
  result: "done" | "dry_run" | "skipped" | "blocked" | "failed";
  note?: string;
}

export interface LoopDeploymentBrief {
  id: string;
  target: LoopDeploymentTarget;
  status: LoopDeploymentStatus;
  bagCount: number;
  createdAt: string;
}

export interface LoopDeployment extends LoopDeploymentBrief {
  loopId: string;
  loopName: string;
  /** The gate's plain-English answer */
  message: string;
  error: string | null;
  requestedBy: string | null;
  steps: LoopDeploymentStep[];
  delivery: LoopDeliveryRow[];
  counts: Record<LoopDeliveryState, number>;
}

export interface LoopPublishResult {
  deployment: LoopDeployment;
  message: string;
}

// ── Pure helpers (used by the API and the editor) ─────────────────────────────

/** Total loop length in seconds. */
export function loopTotalSeconds(items: { seconds: number }[]): number {
  return items.reduce((n, i) => n + (Number.isFinite(i.seconds) && i.seconds > 0 ? i.seconds : 0), 0);
}

/** How many times the loop plays through in an hour of screen time (0 when empty). */
export function loopCyclesPerHour(items: { seconds: number }[]): number {
  const total = loopTotalSeconds(items);
  return total > 0 ? Math.floor(3600 / total) : 0;
}

/** Plays per hour for each file in the loop (a file listed twice plays twice per cycle). */
export function loopPlaysPerHour(items: { fileKey: string; seconds: number }[]): Map<string, number> {
  const cycles = 3600 / Math.max(1, loopTotalSeconds(items));
  const out = new Map<string, number>();
  if (!loopTotalSeconds(items)) return out;
  for (const i of items) out.set(i.fileKey, (out.get(i.fileKey) ?? 0) + cycles);
  for (const [k, v] of out) out.set(k, Math.floor(v));
  return out;
}

/** Start/end second of each slot: [[0,10],[10,20],…]. */
export function loopSlotTimes(items: { seconds: number }[]): [number, number][] {
  let t = 0;
  return items.map((i) => {
    const s = Number.isFinite(i.seconds) && i.seconds > 0 ? i.seconds : 0;
    const slot: [number, number] = [t, t + s];
    t += s;
    return slot;
  });
}

/** Move one item from index `from` to index `to`, returning a new array. */
export function moveLoopItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list.slice();
  const next = list.slice();
  const [it] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, it);
  return next;
}

/**
 * What changes between a loop and the fleet loop, by file (identical copies of a
 * file count as the same ad).
 */
export function diffLoopItems<T extends { fileKey: string; seconds: number }>(
  current: T[],
  base: T[],
): { added: T[]; removed: T[]; kept: T[]; orderChanged: boolean; secondsBefore: number; secondsAfter: number; same: boolean } {
  const baseKeys = new Set(base.map((i) => i.fileKey));
  const curKeys = new Set(current.map((i) => i.fileKey));
  const uniq = (list: T[]) => {
    const seen = new Set<string>();
    return list.filter((i) => (seen.has(i.fileKey) ? false : (seen.add(i.fileKey), true)));
  };
  const added = uniq(current.filter((i) => !baseKeys.has(i.fileKey)));
  const removed = uniq(base.filter((i) => !curKeys.has(i.fileKey)));
  const kept = uniq(current.filter((i) => baseKeys.has(i.fileKey)));
  const keptOrderNow = current.map((i) => i.fileKey).filter((k) => baseKeys.has(k));
  const keptOrderBefore = base.map((i) => i.fileKey).filter((k) => curKeys.has(k));
  const orderChanged = keptOrderNow.join("|") !== keptOrderBefore.join("|");
  const secondsBefore = loopTotalSeconds(base);
  const secondsAfter = loopTotalSeconds(current);
  const same =
    !added.length && !removed.length && !orderChanged && secondsBefore === secondsAfter && current.length === base.length;
  return { added, removed, kept, orderChanged, secondsBefore, secondsAfter, same };
}

/** Program names a bag might report: "June 26" or the raw VSN file "June 26_<md5>_7174.vsn". */
export function sameProgramName(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  return !!norm(a) && norm(a) === norm(b);
}

export interface LoopDeliveryBagFacts {
  /** Bag status bucket ("now" = reported in the last 3 minutes) */
  status: BagStatus;
  playing: string | null;
  downloadedProgramIds: number[];
  downloadedProgramNames: string[];
  lastReportAt: string | null;
}

/**
 * Live delivery state of one bag for a loop that was sent:
 * playing › downloaded › waiting (bag offline) › sent.
 */
export function deliveryStateFor(
  initial: LoopDeliveryInitial,
  bag: LoopDeliveryBagFacts,
  program: { id: number | null; name: string | null },
  now = Date.now(),
): { state: LoopDeliveryState; label: string; note: string | null } {
  const offlineDays = bag.lastReportAt ? Math.floor((now - Date.parse(bag.lastReportAt)) / 86400000) : null;
  const offline = bag.status !== "now";
  const offlineNote = !offline
    ? null
    : offlineDays == null
      ? "Never seen"
      : offlineDays >= 1
        ? `Offline for ${offlineDays} ${offlineDays === 1 ? "day" : "days"}`
        : "Offline right now";
  if (initial === "dry_run") return { state: "dry_run", label: "Not sent — dry run", note: offlineNote };
  if (initial === "blocked") return { state: "blocked", label: "Blocked — not sent", note: offlineNote };
  if (initial === "failed") return { state: "failed", label: "Couldn't send", note: offlineNote };
  if (program.name && sameProgramName(bag.playing, program.name)) {
    return { state: "playing", label: "Playing — confirmed by the bag", note: null };
  }
  const downloaded =
    (program.id != null && bag.downloadedProgramIds.includes(program.id)) ||
    (program.id == null && !!program.name && bag.downloadedProgramNames.some((n) => sameProgramName(n, program.name)));
  if (downloaded) return { state: "downloaded", label: "Downloaded — not playing yet", note: offlineNote };
  if (offline) return { state: "waiting_offline", label: "Waiting — bag offline, sends when it connects", note: offlineNote };
  return { state: "sent", label: "Sent — waiting for the bag to download", note: null };
}

/** "today", "5 days old", "3 weeks old", "3 months old". */
export function loopAgeLabel(ageDays: number | null): string | null {
  if (ageDays == null) return null;
  if (ageDays < 1) return "Published today";
  if (ageDays < 14) return `${ageDays} ${ageDays === 1 ? "day" : "days"} old`;
  if (ageDays < 60) return `${Math.floor(ageDays / 7)} weeks old`;
  const months = Math.floor(ageDays / 30);
  if (months < 24) return `${months} months old`;
  return `${Math.floor(ageDays / 365)} years old`;
}

/** The fleet loop is "stale" once it's more than 60 days old. */
export const FLEET_LOOP_STALE_DAYS = 60;
