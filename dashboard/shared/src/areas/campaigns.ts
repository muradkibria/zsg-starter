// Contracts for the campaigns area: campaigns (contracts), the creatives linked
// to them, measured plays and live inventory. Every number here is measured by
// the bags (play logs and GPS). Nothing modelled (reach, impressions) lives here.

import type { ZoneTime } from "../api";

// ── Status ────────────────────────────────────────────────────────────────────

/**
 * draft            not confirmed yet (or no dates)
 * upcoming         confirmed, starts in the future
 * live             running
 * ending           running, ends within 7 days
 * ended            past its end date and off screen
 * ended_on_screen  past its end date but bags still played it in the last 7 days
 */
export type CampaignPhase = "draft" | "upcoming" | "live" | "ending" | "ended" | "ended_on_screen";
export type CampaignTone = "neutral" | "info" | "green" | "amber" | "red";

export interface CampaignStatus {
  phase: CampaignPhase;
  /** "Draft", "Starts 6 Oct", "Live", "Ending in 3 days", "Ended", "Ended — still on screen" */
  label: string;
  tone: CampaignTone;
  /** One short supporting line, e.g. "Day 28 of 61" or "Still playing on 12 bags" */
  note: string | null;
  /** The note describes a problem (a live campaign not on screen, an ended one still playing) */
  warn: boolean;
}

// ── Campaigns ─────────────────────────────────────────────────────────────────

export interface CampaignInput {
  advertiser: string;
  name: string;
  /** London day, YYYY-MM-DD (first day of the campaign) */
  startDay: string;
  /** London day, YYYY-MM-DD (last day of the campaign, inclusive) */
  endDay: string;
  contractedBags: number;
  /** false = draft (not confirmed with the advertiser yet) */
  confirmed: boolean;
  notes?: string;
}

export type CampaignPatch = Partial<CampaignInput>;

export interface CampaignSummary {
  id: string;
  advertiser: string;
  name: string;
  startDay: string | null;
  endDay: string | null;
  contractedBags: number;
  confirmed: boolean;
  notes: string;
  /** Sample data from `npm run seed:demo` */
  demo: boolean;
  status: CampaignStatus;
  /** Ad files linked (creatives that share one Colorlight file count once) */
  creativeFiles: number;
  /** A linked creative with a thumbnail (for /api/creatives/:id/thumb) */
  thumbId: string | null;
  /** Distinct bags with plays of its creatives in the last 7 London days (measured) */
  bagsCarrying: number;
  /** Measured plays inside the campaign dates, up to now */
  plays: number;
  /** Measured seconds on screen inside the campaign dates */
  playSeconds: number;
  /** Measured plays after the end date */
  playsAfterEnd: number;
  /** Bags that played it after its end date, in the last 7 days */
  bagsAfterEnd: number;
  /** ISO hour of the most recent play we hold, if any */
  lastPlayedAt: string | null;
}

export interface CampaignListResponse {
  asOf: string;
  /** Today in London, YYYY-MM-DD */
  today: string;
  /** First London day we hold play records for (earlier plays were never recorded) */
  playsFrom: string | null;
  /** ISO hour of the latest play record we hold */
  playsTo: string | null;
  campaigns: CampaignSummary[];
}

/** One ad file. Library records that share a Colorlight file are grouped, because plays can't tell them apart. */
export interface CampaignCreativeFile {
  /** The Colorlight file id (md5) or, for files not on Colorlight, the creative id */
  key: string;
  /** Every creative record for this file */
  ids: string[];
  name: string;
  mediaType: "video" | "image" | null;
  durationS: number | null;
  /** A creative id whose thumbnail can be shown via /api/creatives/:id/thumb */
  thumbId: string | null;
  /** The campaign this file is linked to now, if any */
  campaignId: string | null;
  campaignLabel: string | null;
  /** Names of loops that contain this file */
  loops: string[];
  /** Measured plays in the last 7 days, across the fleet */
  playsLast7: number;
  /** Present on suggestions: why it looks like this advertiser's ad */
  match?: { score: number; reason: string };
}

export interface CampaignChainLoop {
  id: string;
  name: string;
  /** Items in the loop */
  slots: number;
  /** 1-based slot numbers holding this campaign's files */
  positions: number[];
  /** Length of one pass of the loop */
  loopSeconds: number;
  /** Bags that reported playing this loop in the last 7 days */
  bagsPlaying: number;
  /** Bags that have this loop downloaded */
  loadedOn: number;
}

/** creatives → loops containing them → bags → riders & routes */
export interface CampaignChain {
  files: CampaignCreativeFile[];
  loops: CampaignChainLoop[];
  bags: {
    /** Measured: played it in the last 7 days */
    carrying: number;
    /** Reported playing a loop that contains it (bags seen in the last 7 days) */
    playingLoop: number;
    /** Have a loop containing it downloaded */
    loadedOn: number;
    contracted: number;
  };
  riders: {
    /** Riders assigned now to the bags carrying it */
    count: number;
    /** Initials for avatars (only for users who can see riders) */
    initials: string[] | null;
    /** Km ridden by the carrying bags on the days they played it, last 7 days */
    km: number;
  };
}

export interface CampaignDetail extends CampaignSummary {
  created: string;
  updated: string;
  chain: CampaignChain;
}

export interface SuggestedCreativesResponse {
  advertiser: string;
  /** Likely matches for the advertiser, best first */
  suggested: CampaignCreativeFile[];
  /** The rest of the library */
  others: CampaignCreativeFile[];
}

export interface LinkCreativesRequest {
  /** The complete set of creatives for this campaign (records sharing a file are linked together) */
  creativeIds: string[];
}

export interface LinkCreativesResponse {
  /** Creative records now linked */
  linked: number;
  /** Ad files now linked */
  files: number;
  /** Files moved here from other campaigns */
  moved: { campaignLabel: string; count: number }[];
  detail: CampaignDetail;
}

// ── Measured stats ────────────────────────────────────────────────────────────

export interface CampaignDayPlays {
  day: string;
  plays: number;
  seconds: number;
  bags: number;
  /** Before our play records begin: no data, not zero */
  noRecords: boolean;
}

export interface CampaignBagRow {
  bagId: string;
  bagName: string;
  plays: number;
  seconds: number;
  /** London days with at least one play */
  days: number;
  /** Who carried it while it played (by assignment). Internal only; null when not permitted or not requested */
  riders: string[] | null;
}

export interface CampaignMapLine {
  bagId: string;
  bagName: string;
  day: string;
  /** Pieces of route while it was playing, as [lng, lat] */
  coords: [number, number][][];
}

export interface CampaignStats {
  campaignId: string;
  fromDay: string;
  toDay: string;
  playsFrom: string | null;
  totals: {
    plays: number;
    seconds: number;
    bags: number;
    daysWithPlays: number;
    /** Km ridden by the bags carrying it, on the days they played it */
    km: number;
    /** Time those bags were out, on those days */
    onSeconds: number;
  };
  perDay: CampaignDayPlays[];
  /** Plays by London hour of day, 0–23 */
  byHour: number[];
  /** Time in zones by the bags carrying it, on the days they played it (from each bag's day) */
  zones: ZoneTime[];
  bags: CampaignBagRow[];
  /** Plays per ad file */
  files: { key: string; name: string; plays: number; seconds: number }[];
  /** Where it played: routes of the carrying bags on the most recent days with plays */
  map: { days: string[]; lines: CampaignMapLine[]; points: number; simplifiedToM: number };
  riderNamesIncluded: boolean;
}

// ── Live inventory ────────────────────────────────────────────────────────────

/** sold: a live campaign · house: DigiLite's own ad · unsold_ended: an ended campaign still in the loop · unsold: anything else */
export type SlotKind = "sold" | "house" | "unsold_ended" | "unsold";

export interface InventorySlot {
  position: number;
  creativeId: string | null;
  name: string;
  kind: SlotKind;
  campaignId: string | null;
  campaignLabel: string | null;
}

export interface InventoryLoop {
  loopId: string | null;
  name: string;
  /** Bags out in the last 7 days playing it */
  bags: number;
  slots: InventorySlot[];
}

export interface InventoryBag {
  bagId: string;
  bagName: string;
  counted: boolean;
  loopName: string | null;
  /** One entry per slot of its loop (empty when the loop isn't known) */
  cells: SlotKind[];
}

export interface InventoryResponse {
  asOf: string;
  windowDays: number;
  /** Bags out in the last 7 days (their slots are counted) */
  bagsCounted: number;
  /** Bags not out in the last 7 days (not counted) */
  bagsNotCounted: number;
  slotsNotCounted: number;
  /** Counted bags playing a loop we hold no copy of (their slots are unknown) */
  bagsUnknownLoop: number;
  totalSlots: number;
  sold: number;
  house: number;
  /** Includes unsoldEnded */
  unsold: number;
  unsoldEnded: number;
  soldBy: { campaignId: string; label: string; slots: number; demo: boolean }[];
  endedBy: { campaignId: string; label: string; slots: number }[];
  loops: InventoryLoop[];
  bags: InventoryBag[];
  testBagExcluded: boolean;
}
