// Campaigns: contracts, the creatives linked to them, measured plays, live
// inventory and the numbers behind client reports.
//
// Everything here is MEASURED: plays and seconds come from the bags' play logs
// (plays collection, per bag per hour per file), distance / time out / zones
// from each bag's day (bag_days) and routes from GPS. Nothing is modelled.
//
// Plays can't tell apart library records that share one Colorlight file, so a
// campaign's plays are counted per distinct file (colorlight_md5), never per
// record.
//
// Pure helpers first (unit-tested in test/campaigns.test.ts), then the
// PocketBase-backed loaders.

import {
  gbDateFormat,
  addDays,
  daysBetween,
  londonDayBounds,
  londonDayStart,
  londonParts,
  programNameFromVsn,
  simplifyLine,
  sortPoints,
  spreadLatePoints,
  todayLondon,
  type CampaignBagRow,
  type CampaignChain,
  type CampaignChainLoop,
  type CampaignCreativeFile,
  type CampaignDayPlays,
  type CampaignDetail,
  type CampaignListResponse,
  type CampaignMapLine,
  type CampaignPhase,
  type CampaignReport,
  type CampaignStats,
  type CampaignStatus,
  type CampaignSummary,
  type InventoryBag,
  type InventoryLoop,
  type InventoryResponse,
  type InventorySlot,
  type SlotKind,
  type TimeOfDayBand,
  type ZoneTime,
} from "@digilite/shared";
import { getAll, getOneOrNull, parsePbDate, pb, pbDate, q, type RecordModel } from "../pb";
import { activeAt, allAssignments, currentRiderByBag } from "./assignments";
import { isTestBag, loadBags } from "./bags";
import { analyticsConfig } from "./settings";
import { bagDays, loadPlacedPoints, loadPoints } from "./tracks";
import { zoneNames } from "./zones";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");

// ══════════════════════════════════════════════════════════════════════════════
// Pure helpers
// ══════════════════════════════════════════════════════════════════════════════

const noon = (day: string) => new Date(`${day}T12:00:00Z`);
const fmtShort = gbDateFormat({ timeZone: "UTC", day: "numeric", month: "short" });
const fmtDayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" });
const fmtMonth = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long" });

/** "6 Oct" */
export const dayShort = (day: string) => fmtShort.format(noon(day));

/** Whole days from a to b (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export const fmtNum = (n: number) => Math.round(n).toLocaleString("en-GB");
const bagsWord = (n: number) => `${fmtNum(n)} ${n === 1 ? "bag" : "bags"}`;

/** DigiLite's own (house) ads and advertisers. */
export function isHouse(text: string | null | undefined): boolean {
  return !!text && /digi\s*-?\s*lite/i.test(text);
}

export interface StatusFacts {
  /** Ad files linked */
  creativeFiles: number;
  /** Bags with plays in the last 7 days */
  bagsCarrying: number;
  /** Plays after the end date (any time) */
  playsAfterEnd: number;
  /** Bags with plays after the end date, in the last 7 days */
  bagsAfterEnd: number;
}

export const NO_FACTS: StatusFacts = { creativeFiles: 0, bagsCarrying: 0, playsAfterEnd: 0, bagsAfterEnd: 0 };

/** Honest status from the dates, the confirmed flag and what the bags actually played. */
export function campaignStatus(
  c: { confirmed: boolean; startDay: string | null; endDay: string | null },
  today: string,
  f: StatusFacts,
): CampaignStatus {
  if (!c.startDay || !c.endDay) return { phase: "draft", label: "Draft", tone: "neutral", note: "No dates set", warn: false };
  if (!c.confirmed) {
    return f.bagsCarrying > 0
      ? { phase: "draft", label: "Draft", tone: "neutral", note: `Not confirmed · already on ${bagsWord(f.bagsCarrying)}`, warn: true }
      : { phase: "draft", label: "Draft", tone: "neutral", note: "Not confirmed yet", warn: false };
  }
  if (today < c.startDay) {
    const label = `Starts ${dayShort(c.startDay)}`;
    if (f.creativeFiles === 0) return { phase: "upcoming", label, tone: "info", note: "No creatives linked yet", warn: false };
    if (f.bagsCarrying > 0) return { phase: "upcoming", label, tone: "info", note: `Already on ${bagsWord(f.bagsCarrying)}`, warn: true };
    return { phase: "upcoming", label, tone: "info", note: "Not on screen yet", warn: false };
  }
  if (today <= c.endDay) {
    const left = dayDiff(today, c.endDay);
    const dayN = dayDiff(c.startDay, today) + 1;
    const total = dayDiff(c.startDay, c.endDay) + 1;
    const [note, warn] =
      f.creativeFiles === 0
        ? ["No creatives linked", true]
        : f.bagsCarrying === 0
          ? ["Not on screen in the last 7 days", true]
          : [`Day ${dayN} of ${total}`, false];
    if (left <= 7) {
      const label = left === 0 ? "Ends today" : left === 1 ? "Ends tomorrow" : `Ending in ${left} days`;
      return { phase: "ending", label, tone: "amber", note, warn };
    }
    return { phase: "live", label: "Live", tone: "green", note, warn };
  }
  if (f.bagsAfterEnd > 0) {
    return { phase: "ended_on_screen", label: "Ended — still on screen", tone: "red", note: `Still playing on ${bagsWord(f.bagsAfterEnd)}`, warn: true };
  }
  return {
    phase: "ended",
    label: "Ended",
    tone: "neutral",
    note: f.playsAfterEnd > 0 ? `${fmtNum(f.playsAfterEnd)} plays after it ended` : `Ended ${dayShort(c.endDay)}`,
    warn: false,
  };
}

const PHASE_RANK: Record<CampaignPhase, number> = { ending: 0, live: 1, ended_on_screen: 2, upcoming: 3, draft: 4, ended: 5 };

/** Running first (ending soonest), then ended-but-playing, upcoming, drafts, ended. */
export function compareCampaigns(a: CampaignSummary, b: CampaignSummary): number {
  const r = PHASE_RANK[a.status.phase] - PHASE_RANK[b.status.phase];
  if (r) return r;
  const ph = a.status.phase;
  if (ph === "live" || ph === "ending") return (a.endDay ?? "").localeCompare(b.endDay ?? "");
  if (ph === "upcoming" || ph === "draft") return (a.startDay ?? "9999").localeCompare(b.startDay ?? "9999");
  return (b.endDay ?? "").localeCompare(a.endDay ?? "");
}

// ── Suggested creatives (advertiser name ↔ file name) ─────────────────────────

const STOP = new Set(["the", "and", "ltd", "limited", "plc", "inc", "co", "uk", "group", "llp", "company"]);
const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
const compact = (s: string) => fold(s).replace(/[^a-z0-9]+/g, "");
const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOP.has(t));

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

function tokenHit(t: string, cand: string[]): boolean {
  return cand.some((x) => x === t || (t.length >= 3 && x.length >= 3 && editDistance(x, t) <= 1 && (t.length >= 4 || x.length === t.length)));
}

/**
 * How likely a creative belongs to an advertiser, from names alone.
 * 1 = the name contains the advertiser; 0.5–0.9 = shares its words; null = no match.
 */
export function matchScore(advertiser: string, creativeName: string, creativeAdvertiser?: string | null): { score: number; reason: string } | null {
  const a = compact(advertiser);
  if (a.length < 3) return null;
  if (creativeAdvertiser && compact(creativeAdvertiser) === a) return { score: 1, reason: "Same advertiser" };
  if (compact(creativeName).includes(a)) return { score: 1, reason: `Name contains “${advertiser.trim()}”` };
  const at = tokens(advertiser).filter((t) => t.length >= 3);
  if (!at.length) return null;
  const ct = tokens(creativeName);
  const hits = at.filter((t) => tokenHit(t, ct));
  if (!hits.length) return null;
  const share = hits.length / at.length;
  const firstHit = hits[0] === at[0] && at[0].length >= 4;
  const score = share >= 0.5 && hits.some((t) => t.length >= 4) ? Math.min(0.9, share) : firstHit ? 0.6 : 0;
  if (score < 0.5) return null;
  return { score: Math.round(score * 100) / 100, reason: `Name shares “${hits.join("”, “")}”` };
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export interface InvBag {
  id: string;
  name: string;
  lastReportAt: Date | null;
  lifecycle: string;
  isTest: boolean;
  playing: string | null;
}
export interface InvLoop {
  id: string;
  name: string;
  programName: string;
  status: string;
  publishedAt: Date | null;
  items: { creative: string }[];
}
export interface InvCreative {
  id: string;
  name: string;
  advertiser: string;
  campaignId: string | null;
}
export interface InvCampaign {
  id: string;
  label: string;
  advertiser: string;
  phase: CampaignPhase;
  demo: boolean;
}

/** The loop a bag reports playing (matched by name; most recently published wins). */
export function findLoop<L extends Pick<InvLoop, "name" | "programName" | "status" | "publishedAt">>(loops: L[], playing: string | null): L | null {
  if (!playing) return null;
  const want = playing.trim().toLowerCase();
  const matches = loops.filter(
    (l) => l.status !== "archived" && (l.name.trim().toLowerCase() === want || (l.programName ?? "").trim().toLowerCase() === want),
  );
  matches.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
  return matches[0] ?? null;
}

export function slotKind(creative: InvCreative | null, campaign: InvCampaign | null): SlotKind {
  if (campaign && (campaign.phase === "live" || campaign.phase === "ending") && !isHouse(campaign.advertiser)) return "sold";
  if (creative && (isHouse(creative.name) || isHouse(creative.advertiser))) return "house";
  if (campaign && isHouse(campaign.advertiser)) return "house";
  if (campaign && (campaign.phase === "ended" || campaign.phase === "ended_on_screen")) return "unsold_ended";
  return "unsold";
}

/**
 * Live inventory: bags out in the last `windowDays` × the slots in the loop
 * each one reports playing. Bags not out for a week aren't counted (but are
 * reported), retired bags and the test bag are left out.
 */
export function computeInventory(input: {
  now: Date;
  bags: InvBag[];
  loops: InvLoop[];
  creatives: Map<string, InvCreative>;
  campaigns: Map<string, InvCampaign>;
  windowDays?: number;
}): InventoryResponse {
  const windowDays = input.windowDays ?? 7;
  const windowMs = windowDays * DAY_MS;
  const live = input.bags.filter((b) => b.lifecycle !== "retired");
  const pool = live.filter((b) => !b.isTest);

  const slotCache = new Map<string, InventorySlot[]>();
  const slotsOf = (loop: InvLoop | null): InventorySlot[] => {
    if (!loop) return [];
    const hit = slotCache.get(loop.id);
    if (hit) return hit;
    const slots = loop.items.map((it, i) => {
      const cr = input.creatives.get(it.creative) ?? null;
      const camp = cr?.campaignId ? input.campaigns.get(cr.campaignId) ?? null : null;
      return {
        position: i + 1,
        creativeId: cr?.id ?? null,
        name: cr?.name ?? "Missing creative",
        kind: slotKind(cr, camp),
        campaignId: camp?.id ?? null,
        campaignLabel: camp?.label ?? null,
      };
    });
    slotCache.set(loop.id, slots);
    return slots;
  };

  let bagsCounted = 0;
  let bagsNotCounted = 0;
  let slotsNotCounted = 0;
  let bagsUnknownLoop = 0;
  const totals: Record<SlotKind, number> = { sold: 0, house: 0, unsold_ended: 0, unsold: 0 };
  const loopAgg = new Map<string, InventoryLoop>();
  const soldBy = new Map<string, { campaignId: string; label: string; slots: number; demo: boolean }>();
  const endedBy = new Map<string, { campaignId: string; label: string; slots: number }>();
  const grid: InventoryBag[] = [];

  for (const b of pool) {
    const counted = !!b.lastReportAt && input.now.getTime() - b.lastReportAt.getTime() <= windowMs;
    const loop = findLoop(input.loops, b.playing);
    const slots = slotsOf(loop);
    grid.push({ bagId: b.id, bagName: b.name, counted, loopName: loop?.name ?? b.playing ?? null, cells: slots.map((s) => s.kind) });
    if (!counted) {
      bagsNotCounted++;
      slotsNotCounted += slots.length;
      continue;
    }
    bagsCounted++;
    if (!loop) {
      bagsUnknownLoop++;
      continue;
    }
    const agg = loopAgg.get(loop.id) ?? { loopId: loop.id, name: loop.name, bags: 0, slots };
    agg.bags++;
    loopAgg.set(loop.id, agg);
    for (const s of slots) {
      totals[s.kind]++;
      if (s.kind === "sold" && s.campaignId) {
        const e = soldBy.get(s.campaignId) ?? { campaignId: s.campaignId, label: s.campaignLabel ?? "Campaign", slots: 0, demo: !!input.campaigns.get(s.campaignId)?.demo };
        e.slots++;
        soldBy.set(s.campaignId, e);
      }
      if (s.kind === "unsold_ended" && s.campaignId) {
        const e = endedBy.get(s.campaignId) ?? { campaignId: s.campaignId, label: s.campaignLabel ?? "Campaign", slots: 0 };
        e.slots++;
        endedBy.set(s.campaignId, e);
      }
    }
  }

  const rank = (x: InventoryBag) => (x.counted ? 0 : 1);
  grid.sort((a, b) => rank(a) - rank(b) || (a.loopName ?? "~").localeCompare(b.loopName ?? "~") || a.bagName.localeCompare(b.bagName, "en-GB", { numeric: true }));

  return {
    asOf: input.now.toISOString(),
    windowDays,
    bagsCounted,
    bagsNotCounted,
    slotsNotCounted,
    bagsUnknownLoop,
    totalSlots: totals.sold + totals.house + totals.unsold_ended + totals.unsold,
    sold: totals.sold,
    house: totals.house,
    unsold: totals.unsold + totals.unsold_ended,
    unsoldEnded: totals.unsold_ended,
    soldBy: [...soldBy.values()].sort((a, b) => b.slots - a.slots),
    endedBy: [...endedBy.values()].sort((a, b) => b.slots - a.slots),
    loops: [...loopAgg.values()].sort((a, b) => b.bags - a.bags),
    bags: grid,
    testBagExcluded: live.some((b) => b.isTest),
  };
}

// ── Time of day and the summary paragraph ─────────────────────────────────────

export const TIME_BANDS = [
  { key: "morning", label: "Morning", from: 6, to: 11 },
  { key: "lunch", label: "Lunch", from: 11, to: 14 },
  { key: "afternoon", label: "Afternoon", from: 14, to: 17 },
  { key: "early_evening", label: "Early evening", from: 17, to: 20 },
  { key: "evening", label: "Evening", from: 20, to: 23 },
  { key: "night", label: "Night", from: 23, to: 6 },
] as const;

const inBand = (h: number, from: number, to: number) => (from < to ? h >= from && h < to : h >= from || h < to);

/** Plays grouped into London time-of-day bands (every hour belongs to exactly one band). */
export function timeOfDay(byHour: number[]): TimeOfDayBand[] {
  const total = byHour.reduce((s, n) => s + n, 0);
  return TIME_BANDS.map((b) => {
    const plays = byHour.reduce((s, n, h) => (inBand(h, b.from, b.to) ? s + n : s), 0);
    return { key: b.key, label: b.label, range: `${pad(b.from)}–${pad(b.to)}`, plays, share: total ? plays / total : 0 };
  });
}

/** The `width`-hour stretch (London time, may wrap past midnight) with the most plays. */
export function busiestStretch(byHour: number[], width = 3): { startHour: number; endHour: number; plays: number } | null {
  if (!byHour.some((n) => n > 0)) return null;
  let best = { startHour: 0, endHour: width % 24, plays: -1 };
  for (let h = 0; h < 24; h++) {
    let s = 0;
    for (let k = 0; k < width; k++) s += byHour[(h + k) % 24] ?? 0;
    if (s > best.plays) best = { startHour: h, endHour: (h + width) % 24, plays: s };
  }
  return best;
}

/** "on 28 September", "between 15 and 28 September", "between 30 September and 2 October", "…2026 and … 2027". */
export function periodPhrase(fromDay: string, toDay: string): string {
  if (fromDay === toDay) return `on ${fmtDayMonth.format(noon(fromDay))}`;
  const [fy, fm] = fromDay.split("-");
  const [ty, tm] = toDay.split("-");
  if (fy !== ty) return `between ${fmtDayMonth.format(noon(fromDay))} ${fy} and ${fmtDayMonth.format(noon(toDay))} ${ty}`;
  if (fm !== tm) return `between ${fmtDayMonth.format(noon(fromDay))} and ${fmtDayMonth.format(noon(toDay))}`;
  return `between ${Number(fromDay.slice(8))} and ${Number(toDay.slice(8))} ${fmtMonth.format(noon(toDay))}`;
}

/** "713 hours", "4.5 hours", "38 minutes". */
export function screenTimePhrase(seconds: number): string {
  if (seconds < 3600) {
    const m = Math.max(1, Math.round(seconds / 60));
    return `${m} ${m === 1 ? "minute" : "minutes"}`;
  }
  const h = seconds / 3600;
  if (h < 10) {
    const r = Math.round(h * 10) / 10;
    return `${r} ${r === 1 ? "hour" : "hours"}`;
  }
  return `${fmtNum(h)} hours`;
}

const listPhrase = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

export interface SummaryInput {
  name: string;
  fromDay: string;
  toDay: string;
  plays: number;
  seconds: number;
  bags: number;
  km: number;
  zones: { name: string; seconds: number }[];
  byHour: number[];
}

/**
 * The report's plain-English summary, written from the measured numbers only
 * (deterministic; no AI). Never mentions reach or anything estimated.
 */
export function summaryText(s: SummaryInput): string {
  const name = s.name.trim() || "campaign";
  const period = periodPhrase(s.fromDay, s.toDay);
  if (s.plays <= 0) return `No plays of your ${name} ad were recorded ${period}.`;
  const parts: string[] = [];
  parts.push(
    `Your ${name} ad played ${fmtNum(s.plays)} ${s.plays === 1 ? "time" : "times"} on ${fmtNum(s.bags)} DigiLite ${s.bags === 1 ? "bag" : "bags"} ${period} — ${screenTimePhrase(s.seconds)} on screen.`,
  );
  const zones = s.zones.filter((z) => z.seconds >= 60).sort((a, b) => b.seconds - a.seconds).slice(0, 2).map((z) => z.name);
  const kmText = s.km >= 1 ? `${fmtNum(s.km)} km` : null;
  const carrier = s.bags === 1 ? "the bag" : "the bags";
  if (kmText && zones.length) parts.push(`On the days it played, ${carrier} carrying it covered ${kmText}, spending most time around ${listPhrase(zones)}.`);
  else if (kmText) parts.push(`On the days it played, ${carrier} carrying it covered ${kmText}.`);
  else if (zones.length) parts.push(`${s.bags === 1 ? "The bag" : "The bags"} carrying it spent most time around ${listPhrase(zones)}.`);
  const busy = busiestStretch(s.byHour);
  const total = s.byHour.reduce((a, n) => a + n, 0);
  if (busy && total > 0 && busy.plays / total >= 0.2 && busy.plays < total) {
    parts.push(`The busiest stretch was between ${pad(busy.startHour)}:00 and ${pad(busy.endHour)}:00.`);
  }
  return parts.join(" ");
}

// ══════════════════════════════════════════════════════════════════════════════
// PocketBase-backed
// ══════════════════════════════════════════════════════════════════════════════

export interface CampaignRow {
  id: string;
  advertiser: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
  contractedBags: number;
  confirmed: boolean;
  notes: string;
  demo: boolean;
  created: string;
  updated: string;
}

const dayOf = (d: Date | null): string | null => {
  if (!d) return null;
  const p = londonParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

export function toCampaignRow(r: RecordModel): CampaignRow {
  return {
    id: r.id,
    advertiser: r.advertiser ?? "",
    name: r.name ?? "",
    startDay: dayOf(parsePbDate(r.start_date)),
    endDay: dayOf(parsePbDate(r.end_date)),
    contractedBags: r.contracted_bags ?? 0,
    confirmed: (r.status || "draft") !== "draft",
    notes: r.notes ?? "",
    demo: !!r.demo,
    created: parsePbDate(r.created)?.toISOString() ?? "",
    updated: parsePbDate(r.updated)?.toISOString() ?? "",
  };
}

export const campaignLabel = (c: { advertiser: string; name: string }) => `${c.advertiser} — ${c.name}`;

/** Stored status: draft, or live/ended from the dates (kept in step for anyone reading the raw record). */
export function storedStatus(confirmed: boolean, endDay: string, today = todayLondon()): "draft" | "live" | "ended" {
  if (!confirmed) return "draft";
  return today > endDay ? "ended" : "live";
}

export async function loadCampaignRows(): Promise<CampaignRow[]> {
  return (await getAll<RecordModel>("campaigns", { sort: "-start_date" })).map(toCampaignRow);
}

export interface CreativeRow {
  id: string;
  name: string;
  advertiser: string;
  campaignId: string | null;
  md5: string;
  mediaType: "video" | "image" | null;
  durationS: number | null;
  hasThumb: boolean;
  archived: boolean;
}

/** One file = the Colorlight file id when there is one, else the record itself. */
export const fileKey = (c: Pick<CreativeRow, "md5" | "id">) => c.md5 || c.id;

export async function loadCreatives(): Promise<CreativeRow[]> {
  const rows = await getAll<RecordModel>("creatives", {
    fields: "id,name,advertiser,campaign,colorlight_md5,media_type,duration_s,thumb,archived",
    sort: "name",
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    advertiser: r.advertiser ?? "",
    campaignId: r.campaign || null,
    md5: r.colorlight_md5 ?? "",
    mediaType: r.media_type || null,
    durationS: r.duration_s ?? null,
    hasThumb: !!r.thumb,
    archived: !!r.archived,
  }));
}

export interface LoopRow extends InvLoop {
  items: { creative: string; seconds: number }[];
}

export async function loadLoops(): Promise<LoopRow[]> {
  const rows = await getAll<RecordModel>("loops", { fields: "id,name,status,items,colorlight_program_name,published_at" });
  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    programName: r.colorlight_program_name ?? "",
    status: r.status ?? "",
    publishedAt: parsePbDate(r.published_at),
    items: (Array.isArray(r.items) ? r.items : [])
      .filter((i: unknown): i is { creative: string; seconds?: number } => !!i && typeof (i as { creative?: unknown }).creative === "string")
      .map((i: { creative: string; seconds?: number }) => ({ creative: i.creative, seconds: Number(i.seconds) || 0 })),
  }));
}

const bagPlaying = (b: RecordModel): string | null => b.playing_program || programNameFromVsn(b.playing_vsn);
const reportedWithin = (b: RecordModel, ms: number, now = Date.now()) => {
  const t = parsePbDate(b.last_report_at)?.getTime();
  return !!t && now - t <= ms;
};

interface PlayRow {
  bag: string;
  hour: Date;
  md5: string;
  plays: number;
  seconds: number;
}

/** Hourly play rows for a set of files in [from, to). */
async function playRows(md5s: string[], from: Date, to: Date | null): Promise<PlayRow[]> {
  if (!md5s.length) return [];
  const out: PlayRow[] = [];
  for (let i = 0; i < md5s.length; i += 20) {
    const chunk = md5s.slice(i, i + 20);
    const filter = `(${chunk.map((m) => `media_md5 = ${q(m)}`).join(" || ")}) && hour >= ${q(pbDate(from))}${to ? ` && hour < ${q(pbDate(to))}` : ""}`;
    const rows = await getAll<RecordModel>("plays", { filter, fields: "bag,hour,media_md5,plays,seconds" });
    for (const r of rows) {
      const hour = parsePbDate(r.hour);
      if (!hour) continue;
      out.push({ bag: r.bag, hour, md5: r.media_md5, plays: r.plays || 0, seconds: r.seconds || 0 });
    }
  }
  return out;
}

let coverageCache: { at: number; from: string | null; to: string | null } | null = null;

/** The span of play records we hold: first London day and latest hour. */
export async function playsCoverage(): Promise<{ from: string | null; to: string | null }> {
  if (coverageCache && Date.now() - coverageCache.at < 5 * 60_000) return coverageCache;
  const first = await pb.collection("plays").getList<RecordModel>(1, 1, { sort: "hour", fields: "hour", skipTotal: true });
  const last = await pb.collection("plays").getList<RecordModel>(1, 1, { sort: "-hour", fields: "hour", skipTotal: true });
  const f = parsePbDate(first.items[0]?.hour);
  const l = parsePbDate(last.items[0]?.hour);
  coverageCache = { at: Date.now(), from: dayOf(f), to: l ? l.toISOString() : null };
  return coverageCache;
}

const windowOf = (c: { startDay: string | null; endDay: string | null }): [Date, Date] | null =>
  c.startDay && c.endDay ? [londonDayStart(c.startDay), londonDayBounds(c.endDay)[1]] : null;

interface Facts extends StatusFacts {
  plays: number;
  seconds: number;
  lastPlayedAt: string | null;
  carryingBagIds: Set<string>;
  rows: PlayRow[];
}

/** Measured facts for one campaign from its files' play rows. */
async function campaignFacts(c: CampaignRow, md5s: string[], creativeFiles: number, today: string): Promise<Facts> {
  const last7 = londonDayStart(addDays(today, -6));
  const win = windowOf(c);
  const empty: Facts = { ...NO_FACTS, creativeFiles, plays: 0, seconds: 0, lastPlayedAt: null, carryingBagIds: new Set(), rows: [] };
  if (!md5s.length) return empty;
  const from = win && win[0] < last7 ? win[0] : last7;
  const rows = await playRows(md5s, from, null);
  const carrying = new Set<string>();
  const afterBags = new Set<string>();
  let plays = 0;
  let seconds = 0;
  let after = 0;
  let last = 0;
  for (const r of rows) {
    const t = r.hour.getTime();
    if (r.plays > 0 && t > last) last = t;
    if (t >= last7.getTime() && r.plays > 0) carrying.add(r.bag);
    if (!win) continue;
    if (t >= win[0].getTime() && t < win[1].getTime()) {
      plays += r.plays;
      seconds += r.seconds;
    } else if (t >= win[1].getTime()) {
      after += r.plays;
      if (t >= last7.getTime() && r.plays > 0) afterBags.add(r.bag);
    }
  }
  return {
    creativeFiles,
    bagsCarrying: carrying.size,
    playsAfterEnd: after,
    bagsAfterEnd: afterBags.size,
    plays,
    seconds,
    lastPlayedAt: last ? new Date(last).toISOString() : null,
    carryingBagIds: carrying,
    rows,
  };
}

function toSummary(c: CampaignRow, f: Facts, today: string, thumbId: string | null = null): CampaignSummary {
  return {
    id: c.id,
    advertiser: c.advertiser,
    name: c.name,
    startDay: c.startDay,
    endDay: c.endDay,
    contractedBags: c.contractedBags,
    confirmed: c.confirmed,
    notes: c.notes,
    demo: c.demo,
    status: campaignStatus(c, today, f),
    creativeFiles: f.creativeFiles,
    thumbId,
    bagsCarrying: f.bagsCarrying,
    plays: f.plays,
    playSeconds: Math.round(f.seconds),
    playsAfterEnd: f.playsAfterEnd,
    bagsAfterEnd: f.bagsAfterEnd,
    lastPlayedAt: f.lastPlayedAt,
  };
}

function filesOf(campaignId: string, creatives: CreativeRow[]) {
  const linked = creatives.filter((c) => c.campaignId === campaignId);
  const keys = new Set(linked.map(fileKey));
  const md5s = [...new Set(linked.map((c) => c.md5).filter(Boolean))];
  const thumbId = linked.find((c) => c.hasThumb && !c.archived)?.id ?? null;
  return { linked, keys, md5s, thumbId };
}

let listCache: { at: number; body: CampaignListResponse } | null = null;
let inventoryCache: { at: number; body: InventoryResponse } | null = null;

export function invalidateCampaigns() {
  listCache = null;
  inventoryCache = null;
}

export async function listCampaigns(): Promise<CampaignListResponse> {
  if (listCache && Date.now() - listCache.at < 30_000) return listCache.body;
  const today = todayLondon();
  const [rows, creatives, coverage] = await Promise.all([loadCampaignRows(), loadCreatives(), playsCoverage()]);
  const summaries = await Promise.all(
    rows.map(async (c) => {
      const { keys, md5s, thumbId } = filesOf(c.id, creatives);
      return toSummary(c, await campaignFacts(c, md5s, keys.size, today), today, thumbId);
    }),
  );
  const body: CampaignListResponse = {
    asOf: new Date().toISOString(),
    today,
    playsFrom: coverage.from,
    playsTo: coverage.to,
    campaigns: summaries.sort(compareCampaigns),
  };
  listCache = { at: Date.now(), body };
  return body;
}

export async function getCampaignRow(id: string): Promise<CampaignRow | null> {
  const rec = await getOneOrNull<RecordModel>("campaigns", id);
  return rec ? toCampaignRow(rec) : null;
}

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** Group library records into files, with the loops holding them and recent plays. */
function toFiles(creatives: CreativeRow[], loops: LoopRow[], campaigns: Map<string, CampaignRow>, plays7: Map<string, number>): CampaignCreativeFile[] {
  const byId = new Map(creatives.map((c) => [c.id, c]));
  const loopsByKey = new Map<string, Set<string>>();
  for (const l of loops) {
    if (l.status === "archived") continue;
    for (const it of l.items) {
      const cr = byId.get(it.creative);
      if (!cr) continue;
      const k = fileKey(cr);
      const set = loopsByKey.get(k) ?? new Set<string>();
      set.add(l.name);
      loopsByKey.set(k, set);
    }
  }
  const groups = new Map<string, CreativeRow[]>();
  for (const c of creatives) {
    // Archived records stay hidden unless they're linked to a campaign (so they can still be seen and unlinked).
    if (c.archived && !c.campaignId) continue;
    const k = fileKey(c);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const linked = list.find((c) => c.campaignId);
    const camp = linked?.campaignId ? campaigns.get(linked.campaignId) : undefined;
    const thumb = list.find((c) => c.hasThumb);
    return {
      key,
      ids: list.map((c) => c.id),
      name: list[0].name,
      mediaType: list[0].mediaType,
      durationS: list[0].durationS,
      thumbId: thumb?.id ?? list[0].id,
      campaignId: linked?.campaignId ?? null,
      campaignLabel: camp ? campaignLabel(camp) : linked?.campaignId ? "Another campaign" : null,
      loops: [...(loopsByKey.get(key) ?? [])].sort(),
      playsLast7: plays7.get(key) ?? 0,
    };
  });
}

/** Fleet-wide plays per file over the last 7 days (for the picker). */
async function playsLast7ByFile(today: string): Promise<Map<string, number>> {
  const since = londonDayStart(addDays(today, -6));
  const rows = await getAll<RecordModel>("plays", { filter: `hour >= ${q(pbDate(since))}`, fields: "media_md5,plays" });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.media_md5, (out.get(r.media_md5) ?? 0) + (r.plays || 0));
  return out;
}

export async function campaignDetail(c: CampaignRow, opts: { showRiders: boolean }): Promise<CampaignDetail> {
  const today = todayLondon();
  const [creatives, loops, bags, allCampaigns] = await Promise.all([loadCreatives(), loadLoops(), loadBags(), loadCampaignRows()]);
  const { keys, md5s, thumbId } = filesOf(c.id, creatives);
  const facts = await campaignFacts(c, md5s, keys.size, today);
  const summary = toSummary(c, facts, today, thumbId);

  // Files (with fleet plays over the last 7 days)
  const plays7 = new Map<string, number>();
  const last7 = londonDayStart(addDays(today, -6)).getTime();
  for (const r of facts.rows) if (r.hour.getTime() >= last7) plays7.set(r.md5, (plays7.get(r.md5) ?? 0) + r.plays);
  const campMap = new Map(allCampaigns.map((x) => [x.id, x]));
  const files = toFiles(creatives.filter((x) => keys.has(fileKey(x))), loops, campMap, plays7).sort((a, b) => b.playsLast7 - a.playsLast7 || a.name.localeCompare(b.name));

  // Loops holding these files, and the bags playing / holding those loops
  const byId = new Map(creatives.map((x) => [x.id, x]));
  const recentBags = bags.filter((b) => (b.lifecycle || "active") !== "retired" && reportedWithin(b, 7 * DAY_MS));
  const chainLoops: CampaignChainLoop[] = [];
  const playingBags = new Set<string>();
  const loadedBags = new Set<string>();
  for (const l of loops) {
    if (l.status === "archived") continue;
    const positions = l.items.map((it, i) => (byId.get(it.creative) && keys.has(fileKey(byId.get(it.creative)!)) ? i + 1 : 0)).filter(Boolean);
    if (!positions.length) continue;
    const lname = l.name.trim().toLowerCase();
    const playing = recentBags.filter((b) => findLoop(loops, bagPlaying(b))?.id === l.id);
    const loaded = bags.filter(
      (b) =>
        (b.lifecycle || "active") !== "retired" &&
        ((b.downloaded_programs ?? []) as { name?: string }[]).some((p) => (p.name ?? "").trim().toLowerCase() === lname),
    );
    for (const b of playing) playingBags.add(b.id);
    for (const b of loaded) loadedBags.add(b.id);
    chainLoops.push({
      id: l.id,
      name: l.name,
      slots: l.items.length,
      positions,
      loopSeconds: Math.round(l.items.reduce((s, it) => s + (it.seconds || byId.get(it.creative)?.durationS || 10), 0)),
      bagsPlaying: playing.length,
      loadedOn: loaded.length,
    });
  }
  chainLoops.sort((a, b) => b.bagsPlaying - a.bagsPlaying || b.loadedOn - a.loadedOn || a.name.localeCompare(b.name));

  // Riders on the carrying bags now, and km ridden on the days they played it (last 7 days)
  const riders = await currentRiderByBag();
  const riderList = [...facts.carryingBagIds].map((id) => riders.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const uniqueRiders = [...new Map(riderList.map((r) => [r.id, r])).values()];
  let km = 0;
  if (facts.carryingBagIds.size) {
    const playedDays = new Set<string>();
    for (const r of facts.rows) if (r.hour.getTime() >= last7 && r.plays > 0) playedDays.add(`${r.bag}|${dayOf(r.hour)}`);
    const rows = await bagDays([...facts.carryingBagIds], addDays(today, -6), today);
    for (const d of rows) if (playedDays.has(`${d.bag}|${d.day}`)) km += d.km || 0;
  }

  const chain: CampaignChain = {
    files,
    loops: chainLoops,
    bags: { carrying: facts.bagsCarrying, playingLoop: playingBags.size, loadedOn: loadedBags.size, contracted: c.contractedBags },
    riders: {
      count: uniqueRiders.length,
      initials: opts.showRiders ? uniqueRiders.map((r) => initialsOf(r.name)) : null,
      km: Math.round(km * 10) / 10,
    },
  };
  return { ...summary, created: c.created, updated: c.updated, chain };
}

export async function suggestedCreatives(c: CampaignRow) {
  const today = todayLondon();
  const [creatives, loops, campaigns, plays7] = await Promise.all([loadCreatives(), loadLoops(), loadCampaignRows(), playsLast7ByFile(today)]);
  const files = toFiles(creatives, loops, new Map(campaigns.map((x) => [x.id, x])), plays7);
  const byKey = new Map<string, CreativeRow[]>();
  for (const cr of creatives) byKey.set(fileKey(cr), [...(byKey.get(fileKey(cr)) ?? []), cr]);
  const suggested: CampaignCreativeFile[] = [];
  const others: CampaignCreativeFile[] = [];
  for (const f of files) {
    let best: { score: number; reason: string } | null = null;
    for (const cr of byKey.get(f.key) ?? []) {
      const m = matchScore(c.advertiser, cr.name, cr.advertiser);
      if (m && (!best || m.score > best.score)) best = m;
    }
    if (best) suggested.push({ ...f, match: best });
    else others.push(f);
  }
  suggested.sort((a, b) => (b.match!.score - a.match!.score) || b.playsLast7 - a.playsLast7 || a.name.localeCompare(b.name));
  others.sort((a, b) => Number(b.campaignId === c.id) - Number(a.campaignId === c.id) || b.playsLast7 - a.playsLast7 || a.name.localeCompare(b.name));
  return { advertiser: c.advertiser, suggested, others };
}

/**
 * Link exactly `creativeIds` to the campaign. Records sharing a file with a
 * chosen record are linked too; records no longer chosen are unlinked.
 */
export async function setCampaignCreatives(c: CampaignRow, creativeIds: string[]) {
  const creatives = await loadCreatives();
  const byId = new Map(creatives.map((x) => [x.id, x]));
  const missing = creativeIds.filter((id) => !byId.has(id));
  if (missing.length) return { error: `${missing.length === 1 ? "A creative wasn't" : "Some creatives weren't"} found. Refresh and try again.` } as const;
  const keys = new Set(creativeIds.map((id) => fileKey(byId.get(id)!)));
  const toLink = creatives.filter((x) => keys.has(fileKey(x)) && x.campaignId !== c.id);
  const toUnlink = creatives.filter((x) => x.campaignId === c.id && !keys.has(fileKey(x)));
  const campaigns = new Map((await loadCampaignRows()).map((x) => [x.id, x]));
  const movedMap = new Map<string, Set<string>>();
  for (const x of toLink) {
    if (!x.campaignId) continue;
    const label = campaigns.get(x.campaignId) ? campaignLabel(campaigns.get(x.campaignId)!) : "another campaign";
    movedMap.set(label, (movedMap.get(label) ?? new Set()).add(fileKey(x)));
  }
  const ops = [...toLink.map((x) => [x.id, c.id] as const), ...toUnlink.map((x) => [x.id, ""] as const)];
  for (let i = 0; i < ops.length; i += 200) {
    const batch = pb.createBatch();
    for (const [id, campaign] of ops.slice(i, i + 200)) batch.collection("creatives").update(id, { campaign });
    await batch.send();
  }
  invalidateCampaigns();
  const fileName = (k: string) => creatives.find((x) => fileKey(x) === k)?.name ?? k;
  const addedFiles = [...new Set(toLink.map(fileKey))];
  const removedFiles = [...new Set(toUnlink.map(fileKey))];
  return {
    linked: creatives.filter((x) => keys.has(fileKey(x))).length,
    files: keys.size,
    added: addedFiles.map(fileName),
    removed: removedFiles.map(fileName),
    moved: [...movedMap.entries()].map(([campaignLabel, set]) => ({ campaignLabel, count: set.size })),
  } as const;
}

/** Unlink every creative from a campaign (before deleting it). */
export async function unlinkAll(campaignId: string): Promise<number> {
  const linked = (await loadCreatives()).filter((x) => x.campaignId === campaignId);
  for (let i = 0; i < linked.length; i += 200) {
    const batch = pb.createBatch();
    for (const x of linked.slice(i, i + 200)) batch.collection("creatives").update(x.id, { campaign: "" });
    await batch.send();
  }
  return linked.length;
}

// ── Inventory ─────────────────────────────────────────────────────────────────

export async function liveInventory(): Promise<InventoryResponse> {
  if (inventoryCache && Date.now() - inventoryCache.at < 30_000) return inventoryCache.body;
  const today = todayLondon();
  const [bags, loops, creatives, campaigns] = await Promise.all([loadBags(), loadLoops(), loadCreatives(), loadCampaignRows()]);
  const body = computeInventory({
    now: new Date(),
    bags: bags.map((b) => ({
      id: b.id,
      name: b.name,
      lastReportAt: parsePbDate(b.last_report_at),
      lifecycle: b.lifecycle || "active",
      isTest: isTestBag(b),
      playing: bagPlaying(b),
    })),
    loops,
    creatives: new Map(creatives.map((c) => [c.id, { id: c.id, name: c.name, advertiser: c.advertiser, campaignId: c.campaignId }])),
    campaigns: new Map(
      campaigns.map((c) => [
        c.id,
        { id: c.id, label: campaignLabel(c), advertiser: c.advertiser, phase: campaignStatus(c, today, NO_FACTS).phase, demo: c.demo },
      ]),
    ),
  });
  inventoryCache = { at: Date.now(), body };
  return body;
}

// ── Measured stats for a period ───────────────────────────────────────────────

/** Default period: the campaign's dates, clipped to today. */
export function defaultPeriod(c: CampaignRow, today = todayLondon()): { fromDay: string; toDay: string } {
  const from = c.startDay && c.startDay <= today ? c.startDay : addDays(today, -6);
  const to = c.endDay && c.endDay < today ? c.endDay : today;
  return from <= to ? { fromDay: from, toDay: to } : { fromDay: to, toDay: to };
}

const MAP_DAYS = 3;
const MAP_MAX_POINTS = 9000;
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

async function mapLines(
  pairs: Map<string, Set<number>>,
  days: string[],
  bagNames: Map<string, string>,
): Promise<CampaignStats["map"]> {
  const recent = days.slice(-MAP_DAYS);
  const cfg = await analyticsConfig();
  const gapMs = cfg.signalGapMin * 60_000;
  const tasks: { bag: string; day: string; hours: Set<number> }[] = [];
  for (const [key, hours] of pairs) {
    const [bag, day] = key.split("|");
    if (recent.includes(day)) tasks.push({ bag, day, hours });
  }
  const raw: { bag: string; day: string; segs: [number, number][][] }[] = [];
  const queue = [...tasks];
  const worker = async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const [from, to] = londonDayBounds(t.day);
      const pts = (await loadPlacedPoints(t.bag, from, to)).filter((p) => t.hours.has(Math.floor(p.t / HOUR_MS) * HOUR_MS));
      const segs: [number, number][][] = [];
      let cur: [number, number][] = [];
      for (let i = 0; i < pts.length; i++) {
        if (i > 0 && pts[i].t - pts[i - 1].t > gapMs) {
          if (cur.length > 1) segs.push(cur);
          cur = [];
        }
        cur.push([pts[i].lng, pts[i].lat]);
      }
      if (cur.length > 1) segs.push(cur);
      if (segs.length) raw.push({ bag: t.bag, day: t.day, segs });
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  let tol = 8;
  let lines: CampaignMapLine[] = [];
  let points = 0;
  for (;;) {
    lines = raw.map((r) => ({
      bagId: r.bag,
      bagName: bagNames.get(r.bag) ?? "Bag",
      day: r.day,
      coords: r.segs.map((s) => simplifyLine(s, tol).map(([x, y]) => [round5(x), round5(y)] as [number, number])),
    }));
    points = lines.reduce((s, l) => s + l.coords.reduce((n, c) => n + c.length, 0), 0);
    if (points <= MAP_MAX_POINTS || tol >= 256) break;
    tol *= 2;
  }
  lines.sort((a, b) => a.day.localeCompare(b.day) || a.bagName.localeCompare(b.bagName, "en-GB", { numeric: true }));
  return { days: recent, lines, points, simplifiedToM: tol };
}

/** Everything measured about a campaign between two London days. */
export async function campaignStats(
  c: CampaignRow,
  fromDay: string,
  toDay: string,
  opts: { riderNames: "full" | "short" | null },
): Promise<CampaignStats> {
  const [creatives, bags, coverage, names] = await Promise.all([loadCreatives(), loadBags(), playsCoverage(), zoneNames()]);
  const { linked, md5s } = filesOf(c.id, creatives);
  const from = londonDayStart(fromDay);
  const to = londonDayBounds(toDay)[1];
  const rows = await playRows(md5s, from, to);
  const assignments = opts.riderNames ? await allAssignments() : [];
  const bagNames = new Map(bags.map((b) => [b.id, b.name as string]));

  const days = daysBetween(fromDay, toDay);
  const perDay = new Map(days.map((d) => [d, { plays: 0, seconds: 0, bags: new Set<string>() }]));
  const byHour = Array.from({ length: 24 }, () => 0);
  const perBag = new Map<string, { plays: number; seconds: number; days: Set<string>; riders: Map<string, number> }>();
  const pairs = new Map<string, Set<number>>();
  const perFile = new Map<string, { plays: number; seconds: number }>();

  for (const r of rows) {
    if (r.plays <= 0 && r.seconds <= 0) continue;
    const p = londonParts(r.hour);
    const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    const d = perDay.get(day);
    if (!d) continue;
    d.plays += r.plays;
    d.seconds += r.seconds;
    d.bags.add(r.bag);
    byHour[p.hour] += r.plays;
    const b = perBag.get(r.bag) ?? { plays: 0, seconds: 0, days: new Set<string>(), riders: new Map<string, number>() };
    b.plays += r.plays;
    b.seconds += r.seconds;
    b.days.add(day);
    if (opts.riderNames) {
      const who = activeAt(assignments, r.bag, r.hour);
      const name = who ? (opts.riderNames === "short" ? shortRiderName(who.riderName) : who.riderName) : "No rider assigned";
      b.riders.set(name, (b.riders.get(name) ?? 0) + r.plays);
    }
    perBag.set(r.bag, b);
    const key = `${r.bag}|${day}`;
    pairs.set(key, (pairs.get(key) ?? new Set<number>()).add(r.hour.getTime()));
    const f = perFile.get(r.md5) ?? { plays: 0, seconds: 0 };
    f.plays += r.plays;
    f.seconds += r.seconds;
    perFile.set(r.md5, f);
  }

  // Bag days: km, time out and zones — only on the days each bag played it.
  let km = 0;
  let onSeconds = 0;
  const zoneSeconds = new Map<string, number>();
  if (perBag.size) {
    for (const d of await bagDays([...perBag.keys()], fromDay, toDay)) {
      if (!pairs.has(`${d.bag}|${d.day}`)) continue;
      km += d.km || 0;
      onSeconds += d.on_seconds || 0;
      for (const [z, s] of Object.entries((d.zones ?? {}) as Record<string, number>)) zoneSeconds.set(z, (zoneSeconds.get(z) ?? 0) + (Number(s) || 0));
    }
  }
  const zones: ZoneTime[] = [...zoneSeconds.entries()]
    .map(([zoneId, seconds]) => ({ zoneId, name: names.get(zoneId) ?? "Removed zone", seconds: Math.round(seconds) }))
    .filter((z) => z.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const perDayOut: CampaignDayPlays[] = days.map((day) => {
    const d = perDay.get(day)!;
    return { day, plays: d.plays, seconds: Math.round(d.seconds), bags: d.bags.size, noRecords: !!coverage.from && day < coverage.from };
  });
  const bagRows: CampaignBagRow[] = [...perBag.entries()]
    .map(([bagId, b]) => ({
      bagId,
      bagName: bagNames.get(bagId) ?? "Bag",
      plays: b.plays,
      seconds: Math.round(b.seconds),
      days: b.days.size,
      riders: opts.riderNames ? [...b.riders.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n) : null,
    }))
    .sort((a, b) => b.plays - a.plays || a.bagName.localeCompare(b.bagName, "en-GB", { numeric: true }));
  const fileName = new Map(linked.map((x) => [x.md5, x.name]));
  const daysWithPlays = perDayOut.filter((d) => d.plays > 0).map((d) => d.day);

  return {
    campaignId: c.id,
    fromDay,
    toDay,
    playsFrom: coverage.from,
    totals: {
      plays: perDayOut.reduce((s, d) => s + d.plays, 0),
      seconds: perDayOut.reduce((s, d) => s + d.seconds, 0),
      bags: perBag.size,
      daysWithPlays: daysWithPlays.length,
      km: Math.round(km * 10) / 10,
      onSeconds: Math.round(onSeconds),
    },
    perDay: perDayOut,
    byHour,
    zones,
    bags: bagRows,
    files: [...perFile.entries()]
      .map(([key, f]) => ({ key, name: fileName.get(key) ?? key, plays: f.plays, seconds: Math.round(f.seconds) }))
      .sort((a, b) => b.plays - a.plays),
    map: await mapLines(pairs, daysWithPlays, bagNames),
    riderNamesIncluded: !!opts.riderNames,
  };
}

/** "Amara Osei" → "Amara O." (what a client may see when rider names are switched on). */
export function shortRiderName(name: string): string {
  const [first, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]}.` : first ?? "";
}

// ── Client report ─────────────────────────────────────────────────────────────

export const ESTIMATE_NOTE = "Estimated reach isn't included until the method is agreed.";

export async function campaignReport(
  c: CampaignRow,
  requested: { fromDay: string; toDay: string },
  riderNames: { requested: boolean; permitted: boolean },
): Promise<CampaignReport> {
  const today = todayLondon();
  const coverage = await playsCoverage();
  let toDay = requested.toDay > today ? today : requested.toDay;
  let fromDay = requested.fromDay;
  // Before our play records begin there is no data (not zero): report from the first day we hold.
  if (coverage.from && fromDay < coverage.from && toDay >= coverage.from) fromDay = coverage.from;
  if (fromDay > toDay) fromDay = toDay;
  const include = riderNames.requested && riderNames.permitted;
  const stats = await campaignStats(c, fromDay, toDay, { riderNames: include ? "short" : null });
  const { keys, md5s } = filesOf(c.id, await loadCreatives());
  const status = campaignStatus(c, today, await campaignFacts(c, md5s, keys.size, today));
  return {
    campaign: { id: c.id, advertiser: c.advertiser, name: c.name, startDay: c.startDay, endDay: c.endDay, demo: c.demo, status },
    fromDay,
    toDay,
    requested,
    preparedAt: new Date().toISOString(),
    stats,
    timeOfDay: timeOfDay(stats.byHour),
    busiest: busiestStretch(stats.byHour),
    summary: summaryText({
      name: c.name,
      fromDay,
      toDay,
      plays: stats.totals.plays,
      seconds: stats.totals.seconds,
      bags: stats.totals.bags,
      km: stats.totals.km,
      zones: stats.zones,
      byHour: stats.byHour,
    }),
    riderNames: {
      requested: riderNames.requested,
      included: include,
      reason: riderNames.requested && !riderNames.permitted ? "Only people who can see riders can include rider names." : null,
    },
    estimate: { included: false, note: ESTIMATE_NOTE },
  };
}
