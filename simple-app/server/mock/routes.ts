import { Router } from "express";
import jwt from "jsonwebtoken";
import {
  MOCK_USERS,
  MOCK_BAGS,
  MOCK_RIDERS,
  MOCK_CAMPAIGNS,
  MOCK_MEDIA,
  MOCK_SCHEDULES,
  MOCK_ZONES,
  MOCK_AUDIT,
  MOCK_ZONE_DWELLS,
  MOCK_AD_PLAY_EVENTS,
  MOCK_BRIGHTNESS_SCHEDULES,
  MOCK_RIDER_SESSIONS,
  MOCK_AD_SLOTS,
  generateGpsHistory,
} from "./data.js";

const adSlots = [...MOCK_AD_SLOTS];

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET ?? "mock-dev-secret";

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post("/auth/login", (req, res) => {
  const { email, password } = req.body ?? {};
  const user = MOCK_USERS.find((u) => u.email === email && u.password === password);
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "24h" }
  );
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
});

router.get("/auth/me", (req, res) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as any;
    const user = MOCK_USERS.find((u) => u.id === payload.userId);
    res.json({ id: payload.userId, email: payload.email, role: payload.role, name: user?.name ?? "" });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

router.post("/auth/logout", (_req, res) => res.json({ success: true }));

// ── Bags ──────────────────────────────────────────────────────────────────────

router.get("/bags", (_req, res) => res.json(MOCK_BAGS));

router.get("/bags/:id", (req, res) => {
  const bag = MOCK_BAGS.find((b) => b.id === req.params.id);
  if (!bag) { res.status(404).json({ error: "Not found" }); return; }
  res.json(bag);
});

router.post("/bags", (req, res) => {
  const bag = { id: `bag_${Date.now()}`, ...req.body, created: new Date().toISOString() };
  res.status(201).json(bag);
});

router.put("/bags/:id", (req, res) => {
  const bag = MOCK_BAGS.find((b) => b.id === req.params.id);
  if (!bag) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...bag, ...req.body });
});

router.get("/bags/:id/gps", (req, res) => {
  const bag = MOCK_BAGS.find((b) => b.id === req.params.id);
  if (!bag) { res.status(404).json({ error: "Not found" }); return; }
  res.json(generateGpsHistory(bag.id, bag.last_lat ?? 51.5074, bag.last_lng ?? -0.1278));
});

router.get("/bags/:id/current-ad", (req, res) => {
  const schedule = MOCK_SCHEDULES.find((s) => s.bag_id === req.params.id);
  if (!schedule) { res.json(null); return; }
  res.json({ schedule, media: schedule.expand?.media_id ?? null });
});

// ── Riders ────────────────────────────────────────────────────────────────────

router.get("/riders", (_req, res) => res.json(MOCK_RIDERS));

router.get("/riders/:id", (req, res) => {
  const rider = MOCK_RIDERS.find((r) => r.id === req.params.id);
  if (!rider) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rider);
});

router.post("/riders", (req, res) => {
  const rider = { id: `rdr_${Date.now()}`, ...req.body, created: new Date().toISOString() };
  res.status(201).json(rider);
});

router.put("/riders/:id", (req, res) => {
  const rider = MOCK_RIDERS.find((r) => r.id === req.params.id);
  if (!rider) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...rider, ...req.body });
});

router.get("/riders/:id/hours", (req, res) => {
  res.json({ riderId: req.params.id, totalHours: Math.floor(Math.random() * 200 + 50) });
});

// ── Media ─────────────────────────────────────────────────────────────────────

router.get("/media", (_req, res) => res.json(MOCK_MEDIA));

router.post("/media", (req, res) => {
  const asset = {
    id: `med_${Date.now()}`,
    campaign_id: req.body.campaign_id ?? null,
    filename: req.file?.originalname ?? "upload.mp4",
    file_type: req.body.file_type ?? "video",
    duration_seconds: Number(req.body.duration_seconds) || 15,
    file_size_bytes: req.file?.size ?? 0,
    fileUrl: "https://placehold.co/1920x1080/666/white?text=Uploaded",
    created: new Date().toISOString(),
  };
  res.status(201).json(asset);
});

router.delete("/media/:id", (_req, res) => res.json({ success: true }));

// ── Campaigns ─────────────────────────────────────────────────────────────────

router.get("/campaigns", (_req, res) => res.json(MOCK_CAMPAIGNS));

router.get("/campaigns/:id", (req, res) => {
  const c = MOCK_CAMPAIGNS.find((c) => c.id === req.params.id);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  const media = MOCK_MEDIA.filter((m) => m.campaign_id === c.id);
  res.json({ ...c, media });
});

router.post("/campaigns", (req, res) => {
  const c = { id: `cmp_${Date.now()}`, ...req.body, created: new Date().toISOString() };
  res.status(201).json(c);
});

router.put("/campaigns/:id", (req, res) => {
  const c = MOCK_CAMPAIGNS.find((c) => c.id === req.params.id);
  if (!c) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...c, ...req.body });
});

router.post("/campaigns/:id/deploy", (req, res) => {
  res.json({ success: true, deployed: req.body.bagIds ?? [], campaignId: req.params.id });
});

// ── Schedules ─────────────────────────────────────────────────────────────────

router.get("/schedules", (_req, res) => res.json(MOCK_SCHEDULES));

router.post("/schedules", (req, res) => {
  const s = { id: `sch_${Date.now()}`, ...req.body, created: new Date().toISOString() };
  res.status(201).json(s);
});

router.put("/schedules/:id", (req, res) => {
  const s = MOCK_SCHEDULES.find((s) => s.id === req.params.id);
  if (!s) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...s, ...req.body });
});

router.delete("/schedules/:id", (_req, res) => res.json({ success: true }));

// ── Zones ─────────────────────────────────────────────────────────────────────

router.get("/zones", (_req, res) => res.json(MOCK_ZONES));

router.get("/zones/:id", (req, res) => {
  const z = MOCK_ZONES.find((z) => z.id === req.params.id);
  if (!z) { res.status(404).json({ error: "Not found" }); return; }
  res.json(z);
});

router.post("/zones", (req, res) => {
  const z = { id: `zone_${Date.now()}`, ...req.body, active: true, created: new Date().toISOString() };
  res.status(201).json(z);
});

router.put("/zones/:id", (req, res) => {
  const z = MOCK_ZONES.find((z) => z.id === req.params.id);
  if (!z) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...z, ...req.body });
});

router.delete("/zones/:id", (_req, res) => res.json({ success: true }));

router.get("/zones/:id/dwells", (req, res) => {
  const dwells = MOCK_ZONE_DWELLS.filter((d) => d.zone_id === req.params.id);
  res.json(dwells);
});

// ── Fleet ─────────────────────────────────────────────────────────────────────

router.get("/fleet/live", (_req, res) => {
  const live = MOCK_BAGS.filter((b) => b.status === "active").map((b) => ({
    bagId: b.id,
    name: b.name,
    lat: b.last_lat,
    lng: b.last_lng,
    speed: b.last_speed,
    heading: b.last_heading,
    lastGpsAt: b.last_gps_at,
    status: b.status,
    riderId: b.rider_id,
    riderName: b.expand?.rider_id?.name ?? null,
  }));
  res.json(live);
});

// ── Reports ───────────────────────────────────────────────────────────────────

router.get("/reports/campaign/:id", (req, res) => {
  const plays = MOCK_AD_PLAY_EVENTS.filter((e) => {
    const media = MOCK_MEDIA.find((m) => m.id === e.media_id);
    return media?.campaign_id === req.params.id;
  });

  const byDate: Record<string, number> = {};
  plays.forEach((p) => {
    const d = p.played_at.slice(0, 10);
    byDate[d] = (byDate[d] ?? 0) + 1;
  });

  res.json({
    campaignId: req.params.id,
    totalPlays: plays.length,
    totalDurationSeconds: plays.reduce((s, p) => s + (p.duration_seconds ?? 0), 0),
    playsByDate: Object.entries(byDate).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
  });
});

router.get("/reports/zone/:id", (req, res) => {
  const dwells = MOCK_ZONE_DWELLS.filter((d) => d.zone_id === req.params.id);
  res.json({
    zoneId: req.params.id,
    totalVisits: dwells.length,
    avgDwellSeconds: dwells.length ? dwells.reduce((s, d) => s + (d.dwell_seconds ?? 0), 0) / dwells.length : 0,
    visitsByBag: MOCK_BAGS.map((b) => ({
      bagId: b.id,
      name: b.name,
      visits: dwells.filter((d) => d.bag_id === b.id).length,
    })),
  });
});

router.get("/reports/rider/:id", (req, res) => {
  const bag = MOCK_BAGS.find((b) => b.rider_id === req.params.id);
  const plays = bag ? MOCK_AD_PLAY_EVENTS.filter((e) => e.bag_id === bag.id) : [];
  res.json({
    riderId: req.params.id,
    bagId: bag?.id ?? null,
    totalPlays: plays.length,
    estimatedHours: Math.round(plays.length * 0.5),
  });
});

router.get("/reports/export/csv", (req, res) => {
  const { type, id } = req.query;
  let csv = "date,count\n";
  const rows = MOCK_AD_PLAY_EVENTS.slice(0, 20);
  rows.forEach((r) => {
    csv += `${r.played_at.slice(0, 10)},1\n`;
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-${id}-report.csv"`);
  res.send(csv);
});

// ── Colorlight (mock syncs / deploys) ─────────────────────────────────────────

router.post("/colorlight/sync", (_req, res) => {
  res.json({ synced: MOCK_BAGS.length, devices: MOCK_BAGS.map((b) => b.colorlight_device_id) });
});

router.post("/colorlight/deploy/:bagId", (req, res) => {
  res.json({ success: true, bagId: req.params.bagId, message: "Program deployed (mock)" });
});

router.post("/colorlight/restart/:bagId", (req, res) => {
  res.json({ success: true, bagId: req.params.bagId, message: "Device restarted (mock)" });
});

// ── GPS route + heatmap data ──────────────────────────────────────────────────

router.get("/bags/:id/route", (req, res) => {
  const bag = MOCK_BAGS.find((b) => b.id === req.params.id);
  if (!bag) { res.status(404).json({ error: "Not found" }); return; }
  const history = generateGpsHistory(bag.id, bag.last_lat ?? 51.5074, bag.last_lng ?? -0.1278);
  // Return as [lat, lng] pairs for Leaflet Polyline
  res.json(history.map((p) => ({ lat: p.lat, lng: p.lng, timestamp: p.created })));
});

router.get("/fleet/heatmap", (_req, res) => {
  const points: { lat: number; lng: number }[] = [];
  for (const bag of MOCK_BAGS.filter((b) => b.status === "active")) {
    const history = generateGpsHistory(bag.id, bag.last_lat ?? 51.5074, bag.last_lng ?? -0.1278);
    history.forEach((p) => points.push({ lat: p.lat, lng: p.lng }));
  }
  res.json(points);
});

// ── Ad slots ──────────────────────────────────────────────────────────────────

router.get("/ad-slots", (_req, res) => {
  const enriched = adSlots.map((s) => ({
    ...s,
    media: s.media_id ? MOCK_MEDIA.find((m) => m.id === s.media_id) ?? null : null,
    campaign: s.campaign_id ? MOCK_CAMPAIGNS.find((c) => c.id === s.campaign_id) ?? null : null,
    bag: MOCK_BAGS.find((b) => b.id === s.bag_id) ?? null,
  }));
  res.json(enriched);
});

router.put("/ad-slots/:bagId/:slot", (req, res) => {
  const { bagId, slot } = req.params;
  const slotNum = Number(slot);
  const idx = adSlots.findIndex((s) => s.bag_id === bagId && s.slot_number === slotNum);
  if (idx === -1) { res.status(404).json({ error: "Slot not found" }); return; }
  adSlots[idx] = { ...adSlots[idx], media_id: req.body.media_id ?? null, campaign_id: req.body.campaign_id ?? null };
  res.json(adSlots[idx]);
});

// Clear all slots for a bag
router.delete("/ad-slots/:bagId", (req, res) => {
  adSlots.forEach((s, i) => {
    if (s.bag_id === req.params.bagId) {
      adSlots[i] = { ...s, media_id: null, campaign_id: null };
    }
  });
  res.json({ success: true });
});

// ── Ad play stats ─────────────────────────────────────────────────────────────

router.get("/reports/ad-plays", (_req, res) => {
  const counts: Record<string, { media_id: string; campaign_id: string | null; plays: number; total_seconds: number }> = {};

  for (const ev of MOCK_AD_PLAY_EVENTS) {
    if (!counts[ev.media_id]) {
      const media = MOCK_MEDIA.find((m) => m.id === ev.media_id);
      counts[ev.media_id] = {
        media_id: ev.media_id,
        campaign_id: media?.campaign_id ?? null,
        plays: 0,
        total_seconds: 0,
      };
    }
    counts[ev.media_id].plays++;
    counts[ev.media_id].total_seconds += ev.duration_seconds ?? 0;
  }

  const rows = Object.values(counts).map((r) => {
    const media = MOCK_MEDIA.find((m) => m.id === r.media_id);
    const campaign = r.campaign_id ? MOCK_CAMPAIGNS.find((c) => c.id === r.campaign_id) : null;
    return {
      ...r,
      filename: media?.filename ?? r.media_id,
      file_type: media?.file_type ?? "unknown",
      campaign_name: campaign?.name ?? null,
    };
  }).sort((a, b) => b.plays - a.plays);

  res.json({ rows, total: MOCK_AD_PLAY_EVENTS.length });
});

// ── Brightness schedules ──────────────────────────────────────────────────────

const brightnessSchedules = [...MOCK_BRIGHTNESS_SCHEDULES];

router.get("/brightness", (_req, res) => res.json(brightnessSchedules));

router.post("/brightness", (req, res) => {
  const s = { id: `brt_${Date.now()}`, ...req.body, enabled: true, created: new Date().toISOString() };
  brightnessSchedules.push(s as any);
  res.status(201).json(s);
});

router.put("/brightness/:id", (req, res) => {
  const idx = brightnessSchedules.findIndex((s) => s.id === req.params.id);
  if (idx === -1) { res.status(404).json({ error: "Not found" }); return; }
  brightnessSchedules[idx] = { ...brightnessSchedules[idx], ...req.body };
  res.json(brightnessSchedules[idx]);
});

router.delete("/brightness/:id", (req, res) => {
  const idx = brightnessSchedules.findIndex((s) => s.id === req.params.id);
  if (idx !== -1) brightnessSchedules.splice(idx, 1);
  res.json({ success: true });
});

// ── Rider sessions / online hours ──────────────────────────────────────────────

router.get("/riders/:id/sessions", (req, res) => {
  const sessions = MOCK_RIDER_SESSIONS.filter((s) => s.rider_id === req.params.id);
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.duration_seconds ?? 0), 0);
  res.json({ sessions, totalSeconds, totalHours: +(totalSeconds / 3600).toFixed(2) });
});

router.get("/riders/:id/sessions/export", (req, res) => {
  const sessions = MOCK_RIDER_SESSIONS.filter((s) => s.rider_id === req.params.id);
  const rider = MOCK_RIDERS.find((r) => r.id === req.params.id);
  let csv = "session_id,rider_name,bag_id,started_at,ended_at,duration_hours\n";
  sessions.forEach((s) => {
    const hours = +(s.duration_seconds / 3600).toFixed(2);
    csv += `${s.id},${rider?.name ?? ""},${s.bag_id},${s.started_at},${s.ended_at},${hours}\n`;
  });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="rider-${req.params.id}-hours.csv"`);
  res.send(csv);
});

// ── Audit ─────────────────────────────────────────────────────────────────────

router.get("/audit", (req, res) => {
  const page = Number(req.query.page ?? 1);
  const perPage = Number(req.query.perPage ?? 20);
  const start = (page - 1) * perPage;
  res.json({
    items: MOCK_AUDIT.slice(start, start + perPage),
    totalItems: MOCK_AUDIT.length,
    totalPages: Math.ceil(MOCK_AUDIT.length / perPage),
    page,
    perPage,
  });
});

export { router as mockRouter };
