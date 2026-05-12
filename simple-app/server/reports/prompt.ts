// ─────────────────────────────────────────────────────────────────────────────
// Prompt construction for campaign reports.
//
// The system prompt sets the role + output structure and is the same on every
// call (so Anthropic's prompt cache can deduplicate it). The user message is
// the dynamic per-report JSON.
// ─────────────────────────────────────────────────────────────────────────────

import type { PreviewOutput } from "./aggregator.js";

export const DEFAULT_SYSTEM_PROMPT = `
You are a senior analyst for DigiLite, a digital out-of-home advertising agency that runs LED courier-bag advertising across London. You write campaign performance reports for clients.

You will receive a JSON payload with the campaign's underlying data:
- Selected ad creatives, with play counts and total airtime per ad
- Per-bag breakdown showing which rider/bag carried the ads and how many GPS-tracked exposures they generated
- A breakdown by London zone and time-of-day band
- A methodology block describing exactly how impression estimates were computed

Produce a markdown report with these sections, in order:

## Executive Summary
2-3 sentences. Lead with total estimated impressions, then total ad plays + airtime, then the standout finding (top zone, best-performing ad, or notable rider).

## Campaign Totals
- Bullet list of: total estimated impressions, total ad plays, total airtime (HH:MM), bags involved.

## Top-Performing Zones
Table of the top 5 zones by impressions, with bag-visits and rough share of total. One sentence of commentary.

## Ad-by-Ad Performance
For each selected ad, one short paragraph: plays, airtime, estimated impressions, and whether it over- or under-indexed vs the campaign average.

## Rider / Bag Performance
Top 5 bags by attributed impressions. Comment on geographic spread (e.g. "concentration in Zone 1" or "even coverage across zones 1-3").

## Time-of-Day Patterns
Brief paragraph + small table showing how impressions distributed across morning rush, midday, lunch, PM rush, evening, night. Note which bands punched above their weight.

## Recommendations
2-4 numbered, specific, conservative recommendations. Examples: "Concentrate more bag-hours in Zone 1 between 16:30–19:00" or "Test rotating Burger King ad with the new Connectbike creative on the same loop". Avoid generic platitudes.

## Methodology Note
One short paragraph. Cite the visibility factor used (10%), the 250m radius, and the time-band weighting. Acknowledge that impression numbers are estimates with conservative defaults.

Tone:
- Confident but not exaggerated. The numbers are estimates, not measurements — be honest about that in the methodology note, but elsewhere speak in clear declaratives.
- Crisp, professional, free of fluff. No "in conclusion" or "moving forward". No emoji.
- Numbers should always include units (plays, hours, impressions). Use commas for thousands. Round impressions to nearest 100.
- British English spelling (we're a UK agency).

Do not invent data not present in the JSON. If a section would be empty (e.g. no time-band data), say so briefly rather than inventing.
`.trim();

export interface UserMessageInput {
  reportTitle: string;
  campaignContext?: {
    client_name?: string;
    campaign_name?: string;
    notes?: string;
  };
  data: PreviewOutput;
}

export function buildUserMessage(input: UserMessageInput): string {
  const { reportTitle, campaignContext, data } = input;

  // Surface the most relevant data first; LLMs attend best to the top of the message.
  const summary = {
    report_title: reportTitle,
    client: campaignContext?.client_name ?? null,
    campaign: campaignContext?.campaign_name ?? null,
    notes: campaignContext?.notes ?? null,
    window: { start: data.startTime, end: data.endTime },
    totals: data.totals,
    ads: data.ads.map((a) => ({
      filename: a.filename,
      type: a.file_type,
      total_plays: a.totalPlays,
      total_airtime_seconds: a.totalAirtimeSeconds,
      estimated_impressions: Math.round(a.estimatedImpressions),
    })),
    top_zones: Object.entries(data.byZone)
      .sort((a, b) => b[1].impressions - a[1].impressions)
      .slice(0, 10)
      .map(([zone, v]) => ({
        zone,
        estimated_impressions: Math.round(v.impressions),
        visits: v.visits,
      })),
    time_bands: Object.entries(data.byTimeBand)
      .sort((a, b) => b[1].impressions - a[1].impressions)
      .map(([band, v]) => ({
        band,
        weight: v.weight,
        estimated_impressions: Math.round(v.impressions),
        seconds: Math.round(v.seconds),
      })),
    bags: data.bags.slice(0, 30).map((b) => ({
      bag_name: b.bag_name,
      plays: b.plays_of_selected_ads,
      airtime_selected_seconds: b.airtime_selected_seconds,
      airtime_share_of_bag: +b.selected_share.toFixed(3),
      attributed_impressions: Math.round(b.attributedImpressions),
      track_point_count: b.exposure.trackPointCount,
    })),
    methodology: data.methodology,
  };

  return [
    "Please produce the campaign report from the data below. The data is real and was computed by joining Colorlight playback statistics with GPS track data and TfL station footfall.",
    "",
    "```json",
    JSON.stringify(summary, null, 2),
    "```",
  ].join("\n");
}
