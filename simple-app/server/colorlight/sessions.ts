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

const sessionsCache = new Map<string, { ts: number; data: RiderSession[] }>();
const SESSIONS_TTL_MS = 5 * 60 * 1000; // 5min cache — sessions don't change retroactively

export async function getSessionsForBag(
  bagId: string,
  days = 7
): Promise<RiderSession[]> {
  const cacheKey = `${bagId}:${days}`;
  const cached = sessionsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SESSIONS_TTL_MS) {
    return cached.data;
  }

  const points: ColorlightTrackPoint[] = [];
  const now = new Date();

  // Fetch each day separately so partial failures don't kill the whole window
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const dayEnd = new Date(now);
    dayEnd.setUTCDate(now.getUTCDate() - dayOffset);
    dayEnd.setUTCHours(23, 59, 59, 999);

    const dayStart = new Date(dayEnd);
    dayStart.setUTCHours(0, 0, 0, 0);

    const fmt = (d: Date) => d.toISOString().slice(0, 19);

    try {
      const track = await getTrack(bagId, fmt(dayStart), fmt(dayEnd));
      if (Array.isArray(track?.data)) {
        points.push(...track.data);
      }
    } catch (err) {
      console.warn(
        `[sessions] Failed to fetch day -${dayOffset} for bag ${bagId}:`,
        (err as Error).message
      );
    }
  }

  const sessions = computeSessions(bagId, points);
  sessionsCache.set(cacheKey, { ts: Date.now(), data: sessions });
  return sessions;
}

function computeSessions(bagId: string, rawPoints: ColorlightTrackPoint[]): RiderSession[] {
  if (rawPoints.length === 0) return [];

  // De-dupe and sort by serverTime (Colorlight's authoritative timestamp)
  const seen = new Set<string>();
  const sorted = rawPoints
    .filter((p) => {
      const key = p.serverTime;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (a, b) => new Date(a.serverTime).getTime() - new Date(b.serverTime).getTime()
    );

  const sessions: RiderSession[] = [];
  let curStart = sorted[0].serverTime;
  let curEnd = sorted[0].serverTime;
  let curPoints = 1;

  for (let i = 1; i < sorted.length; i++) {
    const gap =
      new Date(sorted[i].serverTime).getTime() - new Date(curEnd).getTime();
    if (gap > SESSION_GAP_MS) {
      sessions.push(buildSession(bagId, curStart, curEnd, curPoints));
      curStart = sorted[i].serverTime;
      curEnd = sorted[i].serverTime;
      curPoints = 1;
    } else {
      curEnd = sorted[i].serverTime;
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
