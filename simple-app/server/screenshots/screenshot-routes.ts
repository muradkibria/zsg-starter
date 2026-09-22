// ─────────────────────────────────────────────────────────────────────────────
// Route screenshot API — on-demand generation + listing/download/delete for a
// campaign's captured daily route screenshots.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import archiver from "archiver";
import fs from "fs";
import { getCampaign } from "../store/campaign-store.js";
import { listTerminals } from "../colorlight/client.js";
import { captureRouteScreenshot } from "./capture.js";
import { listScreenshots, saveScreenshot, getScreenshot, deleteScreenshot } from "./screenshot-store.js";

const GENERATE_CONCURRENCY = 2; // Chromium is memory-heavy — keep this low
const MAX_DAYS = 31;

function dateRangeDays(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cursor = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (cursor.getTime() <= end.getTime() && out.length < MAX_DAYS) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
  }
  return out;
}

const router = Router();

router.post("/campaigns/:id/screenshots/generate", async (req, res, next) => {
  try {
    const campaign = getCampaign(req.params.id);
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const body = req.body ?? {};
    const startDate = typeof body.startDate === "string" && body.startDate ? body.startDate : campaign.start_date;
    const endDate = typeof body.endDate === "string" && body.endDate ? body.endDate : (campaign.end_date ?? new Date().toISOString().slice(0, 10));
    if (!startDate) { res.status(400).json({ error: "No start date available — set the campaign's start date or pass startDate" }); return; }
    if (campaign.bag_ids.length === 0) { res.status(400).json({ error: "No bags configured for this campaign" }); return; }

    const days = dateRangeDays(startDate, endDate);
    const terminals = await listTerminals().catch(() => []);
    const bagNameById = new Map<string, string>();
    for (const t of terminals) bagNameById.set(String(t.id), t.title?.raw ?? t.title?.rendered ?? `Terminal ${t.id}`);

    const jobs = campaign.bag_ids.flatMap((bagId) => days.map((date) => ({ bagId, date })));
    let captured = 0;
    const errors: { bag_id: string; date: string; error: string }[] = [];

    for (let i = 0; i < jobs.length; i += GENERATE_CONCURRENCY) {
      const batch = jobs.slice(i, i + GENERATE_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map(async (job) => {
          const png = await captureRouteScreenshot(job.bagId, job.date);
          saveScreenshot({
            campaign_id: campaign.id,
            campaign_name: campaign.campaign_name,
            bag_id: job.bagId,
            bag_name: bagNameById.get(job.bagId) ?? job.bagId,
            date: job.date,
            png,
          });
        })
      );
      for (let j = 0; j < settled.length; j++) {
        const r = settled[j];
        if (r.status === "fulfilled") captured++;
        else errors.push({ bag_id: batch[j].bagId, date: batch[j].date, error: (r.reason as Error)?.message ?? "unknown error" });
      }
    }

    res.json({ requested: jobs.length, captured, failed: errors.length, errors });
  } catch (err) {
    next(err);
  }
});

router.get("/campaigns/:id/screenshots", (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
  const items = listScreenshots({ campaignId: req.params.id });
  res.json(
    items.map((r) => ({
      id: r.id,
      bag_id: r.bag_id,
      bag_name: r.bag_name,
      date: r.date,
      captured_at: r.captured_at,
      size_bytes: r.size_bytes,
      download_url: `/api/screenshots/${r.id}`,
    }))
  );
});

router.get("/campaigns/:id/screenshots/zip", async (req, res, next) => {
  try {
    const campaign = getCampaign(req.params.id);
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    const items = listScreenshots({ campaignId: req.params.id });
    if (items.length === 0) { res.status(404).json({ error: "No screenshots to download for this campaign" }); return; }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="campaign-${campaign.id}-screenshots.zip"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => next(err));
    archive.pipe(res);
    for (const r of items) {
      if (fs.existsSync(r.file_path)) {
        archive.file(r.file_path, { name: `${r.bag_name}_${r.date}.png` });
      }
    }
    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

router.get("/screenshots/:id", (req, res) => {
  const r = getScreenshot(req.params.id);
  if (!r || !fs.existsSync(r.file_path)) { res.status(404).json({ error: "Screenshot not found" }); return; }
  res.setHeader("Content-Type", "image/png");
  res.sendFile(r.file_path);
});

router.delete("/screenshots/:id", (req, res) => {
  const ok = deleteScreenshot(req.params.id);
  if (!ok) { res.status(404).json({ error: "Screenshot not found" }); return; }
  res.json({ success: true });
});

export { router as screenshotRouter };
