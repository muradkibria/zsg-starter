// ─────────────────────────────────────────────────────────────────────────────
// Report aggregator
//
// Inputs: selected ad IDs, date range, optional bag filter.
// Outputs: structured numbers for the LLM (and the UI's "Numbers" panel).
//
// Strategy:
//   1. Resolve selected ad numeric IDs → media slugs (the form Colorlight
//      playTimes uses as `mediaMd5`).
//   2. For every bag in the fleet (or the filtered subset), fetch playTimes.
//      Bags with at least one play of a selected ad become "active bags" for
//      the report.
//   3. For each active bag, fetch its GPS track across the window (split by
//      day, since Colorlight's track endpoint is per-day) and run the exposure
//      model against the TfL stations.
//   4. Attribute the bag's total exposure to each selected ad in proportion
//      to that ad's airtime share on that bag.
//   5. Roll up: per-ad totals, per-bag totals, per-zone, per-time-band.
// ─────────────────────────────────────────────────────────────────────────────

import {
  listTerminals,
  listMedia,
  getTrack,
  getMediaPlayTimes,
  type ColorlightMediaItem,
} from "../colorlight/client.js";
import { listStations } from "../store/tfl-store.js";
import {
  computeBagExposure,
  TIME_BANDS,
  RADIUS_M,
  MAX_DWELL_SECONDS,
  VISIBILITY_FACTOR,
  type TrackPoint,
  type ExposureStation,
} from "./exposure.js";

const FETCH_CONCURRENCY = 4;

export interface PreviewInput {
  /** Colorlight numeric media IDs (as strings) — accepted from the UI's Media list. */
  adIds: string[];
  /** Optional explicit md5 slugs — accepted as a power-user alternative. */
  adMd5s?: string[];
  /** ISO timestamps (UTC). */
  startTime: string;
  endTime: string;
  /** Optional bag ID filter. If empty, all bags that played a selected ad are included. */
  bagIds?: string[];
}

export interface PreviewOutput {
  startTime: string;
  endTime: string;
  // Resolved ad list (with metadata for the report's title/body)
  ads: {
    media_id: string;
    media_md5: string;
    filename: string;
    file_type: string;
    duration_seconds: number;
    totalPlays: number;
    totalAirtimeSeconds: number;
    estimatedImpressions: number;     // attributed share of bag exposures
  }[];
  // Bags that played at least one of the selected ads
  bags: {
    bag_id: string;
    bag_name: string;
    plays_of_selected_ads: number;
    airtime_selected_seconds: number;
    airtime_total_seconds: number;     // all ads on this bag, not just selected
    selected_share: number;            // selected / total airtime — used for attribution
    exposure: {
      totalImpressions: number;
      totalExposureSeconds: number;
      trackPointCount: number;
    };
    attributedImpressions: number;     // exposure × selected_share
  }[];
  // Aggregates
  totals: {
    bagsCovered: number;
    totalPlays: number;
    totalAirtimeSeconds: number;
    estimatedImpressions: number;      // sum of attributedImpressions
  };
  byZone: Record<string, { impressions: number; visits: number }>;
  byTimeBand: Record<string, { impressions: number; seconds: number; weight: number }>;
  // Diagnostic / methodology data — surfaced so the UI can show "how we got here"
  methodology: {
    radius_m: number;
    max_dwell_seconds: number;
    visibility_factor: number;
    time_bands: typeof TIME_BANDS;
    notes: string[];
  };
}

// ── Helper: format day-boundary windows for Colorlight track calls ───────────

function buildDayWindows(startMs: number, endMs: number): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  let cursorEnd = new Date(endMs);
  cursorEnd.setUTCHours(23, 59, 59, 999);
  let safety = 0;
  while (cursorEnd.getTime() >= startMs && safety++ < 60) {
    const dayStart = new Date(cursorEnd);
    dayStart.setUTCHours(0, 0, 0, 0);
    const clippedStart = dayStart.getTime() < startMs ? new Date(startMs) : dayStart;
    const clippedEnd = cursorEnd.getTime() > endMs ? new Date(endMs) : cursorEnd;
    out.push({ start: fmt(clippedStart), end: fmt(clippedEnd) });
    cursorEnd = new Date(dayStart.getTime() - 1);
  }
  return out;
}

async function fetchAllTrackPoints(
  bagId: string,
  startMs: number,
  endMs: number
): Promise<TrackPoint[]> {
  const windows = buildDayWindows(startMs, endMs);
  const points: TrackPoint[] = [];
  for (const w of windows) {
    try {
      const track = await getTrack(bagId, w.start, w.end);
      for (const p of track.data ?? []) {
        if (p.latitude == null || p.longitude == null) continue;
        // serverTime is UTC but Colorlight returns it without the Z suffix.
        // Stamp it explicitly UTC to avoid local-tz parsing on the consuming side.
        const stamp = p.serverTime ?? p.clientTime ?? "";
        const utcStamp = stamp.endsWith("Z") ? stamp : stamp + "Z";
        points.push({ lat: p.latitude, lng: p.longitude, timestamp: utcStamp });
      }
    } catch (err) {
      console.warn(`[aggregator] track fetch failed for bag ${bagId} window ${w.start}–${w.end}:`, (err as Error).message);
    }
  }
  return points;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function buildReportPreview(input: PreviewInput): Promise<PreviewOutput> {
  const startMs = Date.parse(input.startTime);
  const endMs = Date.parse(input.endTime);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("startTime / endTime must be valid ISO timestamps");
  }
  const [lo, hi] = startMs <= endMs ? [startMs, endMs] : [endMs, startMs];

  // ── 1. Resolve ad IDs ↔ slugs via the Media library ───────────────────────
  const mediaList = await listMedia().catch(() => [] as ColorlightMediaItem[]);
  const idToSlug = new Map<string, string>();
  const slugToMedia = new Map<string, ColorlightMediaItem>();
  for (const m of mediaList) {
    const slug = (m as any).name as string | undefined;
    if (slug) {
      idToSlug.set(String(m.id), slug);
      slugToMedia.set(slug, m);
    }
  }

  const wantedSlugs = new Set<string>();
  for (const id of input.adIds ?? []) {
    const slug = idToSlug.get(String(id));
    if (slug) wantedSlugs.add(slug);
  }
  for (const md5 of input.adMd5s ?? []) {
    wantedSlugs.add(md5);
  }
  if (wantedSlugs.size === 0) {
    throw new Error("No ads selected (or selected ads not found in Colorlight media library)");
  }

  // ── 2. Fetch bag list (and apply filter) ──────────────────────────────────
  const terminals = await listTerminals();
  const bagFilter = input.bagIds && input.bagIds.length > 0 ? new Set(input.bagIds) : null;
  const candidateBags = bagFilter
    ? terminals.filter((t) => bagFilter.has(String(t.id)))
    : terminals;

  // ── 3. PlayTimes per bag (concurrency-limited) ────────────────────────────
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const startStr = fmt(new Date(lo));
  const endStr = fmt(new Date(hi));

  interface BagPlayInfo {
    bagId: string;
    bagName: string;
    perAdSelected: Map<string, { plays: number; durationSec: number; mediaName: string; mediaType: string }>;
    totalAirtimeAllAds: number;
    totalAirtimeSelected: number;
    totalPlaysSelected: number;
  }

  const playInfoByBag = new Map<string, BagPlayInfo>();

  for (let i = 0; i < candidateBags.length; i += FETCH_CONCURRENCY) {
    const batch = candidateBags.slice(i, i + FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (t) => {
        const data = await getMediaPlayTimes(t.id, startStr, endStr);
        return { terminal: t, data };
      })
    );
    for (const r of settled) {
      if (r.status !== "fulfilled" || !r.value.data?.statistic) continue;
      const { terminal, data } = r.value;
      const bagId = String(terminal.id);
      const bagName = terminal.title?.raw ?? terminal.title?.rendered ?? `Terminal ${bagId}`;

      const info: BagPlayInfo = {
        bagId,
        bagName,
        perAdSelected: new Map(),
        totalAirtimeAllAds: 0,
        totalAirtimeSelected: 0,
        totalPlaysSelected: 0,
      };
      for (const stat of data.statistic) {
        info.totalAirtimeAllAds += stat.totalPlayDuration;
        if (wantedSlugs.has(stat.mediaMd5)) {
          info.totalAirtimeSelected += stat.totalPlayDuration;
          info.totalPlaysSelected += stat.totalPlayTimes;
          info.perAdSelected.set(stat.mediaMd5, {
            plays: stat.totalPlayTimes,
            durationSec: stat.totalPlayDuration,
            mediaName: stat.mediaName,
            mediaType: stat.mediaType,
          });
        }
      }
      // Only keep bags that actually played at least one selected ad
      if (info.totalPlaysSelected > 0) playInfoByBag.set(bagId, info);
    }
  }

  const activeBagIds = Array.from(playInfoByBag.keys());

  // ── 4. GPS tracks + exposure per active bag ───────────────────────────────
  const stationList = listStations();
  const stationsForExposure: ExposureStation[] = stationList.map((s) => ({
    station_name: s.station_name,
    lat: s.lat,
    lng: s.lng,
    daily_footfall: s.daily_footfall ?? s.daily_entries + s.daily_exits,
    zone: s.zone,
  }));

  interface BagAggregate {
    bag_id: string;
    bag_name: string;
    plays_of_selected_ads: number;
    airtime_selected_seconds: number;
    airtime_total_seconds: number;
    selected_share: number;
    exposure: {
      totalImpressions: number;
      totalExposureSeconds: number;
      trackPointCount: number;
    };
    byZone: Record<string, { impressions: number; visits: number }>;
    byTimeBand: Record<string, { impressions: number; seconds: number }>;
    attributedImpressions: number;
  }

  const bagAggregates: BagAggregate[] = [];

  for (let i = 0; i < activeBagIds.length; i += FETCH_CONCURRENCY) {
    const batch = activeBagIds.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (bagId) => {
        const points = await fetchAllTrackPoints(bagId, lo, hi);
        const exposure = computeBagExposure(points, stationsForExposure);
        return { bagId, exposure };
      })
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      const info = playInfoByBag.get(r.value.bagId)!;
      const e = r.value.exposure;
      const share = info.totalAirtimeAllAds > 0
        ? info.totalAirtimeSelected / info.totalAirtimeAllAds
        : 1; // If we have no airtime data at all, attribute 100% conservatively.
      const attributed = e.totalImpressions * share;
      bagAggregates.push({
        bag_id: info.bagId,
        bag_name: info.bagName,
        plays_of_selected_ads: info.totalPlaysSelected,
        airtime_selected_seconds: info.totalAirtimeSelected,
        airtime_total_seconds: info.totalAirtimeAllAds,
        selected_share: share,
        exposure: {
          totalImpressions: e.totalImpressions,
          totalExposureSeconds: e.totalExposureSeconds,
          trackPointCount: e.trackPointCount,
        },
        byZone: e.byZone,
        byTimeBand: Object.fromEntries(
          Object.entries(e.byTimeBand).map(([k, v]) => [k, v]) as any
        ),
        attributedImpressions: attributed,
      });
    }
  }

  // ── 5. Per-ad attribution ─────────────────────────────────────────────────
  const adRollup = new Map<string, {
    media_id: string;
    media_md5: string;
    filename: string;
    file_type: string;
    duration_seconds: number;
    totalPlays: number;
    totalAirtimeSeconds: number;
    estimatedImpressions: number;
  }>();

  for (const slug of Array.from(wantedSlugs)) {
    const media = slugToMedia.get(slug);
    const numericId = media?.id != null ? String(media.id) : slug;
    const filename = media?.title?.rendered ?? (media as any)?.title_raw ?? slug;
    const fileType = media?.file_type ?? "video";
    const durSec = media?.media_details?.playtime_seconds ?? 0;
    adRollup.set(slug, {
      media_id: numericId,
      media_md5: slug,
      filename,
      file_type: fileType,
      duration_seconds: durSec,
      totalPlays: 0,
      totalAirtimeSeconds: 0,
      estimatedImpressions: 0,
    });
  }

  for (const ba of bagAggregates) {
    const info = playInfoByBag.get(ba.bag_id)!;
    const adPlaysOnBag = Array.from(info.perAdSelected.entries());
    const bagAdAirtimeTotal = adPlaysOnBag.reduce((s, [, v]) => s + v.durationSec, 0);
    if (bagAdAirtimeTotal === 0) continue;

    for (const [slug, stat] of adPlaysOnBag) {
      const row = adRollup.get(slug);
      if (!row) continue;
      row.totalPlays += stat.plays;
      row.totalAirtimeSeconds += stat.durationSec;
      // Attribute this bag's attributedImpressions to this ad in proportion to
      // its share of *selected* airtime on this bag (not all airtime).
      const adShareOfBag = stat.durationSec / bagAdAirtimeTotal;
      row.estimatedImpressions += ba.attributedImpressions * adShareOfBag;
    }
  }

  // ── 6. Roll-ups across all bags ───────────────────────────────────────────
  const byZone: Record<string, { impressions: number; visits: number }> = {};
  const byTimeBand: Record<string, { impressions: number; seconds: number; weight: number }> = {};
  const tbWeightByName = Object.fromEntries(TIME_BANDS.map((b) => [b.name, b.weight]));

  for (const ba of bagAggregates) {
    const shareForRollUp = ba.selected_share; // attribute zone/band rollups same way
    for (const [zone, v] of Object.entries(ba.byZone)) {
      const entry = byZone[zone] ?? { impressions: 0, visits: 0 };
      entry.impressions += v.impressions * shareForRollUp;
      entry.visits += v.visits;
      byZone[zone] = entry;
    }
    for (const [band, v] of Object.entries(ba.byTimeBand)) {
      const entry = byTimeBand[band] ?? { impressions: 0, seconds: 0, weight: tbWeightByName[band] ?? 1 };
      entry.impressions += v.impressions * shareForRollUp;
      entry.seconds += v.seconds;
      byTimeBand[band] = entry;
    }
  }

  const totalPlays = Array.from(adRollup.values()).reduce((s, a) => s + a.totalPlays, 0);
  const totalAirtimeSeconds = Array.from(adRollup.values()).reduce((s, a) => s + a.totalAirtimeSeconds, 0);
  const estimatedImpressions = Array.from(adRollup.values()).reduce((s, a) => s + a.estimatedImpressions, 0);

  // ── 7. Methodology notes (helpful for the UI + the LLM) ───────────────────
  const notes: string[] = [
    `Impressions are estimated as: footfall_per_second × dwell_seconds × time_band_weight × visibility_factor (${VISIBILITY_FACTOR}), summed over every GPS point × TfL station within ${RADIUS_M}m.`,
    `Per-point dwell is capped at ${MAX_DWELL_SECONDS}s to avoid over-weighting parked bags.`,
    `Per-ad impressions are this bag's total exposure × (this ad's share of all airtime on the bag).`,
    `Time bands use Europe/London local time (handles BST/GMT automatically).`,
    `Only bags that played at least one of the selected ads are included.`,
  ];

  return {
    startTime: new Date(lo).toISOString(),
    endTime: new Date(hi).toISOString(),
    ads: Array.from(adRollup.values()).sort((a, b) => b.estimatedImpressions - a.estimatedImpressions),
    bags: bagAggregates
      .map((ba) => ({
        bag_id: ba.bag_id,
        bag_name: ba.bag_name,
        plays_of_selected_ads: ba.plays_of_selected_ads,
        airtime_selected_seconds: ba.airtime_selected_seconds,
        airtime_total_seconds: ba.airtime_total_seconds,
        selected_share: ba.selected_share,
        exposure: ba.exposure,
        attributedImpressions: ba.attributedImpressions,
      }))
      .sort((a, b) => b.attributedImpressions - a.attributedImpressions),
    totals: {
      bagsCovered: bagAggregates.length,
      totalPlays,
      totalAirtimeSeconds,
      estimatedImpressions,
    },
    byZone,
    byTimeBand,
    methodology: {
      radius_m: RADIUS_M,
      max_dwell_seconds: MAX_DWELL_SECONDS,
      visibility_factor: VISIBILITY_FACTOR,
      time_bands: TIME_BANDS,
      notes,
    },
  };
}
