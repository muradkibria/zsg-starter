// ─────────────────────────────────────────────────────────────────────────────
// Time-weighted exposure model
//
// Given a bag's GPS track and the TfL station dataset, estimate how many
// impressions the bag's screen accumulated:
//
//   impressions = Σ (station_footfall_per_second × dwell_seconds × time_weight × visibility_factor)
//                   for every (GPS point × station within 250m) pair
//
// "Conservative" by design — visibility_factor (the fraction of people within
// 250m who could plausibly notice an LED-equipped courier bag) is held at
// 0.10. Tunable as we learn more.
//
// Time weights bias rush hours up and nights down (London local time, BST/GMT
// handled automatically via Intl.DateTimeFormat).
// ─────────────────────────────────────────────────────────────────────────────

export interface TrackPoint {
  lat: number;
  lng: number;
  /** UTC ISO timestamp (with Z) */
  timestamp: string;
}

export interface ExposureStation {
  station_name: string;
  lat: number;
  lng: number;
  daily_footfall: number;
  zone?: string;
}

// ── Constants (kept here so they're easy to tune in one place) ───────────────

export const RADIUS_M = 250;
export const MAX_DWELL_SECONDS = 60;
export const VISIBILITY_FACTOR = 0.10;
const SECONDS_PER_DAY = 86400;

export interface TimeBand {
  name: string;
  startHour: number;  // inclusive, fractional hours (e.g. 16.5 = 16:30)
  endHour: number;    // exclusive
  weight: number;
}

export const TIME_BANDS: TimeBand[] = [
  { name: "AM_RUSH",   startHour: 7,    endHour: 9.5,  weight: 1.5 },
  { name: "MIDDAY",    startHour: 9.5,  endHour: 12,   weight: 0.9 },
  { name: "LUNCH",     startHour: 12,   endHour: 14,   weight: 1.2 },
  { name: "AFTERNOON", startHour: 14,   endHour: 16.5, weight: 0.9 },
  { name: "PM_RUSH",   startHour: 16.5, endHour: 19,   weight: 1.5 },
  { name: "EVENING",   startHour: 19,   endHour: 22,   weight: 0.7 },
  { name: "NIGHT",     startHour: 22,   endHour: 7,    weight: 0.3 }, // wraps midnight
];

// ── Time-band lookup ─────────────────────────────────────────────────────────

/** Return London-local fractional hour-of-day for a date (handles BST/GMT). */
function londonHour(d: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function timeWeightFor(d: Date): { weight: number; band: string } {
  const h = londonHour(d);
  for (const b of TIME_BANDS) {
    if (b.startHour > b.endHour) {
      // wraps midnight
      if (h >= b.startHour || h < b.endHour) return { weight: b.weight, band: b.name };
    } else {
      if (h >= b.startHour && h < b.endHour) return { weight: b.weight, band: b.name };
    }
  }
  return { weight: 1, band: "OTHER" };
}

// ── Haversine distance (inline for speed; we do ~250k of these per bag) ──────

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Output types ─────────────────────────────────────────────────────────────

export interface ZoneBucket {
  impressions: number;
  visits: number;
}
export interface TimeBandBucket {
  impressions: number;
  seconds: number;
}
export interface StationBucket {
  station_name: string;
  zone: string | undefined;
  impressions: number;
  visits: number;
}

export interface BagExposureResult {
  totalImpressions: number;
  totalExposureSeconds: number;
  trackPointCount: number;
  byZone: Record<string, ZoneBucket>;
  byTimeBand: Record<string, TimeBandBucket>;
  byStation: StationBucket[];
}

// ── Main exposure calc ───────────────────────────────────────────────────────

export function computeBagExposure(
  track: TrackPoint[],
  stations: ExposureStation[]
): BagExposureResult {
  const empty: BagExposureResult = {
    totalImpressions: 0,
    totalExposureSeconds: 0,
    trackPointCount: 0,
    byZone: {},
    byTimeBand: {},
    byStation: [],
  };
  if (track.length < 2 || stations.length === 0) return { ...empty, trackPointCount: track.length };

  const sorted = [...track].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let totalImpressions = 0;
  let totalExposureSeconds = 0;
  const byZone: Record<string, ZoneBucket> = {};
  const byTimeBand: Record<string, TimeBandBucket> = {};
  const byStation = new Map<string, StationBucket>();

  for (let i = 0; i < sorted.length - 1; i++) {
    const p = sorted[i];
    const next = sorted[i + 1];
    const tMs = new Date(p.timestamp).getTime();
    const nextMs = new Date(next.timestamp).getTime();
    if (!Number.isFinite(tMs) || !Number.isFinite(nextMs)) continue;

    const gapSec = (nextMs - tMs) / 1000;
    const exposureSec = Math.max(0, Math.min(MAX_DWELL_SECONDS, gapSec));
    if (exposureSec <= 0) continue;

    const tw = timeWeightFor(new Date(tMs));
    totalExposureSeconds += exposureSec;

    // Bounding-box prefilter (much faster than haversine for the ~99% of stations
    // that are nowhere near a given point).
    const latDelta = RADIUS_M / 111000;
    const lngDelta = RADIUS_M / (111000 * Math.max(0.01, Math.cos((p.lat * Math.PI) / 180)));

    for (const s of stations) {
      if (Math.abs(s.lat - p.lat) > latDelta) continue;
      if (Math.abs(s.lng - p.lng) > lngDelta) continue;
      const d = haversineMeters(p.lat, p.lng, s.lat, s.lng);
      if (d > RADIUS_M) continue;

      const footfallPerSec = (s.daily_footfall || 0) / SECONDS_PER_DAY;
      const impressions = footfallPerSec * exposureSec * tw.weight * VISIBILITY_FACTOR;
      if (impressions <= 0) continue;

      totalImpressions += impressions;

      const zoneKey = s.zone ?? "Unzoned";
      const z = byZone[zoneKey] ?? { impressions: 0, visits: 0 };
      z.impressions += impressions;
      z.visits++;
      byZone[zoneKey] = z;

      const tb = byTimeBand[tw.band] ?? { impressions: 0, seconds: 0 };
      tb.impressions += impressions;
      tb.seconds += exposureSec;
      byTimeBand[tw.band] = tb;

      const stKey = s.station_name;
      const st = byStation.get(stKey) ?? {
        station_name: stKey,
        zone: s.zone,
        impressions: 0,
        visits: 0,
      };
      st.impressions += impressions;
      st.visits++;
      byStation.set(stKey, st);
    }
  }

  return {
    totalImpressions,
    totalExposureSeconds,
    trackPointCount: sorted.length,
    byZone,
    byTimeBand,
    byStation: Array.from(byStation.values()).sort((a, b) => b.impressions - a.impressions),
  };
}
