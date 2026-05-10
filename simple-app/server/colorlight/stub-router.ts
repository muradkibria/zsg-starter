// ─────────────────────────────────────────────────────────────────────────────
// Stub router — handles endpoints that Colorlight has no equivalent for
// (riders, campaigns, ad-slots, zones, brightness schedules, audit log,
// schedules). Returns empty list responses for reads and 501 for writes.
//
// These features will eventually be backed by our own side-store (Postgres,
// SQLite, etc.); for now empty responses let the frontend render its empty
// states and pages with mixed live/our-side data still load.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";

const router = Router();

const NOT_IMPL = (feature: string) => ({
  error: "Not implemented",
  detail: `${feature} requires a side-store. Colorlight has no equivalent. Wire one up before enabling this feature in production.`,
});

// ── Riders ───────────────────────────────────────────────────────────────────

router.get("/riders", (_req, res) => res.json([]));

router.get("/riders/:id", (_req, res) =>
  res.status(404).json({ error: "Rider not found", detail: "Riders are not stored yet." })
);

router.post("/riders", (_req, res) => res.status(501).json(NOT_IMPL("Rider registration")));
router.put("/riders/:id", (_req, res) => res.status(501).json(NOT_IMPL("Rider update")));

router.get("/riders/:id/sessions", (req, res) =>
  res.json({ sessions: [], totalSeconds: 0, totalHours: 0, riderId: req.params.id })
);

router.get("/riders/:id/sessions/export", (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="rider-${req.params.id}-hours.csv"`);
  res.send("session_id,rider_name,bag_id,started_at,ended_at,duration_hours\n");
});

router.get("/riders/:id/hours", (req, res) =>
  res.json({ riderId: req.params.id, totalHours: 0 })
);

// ── Campaigns: handled by campaignStoreRouter (CRUD) and liveRouter (Occupancy)
//    The deploy concept lives on Playlists now, not Campaigns.

router.post("/campaigns/:id/deploy", (_req, res) =>
  res.status(501).json(NOT_IMPL("Campaign deploy — use Playlists → Deploy instead"))
);

// ── Schedules ────────────────────────────────────────────────────────────────

router.get("/schedules", (_req, res) => res.json([]));
router.post("/schedules", (_req, res) => res.status(501).json(NOT_IMPL("Schedule creation")));
router.put("/schedules/:id", (_req, res) => res.status(501).json(NOT_IMPL("Schedule update")));
router.delete("/schedules/:id", (_req, res) => res.status(501).json(NOT_IMPL("Schedule delete")));

// ── Zones ────────────────────────────────────────────────────────────────────

router.get("/zones", (_req, res) => res.json([]));

router.get("/zones/:id", (_req, res) =>
  res.status(404).json({ error: "Zone not found" })
);

router.post("/zones", (_req, res) => res.status(501).json(NOT_IMPL("Zone creation")));
router.put("/zones/:id", (_req, res) => res.status(501).json(NOT_IMPL("Zone update")));
router.delete("/zones/:id", (_req, res) => res.status(501).json(NOT_IMPL("Zone delete")));
router.get("/zones/:id/dwells", (_req, res) => res.json([]));

// ── Brightness schedules ─────────────────────────────────────────────────────

router.get("/brightness", (_req, res) => res.json([]));
router.post("/brightness", (_req, res) => res.status(501).json(NOT_IMPL("Brightness schedule create")));
router.put("/brightness/:id", (_req, res) => res.status(501).json(NOT_IMPL("Brightness schedule update")));
router.delete("/brightness/:id", (_req, res) => res.status(501).json(NOT_IMPL("Brightness schedule delete")));

// ── Ad slots: GET handled by liveRouter (derived from playlists). The old
//    PUT/DELETE writes are no longer applicable — slots are derived state, not
//    persistent assignments. Edit a playlist instead.

router.put("/ad-slots/:bagId/:slot", (_req, res) =>
  res.status(501).json(NOT_IMPL("Ad slot assignment — slots are derived from Playlists; edit the playlist instead"))
);
router.delete("/ad-slots/:bagId", (_req, res) =>
  res.status(501).json(NOT_IMPL("Ad slot clear — clear via the playlist editor instead"))
);

// ── Audit ────────────────────────────────────────────────────────────────────

router.get("/audit", (_req, res) =>
  res.json({ items: [], totalItems: 0, page: 1, perPage: 20, totalPages: 0 })
);

// ── Bag-level extras (non-Colorlight) ────────────────────────────────────────

router.get("/bags/:id/current-ad", (_req, res) => res.json(null));

// ── Reports without Colorlight equivalents ───────────────────────────────────

router.get("/reports/zone/:id", (req, res) =>
  res.json({ zoneId: req.params.id, totalVisits: 0, avgDwellSeconds: 0, visitsByBag: [] })
);

router.get("/reports/rider/:id", (req, res) =>
  res.json({ riderId: req.params.id, bagId: null, totalPlays: 0, estimatedHours: 0 })
);

router.get("/reports/campaign/:id", (req, res) =>
  res.json({ campaignId: req.params.id, totalPlays: 0, totalDurationSeconds: 0, playsByDate: [] })
);

router.get("/reports/export/csv", (req, res) => {
  const { type, id } = req.query;
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-${id}-report.csv"`);
  res.send("");
});

// ── Media write (until we wire Colorlight upload) ────────────────────────────

router.post("/media", (_req, res) => res.status(501).json(NOT_IMPL("Media upload via dashboard")));
router.delete("/media/:id", (_req, res) => res.status(501).json(NOT_IMPL("Media delete")));

// ── Colorlight control passthroughs (until next capture) ─────────────────────

router.post("/colorlight/sync", (_req, res) => res.status(501).json(NOT_IMPL("Colorlight sync")));
router.post("/colorlight/deploy/:bagId", (_req, res) =>
  res.status(501).json(NOT_IMPL("Program deploy"))
);
router.post("/colorlight/restart/:bagId", (_req, res) =>
  res.status(501).json(NOT_IMPL("Device restart"))
);

export { router as stubRouter };
