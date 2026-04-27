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
  getLatestGpsForAll,
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

const ACTIVE_GPS_THRESHOLD_MS = 5 * 60 * 1000; // device counted as "active" if GPS within 5 min
const TERMINAL_TTL_MS = 30_000;
const GPS_TTL_MS = 5_000;

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
  const data = await getLatestGpsForAll("");
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
  gps: ColorlightLatestGps | undefined
) {
  const id = String(t.id);
  const gpsAge = gps ? Date.now() - new Date(gps.reportTime).getTime() : Infinity;
  const isActive = gpsAge < ACTIVE_GPS_THRESHOLD_MS;

  return {
    id,
    name: t.title?.raw ?? t.title?.rendered ?? `Terminal ${id}`,
    colorlight_device_id: id,
    rider_id: null,
    status: isActive ? "active" : "inactive",
    last_lat: gps?.latitude ?? null,
    last_lng: gps?.longitude ?? null,
    last_speed: gps?.speed ?? null,
    last_heading: gps?.direct ?? null,
    last_gps_at: gps?.reportTime ?? null,
    created: t.date ?? null,
    expand: { rider_id: null },
  };
}

function defaultDayWindow() {
  const end = new Date();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  // Colorlight expects YYYY-MM-DDTHH:mm:ss without timezone
  const fmt = (d: Date) => d.toISOString().slice(0, 19);
  return { startTime: fmt(start), endTime: fmt(end) };
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
    res.json(terminals.map((t) => terminalToBag(t, map.get(t.id))));
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
    res.json(terminalToBag(terminal, gps ?? undefined));
  } catch (err) {
    next(err);
  }
});

// GPS history (used by route map mode)
router.get("/bags/:id/route", async (req, res, next) => {
  try {
    const { startTime, endTime } = defaultDayWindow();
    const track = await getTrack(req.params.id, startTime, endTime);
    res.json(
      (track.data ?? []).map((p) => ({
        lat: p.latitude,
        lng: p.longitude,
        timestamp: p.serverTime ?? p.clientTime,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// Same as route — frontend asks for /gps for the per-bag history page
router.get("/bags/:id/gps", async (req, res, next) => {
  try {
    const { startTime, endTime } = defaultDayWindow();
    const track = await getTrack(req.params.id, startTime, endTime);
    res.json(
      (track.data ?? []).map((p, i) => ({
        id: `gps_${req.params.id}_${i}`,
        bag_id: req.params.id,
        lat: p.latitude,
        lng: p.longitude,
        speed: null,
        heading: null,
        created: p.serverTime ?? p.clientTime,
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
    res.json(
      terminals
        .filter((t) => map.has(t.id)) // only ones with positions
        .map((t) => {
          const g = map.get(t.id)!;
          const ageMs = Date.now() - new Date(g.reportTime).getTime();
          return {
            bagId: String(t.id),
            name: t.title?.raw ?? `Terminal ${t.id}`,
            lat: g.latitude,
            lng: g.longitude,
            speed: g.speed,
            heading: g.direct,
            lastGpsAt: g.reportTime,
            status: ageMs < ACTIVE_GPS_THRESHOLD_MS ? "active" : "inactive",
            riderId: null,
            riderName: null,
          };
        })
    );
  } catch (err) {
    next(err);
  }
});

router.get("/fleet/heatmap", async (_req, res, next) => {
  try {
    const terminals = await getTerminalsCached();
    const groupId = terminals[0]?.terminalgroup?.[0]?.id ?? 0;
    const { startTime, endTime } = defaultDayWindow();
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
