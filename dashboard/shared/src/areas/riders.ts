// Contracts for the riders area: the rider pipeline, documents, assignments
// (who carried which bag, when) and rider performance taken from the bag's data
// inside the rider's assignment windows.

import type { RouteResponse } from "../api";
import type { BagStatus, Lifecycle } from "../status";

// ── Stages ────────────────────────────────────────────────────────────────────
export type RiderStage = "applied" | "checked" | "waiting" | "active" | "ended";

export const RIDER_STAGES: RiderStage[] = ["applied", "checked", "waiting", "active", "ended"];

export const RIDER_STAGE_LABEL: Record<RiderStage, string> = {
  applied: "Applied",
  checked: "Documents checked",
  waiting: "Waiting for a bag",
  active: "Carrying a bag",
  ended: "Ended",
};

/** Stages that can be set directly. "active" comes from giving a bag; "ended" from ending. */
export type RiderSettableStage = "applied" | "checked" | "waiting";

// ── Documents ─────────────────────────────────────────────────────────────────
export type RiderDocKind = "id" | "right_to_work" | "address" | "agreement" | "dbs" | "insurance" | "other";

export const RIDER_DOC_KINDS: RiderDocKind[] = ["id", "right_to_work", "address", "agreement", "dbs", "insurance", "other"];

export const RIDER_DOC_LABEL: Record<RiderDocKind, string> = {
  id: "Photo ID",
  right_to_work: "Right to work",
  address: "Proof of address",
  agreement: "Contractor agreement",
  dbs: "DBS check",
  insurance: "Insurance",
  other: "Other document",
};

/** Every rider needs these checked before they carry a bag. */
export const REQUIRED_DOC_KINDS: RiderDocKind[] = ["id", "right_to_work", "address", "agreement"];

export type RiderDocStatus = "pending" | "checked" | "rejected";

/** A document is "due" when it expires within this many days. */
export const DOC_DUE_DAYS = 30;
export const DOC_MAX_BYTES = 15 * 1024 * 1024;
export const DOC_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/heic", "image/webp"];
export const DOC_ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/jpeg,image/png,image/heic,image/webp";

/** Worst first: expired > missing > pending (uploaded, not checked) > due (expiring soon) > ok. */
export type RiderDocsState = "expired" | "missing" | "pending" | "due" | "ok";

export interface RiderDocsSummary {
  state: RiderDocsState;
  /** Required kinds (see REQUIRED_DOC_KINDS) */
  required: number;
  /** Required kinds with a checked, unexpired document */
  checked: number;
  /** Required kinds with nothing usable (none uploaded, or only rejected) */
  missing: RiderDocKind[];
  /** Kinds with an upload waiting to be checked */
  pending: RiderDocKind[];
  /** Kinds whose checked document has expired */
  expired: RiderDocKind[];
  /** Kinds whose checked document expires within DOC_DUE_DAYS */
  due: RiderDocKind[];
  /** The soonest expiry that needs attention (expired or due) */
  next: { kind: RiderDocKind; expiresDay: string; expired: boolean } | null;
}

/** "Documents due": something expired, expiring within DOC_DUE_DAYS, or missing (what ?docs=due lists). */
export function docsDue(d: RiderDocsSummary): boolean {
  return d.expired.length + d.due.length + d.missing.length > 0;
}

export interface RiderDocumentDto {
  id: string;
  kind: RiderDocKind;
  status: RiderDocStatus;
  hasFile: boolean;
  /** "pdf" or "image" when a file is attached */
  fileType: "pdf" | "image" | null;
  /** London day the document expires, if it does */
  expiresDay: string | null;
  checkedAt: string | null;
  /** Only sent to people who can open documents (riders.documents) */
  notes: string | null;
  createdAt: string;
}

export interface RiderDocPatchRequest {
  status?: RiderDocStatus;
  /** YYYY-MM-DD, or null to clear */
  expiresDay?: string | null;
  notes?: string;
}

// ── Activity (the bag's data inside the rider's assignments) ─────────────────
/** A day counts as "out" when the rider's bag was out at least this long. */
export const DAY_OUT_MIN_SECONDS = 600;
/** Stopped share this many points above the fleet average is flagged. */
export const STOPPED_WELL_ABOVE_POINTS = 10;

export interface RiderActivity {
  /** Days with at least DAY_OUT_MIN_SECONDS out */
  daysOut: number;
  /** Days they had a bag at some point */
  daysCarrying: number;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  /** Signal gaps (bag on, no location) */
  gaps: number;
  km: number;
  /** Average time out per day out */
  avgOnSeconds: number | null;
  /** Stopped time as a share of time out, 0–100 */
  stoppedPct: number | null;
  gapsPerDay: number | null;
  kmPerDay: number | null;
}

/** The whole fleet over the same window: averages per bag-day out (test bag excluded). */
export interface FleetBaseline {
  bagDays: number;
  avgOnSeconds: number | null;
  stoppedPct: number | null;
  gapsPerDay: number | null;
  kmPerDay: number | null;
}

export interface RiderBagRef {
  id: string;
  name: string;
  status: BagStatus;
  lifecycle: Lifecycle;
  isTestBag: boolean;
  lastReportAt: string | null;
  assignmentId: string;
  /** Assignment start (ISO) */
  since: string;
  /** Assignment end when a last day is booked (ISO) */
  until: string | null;
  /** The assignment starts in the future */
  upcoming: boolean;
}

export interface RiderLastOut {
  day: string;
  bagId: string;
  /** First movement that day */
  start: string;
  /** Last movement that day */
  end: string;
  /** Start of that day's latest shift (for "out since …") */
  shiftStart: string;
}

export interface RiderListItem {
  id: string;
  name: string;
  phone: string;
  stage: RiderStage;
  demo: boolean;
  joinedAt: string | null;
  endedAt: string | null;
  bag: RiderBagRef | null;
  docs: RiderDocsSummary;
  lastOut: RiderLastOut | null;
  activity: RiderActivity;
  /** Moving hours per day across `days` (oldest first); null = no bag that day */
  movingHours: (number | null)[];
}

export interface RiderListResponse {
  asOf: string;
  /** The activity window, oldest first (London days, today last) */
  days: string[];
  fleet: FleetBaseline;
  counts: Record<RiderStage, number> & { docsDue: number; outNow: number };
  riders: RiderListItem[];
}

// ── One rider ─────────────────────────────────────────────────────────────────
export interface RiderStint {
  assignmentId: string;
  bagId: string;
  bagName: string;
  start: string;
  end: string | null;
  endReason: string;
}

export interface RiderDetail {
  id: string;
  name: string;
  phone: string;
  email: string;
  stage: RiderStage;
  demo: boolean;
  joinedAt: string | null;
  endedAt: string | null;
  endedReason: string;
  notes: string;
  createdAt: string;
  bag: RiderBagRef | null;
  stints: RiderStint[];
  docs: RiderDocsSummary;
  lastOut: RiderLastOut | null;
}

export interface RiderCreateRequest {
  name: string;
  phone?: string;
  email?: string;
  stage?: RiderSettableStage;
  notes?: string;
}

export interface RiderPatchRequest {
  name?: string;
  phone?: string;
  email?: string;
  stage?: RiderSettableStage;
  notes?: string;
}

// ── Assignments ───────────────────────────────────────────────────────────────
export interface AssignBagRequest {
  bagId: string;
  /** Start of this London day. Leave out to start now. */
  startDay?: string;
}

export interface EndAssignmentRequest {
  /** Their last London day with the bag (today or earlier) */
  lastDay: string;
  bagAction: "spare" | "give";
  /** With bagAction "give": the rider who gets the bag from the following day */
  nextRiderId?: string;
  reason: string;
}

export interface RiderActionResult {
  rider: RiderDetail;
  /** Plain-English outcome for a toast */
  message: string;
}

export interface SpareBag {
  id: string;
  name: string;
  status: BagStatus;
  lifecycle: Lifecycle;
  isTestBag: boolean;
  lastReportAt: string | null;
  /** Who had it last, and until when */
  lastRider: { id: string; name: string; until: string } | null;
}

// ── Performance, coverage, pay ────────────────────────────────────────────────
export interface RiderDayRow {
  day: string;
  /** They had a bag at some point this day */
  carrying: boolean;
  /** At least DAY_OUT_MIN_SECONDS out */
  out: boolean;
  bagId: string | null;
  bagName: string | null;
  first: string | null;
  last: string | null;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  gaps: number;
  km: number;
  plays: number;
  /** Moving time, plus signal gaps when Settings count them as paid */
  paidSeconds: number;
}

export interface RiderTotals extends RiderActivity {
  plays: number;
  paidSeconds: number;
}

export interface RiderPerformance {
  fromDay: string;
  toDay: string;
  rows: RiderDayRow[];
  totals: RiderTotals;
  fleet: FleetBaseline;
  paySignalGaps: boolean;
  payMinHours: number;
}

export interface RiderCoverage {
  fromDay: string;
  toDay: string;
  /** Simplified track lines for every day they rode, as [lng, lat] */
  lines: [number, number][][];
  points: number;
  /** Days out (DAY_OUT_MIN_SECONDS or more) in the window — the same count as the performance figures */
  daysWithData: number;
  /** Their most recent day out, clipped to their time with the bag */
  last: RouteResponse | null;
}

export interface RiderPaySummary {
  /** The latest approved pay period, if any */
  lastApproved: { startDay: string; endDay: string } | null;
  /** First unpaid day (the day after the last approved period), or null without payroll data */
  fromDay: string | null;
  toDay: string;
  /** Paid time since the last approved period (null without payroll data) */
  paidSeconds: number | null;
  daysOut: number | null;
  paySignalGaps: boolean;
}
