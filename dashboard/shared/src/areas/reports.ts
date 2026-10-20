// Contracts for the reports area: client (proof-of-play) reports for a
// campaign. Measured figures (plays, time on screen, km) are kept apart from
// the estimated impressions (TfL footfall, see impressions.ts), which are always
// labelled. TfL station footfall is only an internal input to that estimate:
// reports never name or mark stations, they give the estimate for the path the
// bags took while the ad played. Rider names are off by default and only
// included on request by someone allowed to see riders.

import type { ZoneTime } from "../api";
import type { CampaignStats, CampaignStatus } from "./campaigns";

export type ReportSection = "summary" | "measured" | "daily" | "hours" | "map" | "zones" | "days" | "bags" | "estimate";

export const REPORT_SECTIONS: { key: ReportSection; label: string; defaultOn: boolean }[] = [
  { key: "summary", label: "Summary", defaultOn: true },
  { key: "measured", label: "Measured numbers", defaultOn: true },
  { key: "daily", label: "Plays per day", defaultOn: true },
  { key: "hours", label: "Time of day", defaultOn: true },
  { key: "map", label: "Where it played (heat map)", defaultOn: true },
  { key: "zones", label: "Time in zones", defaultOn: true },
  { key: "days", label: "Day by day, with a map each", defaultOn: true },
  { key: "bags", label: "List of bags", defaultOn: false },
  { key: "estimate", label: "Estimated impressions, with method", defaultOn: true },
];

export interface TimeOfDayBand {
  key: string;
  label: string;
  /** "17–20" (London time) */
  range: string;
  plays: number;
  /** 0–1 share of the period's plays */
  share: number;
}

/** A cell of the heat map: where the ad was on screen, and for how long. */
export interface ReportHex {
  lng: number;
  lat: number;
  seconds: number;
}

/** One day of the report. */
export interface ReportDay {
  day: string;
  plays: number;
  /** Seconds on screen */
  seconds: number;
  bags: number;
  km: number;
  impressions: number;
  /** TfL hasn't published this day yet: the same weekday of the latest week stands in */
  footfallStandIn: boolean;
  /** Plays by London hour, 0–23 */
  byHour: number[];
  busiest: { startHour: number; endHour: number; plays: number } | null;
  /** Estimated impressions by London hour, 0–23, and by time of day */
  impressionsByHour: number[];
  impressionsTimeOfDay: TimeOfDayBand[];
  zones: ZoneTime[];
  hexes: ReportHex[];
}

export interface CampaignReport {
  campaign: {
    id: string;
    advertiser: string;
    name: string;
    startDay: string | null;
    endDay: string | null;
    demo: boolean;
    status: CampaignStatus;
  };
  /** The period the figures cover (clipped to today) */
  fromDay: string;
  toDay: string;
  /** The period that was asked for */
  requested: { fromDay: string; toDay: string };
  preparedAt: string;
  stats: CampaignStats;
  timeOfDay: TimeOfDayBand[];
  /** The 3-hour stretch with the most plays */
  busiest: { startHour: number; endHour: number; plays: number } | null;
  /** Plain-English paragraph written from the measured numbers only */
  summary: string;
  riderNames: { requested: boolean; included: boolean; reason: string | null };
  /** Estimated impressions from TfL footfall, and how */
  impressions: {
    total: number;
    /** Last day TfL has published; later days use the same weekday of the latest week */
    footfallThrough: string | null;
    /** The working assumptions used (Settings → Impressions) */
    radiusM: number;
    streetShare: number;
    visibility: number;
  };
  /** Estimated impressions by London hour over the period, 0–23, and by time of day */
  impressionsByHour: number[];
  impressionsTimeOfDay: TimeOfDayBand[];
  /** Heat map cells for the whole period; hexagons `hexSizeM` across (centre to corner) */
  hexes: ReportHex[];
  hexSizeM: number;
  days: ReportDay[];
}
