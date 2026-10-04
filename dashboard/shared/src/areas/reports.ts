// Contracts for the reports area: client (proof-of-play) reports for a
// campaign. Measured figures only; estimated reach stays out until its method
// is agreed. Rider names are off by default and only included on request by
// someone allowed to see riders.

import type { CampaignStats, CampaignStatus } from "./campaigns";

export type ReportSection = "summary" | "measured" | "daily" | "hours" | "map" | "zones" | "bags" | "estimate";

export const REPORT_SECTIONS: { key: ReportSection; label: string; defaultOn: boolean }[] = [
  { key: "summary", label: "Summary", defaultOn: true },
  { key: "measured", label: "Measured numbers", defaultOn: true },
  { key: "daily", label: "Plays per day", defaultOn: true },
  { key: "hours", label: "Time of day", defaultOn: true },
  { key: "map", label: "Where it played (map)", defaultOn: true },
  { key: "zones", label: "Time in zones", defaultOn: true },
  { key: "bags", label: "List of bags", defaultOn: false },
  { key: "estimate", label: "Note on estimated reach", defaultOn: true },
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
  estimate: { included: false; note: string };
}
