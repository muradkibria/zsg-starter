// GPS track reading, per-day rollups and route responses, all from the GPS
// points recorded in PocketBase (never live from Colorlight).

import {
  analyseTrack,
  GPS_INTERVAL_MS,
  londonDayBounds,
  simplifyLine,
  simplifyTrack,
  exposureParts,
  indexStations,
  londonClock,
  type ImpressionsParams,
  type StationIndex,
  type StationVisit,
  sortPoints,
  spreadLatePoints,
  type BagDayDto,
  type RouteResponse,
  type ShiftSummary,
  type TrackAnalytics,
  type TrackPoint,
  programNameFromVsn,
} from "@digilite/shared";
import { footfall } from "../footfall/tfl";
import { getAll, parsePbDate, pb, pbDate, q, stableId, type RecordModel } from "../pb";
import { activeAt, allAssignments } from "./assignments";
import { analyticsConfig, impressionsParams } from "./settings";
import { activeZoneShapes, zoneNames } from "./zones";

export async function loadPoints(bagId: string, from: Date, to: Date): Promise<TrackPoint[]> {
  const rows = await getAll<RecordModel>("gps_points", {
    filter: `bag = ${q(bagId)} && ts >= ${q(pbDate(from))} && ts < ${q(pbDate(to))}`,
    fields: "ts,seq,lat,lng",
    sort: "ts,seq",
  });
  return rows.map((r) => ({ t: parsePbDate(r.ts)!.getTime(), lat: r.lat, lng: r.lng, seq: r.seq ?? 0 }));
}

/** A bag's GPS interval in ms (every bag reports every 30 s today). */
export const gpsIntervalMs = (bag: RecordModel | null | undefined) => (bag?.gps_interval_s > 0 ? bag!.gps_interval_s * 1000 : GPS_INTERVAL_MS);

/**
 * Points for [from, to) with late batches put back in time (see spreadLatePoints).
 * Reads an hour either side first, so a batch that reached Colorlight just after
 * midnight but was recorded just before it lands on the right day, and a batch at
 * the start of the window is placed against the fix before it.
 */
export async function loadPlacedPoints(bagId: string, from: Date, to: Date, intervalMs = GPS_INTERVAL_MS): Promise<TrackPoint[]> {
  const raw = await loadPoints(bagId, new Date(from.getTime() - PLACE_MARGIN_MS), new Date(to.getTime() + PLACE_MARGIN_MS));
  return placeInWindow(raw, from.getTime(), to.getTime(), intervalMs);
}

const PLACE_MARGIN_MS = 3600_000;

/** Place late batches using points around the window, then keep those that land inside it. */
export function placeInWindow(raw: TrackPoint[], from: number, to: number, intervalMs = GPS_INTERVAL_MS): TrackPoint[] {
  return spreadLatePoints(sortPoints(raw), intervalMs).filter((p) => p.t >= from && p.t < to);
}

async function attributeShifts(bagId: string, a: TrackAnalytics): Promise<ShiftSummary[]> {
  const assignments = await allAssignments();
  return a.shifts.map((s) => {
    const who = activeAt(assignments, bagId, new Date(s.start));
    return {
      start: new Date(s.start).toISOString(),
      end: new Date(s.end).toISOString(),
      onSeconds: s.onSeconds,
      movingSeconds: s.movingSeconds,
      stoppedSeconds: s.stoppedSeconds,
      gapSeconds: s.gapSeconds,
      km: s.km,
      riderId: who?.riderId ?? null,
      riderName: who?.riderName ?? null,
    };
  });
}

// ── Bag days ──────────────────────────────────────────────────────────────────

let indexed: { stations: unknown; index: StationIndex } | null = null;
/** TfL stations with their daily taps, indexed for "nearest within 150 m". */
export async function stationIndex(): Promise<StationIndex> {
  const f = await footfall();
  if (!indexed || indexed.stations !== f.stations) indexed = { stations: f.stations, index: indexStations(f.stations) };
  return indexed.index;
}

export async function computeBagDay(bag: RecordModel, day: string): Promise<void> {
  const [start, end] = londonDayBounds(day);
  const pts = await loadPlacedPoints(bag.id, start, end, gpsIntervalMs(bag));
  const a = analyseTrack(pts, await activeZoneShapes(), await analyticsConfig());
  const playRows = await getAll<RecordModel>("plays", {
    filter: `bag = ${q(bag.id)} && hour >= ${q(pbDate(start))} && hour < ${q(pbDate(end))}`,
    fields: "plays,seconds,hour",
  });
  const plays = playRows.reduce((s, r) => s + (r.plays || 0), 0);
  // Time on screen per hour, and the estimated impressions while it was on.
  const onScreen = new Map<number, number>();
  for (const r of playRows) {
    const h = parsePbDate(r.hour)?.getTime();
    if (h !== undefined) onScreen.set(h, (onScreen.get(h) ?? 0) + (r.seconds || 0));
  }
  const clock = londonClock();
  const screenHourly = Array.from({ length: 24 }, () => 0);
  for (const [h, sec] of onScreen) screenHourly[clock(h).hour] += Math.round(Math.min(3600, sec));
  const impressionsHourly = Array.from({ length: 24 }, () => 0);
  const index = await stationIndex();
  const params = await impressionsParams();
  for (const part of exposureParts(pts, index, (t) => Math.min(1, (onScreen.get(Math.floor(t / 3600_000) * 3600_000) ?? 0) / 3600), params, clock)) {
    impressionsHourly[clock(part.t).hour] += part.impressions;
  }
  const iso = (t: number) => new Date(t).toISOString();
  const data = {
    id: stableId(`bag_day:${bag.id}:${day}`),
    bag: bag.id,
    day,
    first_at: a.first ? pbDate(new Date(a.first)) : "",
    last_at: a.last ? pbDate(new Date(a.last)) : "",
    points: a.points,
    on_seconds: Math.round(a.onSeconds),
    moving_seconds: Math.round(a.movingSeconds),
    stopped_seconds: Math.round(a.stoppedSeconds),
    gap_seconds: Math.round(a.gapSeconds),
    gaps: a.gaps.length,
    km: Math.round(a.km * 100) / 100,
    shifts: a.shifts.map((s) => ({ ...s, start: iso(s.start), end: iso(s.end) })),
    stops: a.stops.map((s) => ({ ...s, start: iso(s.start), end: iso(s.end) })),
    signal_gaps: a.gaps.map((g) => ({ ...g, start: iso(g.start), end: iso(g.end) })),
    zones: a.zoneSeconds,
    plays,
    screen_hourly: screenHourly,
    impressions: Math.round(impressionsHourly.reduce((a, b) => a + b, 0)),
    impressions_hourly: impressionsHourly.map((v) => Math.round(v * 10) / 10),
    computed_at: pbDate(new Date()),
  };
  const batch = pb.createBatch();
  batch.collection("bag_days").upsert(data);
  await batch.send();
}

export async function toBagDayDto(r: RecordModel, bagName: string): Promise<BagDayDto> {
  const names = await zoneNames();
  const assignments = await allAssignments();
  const shifts = (Array.isArray(r.shifts) ? r.shifts : []) as {
    start: string; end: string; onSeconds: number; movingSeconds: number; stoppedSeconds: number; gapSeconds: number; km: number;
  }[];
  return {
    bagId: r.bag,
    bagName,
    day: r.day,
    first: parsePbDate(r.first_at)?.toISOString() ?? null,
    last: parsePbDate(r.last_at)?.toISOString() ?? null,
    points: r.points ?? 0,
    onSeconds: r.on_seconds ?? 0,
    movingSeconds: r.moving_seconds ?? 0,
    stoppedSeconds: r.stopped_seconds ?? 0,
    gapSeconds: r.gap_seconds ?? 0,
    gaps: r.gaps ?? 0,
    km: r.km ?? 0,
    plays: r.plays ?? 0,
    impressions: r.impressions ?? 0,
    zones: Object.entries((r.zones ?? {}) as Record<string, number>)
      .map(([zoneId, seconds]) => ({ zoneId, name: names.get(zoneId) ?? "Removed zone", seconds }))
      .sort((a, b) => b.seconds - a.seconds),
    shifts: shifts.map((s) => {
      const who = activeAt(assignments, r.bag, new Date(s.start));
      return { ...s, riderId: who?.riderId ?? null, riderName: who?.riderName ?? null };
    }),
  };
}

export async function bagDays(bagIds: string[] | null, fromDay: string, toDay: string): Promise<RecordModel[]> {
  const bagFilter = bagIds && bagIds.length ? ` && (${bagIds.map((id) => `bag = ${q(id)}`).join(" || ")})` : "";
  return getAll<RecordModel>("bag_days", {
    filter: `day >= ${q(fromDay)} && day <= ${q(toDay)}${bagFilter}`,
    sort: "day",
  });
}

// ── Routes (what the map draws) ───────────────────────────────────────────────

/** Stretches near TfL stations while the screen was on, with their estimated impressions (all ads). */
async function stationVisits(bagId: string, pts: TrackPoint[], from: Date, to: Date, params: ImpressionsParams): Promise<StationVisit[]> {
  const rows = await getAll<RecordModel>("plays", {
    filter: `bag = ${q(bagId)} && hour >= ${q(pbDate(from))} && hour < ${q(pbDate(to))}`,
    fields: "hour,seconds",
  });
  const onScreen = new Map<number, number>();
  for (const r of rows) {
    const h = parsePbDate(r.hour)?.getTime();
    if (h !== undefined) onScreen.set(h, (onScreen.get(h) ?? 0) + (r.seconds || 0));
  }
  const parts = exposureParts(pts, await stationIndex(), (t) => Math.min(1, (onScreen.get(Math.floor(t / 3600_000) * 3600_000) ?? 0) / 3600), params);
  const out: (StationVisit & { lastT: number })[] = [];
  let cur: (StationVisit & { lastT: number }) | null = null;
  for (const p of parts) {
    if (!p.station) continue;
    // A new visit when the station changes or after 5 minutes away.
    if (!cur || cur.key !== p.station.key || p.t - cur.lastT > 5 * 60_000) {
      if (cur) out.push(cur);
      cur = { key: p.station.key, name: p.station.name, lat: p.station.lat, lng: p.station.lng, start: new Date(p.t).toISOString(), end: "", impressions: 0, lastT: p.t };
    }
    cur.lastT = p.t;
    cur.end = new Date(p.t + Math.max(30, p.seconds) * 1000).toISOString();
    cur.impressions += p.impressions;
  }
  if (cur) out.push(cur);
  return out.map(({ lastT: _lastT, ...v }) => ({ ...v, impressions: Math.round(v.impressions * 10) / 10 }));
}

export async function buildRoute(bag: RecordModel, from: Date, to: Date, day: string | null): Promise<RouteResponse> {
  const cfg = await analyticsConfig();
  const zones = await activeZoneShapes();
  const names = await zoneNames();
  const pts = await loadPlacedPoints(bag.id, from, to, gpsIntervalMs(bag));
  const a = analyseTrack(pts, zones, cfg);

  // Pieces of track split at signal gaps: straight lines between GPS fixes,
  // simplified keeping their timing (for replay).
  const gapMs = cfg.signalGapMin * 60000;
  const segments: [number, number][][] = [];
  const times: number[][] = [];
  let cur: TrackPoint[] = [];
  const flush = () => {
    if (cur.length > 1) {
      const kept = simplifyTrack(cur, 3);
      segments.push(kept.map((i) => [cur[i].lng, cur[i].lat]));
      times.push(kept.map((i) => Math.round(cur[i].t / 1000)));
    }
    cur = [];
  };
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && pts[i].t - pts[i - 1].t > gapMs) flush();
    cur.push(pts[i]);
  }
  flush();

  const iso = (t: number) => new Date(t).toISOString();
  const params = await impressionsParams();
  return {
    stationVisits: await stationVisits(bag.id, pts, from, to, params),
    catchmentM: params.radiusM,
    bagId: bag.id,
    bagName: bag.name,
    from: from.toISOString(),
    to: to.toISOString(),
    day,
    segments,
    times,
    gaps: a.gaps.map((g) => ({ start: iso(g.start), end: iso(g.end), seconds: g.seconds, from: g.from, to: g.to })),
    stops: a.stops.map((s) => ({ lat: s.lat, lng: s.lng, start: iso(s.start), end: iso(s.end), seconds: s.seconds })),
    shifts: await attributeShifts(bag.id, a),
    zones: Object.entries(a.zoneSeconds)
      .map(([zoneId, seconds]) => ({ zoneId, name: names.get(zoneId) ?? "Zone", seconds }))
      .sort((x, y) => y.seconds - x.seconds),
    zoneTimeline: a.zoneSegments.map((z) => ({
      zoneId: z.zoneId,
      name: z.zoneId ? names.get(z.zoneId) ?? null : null,
      start: iso(z.start),
      end: iso(z.end),
    })),
    timeline: a.timeline.map((p) => ({ kind: p.kind, start: iso(p.start), end: iso(p.end) })),
    summary: {
      first: a.first ? iso(a.first) : null,
      last: a.last ? iso(a.last) : null,
      points: a.points,
      late: a.late,
      onSeconds: a.onSeconds,
      movingSeconds: a.movingSeconds,
      stoppedSeconds: a.stoppedSeconds,
      gapSeconds: a.gapSeconds,
      km: a.km,
    },
    playing: bag.playing_program || programNameFromVsn(bag.playing_vsn),
  };
}

/** Recent trail (last N minutes) for a set of bags, as [lng, lat]. */
export async function recentTrails(bagIds: string[], minutes = 30): Promise<Map<string, [number, number][]>> {
  const out = new Map<string, [number, number][]>();
  if (!bagIds.length) return out;
  const since = new Date(Date.now() - minutes * 60000);
  const rows = await getAll<RecordModel>("gps_points", {
    filter: `ts >= ${q(pbDate(since))} && (${bagIds.map((id) => `bag = ${q(id)}`).join(" || ")})`,
    fields: "bag,ts,seq,lat,lng",
    sort: "ts,seq",
  });
  for (const r of rows) {
    const list = out.get(r.bag) ?? [];
    list.push([r.lng, r.lat]);
    out.set(r.bag, list);
  }
  for (const [k, v] of out) out.set(k, simplifyLine(v, 3));
  return out;
}

/** Most recent London day that has a bag_days row with points. */
export async function lastActiveDay(bagId: string): Promise<string | null> {
  const res = await pb.collection("bag_days").getList(1, 1, {
    filter: `bag = ${q(bagId)} && points > 0`,
    sort: "-day",
    fields: "day",
    skipTotal: true,
  });
  return (res.items[0]?.day as string | undefined) ?? null;
}
