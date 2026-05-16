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

// 50 MB cap — TfL's daily-tap-count export over a full year is ~200k rows.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
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
  const { ok, errors, sourceRowCount, unmatchedStations } = parseCsv(csv);

  if (ok.length === 0) {
    res.status(400).json({
      error: "No valid rows parsed from CSV",
      detail: errors.slice(0, 5),
      hint:
        "Accepted formats: (a) per-station rows with station_name, lat, lng, daily_entries, daily_exits OR " +
        "(b) TfL's daily tap-count export with TravelDate, Station, EntryTapCount, ExitTapCount " +
        "(coords resolved automatically from the bundled TfL station list).",
    });
    return;
  }

  try {
    const meta = replaceDataset(ok, req.file.originalname, { sourceRowCount, unmatchedStations });
    res.status(201).json({
      success: true,
      meta,
      parseErrors: errors.slice(0, 20),
      droppedRows: errors.length,
      sample: ok.slice(0, 5),
      // Friendly upload summary for the UI
      summary: {
        format: sourceRowCount ? "tap-count (aggregated to mean daily per station)" : "per-station",
        sourceRowCount,
        stationsResolved: ok.length,
        stationsUnmatched: unmatchedStations?.length ?? 0,
        unmatched: unmatchedStations?.slice(0, 20),
      },
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
