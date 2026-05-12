// ─────────────────────────────────────────────────────────────────────────────
// TfL endpoints — upload CSV, see what's loaded, wipe it.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import multer from "multer";
import {
  listStations,
  getMeta,
  hasDataset,
  replaceDataset,
  clearDataset,
  parseCsv,
} from "./tfl-store.js";

const router = Router();

// 5 MB cap on CSV uploads — TfL's full station list is ~270 rows so plenty
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── Summary (used by Reports UI to know if data exists) ──────────────────────

router.get("/tfl/summary", (_req, res) => {
  const meta = getMeta();
  const stations = listStations();
  res.json({
    hasDataset: hasDataset(),
    meta,
    sample: stations.slice(0, 5),
  });
});

// ── Upload (replace dataset) ─────────────────────────────────────────────────

router.post("/tfl/upload", upload.single("file"), (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const csv = req.file.buffer.toString("utf8");
  const { ok, errors } = parseCsv(csv);

  if (ok.length === 0) {
    res.status(400).json({
      error: "No valid rows parsed from CSV",
      detail: errors.slice(0, 5),
      hint:
        "Expected columns: station_name, lat, lng (required); daily_entries, daily_exits, zone (optional). " +
        "Common header aliases accepted (latitude, longitude, name, etc.).",
    });
    return;
  }

  try {
    const meta = replaceDataset(ok, req.file.originalname);
    res.status(201).json({
      success: true,
      meta,
      parseErrors: errors.slice(0, 20), // surface up to 20 row errors so user can fix
      droppedRows: errors.length,
      sample: ok.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ error: "Save failed", detail: (err as Error).message });
  }
});

// ── Clear ────────────────────────────────────────────────────────────────────

router.delete("/tfl/dataset", (_req, res) => {
  clearDataset();
  res.json({ success: true });
});

export { router as tflRouter };
