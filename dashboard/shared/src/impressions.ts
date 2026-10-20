// Estimated impressions from TfL station footfall. For each stretch of a bag's
// track (between two GPS fixes, at most 60 s):
//
//   impressions = daily station movements (TfL entries + exits that day)
//               × hourly traffic share (an estimated profile: TfL's file has daily totals only)
//               × exposure duration as a fraction of an hour
//               × station-to-street allocation
//               × visibility factor
//               × the advertiser's share of screen time
//
// A stretch counts when the bag is inside a station's catchment (Haversine
// distance ≤ the catchment radius). Where catchments overlap, only the nearest
// station counts, so the same flow is never counted twice. TfL publishes about
// a week behind: until a day is published, the same weekday of the latest week
// it has stands in.
//
// The radius, allocation and visibility are working assumptions, set in
// Settings and to be calibrated; they aren't measurements. Measured figures
// (plays, time on screen, km) never depend on any of this.

import type { TrackPoint } from "./analytics";
import { haversineMeters } from "./geo";

/** A station and its taps (entries + exits) per London day. */
export interface FootfallStation {
  key: string;
  name: string;
  lat: number;
  lng: number;
  taps: Record<string, number>;
}

/** The working assumptions (Settings → Impressions). */
export interface ImpressionsParams {
  /** Station catchment radius, metres */
  radiusM: number;
  /** Share of a station's users who pass through the street where the bag is (0–1) */
  streetShare: number;
  /** Share of those passing who have a reasonable opportunity to see the screen (0–1) */
  visibility: number;
}

/** Starting values for testing — assumptions, not measurements. */
export const DEFAULT_IMPRESSIONS: ImpressionsParams = { radiusM: 250, streetShare: 0.25, visibility: 0.1 };

/** Longest stretch between two GPS fixes that counts (longer is a gap). */
export const MAX_STEP_S = 60;

// Estimated share of a station's daily movements in each London hour: commuter
// peaks on weekdays, a broad midday-to-evening hump at weekends. TfL's daily file
// has no hours, so this is a documented estimate, not a measurement.
const WEEKDAY = [1.0, 0.3, 0, 0, 0.2, 1.5, 3.5, 7.5, 9.5, 6, 4.5, 4.5, 5, 5, 4.8, 5.5, 7, 9, 8, 5.5, 4, 3.5, 3, 2];
const WEEKEND = [1.5, 0.6, 0.2, 0.1, 0.2, 0.6, 1.2, 2.2, 3.5, 4.8, 6, 6.8, 7.2, 7.3, 7.3, 7.2, 7.2, 7, 6.5, 5.5, 4.6, 4, 3.5, 2.8];
const norm = (a: number[]) => {
  const t = a.reduce((s, v) => s + v, 0);
  return a.map((v) => v / t);
};
export const HOURLY_SHARE = { weekday: norm(WEEKDAY), weekend: norm(WEEKEND) };

/** One week before a London day. */
const weekBefore = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10);

/**
 * A station's taps on a day; if TfL hasn't published that day yet, the same
 * weekday in the latest week it has (looking back up to 8 weeks).
 */
export function tapsOn(station: FootfallStation, day: string): number {
  let d = day;
  for (let i = 0; i <= 8; i++, d = weekBefore(d)) {
    const v = station.taps[d];
    if (v !== undefined) return v;
  }
  return 0;
}

/** Stations on a grid for quick "nearest within 150 m" lookups. */
export interface StationIndex {
  cells: Map<string, FootfallStation[]>;
}

const CELL_DEG = 0.004;
const cellOf = (lat: number, lng: number) => `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;

export function indexStations(stations: FootfallStation[]): StationIndex {
  const cells = new Map<string, FootfallStation[]>();
  for (const s of stations) {
    const k = cellOf(s.lat, s.lng);
    cells.set(k, [...(cells.get(k) ?? []), s]);
  }
  return { cells };
}

/** The nearest station within `radiusM` (Haversine), and how far. */
export function nearestStation(index: StationIndex, lat: number, lng: number, radiusM: number): { station: FootfallStation; metres: number } | null {
  const ci = Math.floor(lat / CELL_DEG);
  const cj = Math.floor(lng / CELL_DEG);
  const reach = Math.max(1, Math.ceil(radiusM / 270));
  let best: { station: FootfallStation; metres: number } | null = null;
  for (let i = ci - reach; i <= ci + reach; i++) {
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (const s of index.cells.get(`${i}:${j}`) ?? []) {
        const m = haversineMeters(lat, lng, s.lat, s.lng);
        if (m <= radiusM && (!best || m < best.metres)) best = { station: s, metres: m };
      }
    }
  }
  return best;
}

/** London day ("2026-09-28") and hour for a time, cheaply (the UTC offset is looked up once an hour). */
export function londonClock(): (t: number) => { day: string; hour: number; weekend: boolean } {
  const memo = new Map<number, { day: string; hour: number; weekend: boolean }>();
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  return (t: number) => {
    const h = Math.floor(t / 3600_000);
    let v = memo.get(h);
    if (!v) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(h * 3600_000)).map((x) => [x.type, x.value]));
      v = { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekend: p.weekday === "Sat" || p.weekday === "Sun" };
      memo.set(h, v);
    }
    return v;
  };
}

export interface ExposurePart {
  /** epoch ms at the start of the stretch */
  t: number;
  lat: number;
  lng: number;
  seconds: number;
  impressions: number;
  station: FootfallStation | null;
}

/**
 * Walk a bag's track and estimate impressions stretch by stretch. `share(t)` is
 * the share of that moment's screen time to count (0–1): the screen being on at
 * all, or one advertiser's share. Stretches with no share are skipped.
 */
export function exposureParts(
  points: TrackPoint[],
  index: StationIndex,
  share: (t: number) => number,
  params: ImpressionsParams,
  clock = londonClock(),
): ExposurePart[] {
  const out: ExposurePart[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i];
    const seconds = Math.min(MAX_STEP_S, (points[i + 1].t - p.t) / 1000);
    if (seconds <= 0) continue;
    const sh = share(p.t);
    if (sh <= 0) continue;
    const near = nearestStation(index, p.lat, p.lng, params.radiusM);
    let impressions = 0;
    if (near) {
      const c = clock(p.t);
      const hourShare = (c.weekend ? HOURLY_SHARE.weekend : HOURLY_SHARE.weekday)[c.hour];
      impressions = tapsOn(near.station, c.day) * hourShare * (seconds / 3600) * params.streetShare * params.visibility * sh;
    }
    out.push({ t: p.t, lat: p.lat, lng: p.lng, seconds: seconds * sh, impressions, station: near?.station ?? null });
  }
  return out;
}

/** Round an estimate for display: two significant figures (12,345 → 12,000). */
export function roundEstimate(n: number): number {
  if (n < 100) return Math.round(n);
  const mag = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}
