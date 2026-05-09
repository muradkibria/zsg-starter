// ─────────────────────────────────────────────────────────────────────────────
// Session derivation — compute online/offline sessions from Colorlight GPS
// track data. A session is a continuous run of GPS reports with no gap > 5min.
//
// This is more accurate than Colorlight's `online/form` totals because it
// reflects actual GPS reporting (when the bag was running and reporting),
// not Colorlight's internal "online" flag which can be misleading.
// ─────────────────────────────────────────────────────────────────────────────

import { getTrack, type ColorlightTrackPoint } from "./client.js";

export interface RiderSession {
  id: string;
  bag_id: string;
  started_at: string;        // ISO UTC
  ended_at: string;          // ISO UTC
  duration_seconds: number;
  gps_points: number;
}

export interface DayBreakdown {
  date: string;              // YYYY-MM-DD
  total_seconds: number;
  total_hours: number;
  session_count: number;
  sessions: RiderSession[];
}

// A 5-minute gap between GPS reports = device went offline. GPS normally
// reports every ~30s based on captured data, so this comfortably absorbs
// brief signal drops while catching real offline gaps.
const SESSION_GAP_MS = 5 * 60 * 1000;

// ── Sessions for a single bag, over the last N days ──────────────────────────

interface CacheEntry {
  ts: number;
  data: RiderSession[];
  ttl: number;       // how long this entry is valid (ms)
}

const sessionsCache = new Map<string, CacheEntry>();
const FRESH_TTL_MS = 5 * 60 * 1000;     // all days succeeded → 5 min cache
const PARTIAL_TTL_MS = 60 * 1000;       // some days failed → 1 min cache (retry sooner)
const FETCH_CONCURRENCY = 3;            // simultaneous /track calls per bag
const MAX_RANGE_MS = 31 * 24 * 3600 * 1000; // safety cap

export interface SessionsRange {
  /** Inclusive start of the window in epoch ms. */
  startMs: number;
  /** Inclusive end of the window in epoch ms. */
  endMs: number;
}

/** Derive a SessionsRange from a "rolling N days" parameter (legacy). */
export function rangeFromDays(days: number): SessionsRange {
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 3600 * 1000;
  return { startMs, endMs };
}

export async function getSessionsForBag(
  bagId: string,
  rangeOrDays: SessionsRange | number = 7
): Promise<RiderSession[]> {
  // Normalise the input — accept either a {startMs, endMs} or a "days" number.
  let { startMs, endMs }: SessionsRange =
    typeof rangeOrDays === "number"
      ? rangeFromDays(rangeOrDays)
      : { startMs: rangeOrDays.startMs, endMs: rangeOrDays.endMs };

  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  if (endMs - startMs > MAX_RANGE_MS) startMs = endMs - MAX_RANGE_MS;

  // Cache key normalised to whole minutes so adjacent requests dedupe
  const cacheKey = `${bagId}:${Math.floor(startMs / 60000)}:${Math.floor(endMs / 60000)}`;
  const cached = sessionsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < cached.ttl) {
    return cached.data;
  }

  // Build day-aligned windows that cover [startMs, endMs] inclusively.
  // Walks from endMs backwards in 24h chunks. Each window is clipped to the
  // requested range so partial first/last days don't pull data outside it.
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const dayWindows: { offset: number; start: string; end: string }[] = [];
  let cursorEnd = new Date(endMs);
  cursorEnd.setUTCHours(23, 59, 59, 999);
  let offset = 0;
  while (cursorEnd.getTime() >= startMs) {
    const dayStart = new Date(cursorEnd);
    dayStart.setUTCHours(0, 0, 0, 0);

    const clippedStart = dayStart.getTime() < startMs ? new Date(startMs) : dayStart;
    const clippedEnd = cursorEnd.getTime() > endMs ? new Date(endMs) : cursorEnd;

    dayWindows.push({ offset, start: fmt(clippedStart), end: fmt(clippedEnd) });

    cursorEnd = new Date(dayStart.getTime() - 1);  // step back to previous day's 23:59
    offset++;
    if (offset > 35) break; // safety net — should never hit thanks to MAX_RANGE_MS
  }

  // Fetch in small parallel batches (faster than sequential, gentler than fan-out)
  const points: ColorlightTrackPoint[] = [];
  let successes = 0;
  let failures = 0;
  let lastError: Error | null = null;

  for (let i = 0; i < dayWindows.length; i += FETCH_CONCURRENCY) {
    const batch = dayWindows.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((w) => getTrack(bagId, w.start, w.end))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const w = batch[j];
      if (r.status === "fulfilled" && Array.isArray(r.value?.data)) {
        points.push(...r.value.data);
        successes++;
      } else {
        failures++;
        const err = r.status === "rejected" ? (r.reason as Error) : new Error("Unexpected response shape");
        lastError = err;
        console.warn(
          `[sessions] Failed to fetch day -${w.offset} for bag ${bagId}:`,
          err?.message ?? err
        );
      }
    }
  }

  // CRITICAL: if every single day failed, this is an upstream problem, not a
  // legitimate empty timesheet. Throw so the route surfaces 502 and the
  // frontend renders the error state — and so we DO NOT poison the cache
  // with an empty array (this was the bug that caused yesterday's blank
  // timesheet for ~5 min after a transient Colorlight blip).
  if (successes === 0 && failures > 0) {
    throw new Error(
      `Could not load any GPS history for bag ${bagId} (all ${failures} day(s) failed). ` +
      `Last error: ${lastError?.message ?? "unknown"}`
    );
  }

  const sessions = computeSessions(bagId, points);

  // Cache normally on full success; shorter TTL if some days failed so we
  // retry the missing days sooner.
  const ttl = failures > 0 ? PARTIAL_TTL_MS : FRESH_TTL_MS;
  sessionsCache.set(cacheKey, { ts: Date.now(), data: sessions, ttl });
  return sessions;
}

/** Test/admin helper — wipe the sessions cache. */
export function clearSessionsCache() {
  sessionsCache.clear();
}

// Colorlight's `serverTime` is UTC but doesn't include a "Z" suffix, so we
// have to add one before parsing — otherwise Date() interprets in the local
// timezone of whatever server this runs on, which can be wildly wrong.
function asUtc(t: string): string {
  return t.endsWith("Z") ? t : t + "Z";
}

function computeSessions(bagId: string, rawPoints: ColorlightTrackPoint[]): RiderSession[] {
  if (rawPoints.length === 0) return [];

  // De-dupe and sort by serverTime (Colorlight's authoritative UTC timestamp)
  const seen = new Set<string>();
  const sorted = rawPoints
    .filter((p) => {
      const key = p.serverTime;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) => new Date(asUtc(a.serverTime)).getTime() - new Date(asUtc(b.serverTime)).getTime()
    );

  const sessions: RiderSession[] = [];
  let curStart = asUtc(sorted[0].serverTime);
  let curEnd = asUtc(sorted[0].serverTime);
  let curPoints = 1;

  for (let i = 1; i < sorted.length; i++) {
    const pointStamp = asUtc(sorted[i].serverTime);
    const gap = new Date(pointStamp).getTime() - new Date(curEnd).getTime();
    if (gap > SESSION_GAP_MS) {
      sessions.push(buildSession(bagId, curStart, curEnd, curPoints));
      curStart = pointStamp;
      curEnd = pointStamp;
      curPoints = 1;
    } else {
      curEnd = pointStamp;
      curPoints++;
    }
  }
  sessions.push(buildSession(bagId, curStart, curEnd, curPoints));

  // Most recent first
  return sessions.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

function buildSession(bagId: string, start: string, end: string, points: number): RiderSession {
  const seconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000)
  );
  return {
    id: `ses_${bagId}_${start}`,
    bag_id: bagId,
    started_at: start,
    ended_at: end,
    duration_seconds: seconds,
    gps_points: points,
  };
}

// ── Aggregate by day ─────────────────────────────────────────────────────────

export function groupSessionsByDay(sessions: RiderSession[]): DayBreakdown[] {
  const byDate = new Map<string, RiderSession[]>();
  for (const s of sessions) {
    // Use the START date (YYYY-MM-DD) — sessions that span midnight count toward
    // the day they began. Edge cases are rare with delivery shifts.
    const date = s.started_at.slice(0, 10);
    const arr = byDate.get(date) ?? [];
    arr.push(s);
    byDate.set(date, arr);
  }

  const out: DayBreakdown[] = [];
  byDate.forEach((daySessions, date) => {
    const total_seconds = daySessions.reduce(
      (sum: number, s: RiderSession) => sum + s.duration_seconds,
      0
    );
    out.push({
      date,
      total_seconds,
      total_hours: +(total_seconds / 3600).toFixed(2),
      session_count: daySessions.length,
      sessions: [...daySessions].sort(
        (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
      ),
    });
  });
  // Most recent day first
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ── CSV export helper ────────────────────────────────────────────────────────

export function sessionsToCsv(rider: { id: string; name: string }, sessions: RiderSession[]): string {
  const lines: string[] = [];
  lines.push("rider_id,rider_name,bag_id,session_id,started_at,ended_at,duration_minutes,gps_points");
  for (const s of sessions) {
    const minutes = (s.duration_seconds / 60).toFixed(1);
    lines.push(
      `${rider.id},"${rider.name.replace(/"/g, '""')}",${s.bag_id},${s.id},${s.started_at},${s.ended_at},${minutes},${s.gps_points}`
    );
  }
  return lines.join("\n") + "\n";
}
