// Contracts for the exports area.
//
// Every export covers London days (midnight to midnight). Rows are credited to
// whoever had the bag at the time (by assignment); signal gaps are kept as
// explicit "no signal" rows and never filled in.

import type { PayRange } from "./payroll";

export type ExportType = "routes" | "shifts" | "plays" | "zones";
export type ExportFormat = "csv" | "xlsx" | "gpx" | "kml";

export const EXPORT_TYPES: ExportType[] = ["routes", "shifts", "plays", "zones"];

export const EXPORT_TYPE_LABEL: Record<ExportType, string> = {
  routes: "Routes",
  shifts: "Shifts & hours",
  plays: "Ad plays",
  zones: "Time in zones",
};

/** Map files only make sense for routes. */
export function exportFormatsFor(type: ExportType): ExportFormat[] {
  return type === "routes" ? ["xlsx", "csv", "gpx", "kml"] : ["xlsx", "csv"];
}

/** Query parameters shared by the preview and the download. */
export interface ExportRequest {
  type: ExportType;
  /** Comma-separated in the query string */
  bagIds: string[];
  riderIds: string[];
  fromDay: string;
  toDay: string;
}

export interface ExportColumn {
  key: string;
  label: string;
  numeric?: boolean;
}

export type ExportRowTone = "gap" | "late" | "stopped" | "moving" | null;

export interface ExportPreviewRow {
  cells: (string | number | null)[];
  tone: ExportRowTone;
}

export interface ExportHandover {
  bagId: string;
  bagName: string;
  day: string;
  fromRiderName: string | null;
  toRiderName: string | null;
}

export interface ExportPreview extends ExportRequest {
  days: number;
  /** Bags with data in the export */
  bags: number;
  /** Riders credited somewhere in the export */
  riders: number;
  rowCount: number;
  /** Routes: location points (rows = points + "no signal" rows) */
  pointCount: number | null;
  /** Signal gaps kept as "no signal" rows (routes) or counted in shifts */
  gapCount: number;
  /** Routes over ~60,000 points: the gap count (and so the row count) is from the daily summaries, so approximate */
  approximate: boolean;
  /** Routes: points that arrived late in a batch and share one arrival time */
  lateCount: number;
  /** Bag-days in the export with no rider assigned (rider left blank) */
  noRiderDays: number;
  handovers: ExportHandover[];
  columns: ExportColumn[];
  sample: ExportPreviewRow[];
  /** e.g. "Bag 006, Mon 28 Sep, around the 19:42 signal gap" */
  sampleNote: string;
  /** The bag-day the sample (and the map thumbnail) comes from */
  sampleBagDay: { bagId: string; bagName: string; day: string } | null;
  /** Rough file sizes, bytes */
  estimatedBytes: Partial<Record<ExportFormat, number>>;
  /** Signal gap threshold used (minutes), for the wording */
  signalGapMin: number;
  /** Rider names are left out for people who can't see riders */
  ridersHidden: boolean;
}

export interface ExportBagOption {
  id: string;
  name: string;
  riderName: string | null;
  lifecycle: string;
  lastReportAt: string | null;
}

export interface ExportRiderOption {
  id: string;
  name: string;
  bagName: string | null;
  stage: string;
  demo: boolean;
}

export interface ExportOptions {
  bags: ExportBagOption[];
  /** Empty when the user can't see riders */
  riders: ExportRiderOption[];
  today: string;
  lastPayPeriod: PayRange;
  maxDays: number;
}
