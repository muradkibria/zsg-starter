// ─────────────────────────────────────────────────────────────────────────────
// Report endpoints — preview (numbers only, no LLM) and (later) generate.
//
// Mounted under /api by routes.ts. The generate / list / get / delete endpoints
// are added in Phase C alongside the Claude client.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { buildReportPreview, type PreviewInput } from "./aggregator.js";
import { hasDataset } from "../store/tfl-store.js";
import { anthropicConfigured, callClaude } from "./anthropic.js";
import { DEFAULT_SYSTEM_PROMPT, buildUserMessage } from "./prompt.js";
import { listReports, getReport, saveReport, deleteReport } from "./report-store.js";
import { getCampaign } from "../store/campaign-store.js";

const router = Router();

// ── Preview (Phase B) ────────────────────────────────────────────────────────
// Accepts the same shape we'll later use for generate, but skips the LLM step.
// Useful for sanity-checking the math before spending LLM tokens.

router.post("/reports/preview", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Partial<PreviewInput>;
    const adIds = Array.isArray(body.adIds) ? body.adIds.map(String) : [];
    const adMd5s = Array.isArray(body.adMd5s) ? body.adMd5s.map(String) : [];
    const startTime = String(body.startTime ?? "");
    const endTime = String(body.endTime ?? "");
    const bagIds = Array.isArray(body.bagIds) ? body.bagIds.map(String) : undefined;

    if (adIds.length === 0 && adMd5s.length === 0) {
      res.status(400).json({ error: "At least one ad must be selected (provide adIds or adMd5s)" });
      return;
    }
    if (!startTime || !endTime) {
      res.status(400).json({ error: "startTime and endTime are required (ISO timestamps)" });
      return;
    }
    if (!hasDataset()) {
      res.status(409).json({
        error: "TfL footfall dataset not uploaded yet",
        detail: "Upload a TfL stations CSV via POST /api/tfl/upload before generating a report.",
      });
      return;
    }

    const out = await buildReportPreview({ adIds, adMd5s, startTime, endTime, bagIds });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

// ── System status (UI uses this to know whether the generate button can be enabled) ──

router.get("/reports/system-status", (_req, res) => {
  res.json({
    tflDatasetLoaded: hasDataset(),
    anthropicConfigured: anthropicConfigured(),
    canGenerate: hasDataset() && anthropicConfigured(),
  });
});

// ── Generate (Phase C) ───────────────────────────────────────────────────────
// 1. Run preview to assemble numbers
// 2. Call Claude with prompt + numbers
// 3. Save the full report to disk

router.post("/reports/generate", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Partial<PreviewInput> & {
      title?: string;
      campaign_id?: string | null;
      prompt_override?: string | null;
    };

    const adIds = Array.isArray(body.adIds) ? body.adIds.map(String) : [];
    const adMd5s = Array.isArray(body.adMd5s) ? body.adMd5s.map(String) : [];
    const startTime = String(body.startTime ?? "");
    const endTime = String(body.endTime ?? "");
    const bagIds = Array.isArray(body.bagIds) ? body.bagIds.map(String) : undefined;
    const title = String(body.title ?? "Campaign Report").trim();
    const campaignId = body.campaign_id ?? null;

    if (adIds.length === 0 && adMd5s.length === 0) {
      res.status(400).json({ error: "At least one ad must be selected" });
      return;
    }
    if (!startTime || !endTime) {
      res.status(400).json({ error: "startTime and endTime are required" });
      return;
    }
    if (!hasDataset()) {
      res.status(409).json({
        error: "TfL footfall dataset not uploaded yet",
        detail: "Upload a TfL stations CSV before generating a report.",
      });
      return;
    }
    if (!anthropicConfigured()) {
      res.status(409).json({
        error: "Anthropic API key not configured",
        detail: "Set ANTHROPIC_API_KEY in the server environment to enable report generation.",
      });
      return;
    }

    // 1. Build numbers
    const numbers = await buildReportPreview({ adIds, adMd5s, startTime, endTime, bagIds });

    // Pull campaign metadata if tagged — gives the LLM extra context (client name, notes)
    const campaign = campaignId ? getCampaign(String(campaignId)) : null;

    // 2. Call Claude
    const systemPrompt = body.prompt_override?.trim() || DEFAULT_SYSTEM_PROMPT;
    const userMessage = buildUserMessage({
      reportTitle: title,
      campaignContext: campaign
        ? {
            client_name: campaign.client_name,
            campaign_name: campaign.campaign_name,
            notes: campaign.notes,
          }
        : undefined,
      data: numbers,
    });

    const llm = await callClaude({ systemPrompt, userMessage });

    // 3. Save
    const saved = saveReport({
      title,
      campaign_id: campaignId,
      client_name: campaign?.client_name ?? null,
      campaign_name: campaign?.campaign_name ?? null,
      ad_ids: numbers.ads.map((a) => a.media_id),
      bag_ids: numbers.bags.map((b) => b.bag_id),
      numbers,
      narrative_markdown: llm.text,
      model_used: llm.model,
      token_usage: { input: llm.usage.input_tokens, output: llm.usage.output_tokens },
      prompt_override: body.prompt_override?.trim() || null,
    });

    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
});

// ── Saved-report CRUD ────────────────────────────────────────────────────────

router.get("/reports", (_req, res) => {
  res.json(listReports());
});

router.get("/reports/:id", (req, res) => {
  const r = getReport(req.params.id);
  if (!r) { res.status(404).json({ error: "Report not found" }); return; }
  res.json(r);
});

router.delete("/reports/:id", (req, res) => {
  const ok = deleteReport(req.params.id);
  if (!ok) { res.status(404).json({ error: "Report not found" }); return; }
  res.json({ success: true });
});

export { router as reportRouter };
