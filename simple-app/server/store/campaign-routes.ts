import { Router } from "express";
import {
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  type CampaignStatus,
} from "./campaign-store.js";

const router = Router();

const VALID_STATUSES: CampaignStatus[] = ["draft", "active", "paused", "ended"];

function isValidStatus(s: any): s is CampaignStatus {
  return typeof s === "string" && (VALID_STATUSES as string[]).includes(s);
}

// ── List / detail ────────────────────────────────────────────────────────────

router.get("/campaigns", (_req, res) => {
  res.json(listCampaigns());
});

router.get("/campaigns/:id", (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json(c);
});

// ── Create ───────────────────────────────────────────────────────────────────

router.post("/campaigns", (req, res) => {
  const body = req.body ?? {};
  const client = String(body.client_name ?? "").trim();
  const name = String(body.campaign_name ?? "").trim();
  if (!client) { res.status(400).json({ error: "client_name is required" }); return; }
  if (!name) { res.status(400).json({ error: "campaign_name is required" }); return; }

  // status is optional; if absent, default to draft. If present, must be valid.
  let status: CampaignStatus = "draft";
  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    status = body.status;
  }

  const contracted = Number(body.contracted_bags ?? 0);
  if (!Number.isFinite(contracted) || contracted < 0) {
    res.status(400).json({ error: "contracted_bags must be a non-negative number" });
    return;
  }

  const created = createCampaign({
    client_name: client,
    campaign_name: name,
    status,
    start_date: body.start_date ?? null,
    end_date: body.end_date ?? null,
    contracted_bags: contracted,
    notes: typeof body.notes === "string" ? body.notes : "",
  });
  res.status(201).json(created);
});

// ── Update ───────────────────────────────────────────────────────────────────

router.put("/campaigns/:id", (req, res) => {
  const body = req.body ?? {};
  const updates: Parameters<typeof updateCampaign>[1] = {};

  if (body.client_name !== undefined) {
    const v = String(body.client_name).trim();
    if (!v) { res.status(400).json({ error: "client_name cannot be empty" }); return; }
    updates.client_name = v;
  }
  if (body.campaign_name !== undefined) {
    const v = String(body.campaign_name).trim();
    if (!v) { res.status(400).json({ error: "campaign_name cannot be empty" }); return; }
    updates.campaign_name = v;
  }
  if (body.status !== undefined) {
    if (!isValidStatus(body.status)) {
      res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(", ")}` });
      return;
    }
    updates.status = body.status;
  }
  if (body.start_date !== undefined) updates.start_date = body.start_date;
  if (body.end_date !== undefined) updates.end_date = body.end_date;
  if (body.contracted_bags !== undefined) {
    const n = Number(body.contracted_bags);
    if (!Number.isFinite(n) || n < 0) {
      res.status(400).json({ error: "contracted_bags must be a non-negative number" });
      return;
    }
    updates.contracted_bags = n;
  }
  if (body.notes !== undefined) updates.notes = String(body.notes ?? "");

  const updated = updateCampaign(req.params.id, updates);
  if (!updated) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json(updated);
});

// ── Delete ───────────────────────────────────────────────────────────────────

router.delete("/campaigns/:id", (req, res) => {
  const ok = deleteCampaign(req.params.id);
  if (!ok) { res.status(404).json({ error: "Campaign not found" }); return; }
  res.json({ success: true });
});

export { router as campaignStoreRouter };
