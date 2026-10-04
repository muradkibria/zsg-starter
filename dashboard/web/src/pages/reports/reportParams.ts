// The report's settings live in the URL, so Back from the printable page
// returns to the builder exactly as it was, and a link reproduces a report.

import { isDay, REPORT_SECTIONS, type ReportSection } from "@digilite/shared";
import type { PeriodPreset } from "../campaigns/format";

export interface ReportState {
  preset: PeriodPreset | null;
  fromDay: string | null;
  toDay: string | null;
  sections: ReportSection[];
  riderNames: boolean;
  /** The edited summary; null = use the one written from the numbers */
  summary: string | null;
}

export const DEFAULT_SECTIONS: ReportSection[] = REPORT_SECTIONS.filter((s) => s.defaultOn).map((s) => s.key);
const KEYS = new Set<string>(REPORT_SECTIONS.map((s) => s.key));
const PRESETS = new Set(["campaign", "last7", "yesterday", "thisMonth", "lastMonth", "custom"]);

export function readReportParams(p: URLSearchParams): ReportState {
  const s = p.get("s");
  const preset = p.get("preset");
  return {
    preset: preset && PRESETS.has(preset) ? (preset as PeriodPreset) : null,
    fromDay: isDay(p.get("fromDay")) ? p.get("fromDay") : null,
    toDay: isDay(p.get("toDay")) ? p.get("toDay") : null,
    sections: s === null ? DEFAULT_SECTIONS : (s.split(",").filter((k) => KEYS.has(k)) as ReportSection[]),
    riderNames: p.get("riderNames") === "1",
    summary: p.has("summary") ? p.get("summary") : null,
  };
}

export function reportSearch(st: ReportState, extra: Record<string, string> = {}): URLSearchParams {
  const p = new URLSearchParams(extra);
  if (st.preset) p.set("preset", st.preset);
  if (st.fromDay) p.set("fromDay", st.fromDay);
  if (st.toDay) p.set("toDay", st.toDay);
  const ordered = REPORT_SECTIONS.map((s) => s.key).filter((k) => st.sections.includes(k));
  if (ordered.join(",") !== DEFAULT_SECTIONS.join(",")) p.set("s", ordered.join(","));
  if (st.riderNames) p.set("riderNames", "1");
  if (st.summary !== null) p.set("summary", st.summary);
  return p;
}

export function printableHref(campaignId: string, st: ReportState, print = false): string {
  const p = reportSearch(st);
  if (print) p.set("print", "1");
  return `/reports/${campaignId}?${p.toString()}`;
}

export function builderHref(campaignId: string, st: ReportState): string {
  return `/reports?${reportSearch(st, { campaign: campaignId }).toString()}`;
}

/** Words that would smuggle an estimate into the summary. */
const ESTIMATE_WORDS = /\b(reach|reached|impressions?|audiences?|views?|viewers?|eyeballs?|people (?:saw|who saw|have seen)|seen by|footfall)\b/i;
export const mentionsEstimate = (text: string) => ESTIMATE_WORDS.test(text);
