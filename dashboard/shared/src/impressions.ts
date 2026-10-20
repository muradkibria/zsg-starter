// Estimated impressions for a screen on the move, using TfL station footfall as
// a gauge of how busy each street is.
//
//   1. How busy it is here, now: pedestrians passing a point per hour =
//        minimum street flow
//      + flow per station passenger × Σ nearby stations' movements that hour
//        (TfL entries + exits that day × an estimated hourly share — TfL's file has
//        daily totals only), each weighted by distance (a Gaussian, so busyness
//        fades smoothly between stations instead of stopping at a catchment edge).
//   2. Who the screen meets on each stretch of track (≤ 60 s between GPS fixes):
//        people along the street it covers (flow ÷ walking speed × metres travelled)
//      + people walking past it in that time (flow × seconds ÷ 3600; all of it
//        when the bag is stopped).
//   3. impressions = people met × visibility × the share of that time the screen
//      was on (or showed one advertiser's ad).
//
// TfL publishes about a week behind: until a day is published, the same weekday
// of the latest week it has stands in. The spread, flow per passenger, minimum
// flow and visibility are working assumptions (Settings → Impressions), to be
// calibrated. Measured figures (plays, time on screen, km) never depend on this.

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
  /** How far a station's busyness spreads (Gaussian σ), metres */
  spreadM: number;
  /** Pedestrians passing a point per hour, per station movement that hour at the station */
  flowPerTap: number;
  /** Pedestrians per hour on any street, however far from a station */
  minFlow: number;
  /** Share of the people met who have a reasonable chance to see the screen (0–1) */
  visibility: number;
}

/** Starting values — assumptions to calibrate, not measurements. */
export const DEFAULT_IMPRESSIONS: ImpressionsParams = { spreadM: 300, flowPerTap: 0.5, minFlow: 100, visibility: 0.1 };

/** Longest stretch between two GPS fixes that counts (longer is a gap). */
export const MAX_STEP_S = 60;
/** Walking pace, metres a second: turns a flow past a point into people per metre of street. */
export const WALKING_MS = 1.3;

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

/**
 * Pedestrians passing a point per hour: the minimum flow plus every station
 * within 3 spreads, its movements that hour weighted by distance.
 */
export function areaFlow(index: StationIndex, lat: number, lng: number, c: { day: string; hour: number; weekend: boolean }, params: ImpressionsParams): number {
  const ci = Math.floor(lat / CELL_DEG);
  const cj = Math.floor(lng / CELL_DEG);
  const reachM = 3 * params.spreadM;
  const reach = Math.max(1, Math.ceil(reachM / 270));
  const hourShare = (c.weekend ? HOURLY_SHARE.weekend : HOURLY_SHARE.weekday)[c.hour];
  const twoSigma2 = 2 * params.spreadM * params.spreadM;
  let movements = 0;
  for (let i = ci - reach; i <= ci + reach; i++) {
    for (let j = cj - reach; j <= cj + reach; j++) {
      for (const s of index.cells.get(`${i}:${j}`) ?? []) {
        const m = haversineMeters(lat, lng, s.lat, s.lng);
        if (m <= reachM) movements += tapsOn(s, c.day) * hourShare * Math.exp((-m * m) / twoSigma2);
      }
    }
  }
  return params.minFlow + params.flowPerTap * movements;
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
  /** Seconds counted (already weighted by the share) */
  seconds: number;
  /** People met on the stretch (before visibility and share) */
  met: number;
  impressions: number;
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
    const q = points[i + 1];
    const gap = (q.t - p.t) / 1000;
    if (gap <= 0) continue;
    const sh = share(p.t);
    if (sh <= 0) continue;
    const seconds = Math.min(MAX_STEP_S, gap);
    // Over a signal gap we don't know the path: count the time, not the distance.
    const metres = gap <= MAX_STEP_S ? haversineMeters(p.lat, p.lng, q.lat, q.lng) : 0;
    const flow = areaFlow(index, p.lat, p.lng, clock(p.t), params);
    const met = (flow / 3600 / WALKING_MS) * metres + (flow * seconds) / 3600;
    out.push({ t: p.t, lat: p.lat, lng: p.lng, seconds: seconds * sh, met, impressions: met * params.visibility * sh });
  }
  return out;
}

/** Round an estimate for display: two significant figures (12,345 → 12,000). */
export function roundEstimate(n: number): number {
  if (n < 100) return Math.round(n);
  const mag = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}
