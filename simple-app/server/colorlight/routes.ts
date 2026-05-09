// ─────────────────────────────────────────────────────────────────────────────
// Live Express router — maps /api/* to Colorlight Cloud.
// Only endpoints with a real Colorlight equivalent are registered here; the
// rest fall through to the mock router (riders, campaigns, ad-slots, zones).
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  listTerminals,
  getTerminal,
  getLatestGpsBatched,
  getLatestGpsForTerminal,
  getTrack,
  getHeatMap,
  getOnlineForm,
  getMediaPlayTimes,
  listMedia,
  getUsername,
  type ColorlightTerminal,
  type ColorlightLatestGps,
} from "./client.js";
import {
  getSessionsForBag,
  groupSessionsByDay,
  sessionsToCsv,
} from "./sessions.js";
import { getRider, getRiderByBagId, listRiders } from "../store/rider-store.js";
import { listPlaylists } from "../store/playlist-store.js";

// Device counts as "active" if its last GPS report was within the threshold.
// 90s comfortably covers the ~30s normal Colorlight reporting interval plus a
// network blip, but flips to "offline" quickly enough to match Colorlight's
// own online indicator.
const ACTIVE_GPS_THRESHOLD_MS = 90 * 1000;
const TERMINAL_TTL_MS = 30_000;
const GPS_TTL_MS = 5_000;

/**
 * Parse Colorlight `serverTime` (UTC, no Z) reliably regardless of where this
 * server runs. Falls back to `reportTime` (which is in the tenant's local
 * timezone) only if serverTime is missing.
 */
function parseColorlightUtc(serverTime: string | undefined, reportTime: string | undefined): number {
  if (serverTime) {
    const s = serverTime.endsWith("Z") ? serverTime : serverTime + "Z";
    const ms = new Date(s).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  if (reportTime) {
    // Last resort — interpret as UTC even though it might be tenant-local.
    // Inaccurate but safer than crashing.
    const s = reportTime.endsWith("Z") ? reportTime : reportTime + "Z";
    const ms = new Date(s).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

function utcStamp(serverTime: string | undefined, reportTime: string | undefined): string | null {
  if (serverTime) return serverTime.endsWith("Z") ? serverTime : serverTime + "Z";
  if (reportTime) return reportTime.endsWith("Z") ? reportTime : reportTime + "Z";
  return null;
}

// ── In-memory cache (shared across requests) ─────────────────────────────────

let terminalCache: { ts: number; data: ColorlightTerminal[] } | null = null;
let gpsCache: { ts: number; data: ColorlightLatestGps[] } | null = null;

async function getTerminalsCached(): Promise<ColorlightTerminal[]> {
  if (terminalCache && Date.now() - terminalCache.ts < TERMINAL_TTL_MS) {
    return terminalCache.data;
  }
  const data = await listTerminals();
  terminalCache = { ts: Date.now(), data };
  return data;
}

async function getGpsCached(): Promise<ColorlightLatestGps[]> {
  if (gpsCache && Date.now() - gpsCache.ts < GPS_TTL_MS) {
    return gpsCache.data;
  }
  const terminals = await getTerminalsCached();
  const data = await getLatestGpsBatched(terminals.map((t) => t.id));
  gpsCache = { ts: Date.now(), data };
  return data;
}

// ── Transformers — Colorlight shapes → frontend shapes ───────────────────────

function gpsByTerminalId(gps: ColorlightLatestGps[]): Map<number, ColorlightLatestGps> {
  const m = new Map<number, ColorlightLatestGps>();
  for (const g of gps) m.set(g.terminalId, g);
  return m;
}

function terminalToBag(
  t: ColorlightTerminal,
  gps: ColorlightLatestGps | undefined,
  ridersByBagId?: Map<string, { id: string; name: string }>
) {
  const id = String(t.id);
  const reportMs = gps ? parseColorlightUtc(gps.serverTime, gps.reportTime) : 0;
  const gpsAge = reportMs > 0 ? Date.now() - reportMs : Infinity;
  const isActive = gpsAge < ACTIVE_GPS_THRESHOLD_MS;
  const rider = ridersByBagId?.get(id) ?? null;

  return {
    id,
    name: t.title?.raw ?? t.title?.rendered ?? `Terminal ${id}`,
    colorlight_device_id: id,
    rider_id: rider?.id ?? null,
    status: isActive ? "active" : "inactive",
    last_lat: gps?.latitude ?? null,
    last_lng: gps?.longitude ?? null,
    last_speed: gps?.speed ?? null,
    last_heading: gps?.direct ?? null,
    last_gps_at: gps ? utcStamp(gps.serverTime, gps.reportTime) : null,
    created: t.date ?? null,
    expand: { rider_id: rider },
  };
}

function buildRiderIndex(): Map<string, { id: string; name: string }> {
  const map = new Map<string, { id: string; name: string }>();
  for (const r of listRiders()) {
    if (r.bag_id) map.set(r.bag_id, { id: r.id, name: r.name });
  }
  return map;
}

function defaultDayWindow() {
  // Use a rolling 24h window in UTC ISO format. Avoids timezone confusion
  // between the user's locale, Railway's UTC server, and Colorlight's account
  // timezone — and guarantees we always get something for the current shift.
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  return { startTime: fmt(start), endTime: fmt(end) };
}

const MAX_WINDOW_MS = 31 * 24 * 3600 * 1000; // safety cap on history queries

/**
 * Resolve a time window from query params with sensible defaults and bounds.
 * Accepts ISO 8601 timestamps. If absent or invalid, falls back to the last
 * 24 hours. Caps the window to 31 days so a misclick can't ask Colorlight
 * for a year of GPS data at once.
 */
function resolveWindow(req: { query: Record<string, any> }): { startTime: string; endTime: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  const now = new Date();

  let endMs = Date.parse(String(req.query?.endTime ?? ""));
  if (!Number.isFinite(endMs)) endMs = now.getTime();

  let startMs = Date.parse(String(req.query?.startTime ?? ""));
  if (!Number.isFinite(startMs)) startMs = endMs - 24 * 3600 * 1000;

  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  if (endMs - startMs > MAX_WINDOW_MS) startMs = endMs - MAX_WINDOW_MS;

  return { startTime: fmt(new Date(startMs)), endTime: fmt(new Date(endMs)) };
}

// ── Router ───────────────────────────────────────────────────────────────────

const router = Router();

// ── Auth (server-side login is implicit; this is just the dashboard's me/login) ──

router.get("/auth/me", (_req, res) => {
  res.json({
    id: "colorlight-user",
    email: getUsername(),
    name: getUsername(),
    role: "admin",
  });
});

router.post("/auth/login", (_req, res) => {
  // Mock issues a JWT so the existing frontend auth wrapper is happy.
  const secret = process.env.JWT_SECRET ?? "dev-secret";
  const token = jwt.sign(
    { userId: "colorlight-user", email: getUsername(), role: "admin" },
    secret,
    { expiresIn: "24h" }
  );
  res.json({ token, user: { id: "colorlight-user", email: getUsername(), role: "admin", name: getUsername() } });
});

router.post("/auth/logout", (_req, res) => res.json({ success: true }));

// ── Bags / terminals ─────────────────────────────────────────────────────────

router.get("/bags", async (_req, res, next) => {
  try {
    const [terminals, gps] = await Promise.all([getTerminalsCached(), getGpsCached()]);
    const map = gpsByTerminalId(gps);
    const ridersByBag = buildRiderIndex();
    res.json(terminals.map((t) => terminalToBag(t, map.get(t.id), ridersByBag)));
  } catch (err) {
    next(err);
  }
});

router.get("/bags/:id", async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const [terminal, gps] = await Promise.all([
      getTerminal(id),
      getLatestGpsForTerminal(id),
    ]);
    const ridersByBag = buildRiderIndex();
    res.json(terminalToBag(terminal, gps ?? undefined, ridersByBag));
  } catch (err) {
    next(err);
  }
});

// GPS history (used by route map mode)
router.get("/bags/:id/route", async (req, res, next) => {
  try {
    const { startTime, endTime } = resolveWindow(req);
    const track = await getTrack(req.params.id, startTime, endTime);
    res.json(
      (track.data ?? []).map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        timestamp: utcStamp(p.serverTime, p.clientTime),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Same as route — frontend asks for /gps for the per-bag history page
router.get("/bags/:id/gps", async (req, res, next) => {
  try {
    const { startTime, endTime } = resolveWindow(req);
    const track = await getTrack(req.params.id, startTime, endTime);
    res.json(
      (track.data ?? []).map((p, i) => ({
        id: `gps_${req.params.id}_${i}`,
        bag_id: req.params.id,
        lat: p.latitude,
        lng: p.longitude,
        speed: null,
        heading: null,
        created: utcStamp(p.serverTime, p.clientTime),
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ── Fleet ────────────────────────────────────────────────────────────────────

router.get("/fleet/live", async (_req, res, next) => {
  try {
    const [terminals, gps] = await Promise.all([getTerminalsCached(), getGpsCached()]);
    const map = gpsByTerminalId(gps);
    // Return ALL terminals — even ones with no position or stale GPS.
    // The frontend will render an offline marker at the last known position,
    // or skip rendering entirely if no GPS has ever been reported.
    res.json(
      terminals.map((t) => {
        const g = map.get(t.id);
        const reportMs = g ? parseColorlightUtc(g.serverTime, g.reportTime) : 0;
        const ageMs = reportMs > 0 ? Date.now() - reportMs : Infinity;
        const status = ageMs < ACTIVE_GPS_THRESHOLD_MS ? "active" : "inactive";
        return {
          bagId: String(t.id),
          name: t.title?.raw ?? `Terminal ${t.id}`,
          lat: g?.latitude ?? null,
          lng: g?.longitude ?? null,
          speed: g?.speed ?? null,
          heading: g?.direct ?? null,
          lastGpsAt: g ? utcStamp(g.serverTime, g.reportTime) : null,
          status,
          riderId: null,
          riderName: null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

router.get("/fleet/heatmap", async (req, res, next) => {
  try {
    const terminals = await getTerminalsCached();
    const groupId = terminals[0]?.terminalgroup?.[0]?.id ?? 0;
    const { startTime, endTime } = resolveWindow(req);
    const heat = await getHeatMap(groupId, startTime, endTime);
    res.json(
      (heat.data ?? []).flatMap((p) => {
        // Expand each cell into `count` points so the existing CircleMarker layer renders density
        const out: { lat: number; lng: number }[] = [];
        const reps = Math.min(p.count, 10);
        for (let i = 0; i < reps; i++) out.push({ lat: p.latitude, lng: p.longitude });
        return out;
      })
    );
  } catch (err) {
    next(err);
  }
});

// ── Media ────────────────────────────────────────────────────────────────────

router.get("/media", async (_req, res, next) => {
  try {
    const items = await listMedia();
    res.json(
      items.map((m) => ({
        id: String(m.id),
        campaign_id: m.attachment_program?.[0]?.id?.toString() ?? null,
        filename: m.title?.rendered ?? m.title_raw ?? `media-${m.id}`,
        file_type: m.file_type === "mp4" || m.mime_type?.startsWith("video") ? "video" : "image",
        duration_seconds: m.media_details?.playtime_seconds ?? 10,
        file_size_bytes: m.media_details?.filesize ?? 0,
        fileUrl: m.video_thumbnail_jpg ?? m.source_url,
        created: m.date_gmt ?? m.date,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ── Reports ──────────────────────────────────────────────────────────────────

router.get("/reports/ad-plays", async (_req, res, next) => {
  try {
    const terminals = await getTerminalsCached();
    const { startTime, endTime } = defaultDayWindow();

    // Aggregate playTimes across all terminals (with a small concurrency limit)
    const concurrency = 4;
    const aggregated = new Map<
      string,
      { mediaName: string; mediaType: string; plays: number; total_seconds: number }
    >();

    for (let i = 0; i < terminals.length; i += concurrency) {
      const batch = terminals.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map((t) => getMediaPlayTimes(t.id, startTime, endTime))
      );
      for (const r of results) {
        if (r.status !== "fulfilled" || !r.value?.statistic) continue;
        for (const stat of r.value.statistic) {
          const existing = aggregated.get(stat.mediaMd5);
          if (existing) {
            existing.plays += stat.totalPlayTimes;
            existing.total_seconds += stat.totalPlayDuration;
          } else {
            aggregated.set(stat.mediaMd5, {
              mediaName: stat.mediaName,
              mediaType: stat.mediaType,
              plays: stat.totalPlayTimes,
              total_seconds: stat.totalPlayDuration,
            });
          }
        }
      }
    }

    const rows = Array.from(aggregated.entries())
      .map(([md5, v]) => ({
        media_id: md5,
        filename: v.mediaName,
        file_type: v.mediaType.toLowerCase(),
        campaign_id: null,
        campaign_name: null,
        plays: v.plays,
        total_seconds: v.total_seconds,
      }))
      .sort((a, b) => b.plays - a.plays);

    const total = rows.reduce((s, r) => s + r.plays, 0);
    res.json({ rows, total });
  } catch (err) {
    next(err);
  }
});

// ── Rich ad-plays breakdown for the Reports page ─────────────────────────────
// Returns three pre-aggregated views (By Ad, By Bag, By Playlist) so the
// frontend can pivot without re-fetching. Single endpoint = one Colorlight
// fan-out per request.
//
// Query params:
//   startTime, endTime  ISO timestamps (defaults to last 24h via resolveWindow)
//   bagIds=a,b,c        Comma-separated bag IDs to filter to (default: all)
router.get("/reports/ad-plays-breakdown", async (req, res, next) => {
  try {
    const { startTime, endTime } = resolveWindow(req);
    const allTerminals = await getTerminalsCached();

    // Bag filter — accept comma-separated IDs OR repeated query params
    let filterIds: Set<string> | null = null;
    const rawBagIds = req.query.bagIds;
    if (typeof rawBagIds === "string" && rawBagIds.trim()) {
      filterIds = new Set(rawBagIds.split(",").map((s) => s.trim()).filter(Boolean));
    } else if (Array.isArray(rawBagIds)) {
      filterIds = new Set(rawBagIds.map(String));
    }

    const terminals = filterIds
      ? allTerminals.filter((t) => filterIds!.has(String(t.id)))
      : allTerminals;

    const terminalNameById = new Map<string, string>();
    for (const t of terminals) {
      terminalNameById.set(String(t.id), t.title?.raw ?? `Terminal ${t.id}`);
    }

    // Fan out to Colorlight playTimes per bag (concurrency-limited)
    const concurrency = 4;
    type RawStat = {
      bagId: string;
      bagName: string;
      mediaMd5: string;
      mediaName: string;
      mediaType: string;
      plays: number;
      durationSeconds: number;
    };
    const rawStats: RawStat[] = [];

    for (let i = 0; i < terminals.length; i += concurrency) {
      const batch = terminals.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        batch.map(async (t) => {
          const data = await getMediaPlayTimes(t.id, startTime, endTime);
          return { terminal: t, data };
        })
      );
      for (const r of settled) {
        if (r.status !== "fulfilled" || !r.value.data?.statistic) continue;
        const bagId = String(r.value.terminal.id);
        const bagName = terminalNameById.get(bagId) ?? bagId;
        for (const s of r.value.data.statistic) {
          rawStats.push({
            bagId,
            bagName,
            mediaMd5: s.mediaMd5,
            mediaName: s.mediaName,
            mediaType: s.mediaType,
            plays: s.totalPlayTimes,
            durationSeconds: s.totalPlayDuration,
          });
        }
      }
    }

    // ── Pivot 1: By Ad ────────────────────────────────────────────────────
    const adMap = new Map<string, {
      mediaMd5: string;
      mediaName: string;
      mediaType: string;
      totalPlays: number;
      totalDurationSeconds: number;
      perBag: { bagId: string; bagName: string; plays: number; durationSeconds: number }[];
    }>();
    for (const s of rawStats) {
      let entry = adMap.get(s.mediaMd5);
      if (!entry) {
        entry = {
          mediaMd5: s.mediaMd5,
          mediaName: s.mediaName,
          mediaType: s.mediaType,
          totalPlays: 0,
          totalDurationSeconds: 0,
          perBag: [],
        };
        adMap.set(s.mediaMd5, entry);
      }
      entry.totalPlays += s.plays;
      entry.totalDurationSeconds += s.durationSeconds;
      entry.perBag.push({
        bagId: s.bagId,
        bagName: s.bagName,
        plays: s.plays,
        durationSeconds: s.durationSeconds,
      });
    }
    const byAd = Array.from(adMap.values()).sort((a, b) => b.totalPlays - a.totalPlays);

    // ── Pivot 2: By Bag ───────────────────────────────────────────────────
    const bagMap = new Map<string, {
      bagId: string;
      bagName: string;
      totalPlays: number;
      totalDurationSeconds: number;
      perAd: { mediaMd5: string; mediaName: string; mediaType: string; plays: number; durationSeconds: number }[];
    }>();
    for (const s of rawStats) {
      let entry = bagMap.get(s.bagId);
      if (!entry) {
        entry = {
          bagId: s.bagId,
          bagName: s.bagName,
          totalPlays: 0,
          totalDurationSeconds: 0,
          perAd: [],
        };
        bagMap.set(s.bagId, entry);
      }
      entry.totalPlays += s.plays;
      entry.totalDurationSeconds += s.durationSeconds;
      entry.perAd.push({
        mediaMd5: s.mediaMd5,
        mediaName: s.mediaName,
        mediaType: s.mediaType,
        plays: s.plays,
        durationSeconds: s.durationSeconds,
      });
    }
    // Ensure every filtered bag appears even if it had zero plays
    terminalNameById.forEach((bagName, bagId) => {
      if (!bagMap.has(bagId)) {
        bagMap.set(bagId, { bagId, bagName, totalPlays: 0, totalDurationSeconds: 0, perAd: [] });
      }
    });
    const byBag = Array.from(bagMap.values()).sort((a, b) => b.totalPlays - a.totalPlays);

    // ── Pivot 3: By Playlist ──────────────────────────────────────────────
    // Match Colorlight's mediaMd5 (a slug like "F_<HASH>_<size>") to our
    // playlist items, which reference media by Colorlight numeric id. The
    // bridge is the Media library's `name` slug.
    const mediaList = await listMedia().catch(() => []);
    const numericIdToSlug = new Map<string, string>(); // "6421932" → "F_xxx_52721"
    for (const m of mediaList) {
      if (m.id != null && (m as any).name) numericIdToSlug.set(String(m.id), String((m as any).name));
    }

    const playlists = listPlaylists();
    const byPlaylist: {
      playlistId: string;
      playlistName: string;
      bagIds: string[];
      itemCount: number;
      totalPlays: number;
      totalDurationSeconds: number;
      perAd: { mediaMd5: string; mediaName: string; mediaType: string; plays: number; durationSeconds: number }[];
    }[] = [];

    const matchedSlugs = new Set<string>();

    for (const pl of playlists) {
      // Bags this playlist is on (intersect with our filter)
      const plBagIds = pl.deployed_to.map((d) => d.bag_id).filter((b) => terminalNameById.has(b));
      if (plBagIds.length === 0 && filterIds) continue; // skip playlists not relevant to current filter

      // Slugs this playlist's items represent
      const slugs = pl.items
        .map((i) => numericIdToSlug.get(i.media_id))
        .filter((s): s is string => !!s);

      let totalPlays = 0;
      let totalDuration = 0;
      const perAd: typeof byPlaylist[number]["perAd"] = [];
      for (const slug of slugs) {
        const ad = adMap.get(slug);
        if (!ad) continue;
        // Only count plays from bags this playlist is deployed to
        const relevant = ad.perBag.filter((b) => plBagIds.includes(b.bagId));
        const plays = relevant.reduce((s, b) => s + b.plays, 0);
        const dur = relevant.reduce((s, b) => s + b.durationSeconds, 0);
        if (plays === 0) continue;
        totalPlays += plays;
        totalDuration += dur;
        perAd.push({
          mediaMd5: slug,
          mediaName: ad.mediaName,
          mediaType: ad.mediaType,
          plays,
          durationSeconds: dur,
        });
        matchedSlugs.add(slug);
      }

      byPlaylist.push({
        playlistId: pl.id,
        playlistName: pl.name,
        bagIds: plBagIds,
        itemCount: pl.items.length,
        totalPlays,
        totalDurationSeconds: totalDuration,
        perAd: perAd.sort((a, b) => b.plays - a.plays),
      });
    }
    byPlaylist.sort((a, b) => b.totalPlays - a.totalPlays);

    // Anything that didn't match a CMS-managed playlist (legacy / external programs)
    const unmatchedAds = byAd
      .filter((a) => !matchedSlugs.has(a.mediaMd5))
      .map((a) => ({
        mediaMd5: a.mediaMd5,
        mediaName: a.mediaName,
        mediaType: a.mediaType,
        plays: a.totalPlays,
        durationSeconds: a.totalDurationSeconds,
      }));

    // ── Totals ────────────────────────────────────────────────────────────
    const totalPlays = byAd.reduce((s, a) => s + a.totalPlays, 0);
    const totalDurationSeconds = byAd.reduce((s, a) => s + a.totalDurationSeconds, 0);

    res.json({
      startTime: new Date(startTime + (startTime.endsWith("Z") ? "" : "Z")).toISOString(),
      endTime: new Date(endTime + (endTime.endsWith("Z") ? "" : "Z")).toISOString(),
      bagsCovered: terminals.length,
      bagIds: terminals.map((t) => String(t.id)),
      totalPlays,
      totalDurationSeconds,
      adCount: byAd.length,
      byAd,
      byBag,
      byPlaylist,
      unmatched: {
        totalPlays: unmatchedAds.reduce((s, a) => s + a.plays, 0),
        ads: unmatchedAds,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Online form (terminal online/offline times) ──────────────────────────────
// Surfaced as a fleet-wide hours endpoint. The rider-level sessions endpoint
// stays in the mock router until we layer rider→terminal mapping on top.

router.get("/fleet/online-hours", async (_req, res, next) => {
  try {
    const entries = await getOnlineForm();
    res.json(
      entries.map((e) => ({
        terminalId: String(e.terminalId),
        deviceName: e.deviceName,
        terminalGroupName: e.terminalGroupName,
        totalOnlineHours: +(e.totalOnlineTime / 3600).toFixed(2),
        totalOfflineHours: +(e.totalOfflineTime / 3600).toFixed(2),
        isOnline: e.isTerminalOnline,
        lastOnlineAt: e.lastOnlineTime,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ── Sessions / timesheets (derived from GPS tracks) ──────────────────────────

/**
 * Resolve the requested timesheet window. Supports either:
 *   - ?startTime=ISO&endTime=ISO  (preferred — explicit range)
 *   - ?days=N                     (legacy — rolling N days back from now)
 *   - (none)                      → defaults to last 7 days
 */
function resolveSessionsRange(req: { query: Record<string, any> }): {
  startMs: number;
  endMs: number;
  days: number;
  windowLabel: string;
} {
  const explicitStart = Date.parse(String(req.query?.startTime ?? ""));
  const explicitEnd = Date.parse(String(req.query?.endTime ?? ""));

  if (Number.isFinite(explicitStart) && Number.isFinite(explicitEnd)) {
    let s = explicitStart, e = explicitEnd;
    if (s > e) [s, e] = [e, s];
    const daysSpan = Math.max(1, Math.ceil((e - s) / (24 * 3600 * 1000)));
    const startSlug = new Date(s).toISOString().slice(0, 10);
    const endSlug = new Date(e).toISOString().slice(0, 10);
    return {
      startMs: s,
      endMs: e,
      days: daysSpan,
      windowLabel: startSlug === endSlug ? startSlug : `${startSlug}_to_${endSlug}`,
    };
  }

  const days = Math.min(31, Math.max(1, Number(req.query?.days ?? 7)));
  const endMs = Date.now();
  const startMs = endMs - days * 24 * 3600 * 1000;
  return { startMs, endMs, days, windowLabel: `${days}d` };
}

router.get("/bags/:id/sessions", async (req, res, next) => {
  try {
    const range = resolveSessionsRange(req);
    const sessions = await getSessionsForBag(req.params.id, { startMs: range.startMs, endMs: range.endMs });
    const byDay = groupSessionsByDay(sessions);
    const totalSeconds = sessions.reduce((s, x) => s + x.duration_seconds, 0);
    res.json({
      bag_id: req.params.id,
      days: range.days,
      startTime: new Date(range.startMs).toISOString(),
      endTime: new Date(range.endMs).toISOString(),
      totalSessions: sessions.length,
      totalSeconds,
      totalHours: +(totalSeconds / 3600).toFixed(2),
      byDay,
      sessions,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/riders/:id/sessions", async (req, res, next) => {
  try {
    const rider = getRider(req.params.id);
    if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
    const range = resolveSessionsRange(req);
    if (!rider.bag_id) {
      res.json({
        rider_id: rider.id,
        bag_id: null,
        days: range.days,
        startTime: new Date(range.startMs).toISOString(),
        endTime: new Date(range.endMs).toISOString(),
        totalSessions: 0,
        totalSeconds: 0,
        totalHours: 0,
        byDay: [],
        sessions: [],
        message: "No bag assigned to this rider",
      });
      return;
    }
    const sessions = await getSessionsForBag(rider.bag_id, { startMs: range.startMs, endMs: range.endMs });
    const byDay = groupSessionsByDay(sessions);
    const totalSeconds = sessions.reduce((s, x) => s + x.duration_seconds, 0);
    res.json({
      rider_id: rider.id,
      bag_id: rider.bag_id,
      days: range.days,
      startTime: new Date(range.startMs).toISOString(),
      endTime: new Date(range.endMs).toISOString(),
      totalSessions: sessions.length,
      totalSeconds,
      totalHours: +(totalSeconds / 3600).toFixed(2),
      byDay,
      sessions,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/riders/:id/sessions/export", async (req, res, next) => {
  try {
    const rider = getRider(req.params.id);
    if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
    const range = resolveSessionsRange(req);
    if (!rider.bag_id) {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="rider-${rider.id}-hours.csv"`);
      res.send("rider_id,rider_name,bag_id,session_id,started_at,ended_at,duration_minutes,gps_points\n");
      return;
    }
    const sessions = await getSessionsForBag(rider.bag_id, { startMs: range.startMs, endMs: range.endMs });
    const csv = sessionsToCsv(rider, sessions);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rider-${rider.id}-hours-${range.windowLabel}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// Bag-level rider lookup that uses the rider store
router.get("/bags/:bagId/rider", (req, res) => {
  const rider = getRiderByBagId(req.params.bagId);
  if (!rider) { res.status(404).json({ error: "No rider assigned to this bag" }); return; }
  res.json(rider);
});

// Per-bag play stats over a custom window (used by the Reports timesheet view)
router.get("/bags/:id/play-times", async (req, res, next) => {
  try {
    const days = Math.min(31, Math.max(1, Number(req.query.days ?? 7)));
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    const data = await getMediaPlayTimes(req.params.id, fmt(start), fmt(end));
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// ── Error fall-through ───────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
router.use((err: any, _req: any, res: any, _next: any) => {
  console.error("[colorlight-route]", err?.response?.status ?? "", err?.message ?? err);
  res.status(502).json({
    error: "Colorlight upstream error",
    detail: err?.message ?? String(err),
    status: err?.response?.status ?? null,
  });
});

export { router as liveRouter };
