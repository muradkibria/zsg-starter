// ─────────────────────────────────────────────────────────────────────────────
// Nightly auto-capture — screenshots yesterday's route for every bag of every
// currently-active campaign, so nobody has to hand-trigger "Generate" each
// morning. Opt-in via ROUTE_SCREENSHOT_CRON_ENABLED (default off) — verify the
// on-demand path in production first; a persistent headless Chromium plus a
// nightly batch job competes for memory with normal request traffic.
// ─────────────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import { listCampaigns, isCampaignActive } from "../store/campaign-store.js";
import { listTerminals } from "../colorlight/client.js";
import { captureRouteScreenshot } from "./capture.js";
import { saveScreenshot } from "./screenshot-store.js";

const CRON_SCHEDULE = process.env.ROUTE_SCREENSHOT_CRON_SCHEDULE ?? "0 3 * * *"; // 03:00 server time
const CAPTURE_CONCURRENCY = 2;

function yesterday(): string {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

export async function runNightlyCapture(dateStr: string = yesterday()): Promise<void> {
  const active = listCampaigns().filter((c) => isCampaignActive(c));
  if (active.length === 0) {
    console.log("[route-screenshot-cron] no active campaigns — nothing to capture");
    return;
  }

  const terminals = await listTerminals().catch(() => []);
  const bagNameById = new Map<string, string>();
  for (const t of terminals) bagNameById.set(String(t.id), t.title?.raw ?? t.title?.rendered ?? `Terminal ${t.id}`);

  const jobs = active.flatMap((c) =>
    c.bag_ids.length > 0
      ? c.bag_ids.map((bagId) => ({ campaignId: c.id, campaignName: c.campaign_name, bagId }))
      : []
  );

  const skipped = active.filter((c) => c.bag_ids.length === 0);
  for (const c of skipped) {
    console.warn(`[route-screenshot-cron] skipping "${c.campaign_name}" (${c.id}) — no bags configured`);
  }

  let captured = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += CAPTURE_CONCURRENCY) {
    const batch = jobs.slice(i, i + CAPTURE_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (job) => {
        const png = await captureRouteScreenshot(job.bagId, dateStr);
        saveScreenshot({
          campaign_id: job.campaignId,
          campaign_name: job.campaignName,
          bag_id: job.bagId,
          bag_name: bagNameById.get(job.bagId) ?? job.bagId,
          date: dateStr,
          png,
        });
      })
    );
    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled") {
        captured++;
      } else {
        failed++;
        console.warn(
          `[route-screenshot-cron] capture failed for bag ${batch[j].bagId} (${dateStr}):`,
          (r.reason as Error)?.message ?? r.reason
        );
      }
    }
  }

  console.log(`[route-screenshot-cron] ${dateStr}: captured ${captured}/${jobs.length} (${failed} failed)`);
}

let started = false;

export function startRouteScreenshotCron() {
  if (started) return;
  if (process.env.ROUTE_SCREENSHOT_CRON_ENABLED !== "true") {
    console.log("[route-screenshot-cron] disabled (set ROUTE_SCREENSHOT_CRON_ENABLED=true to enable)");
    return;
  }
  started = true;
  cron.schedule(CRON_SCHEDULE, () => {
    runNightlyCapture().catch((err) => {
      console.error("[route-screenshot-cron] run failed:", (err as Error).message);
    });
  });
  console.log(`[route-screenshot-cron] scheduled (cron: "${CRON_SCHEDULE}")`);
}
