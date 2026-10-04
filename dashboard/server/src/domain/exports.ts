// Exports: routes (every GPS point), shifts, ad plays and time in zones, as
// CSV, Excel, GPX or KML. Built from our PocketBase copy, a bag at a time and a
// page at a time, and streamed so a month of routes never sits in memory.
//
// Rules: London days; rows are credited to whoever had the bag at the time (by
// assignment); signal gaps become explicit "no signal" rows and are never
// filled in; points that arrived late in a batch keep their arrival time and
// are marked "sent late".

import ExcelJS from "exceljs";
import type { Response } from "express";
import {
  EXPORT_TYPE_LABEL,
  analyseTrack,
  formatDuration,
  haversineMeters,
  londonDayBounds,
  londonOffsetMinutes,
  paidSeconds,
  payDayCount,
  payPeriodLabel,
  payWeekday,
  sortPoints,
  spreadLatePoints,
  type AnalyticsConfig,
  type ExportColumn,
  type ExportFormat,
  type ExportHandover,
  type ExportPreview,
  type ExportPreviewRow,
  type ExportRequest,
  type ExportType,
  type TrackPoint,
} from "@digilite/shared";
import { getAll, getFirst, pb, pbDate, parsePbDate, q, type RecordModel } from "../pb";
import { activeAt, allAssignments, type AssignmentRow } from "./assignments";
import { loadBags } from "./bags";
import { analyticsConfig, getSettings } from "./settings";
import { zoneNames } from "./zones";

type Cell = string | number | null;

// ── CSV / XML ─────────────────────────────────────────────────────────────────

/** Excel only reads UTF-8 CSV properly (£, accents) with a byte-order mark. */
export const CSV_BOM = "\ufeff";

export function csvCell(v: Cell | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  // A cell starting with = + - @ would run as a formula in a spreadsheet.
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: readonly (Cell | undefined)[]): string {
  return cells.map(csvCell).join(",") + "\r\n";
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ── London time (fast: one offset lookup per hour) ────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
const offsetByHour = new Map<number, number>();

function londonOffsetMs(t: number): number {
  const h = Math.floor(t / 3600000);
  let o = offsetByHour.get(h);
  if (o === undefined) {
    // Clocks change on the hour (01:00 UTC), so one lookup covers the whole hour.
    o = londonOffsetMinutes(new Date(h * 3600000)) * 60000;
    if (offsetByHour.size > 20000) offsetByHour.clear();
    offsetByHour.set(h, o);
  }
  return o;
}

/** London date ("2026-09-28") and time ("19:42:06") of an instant. */
export function londonStamp(t: number): { date: string; time: string } {
  const d = new Date(t + londonOffsetMs(t));
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
  };
}

/** "14m 32s", "1h 05m" — a signal gap's length. */
export function gapLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${pad(m)}m` : `${m}m ${pad(s % 60)}s`;
}

/** "Mon 28 Sep" */
export function dayShort(day: string): string {
  return `${payWeekday(day)} ${payPeriodLabel(day, day, { short: true })}`;
}

const hours2 = (seconds: number) => Math.round(seconds / 36) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ── Scope: which bag, when ────────────────────────────────────────────────────

/** Half-open [start, end) in epoch ms. */
export interface Interval {
  start: number;
  end: number;
}

export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function inIntervals(list: Interval[], t: number): boolean {
  for (const i of list) if (t >= i.start && t < i.end) return true;
  return false;
}

function touches(list: Interval[], start: number, end: number): boolean {
  return list.some((i) => i.start < end && i.end > start);
}

/**
 * Bags → time windows to export. Picked bags: the whole range. Picked riders:
 * the bags they held, only while they held them. Nothing picked: every bag.
 */
export function buildScope(o: {
  from: number;
  to: number;
  bagIds: string[];
  riderIds: string[];
  everyBagId: string[];
  assignments: AssignmentRow[];
}): Map<string, Interval[]> {
  const raw = new Map<string, Interval[]>();
  const add = (bagId: string, i: Interval) => raw.set(bagId, [...(raw.get(bagId) ?? []), i]);
  const everyone = !o.bagIds.length && !o.riderIds.length;
  for (const id of everyone ? o.everyBagId : o.bagIds) add(id, { start: o.from, end: o.to });
  const riders = new Set(o.riderIds);
  for (const a of o.assignments) {
    if (!riders.has(a.riderId)) continue;
    const s = Math.max(a.start.getTime(), o.from);
    const e = Math.min(a.end ? a.end.getTime() : Infinity, o.to);
    if (e > s) add(a.bagId, { start: s, end: e });
  }
  const out = new Map<string, Interval[]>();
  for (const [k, v] of raw) {
    const m = mergeIntervals(v);
    if (m.length) out.set(k, m);
  }
  return out;
}

/** Bag hand-overs (and hand-backs) inside [from, to) for the given bags. */
export function handoversIn(assignments: AssignmentRow[], bagIds: Set<string>, from: number, to: number, bagName: (id: string) => string): ExportHandover[] {
  const out: ExportHandover[] = [];
  const byBag = new Map<string, AssignmentRow[]>();
  for (const a of assignments) if (bagIds.has(a.bagId)) byBag.set(a.bagId, [...(byBag.get(a.bagId) ?? []), a]);
  for (const [bagId, list] of byBag) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    list.forEach((a, i) => {
      const s = a.start.getTime();
      if (i > 0 && s >= from && s < to) {
        out.push({ bagId, bagName: bagName(bagId), day: londonStamp(s).date, fromRiderName: list[i - 1].riderName, toRiderName: a.riderName });
      }
      // Handed back with nobody taking it on inside the range (otherwise the next hand-over covers it).
      const e = a.end?.getTime();
      const next = list[i + 1];
      if (e !== undefined && e > from && e <= to && !(next && next.start.getTime() < to)) {
        out.push({ bagId, bagName: bagName(bagId), day: londonStamp(e - 1).date, fromRiderName: a.riderName, toRiderName: null });
      }
    });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.bagName.localeCompare(b.bagName));
}

// ── Routes: one row per GPS point, plus "no signal" rows ──────────────────────

export interface GpsRow extends TrackPoint {
  seq: number;
  late?: boolean;
}

export interface RoutePointRow {
  kind: "point";
  /** Stored time (for a late batch, when it arrived) */
  t: number;
  lat: number;
  lng: number;
  kmh: number | null;
  state: "Moving" | "Stopped" | "—";
  late: boolean;
  /** First point after a signal gap or a break: map files start a new line here */
  newSegment: boolean;
}

export interface RouteGapRow {
  kind: "gap";
  t: number;
  end: number;
  seconds: number;
}

export type RouteRow = RoutePointRow | RouteGapRow;

/**
 * One London day of a bag's points → export rows. Stops and shifts come from
 * the same analysis as the rest of the app. The time column is what we stored:
 * for a late batch that's when it arrived, so wherever that column jumps by
 * more than signalGapMin inside a shift there's an explicit "no signal" row
 * (the bag sent nothing) — never filled in. Longer silences between shifts
 * (bag off) get no row but still break the line.
 */
export function routeRowsForDay(raw: GpsRow[], cfg: AnalyticsConfig): RouteRow[] {
  if (!raw.length) return [];
  const sorted = sortPoints(raw) as GpsRow[];
  const spread = spreadLatePoints(sorted);
  const a = analyseTrack(sorted, [], cfg);
  const gapMs = cfg.signalGapMin * 60000;
  const shiftOf = (t: number) => a.shifts.findIndex((x) => t >= x.start && t <= x.end);
  const stopped = (t: number) => a.stops.some((x) => t >= x.start && t <= x.end);
  const isLate = (i: number) => !!(sorted[i].late || spread[i].late);
  const out: RouteRow[] = [];
  let newSegment = true;
  let shift = shiftOf(spread[0].t);
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const late = isLate(i);
    let kmh: number | null = null;
    // Speed only between two points with real timestamps (not after a gap or a late batch).
    if (i > 0 && !newSegment && !late && !isLate(i - 1)) {
      const prev = sorted[i - 1];
      const dt = p.t - prev.t;
      if (dt > 0) kmh = Math.round((haversineMeters(prev.lat, prev.lng, p.lat, p.lng) / (dt / 1000)) * 3.6);
    }
    out.push({
      kind: "point",
      t: p.t,
      lat: p.lat,
      lng: p.lng,
      kmh,
      state: shift < 0 ? "—" : stopped(spread[i].t) ? "Stopped" : "Moving",
      late,
      newSegment,
    });
    newSegment = false;
    const next = sorted[i + 1];
    if (!next) break;
    const nextShift = shiftOf(spread[i + 1].t);
    const dt = next.t - p.t;
    if (dt > gapMs) {
      newSegment = true;
      if (shift >= 0 && shift === nextShift) out.push({ kind: "gap", t: p.t, end: next.t, seconds: dt / 1000 });
    }
    shift = nextShift;
  }
  return out;
}

/** Split a day's rows into continuous lines for map files (never joined across a gap). */
export function routeSegments(rows: RouteRow[]): RoutePointRow[][] {
  const out: RoutePointRow[][] = [];
  let cur: RoutePointRow[] = [];
  for (const r of rows) {
    if (r.kind === "gap" || r.newSegment) {
      if (cur.length) out.push(cur);
      cur = [];
    }
    if (r.kind === "point") cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out;
}

// ── Columns ───────────────────────────────────────────────────────────────────

const RIDER: ExportColumn = { key: "rider", label: "Rider" };

const COLUMNS: Record<ExportType, ExportColumn[]> = {
  routes: [
    RIDER,
    { key: "bag", label: "Bag" },
    { key: "date", label: "Date" },
    { key: "time", label: "Time" },
    { key: "lat", label: "Latitude", numeric: true },
    { key: "lng", label: "Longitude", numeric: true },
    { key: "kmh", label: "km/h", numeric: true },
    { key: "state", label: "State" },
    { key: "late", label: "Sent late" },
  ],
  shifts: [
    RIDER,
    { key: "bag", label: "Bag" },
    { key: "date", label: "Date" },
    { key: "start", label: "Start" },
    { key: "end", label: "End" },
    { key: "on", label: "On (h)", numeric: true },
    { key: "moving", label: "Moving (h)", numeric: true },
    { key: "stopped", label: "Stopped (h)", numeric: true },
    { key: "gap", label: "No signal (h)", numeric: true },
    { key: "paid", label: "Paid (h)", numeric: true },
    { key: "km", label: "km", numeric: true },
    { key: "gaps", label: "Signal gaps", numeric: true },
    { key: "zones", label: "Zones" },
  ],
  plays: [
    RIDER,
    { key: "bag", label: "Bag" },
    { key: "date", label: "Date" },
    { key: "creative", label: "Creative" },
    { key: "mediaType", label: "Type" },
    { key: "plays", label: "Plays", numeric: true },
    { key: "seconds", label: "Seconds on screen", numeric: true },
  ],
  zones: [
    RIDER,
    { key: "bag", label: "Bag" },
    { key: "date", label: "Date" },
    { key: "zone", label: "Zone" },
    { key: "seconds", label: "Seconds in zone", numeric: true },
    { key: "hours", label: "Hours in zone", numeric: true },
  ],
};

export function columnsFor(type: ExportType, hideRiders: boolean): ExportColumn[] {
  return COLUMNS[type].filter((c) => !(hideRiders && c.key === "rider"));
}

// ── Loading ───────────────────────────────────────────────────────────────────

interface DayShiftRec {
  start: string;
  end: string;
  onSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  gapSeconds: number;
  km: number;
  zoneSeconds?: Record<string, number>;
}

interface BagDayRec {
  bagId: string;
  day: string;
  points: number;
  shifts: DayShiftRec[];
  gaps: { start: string; end: string; seconds: number }[];
}

export interface ExportContext {
  req: ExportRequest;
  from: number;
  to: number;
  days: string[];
  scope: Map<string, Interval[]>;
  bagName: (id: string) => string;
  /** Bag ids in scope, in name order */
  bagOrder: string[];
  assignments: AssignmentRow[];
  cfg: AnalyticsConfig;
  paySignalGaps: boolean;
  hideRiders: boolean;
  bagDays: BagDayRec[];
}

function days(fromDay: string, toDay: string): string[] {
  const out: string[] = [];
  const [y, m, d] = fromDay.split("-").map(Number);
  for (let i = 0; i < payDayCount(fromDay, toDay); i++) {
    const t = new Date(Date.UTC(y, m - 1, d + i));
    out.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`);
  }
  return out;
}

export async function loadExportContext(req: ExportRequest, hideRiders: boolean): Promise<ExportContext> {
  const from = londonDayBounds(req.fromDay)[0].getTime();
  const to = londonDayBounds(req.toDay)[1].getTime();
  const [bags, assignments, cfg, settings, dayRows] = await Promise.all([
    loadBags(),
    allAssignments(),
    analyticsConfig(),
    getSettings(),
    getAll<RecordModel>("bag_days", {
      filter: `day >= ${q(req.fromDay)} && day <= ${q(req.toDay)}`,
      fields: "bag,day,points,shifts,signal_gaps",
      sort: "day",
    }),
  ]);
  const names = new Map(bags.map((b) => [b.id, b.name as string]));
  const scope = buildScope({
    from,
    to,
    bagIds: req.bagIds,
    riderIds: req.riderIds,
    everyBagId: bags.map((b) => b.id),
    assignments,
  });
  const bagName = (id: string) => names.get(id) ?? "Unknown bag";
  const bagOrder = [...scope.keys()].sort((a, b) => bagName(a).localeCompare(bagName(b), "en-GB", { numeric: true }));
  const bagDays: BagDayRec[] = dayRows
    .filter((r) => scope.has(r.bag))
    .map((r) => ({
      bagId: r.bag,
      day: r.day,
      points: r.points ?? 0,
      shifts: Array.isArray(r.shifts) ? (r.shifts as DayShiftRec[]) : [],
      gaps: Array.isArray(r.signal_gaps) ? (r.signal_gaps as BagDayRec["gaps"]) : [],
    }));
  return {
    req,
    from,
    to,
    days: days(req.fromDay, req.toDay),
    scope,
    bagName,
    bagOrder,
    assignments,
    cfg,
    paySignalGaps: settings.paySignalGaps,
    hideRiders,
    bagDays,
  };
}

/** A bag's points in [from, to), in pages of 1,000 (the most PocketBase serves), four pages at a time. */
async function loadGps(bagId: string, from: number, to: number): Promise<GpsRow[]> {
  const opts = {
    filter: `bag = ${q(bagId)} && ts >= ${q(pbDate(new Date(from)))} && ts < ${q(pbDate(new Date(to)))}`,
    fields: "ts,seq,lat,lng,late",
    sort: "ts,seq",
  };
  const col = pb.collection("gps_points");
  const first = await col.getList<RecordModel>(1, 1000, opts);
  const pages: RecordModel[][] = [first.items];
  for (let p = 2; p <= first.totalPages; p += 4) {
    const batch = await Promise.all(
      [p, p + 1, p + 2, p + 3].filter((n) => n <= first.totalPages).map((n) => col.getList<RecordModel>(n, 1000, { ...opts, skipTotal: true })),
    );
    for (const b of batch) pages.push(b.items);
  }
  return pages.flat().map((r) => ({ t: parsePbDate(r.ts)!.getTime(), seq: r.seq ?? 0, lat: r.lat, lng: r.lng, late: !!r.late }));
}

async function countGps(bagId: string, iv: Interval[], extra = ""): Promise<number> {
  let n = 0;
  for (const i of iv) {
    const res = await pb.collection("gps_points").getList(1, 1, {
      filter: `bag = ${q(bagId)} && ts >= ${q(pbDate(new Date(i.start)))} && ts < ${q(pbDate(new Date(i.end)))}${extra}`,
      fields: "id",
    });
    n += res.totalItems;
  }
  return n;
}

function riderAt(ctx: ExportContext, bagId: string, t: number): AssignmentRow | null {
  return activeAt(ctx.assignments, bagId, new Date(t));
}

// ── Row sources ───────────────────────────────────────────────────────────────

export interface RouteBlock {
  bagId: string;
  bagName: string;
  day: string;
  rows: RouteRow[];
  riderNames: string[];
}

/** A bag-day at a time: loads one bag's points (paged), analyses each London day. */
export async function* routeBlocks(ctx: ExportContext, only?: { bagId: string; day: string }): AsyncGenerator<RouteBlock> {
  const plan = (only ? [only.bagId] : ctx.bagOrder).flatMap((bagId) => {
    const iv = ctx.scope.get(bagId);
    if (!iv) return [];
    const touched = (only ? [only.day] : ctx.days).filter((d) => {
      const [s, e] = londonDayBounds(d);
      return touches(iv, s.getTime(), e.getTime());
    });
    if (!touched.length) return [];
    const bounds = touched.map((d) => londonDayBounds(d).map((x) => x.getTime()) as [number, number]);
    return [{ bagId, iv, touched, bounds }];
  });
  // Load the next bag while this one is being written.
  const load = (i: number) => {
    const p = plan[i];
    const promise = p ? loadGps(p.bagId, p.bounds[0][0], p.bounds[p.bounds.length - 1][1]) : Promise.resolve([] as GpsRow[]);
    promise.catch(() => undefined);
    return promise;
  };
  let next = load(0);
  for (let pi = 0; pi < plan.length; pi++) {
    const { bagId, iv, touched, bounds } = plan[pi];
    const pts = await next;
    next = load(pi + 1);
    let k = 0;
    for (let di = 0; di < touched.length; di++) {
      const [s, e] = bounds[di];
      while (k < pts.length && pts[k].t < s) k++;
      const dayPts: GpsRow[] = [];
      while (k < pts.length && pts[k].t < e) dayPts.push(pts[k++]);
      if (!dayPts.length) continue;
      const rows = routeRowsForDay(dayPts, ctx.cfg).filter((r) => inIntervals(iv, r.t));
      if (!rows.some((r) => r.kind === "point")) continue;
      const riderNames = new Set<string>();
      for (const r of rows) {
        const who = riderAt(ctx, bagId, r.t);
        if (who) riderNames.add(who.riderName);
      }
      yield { bagId, bagName: ctx.bagName(bagId), day: touched[di], rows, riderNames: [...riderNames] };
    }
  }
}

function routeCells(ctx: ExportContext, b: RouteBlock, r: RouteRow): Cell[] {
  const { date, time } = londonStamp(r.t);
  const rider = ctx.hideRiders ? [] : [riderAt(ctx, b.bagId, r.t)?.riderName ?? ""];
  if (r.kind === "gap") return [...rider, b.bagName, date, time, null, null, null, `No signal · ${gapLength(r.seconds)}`, ""];
  return [...rider, b.bagName, date, time, round6(r.lat), round6(r.lng), r.kmh, r.state, r.late ? "Yes" : ""];
}

function routeTone(r: RouteRow): ExportPreviewRow["tone"] {
  if (r.kind === "gap") return "gap";
  if (r.late) return "late";
  return r.state === "Stopped" ? "stopped" : r.state === "Moving" ? "moving" : null;
}

interface TableRow {
  bagId: string;
  cells: Cell[];
  gaps?: number;
}

/** Shifts in scope: a shift is credited to whoever had the bag when it started. */
export function shiftRows(ctx: ExportContext, zoneName: (id: string) => string): TableRow[] {
  const out: (TableRow & { start: number })[] = [];
  for (const bd of ctx.bagDays) {
    const iv = ctx.scope.get(bd.bagId)!;
    for (const s of bd.shifts) {
      const start = Date.parse(s.start);
      const end = Date.parse(s.end);
      if (!inIntervals(iv, start)) continue;
      const gaps = bd.gaps.filter((g) => {
        const t = Date.parse(g.start);
        return t >= start && t <= end;
      }).length;
      const zones = Object.entries(s.zoneSeconds ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, sec]) => `${zoneName(id)} ${formatDuration(sec)}`)
        .join("; ");
      const rider = ctx.hideRiders ? [] : [riderAt(ctx, bd.bagId, start)?.riderName ?? ""];
      out.push({
        bagId: bd.bagId,
        gaps,
        start,
        cells: [
          ...rider,
          ctx.bagName(bd.bagId),
          bd.day,
          londonStamp(start).time.slice(0, 5),
          londonStamp(end).time.slice(0, 5),
          hours2(s.onSeconds),
          hours2(s.movingSeconds),
          hours2(s.stoppedSeconds),
          hours2(s.gapSeconds),
          hours2(paidSeconds(s, ctx.paySignalGaps)),
          Math.round(s.km * 100) / 100,
          gaps,
          zones,
        ],
      });
    }
  }
  return out.sort((a, b) => ctx.bagName(a.bagId).localeCompare(ctx.bagName(b.bagId), "en-GB", { numeric: true }) || a.start - b.start);
}

/** Time in zones per bag, day and rider (from the shifts in scope). */
export function zoneRows(ctx: ExportContext, zoneName: (id: string) => string): TableRow[] {
  const acc = new Map<string, { bagId: string; day: string; rider: string; zone: string; seconds: number }>();
  for (const bd of ctx.bagDays) {
    const iv = ctx.scope.get(bd.bagId)!;
    for (const s of bd.shifts) {
      const start = Date.parse(s.start);
      if (!inIntervals(iv, start)) continue;
      const rider = ctx.hideRiders ? "" : riderAt(ctx, bd.bagId, start)?.riderName ?? "";
      for (const [zoneId, sec] of Object.entries(s.zoneSeconds ?? {})) {
        const key = `${bd.bagId}|${bd.day}|${rider}|${zoneId}`;
        const cur = acc.get(key) ?? { bagId: bd.bagId, day: bd.day, rider, zone: zoneName(zoneId), seconds: 0 };
        cur.seconds += sec;
        acc.set(key, cur);
      }
    }
  }
  return [...acc.values()]
    .sort(
      (a, b) =>
        ctx.bagName(a.bagId).localeCompare(ctx.bagName(b.bagId), "en-GB", { numeric: true }) ||
        a.day.localeCompare(b.day) ||
        a.rider.localeCompare(b.rider) ||
        a.zone.localeCompare(b.zone),
    )
    .map((z) => ({
      bagId: z.bagId,
      cells: [...(ctx.hideRiders ? [] : [z.rider]), ctx.bagName(z.bagId), z.day, z.zone, Math.round(z.seconds), hours2(z.seconds)],
    }));
}

/** Ad plays per bag, London day, rider (by the hour) and creative. */
export async function playRows(ctx: ExportContext): Promise<TableRow[]> {
  if (!ctx.scope.size) return [];
  const rows = await getAll<RecordModel>("plays", {
    filter: `hour >= ${q(pbDate(new Date(ctx.from)))} && hour < ${q(pbDate(new Date(ctx.to)))}`,
    fields: "bag,hour,media_md5,media_name,media_type,plays,seconds",
    sort: "hour",
  });
  const acc = new Map<string, { bagId: string; day: string; rider: string; creative: string; mediaType: string; plays: number; seconds: number }>();
  for (const r of rows) {
    const iv = ctx.scope.get(r.bag);
    if (!iv) continue;
    const t = parsePbDate(r.hour)!.getTime();
    if (!inIntervals(iv, t)) continue;
    const day = londonStamp(t).date;
    const rider = ctx.hideRiders ? "" : riderAt(ctx, r.bag, t)?.riderName ?? "";
    const key = `${r.bag}|${day}|${rider}|${r.media_md5}`;
    const cur = acc.get(key) ?? {
      bagId: r.bag,
      day,
      rider,
      creative: r.media_name || r.media_md5,
      mediaType: r.media_type || "",
      plays: 0,
      seconds: 0,
    };
    cur.plays += r.plays || 0;
    cur.seconds += r.seconds || 0;
    acc.set(key, cur);
  }
  return [...acc.values()]
    .sort(
      (a, b) =>
        ctx.bagName(a.bagId).localeCompare(ctx.bagName(b.bagId), "en-GB", { numeric: true }) ||
        a.day.localeCompare(b.day) ||
        a.rider.localeCompare(b.rider) ||
        a.creative.localeCompare(b.creative),
    )
    .map((p) => ({
      bagId: p.bagId,
      cells: [...(ctx.hideRiders ? [] : [p.rider]), ctx.bagName(p.bagId), p.day, p.creative, p.mediaType, p.plays, Math.round(p.seconds)],
    }));
}

async function tableRows(ctx: ExportContext): Promise<TableRow[]> {
  const names = await zoneNames();
  const zoneName = (id: string) => names.get(id) ?? "Removed zone";
  if (ctx.req.type === "shifts") return shiftRows(ctx, zoneName);
  if (ctx.req.type === "zones") return zoneRows(ctx, zoneName);
  return playRows(ctx);
}

// ── Preview ───────────────────────────────────────────────────────────────────

const SAMPLE = 12;
/** Up to this many points the preview counts rows with the download's own code. */
const EXACT_PREVIEW_POINTS = 60_000;

export async function exportPreview(req: ExportRequest, hideRiders: boolean): Promise<ExportPreview> {
  const ctx = await loadExportContext(req, hideRiders);
  const columns = columnsFor(req.type, hideRiders);

  // Who's credited, and bag-days out with nobody assigned, from the shifts in scope.
  const riderIds = new Set<string>();
  const noRider = new Set<string>();
  const bagsWithData = new Set<string>();
  for (const bd of ctx.bagDays) {
    const iv = ctx.scope.get(bd.bagId)!;
    for (const s of bd.shifts) {
      const t = Date.parse(s.start);
      if (!inIntervals(iv, t)) continue;
      bagsWithData.add(bd.bagId);
      const who = riderAt(ctx, bd.bagId, t);
      if (who) riderIds.add(who.riderId);
      else noRider.add(`${bd.bagId}|${bd.day}`);
    }
  }

  let rowCount = 0;
  let pointCount: number | null = null;
  let gapCount = 0;
  let lateCount = 0;
  let approximate = false;
  let sample: ExportPreviewRow[] = [];
  let sampleNote = "";
  let sampleBagDay: ExportPreview["sampleBagDay"] = null;

  if (req.type === "routes") {
    pointCount = 0;
    const withPoints: string[] = [];
    for (const bagId of ctx.bagOrder) {
      const iv = ctx.scope.get(bagId)!;
      const n = await countGps(bagId, iv);
      if (n > 0) {
        pointCount += n;
        withPoints.push(bagId);
        bagsWithData.add(bagId);
        lateCount += await countGps(bagId, iv, " && late = true");
      }
    }
    const first = withPoints[0];
    const hasGap = (b: RouteBlock) => b.rows.some((r) => r.kind === "gap");
    let sampleBlock: RouteBlock | null = null;
    let firstBlock: RouteBlock | null = null;
    if (pointCount <= EXACT_PREVIEW_POINTS) {
      // Small enough to run the real thing: counts match the file exactly.
      for await (const b of routeBlocks(ctx)) {
        gapCount += b.rows.filter((r) => r.kind === "gap").length;
        if (b.bagId === first) {
          firstBlock ??= b;
          if (!sampleBlock && hasGap(b)) sampleBlock = b;
        }
      }
    } else {
      approximate = true;
      for (const bd of ctx.bagDays) {
        const iv = ctx.scope.get(bd.bagId)!;
        gapCount += bd.gaps.filter((g) => inIntervals(iv, Date.parse(g.start))).length;
      }
      if (first) {
        // Look at a few of the first bag's days that had a gap for a "no signal" row to show.
        const iv = ctx.scope.get(first)!;
        const candidates = ctx.bagDays.filter((bd) => bd.bagId === first && bd.gaps.some((g) => inIntervals(iv, Date.parse(g.start)))).map((bd) => bd.day);
        for (const d of candidates.slice(0, 4)) {
          for await (const b of routeBlocks(ctx, { bagId: first, day: d })) if (hasGap(b)) sampleBlock = b;
          if (sampleBlock) break;
        }
        if (!sampleBlock) {
          const firstPoint = await getFirst<RecordModel>(
            "gps_points",
            `bag = ${q(first)} && ts >= ${q(pbDate(new Date(iv[0].start)))} && ts < ${q(pbDate(new Date(iv[iv.length - 1].end)))}`,
            { sort: "ts,seq", fields: "ts" },
          );
          const d = firstPoint ? londonStamp(parsePbDate(firstPoint.ts)!.getTime()).date : null;
          if (d) for await (const b of routeBlocks(ctx, { bagId: first, day: d })) firstBlock = b;
        }
      }
    }
    rowCount = pointCount + gapCount;

    // Sample: the first bag, around its first "no signal" row if it has one.
    const b = sampleBlock ?? firstBlock;
    if (b) {
      const gi = b.rows.findIndex((r) => r.kind === "gap");
      const startAt = gi >= 0 ? Math.max(0, gi - 5) : 0;
      const rows = b.rows.slice(startAt, startAt + SAMPLE);
      sample = rows.map((r) => ({ cells: routeCells(ctx, b, r), tone: routeTone(r) }));
      sampleNote =
        gi >= 0
          ? `${b.bagName}, ${dayShort(b.day)}, around the ${londonStamp(b.rows[gi].t).time.slice(0, 5)} signal gap`
          : `${b.bagName}, ${dayShort(b.day)}, first ${rows.length} points`;
      sampleBagDay = { bagId: b.bagId, bagName: b.bagName, day: b.day };
    }
  } else {
    const rows = await tableRows(ctx);
    rowCount = rows.length;
    for (const r of rows) bagsWithData.add(r.bagId);
    if (req.type === "shifts") gapCount = rows.reduce((s, r) => s + (r.gaps ?? 0), 0);
    sample = rows.slice(0, SAMPLE).map((r) => ({ cells: r.cells, tone: null }));
    sampleNote = rows.length ? `First ${sample.length} rows · sorted by bag, then date` : "";
  }

  const handovers = handoversIn(ctx.assignments, new Set(ctx.bagOrder), ctx.from, ctx.to, ctx.bagName).map((h) =>
    hideRiders ? { ...h, fromRiderName: h.fromRiderName && "A rider", toRiderName: h.toRiderName && "another rider" } : h,
  );
  const tracks = ctx.bagDays.filter((b) => b.points > 0).length;
  const estimatedBytes: ExportPreview["estimatedBytes"] =
    req.type === "routes"
      ? { csv: rowCount * 70 + 200, xlsx: rowCount * 46 + 9000, gpx: (pointCount ?? 0) * 87 + tracks * 260, kml: (pointCount ?? 0) * 20 + tracks * 520 }
      : { csv: rowCount * 70 + 200, xlsx: rowCount * 40 + 9000 };

  return {
    ...req,
    days: ctx.days.length,
    bags: bagsWithData.size,
    riders: riderIds.size,
    rowCount,
    pointCount,
    gapCount,
    approximate,
    lateCount,
    noRiderDays: noRider.size,
    handovers,
    columns,
    sample,
    sampleNote,
    sampleBagDay,
    estimatedBytes,
    signalGapMin: ctx.cfg.signalGapMin,
    ridersHidden: hideRiders,
  };
}

// ── Downloads ─────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function exportFilename(req: ExportRequest, format: ExportFormat, who: string | null): string {
  const parts = ["digilite", req.type];
  if (who) parts.push(slug(who));
  parts.push(req.fromDay === req.toDay ? req.fromDay : `${req.fromDay}-to-${req.toDay}`);
  return `${parts.filter(Boolean).join("-")}.${format}`;
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  gpx: "application/gpx+xml",
  kml: "application/vnd.google-earth.kml+xml",
};

/** Buffered writer that respects back-pressure and stops if the browser goes away. */
class Out {
  private buf: string[] = [];
  private size = 0;
  constructor(private res: Response) {}
  get closed() {
    return this.res.destroyed || this.res.writableEnded;
  }
  async write(s: string) {
    this.buf.push(s);
    this.size += s.length;
    if (this.size >= 64 * 1024) await this.flush();
  }
  async flush() {
    if (!this.size || this.closed) return;
    const chunk = this.buf.join("");
    this.buf = [];
    this.size = 0;
    if (!this.res.write(chunk)) {
      await new Promise<void>((resolve) => {
        const done = () => {
          this.res.off("drain", done);
          this.res.off("close", done);
          resolve();
        };
        this.res.on("drain", done);
        this.res.on("close", done);
      });
    }
  }
}

function aboutLines(ctx: ExportContext, rows: number | null): [string, string][] {
  const r = ctx.req;
  const lines: [string, string][] = [
    ["Export", EXPORT_TYPE_LABEL[r.type]],
    ["Days", `${payPeriodLabel(r.fromDay, r.toDay, { year: true })} (London days, midnight to midnight)`],
    ["Bags", ctx.bagOrder.length ? ctx.bagOrder.map(ctx.bagName).join(", ") : "None"],
    ["Made", `${londonStamp(Date.now()).date} ${londonStamp(Date.now()).time.slice(0, 5)} London time`],
  ];
  if (rows !== null) lines.push(["Rows", String(rows)]);
  lines.push(["Times", "London time (GMT or BST)."]);
  if (!ctx.hideRiders) lines.push(["Rider", "Whoever had the bag at the time, from the assignment record. Blank when nobody was assigned."]);
  if (r.type === "routes") {
    lines.push(
      ["State", `Moving, Stopped (stayed within ${ctx.cfg.stopRadiusM} m for ${ctx.cfg.stopMin} min or more), or — for a lone point outside a shift.`],
      ["No signal", `The bag was on but sent no location for more than ${ctx.cfg.signalGapMin} min. Kept as its own row; nothing is filled in.`],
      ["Sent late", "Points the bag stored while it had no signal and sent together later. The time shown is when they arrived."],
      ["km/h", "Worked out from two consecutive points. Blank after a gap and for points sent late."],
    );
  }
  if (r.type === "shifts") {
    lines.push(
      ["Shift", `A run of points with no break longer than ${ctx.cfg.shiftBreakMin} min. A shift past midnight is split across two days.`],
      ["Paid (h)", ctx.paySignalGaps ? "Moving time plus time with no signal (the pay rules in Settings)." : "Moving time (the pay rules in Settings). Stops and time with no signal aren't paid."],
    );
  }
  if (r.type === "plays") lines.push(["Plays", "Counted by the bag, per hour, per ad file."]);
  if (r.type === "zones") lines.push(["Zones", "Time the bag's points were inside each zone, from the shifts in the export."]);
  return lines;
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FF10182B" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEBE2" } };
}

function widthFor(c: ExportColumn): number {
  if (c.key === "zones") return 48;
  if (c.key === "creative") return 36;
  if (c.key === "state") return 22;
  if (c.key === "rider") return 20;
  return Math.max(10, c.label.length + 3);
}

/**
 * Write the export to the response. Returns the number of data rows written
 * (routes count every point and every "no signal" row).
 */
export async function writeExport(res: Response, ctx: ExportContext, format: ExportFormat): Promise<number> {
  const cols = columnsFor(ctx.req.type, ctx.hideRiders);
  let rows = 0;

  if (format === "csv") {
    const out = new Out(res);
    await out.write(CSV_BOM + csvLine(cols.map((c) => c.label)));
    if (ctx.req.type === "routes") {
      for await (const b of routeBlocks(ctx)) {
        if (out.closed) break;
        for (const r of b.rows) {
          await out.write(csvLine(routeCells(ctx, b, r)));
          rows++;
        }
      }
    } else {
      for (const r of await tableRows(ctx)) {
        await out.write(csvLine(r.cells));
        rows++;
      }
    }
    await out.flush();
    res.end();
    return rows;
  }

  if (format === "xlsx") {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false });
    wb.creator = "DigiLite Hub";
    const about = wb.addWorksheet("About");
    about.columns = [
      { key: "k", width: 14, style: { font: { bold: true } } },
      { key: "v", width: 110 },
    ];
    for (const [k, v] of aboutLines(ctx, null)) about.addRow([k, v]).commit();
    about.commit();
    const newSheet = (name: string) => {
      const ws = wb.addWorksheet(name.slice(0, 31), { views: [{ state: "frozen", ySplit: 1 }] });
      ws.columns = cols.map((c) => ({ header: c.label, key: c.key, width: widthFor(c) }));
      styleHeader(ws);
      return ws;
    };
    if (ctx.req.type === "routes") {
      // One sheet per bag.
      let ws: ExcelJS.Worksheet | null = null;
      let current = "";
      for await (const b of routeBlocks(ctx)) {
        if (res.destroyed) break;
        if (b.bagId !== current) {
          ws?.commit();
          ws = newSheet(b.bagName);
          current = b.bagId;
        }
        for (const r of b.rows) {
          ws!.addRow(routeCells(ctx, b, r)).commit();
          rows++;
        }
      }
      if (ws) ws.commit();
      else newSheet("Routes").commit();
    } else {
      const ws = newSheet(EXPORT_TYPE_LABEL[ctx.req.type].replace("&", "and"));
      for (const r of await tableRows(ctx)) {
        ws.addRow(r.cells).commit();
        rows++;
      }
      ws.commit();
    }
    await wb.commit();
    return rows;
  }

  // Map files: one track per bag-day, split at every signal gap.
  const out = new Out(res);
  const title = `DigiLite routes, ${payPeriodLabel(ctx.req.fromDay, ctx.req.toDay, { year: true })}`;
  const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
  const trackName = (b: RouteBlock) => {
    const who = ctx.hideRiders ? "" : ` · ${b.riderNames.length ? b.riderNames.join(" / ") : "no rider"}`;
    return `${b.bagName} · ${dayShort(b.day)} ${b.day.slice(0, 4)}${who}`;
  };
  const desc = (b: RouteBlock) =>
    `London day ${b.day}. The line breaks at signal gaps (the bag sent no location) and when the bag was off; nothing is filled in.`;
  if (format === "gpx") {
    await out.write(
      `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="DigiLite Hub" xmlns="http://www.topografix.com/GPX/1/1">\n` +
        `<metadata><name>${xmlEscape(title)}</name><time>${iso(Date.now())}</time></metadata>\n`,
    );
    for await (const b of routeBlocks(ctx)) {
      if (out.closed) break;
      await out.write(`<trk><name>${xmlEscape(trackName(b))}</name><desc>${xmlEscape(desc(b))}</desc>\n`);
      for (const seg of routeSegments(b.rows)) {
        let s = "<trkseg>\n";
        for (const p of seg) {
          s += `<trkpt lat="${round6(p.lat)}" lon="${round6(p.lng)}"><time>${iso(p.t)}</time>${p.late ? "<desc>Sent late: the time is when it arrived</desc>" : ""}</trkpt>\n`;
        }
        await out.write(s + "</trkseg>\n");
        rows += seg.length;
      }
      await out.write("</trk>\n");
    }
    await out.write("</gpx>\n");
  } else {
    await out.write(
      `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document><name>${xmlEscape(title)}</name>\n` +
        `<Style id="route"><LineStyle><color>ff471b06</color><width>4</width></LineStyle></Style>\n`,
    );
    for await (const b of routeBlocks(ctx)) {
      if (out.closed) break;
      const segs = routeSegments(b.rows);
      const pts = segs.flat();
      let s =
        `<Placemark><name>${xmlEscape(trackName(b))}</name><description>${xmlEscape(desc(b))}</description><styleUrl>#route</styleUrl>` +
        `<TimeSpan><begin>${iso(pts[0].t)}</begin><end>${iso(pts[pts.length - 1].t)}</end></TimeSpan><MultiGeometry>\n`;
      for (const seg of segs) {
        const coords = seg.map((p) => `${round6(p.lng)},${round6(p.lat)},0`).join(" ");
        s += seg.length > 1 ? `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>\n` : `<Point><coordinates>${coords}</coordinates></Point>\n`;
      }
      await out.write(s + "</MultiGeometry></Placemark>\n");
      rows += pts.length;
    }
    await out.write("</Document>\n</kml>\n");
  }
  await out.flush();
  res.end();
  return rows;
}
