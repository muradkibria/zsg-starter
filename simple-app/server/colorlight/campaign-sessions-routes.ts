// ─────────────────────────────────────────────────────────────────────────────
// Campaign-scoped timesheet — aggregates the existing GPS-session logic
// (sessions.ts) across every bag assigned to a campaign, so ops can download
// one combined timesheet per campaign instead of pulling each rider/bag
// individually. Computation itself is untouched — this only fans out and
// stitches the results together.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import { listTerminals } from "./client.js";
import { getSessionsForBag, groupSessionsByDay, campaignSessionsToCsv, type RiderSession, type DayBreakdown } from "./sessions.js";
import { getCampaign } from "../store/campaign-store.js";
import { getRiderByBagId } from "../store/rider-store.js";

const FETCH_CONCURRENCY = 3; // matches sessions.ts's per-bag GPS fetch concurrency
const MAX_RANGE_MS = 31 * 24 * 3600 * 1000;

interface RiderRow {
  rider_id: string | null;
  rider_name: string;
  bag_id: string;
  bag_name: string;
  totalHours: number;
  workingHours: number;
  idleHours: number;
  byDay: DayBreakdown[];
}

/** Resolve the timesheet window: explicit query params win, else the campaign's own dates. */
function resolveRange(
  req: { query: Record<string, any> },
  campaign: { start_date: string | null; end_date: string | null }
): { startMs: number; endMs: number } {
  const qStart = Date.parse(String(req.query?.startTime ?? ""));
  const qEnd = Date.parse(String(req.query?.endTime ?? ""));
  if (Number.isFinite(qStart) && Number.isFinite(qEnd)) {
    let s = qStart, e = qEnd;
    if (s > e) [s, e] = [e, s];
    if (e - s > MAX_RANGE_MS) s = e - MAX_RANGE_MS;
    return { startMs: s, endMs: e };
  }

  const now = Date.now();
  let startMs = campaign.start_date ? new Date(campaign.start_date + "T00:00:00Z").getTime() : now - MAX_RANGE_MS;
  let endMs = campaign.end_date ? new Date(campaign.end_date + "T23:59:59Z").getTime() : now;
  if (!Number.isFinite(startMs)) startMs = now - MAX_RANGE_MS;
  if (!Number.isFinite(endMs)) endMs = now;
  if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
  if (endMs - startMs > MAX_RANGE_MS) startMs = endMs - MAX_RANGE_MS;
  return { startMs, endMs };
}

async function buildTimesheet(campaignId: string, req: { query: Record<string, any> }) {
  const campaign = getCampaign(campaignId);
  if (!campaign) return { notFound: true as const };

  const { startMs, endMs } = resolveRange(req, campaign);
  const warnings: string[] = [];

  if (campaign.bag_ids.length === 0) {
    warnings.push("No bags configured for this campaign — set them in the Campaigns page.");
  }
  if (campaign.contracted_bags > 0 && campaign.bag_ids.length !== campaign.contracted_bags) {
    warnings.push(
      `Campaign is contracted for ${campaign.contracted_bags} bag(s) but only ${campaign.bag_ids.length} are configured.`
    );
  }

  const terminals = await listTerminals().catch(() => []);
  const bagNameById = new Map<string, string>();
  for (const t of terminals) bagNameById.set(String(t.id), t.title?.raw ?? t.title?.rendered ?? `Terminal ${t.id}`);

  const rows: RiderRow[] = [];
  const rawByBag = new Map<string, RiderSession[]>();

  for (let i = 0; i < campaign.bag_ids.length; i += FETCH_CONCURRENCY) {
    const batch = campaign.bag_ids.slice(i, i + FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((bagId) => getSessionsForBag(bagId, { startMs, endMs }))
    );
    for (let j = 0; j < settled.length; j++) {
      const bagId = batch[j];
      const r = settled[j];
      if (r.status === "fulfilled") {
        rawByBag.set(bagId, r.value);
      } else {
        warnings.push(`Bag ${bagNameById.get(bagId) ?? bagId} failed to load: ${(r.reason as Error)?.message ?? "unknown error"}`);
      }
    }
  }

  for (const bagId of campaign.bag_ids) {
    const sessions = rawByBag.get(bagId);
    if (!sessions) continue; // failed fetch, already warned above
    const rider = getRiderByBagId(bagId);
    const totalSeconds = sessions.reduce((s, x) => s + x.duration_seconds, 0);
    const idleSeconds = sessions.reduce((s, x) => s + (x.idle_seconds ?? 0), 0);
    rows.push({
      rider_id: rider?.id ?? null,
      rider_name: rider?.name ?? "(no rider assigned)",
      bag_id: bagId,
      bag_name: bagNameById.get(bagId) ?? bagId,
      totalHours: +(totalSeconds / 3600).toFixed(2),
      workingHours: +((totalSeconds - idleSeconds) / 3600).toFixed(2),
      idleHours: +(idleSeconds / 3600).toFixed(2),
      byDay: groupSessionsByDay(sessions),
    });
  }

  const totals = rows.reduce(
    (acc, r) => ({
      totalHours: acc.totalHours + r.totalHours,
      workingHours: acc.workingHours + r.workingHours,
      idleHours: acc.idleHours + r.idleHours,
    }),
    { totalHours: 0, workingHours: 0, idleHours: 0 }
  );

  return {
    notFound: false as const,
    campaign,
    startMs,
    endMs,
    rows,
    rawByBag,
    bagNameById,
    warnings,
    totals: {
      totalHours: +totals.totalHours.toFixed(2),
      workingHours: +totals.workingHours.toFixed(2),
      idleHours: +totals.idleHours.toFixed(2),
      riderCount: rows.filter((r) => r.rider_id).length,
      bagCount: rows.length,
    },
  };
}

const router = Router();

router.get("/campaigns/:id/timesheet", async (req, res, next) => {
  try {
    const result = await buildTimesheet(req.params.id, req);
    if (result.notFound) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({
      campaign_id: result.campaign.id,
      client_name: result.campaign.client_name,
      campaign_name: result.campaign.campaign_name,
      startTime: new Date(result.startMs).toISOString(),
      endTime: new Date(result.endMs).toISOString(),
      bag_ids: result.campaign.bag_ids,
      riders: result.rows,
      totals: result.totals,
      warnings: result.warnings,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/campaigns/:id/timesheet/export", async (req, res, next) => {
  try {
    const result = await buildTimesheet(req.params.id, req);
    if (result.notFound) { res.status(404).json({ error: "Campaign not found" }); return; }

    const csv = campaignSessionsToCsv(
      { id: result.campaign.id, campaign_name: result.campaign.campaign_name, client_name: result.campaign.client_name },
      result.rows.map((r) => ({
        rider_id: r.rider_id,
        rider_name: r.rider_name,
        bag_id: r.bag_id,
        sessions: result.rawByBag.get(r.bag_id) ?? [],
      }))
    );

    const startSlug = new Date(result.startMs).toISOString().slice(0, 10);
    const endSlug = new Date(result.endMs).toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="campaign-${result.campaign.id}-timesheet-${startSlug}_to_${endSlug}.csv"`
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export { router as campaignSessionsRouter };
