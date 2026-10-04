// Core API contracts (auth, fleet, bags, routes, zones, settings, system).
// Feature areas keep their own contract files in ./areas/.

import type { LatLng } from "./geo";
import type { BagStatus, Lifecycle, Role } from "./status";

export interface ApiErrorBody {
  error: string;
  detail?: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// ── Bags ──────────────────────────────────────────────────────────────────────
export type BagIssueKind = "not_seen" | "clock" | "old_loop" | "brightness" | "software" | "no_rider";

export interface BagIssue {
  kind: BagIssueKind;
  label: string;
}

export interface BagRiderRef {
  id: string;
  name: string;
  /** ISO start of the current assignment */
  since: string;
  demo?: boolean;
}

export interface BagClock {
  tz: string | null;
  label: string;
  ok: boolean | null;
}

export interface BagSummary {
  id: string;
  colorlightId: number;
  name: string;
  status: BagStatus;
  lifecycle: Lifecycle;
  isTestBag: boolean;
  lastReportAt: string | null;
  lastGpsAt: string | null;
  position: LatLng | null;
  speed: number | null;
  heading: number | null;
  rider: BagRiderRef | null;
  playing: string | null;
  brightnessPct: number | null;
  firmware: string | null;
  clock: BagClock;
  issues: BagIssue[];
}

/** A bag on the live map: summary plus its last 30 minutes of track ([lng, lat]). */
export interface LiveBag extends BagSummary {
  trail: [number, number][];
}

export interface Stint {
  assignmentId: string;
  riderId: string;
  riderName: string;
  start: string;
  end: string | null;
  demo?: boolean;
}

export interface CommandSummary {
  id: string;
  bagId: string;
  type: "brightness" | "reboot" | "screenshot" | "sleep" | "wakeup" | "schedule" | "publish";
  value: unknown;
  status: "dry_run" | "blocked" | "sent" | "failed" | "confirmed";
  error: string | null;
  createdAt: string;
  requestedBy: string | null;
}

export interface BagDevice {
  model: string | null;
  serial: string | null;
  resolution: string | null;
  firmware: string | null;
  latestFirmware: string | null;
  storageUsedPct: number | null;
  powerOn: boolean | null;
  connected: boolean | null;
  network: string | null;
  gpsIntervalS: number | null;
  brightnessRaw: number | null;
  downloadedPrograms: string[];
}

export interface BagDetail extends BagSummary {
  colorlightName: string;
  lifecycleNote: string;
  device: BagDevice;
  stints: Stint[];
  screenshot: { takenAt: string; url: string } | null;
  commands: CommandSummary[];
  deviceSchedule: unknown;
  /** Most recent London day with GPS for this bag, if any */
  lastActiveDay: string | null;
}

export interface BagPatch {
  lifecycle?: Lifecycle;
  lifecycleNote?: string;
}

export type BagCommandRequest =
  | { type: "brightness"; value: number }
  | { type: "reboot" }
  | { type: "screenshot" }
  | { type: "sleep" }
  | { type: "wakeup" };

export interface CommandResult {
  command: CommandSummary;
  /** Plain-English outcome, e.g. "Dry run — nothing was sent" */
  message: string;
}

// ── Routes & days ─────────────────────────────────────────────────────────────
export interface RouteStop {
  lat: number;
  lng: number;
  start: string;
  end: string;
  seconds: number;
}

export interface RouteGap {
  start: string;
  end: string;
  seconds: number;
  from: [number, number];
  to: [number, number];
}

export interface ZoneTime {
  zoneId: string;
  name: string;
  seconds: number;
}

export interface TimelineItem {
  kind: "moving" | "stopped" | "gap";
  start: string;
  end: string;
}

export interface ZoneTimelineItem {
  zoneId: string | null;
  name: string | null;
  start: string;
  end: string;
}

export interface ShiftSummary {
  start: string;
  end: string;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  riderId: string | null;
  riderName: string | null;
}

export interface RouteSummary {
  first: string | null;
  last: string | null;
  points: number;
  late: number;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
}

export interface RouteResponse {
  bagId: string;
  bagName: string;
  from: string;
  to: string;
  day: string | null;
  /** Continuous pieces of track, simplified, as [lng, lat] */
  segments: [number, number][][];
  gaps: RouteGap[];
  stops: RouteStop[];
  shifts: ShiftSummary[];
  zones: ZoneTime[];
  zoneTimeline: ZoneTimelineItem[];
  timeline: TimelineItem[];
  summary: RouteSummary;
  /** What the bag reported playing (current state, not historical) */
  playing: string | null;
}

export interface BagDayDto {
  bagId: string;
  bagName: string;
  day: string;
  first: string | null;
  last: string | null;
  points: number;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  gaps: number;
  km: number;
  plays: number;
  zones: ZoneTime[];
  shifts: ShiftSummary[];
}

// ── Fleet ─────────────────────────────────────────────────────────────────────
export type WriteMode = "off" | "test" | "fleet";

export interface AttentionItem {
  kind: string;
  severity: "red" | "amber" | "info";
  count: number;
  title: string;
  body: string;
  bagIds: string[];
  /** In-app link, e.g. "/bags?issue=clock" */
  href: string;
}

export interface SyncHealth {
  /** False when the Colorlight sync is switched off (SYNC_ENABLED=false) or has no Colorlight login */
  enabled?: boolean;
  colorlightOk: boolean;
  lastStatusSync: string | null;
  lastGpsSync: string | null;
  lastTrackSync: string | null;
  lastPlaysSync: string | null;
  backfill: { done: boolean; note: string | null };
  error: string | null;
}

export interface FleetOverview {
  asOf: string;
  total: number;
  counts: Record<BagStatus, number>;
  attention: AttentionItem[];
  writeMode: WriteMode;
  fleetWritesEnabled: boolean;
  testBagIds: string[];
  fleetLoop: string | null;
  brightnessTargetPct: number;
  sync: SyncHealth;
}

export interface LiveResponse {
  asOf: string;
  bags: LiveBag[];
}

/** Server-sent events on /api/live */
export type LiveEvent =
  | { type: "hello"; asOf: string }
  | { type: "bags"; asOf: string; bags: LiveBag[] }
  | { type: "overview"; overview: FleetOverview };

// ── Zones ─────────────────────────────────────────────────────────────────────
export interface ZoneDto {
  id: string;
  name: string;
  kind: "circle" | "polygon";
  type: "neighbourhood" | "high_street" | "station" | "other";
  centerLat: number | null;
  centerLng: number | null;
  radiusM: number | null;
  polygon: [number, number][] | null;
  active: boolean;
  sort: number;
}

// ── Settings ──────────────────────────────────────────────────────────────────
export interface SettingsDto {
  fleetWritesEnabled: boolean;
  fleetLoopName: string;
  brightnessTargetPct: number;
  brightnessCommandScale: number;
  shiftBreakMin: number;
  signalGapMin: number;
  stopRadiusM: number;
  stopMin: number;
  payRate: string;
  payMinHours: number;
  paySignalGaps: boolean;
}

// ── Search ────────────────────────────────────────────────────────────────────
export interface SearchResult {
  kind: "bag" | "rider" | "zone";
  id: string;
  label: string;
  sublabel: string;
  href: string;
}

// ── Pagination helper ─────────────────────────────────────────────────────────
export interface Paged<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}
