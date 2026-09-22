// ─────────────────────────────────────────────────────────────────────────────
// Headless-browser route screenshot capture. Navigates a same-origin Playwright
// page to the chrome-free /snapshot/bag/:bagId/day/:date route (client/src/
// pages/RouteSnapshotView.tsx), waits for it to signal it's fully rendered,
// then captures a PNG.
//
// The browser instance is a lazy-launched singleton, reused across calls —
// starting Chromium per-screenshot would be far too slow for a batch job.
// ─────────────────────────────────────────────────────────────────────────────

import { chromium, type Browser } from "playwright";

let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true }).catch((err) => {
      browserPromise = null; // allow retry on next call
      throw err;
    });
  }
  return browserPromise;
}

/** Call on process shutdown so a held Chromium instance doesn't block exit. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    // best-effort — process is exiting anyway
  } finally {
    browserPromise = null;
  }
}

const READY_SELECTOR = '[data-testid="snapshot-ready"]';
const NAV_TIMEOUT_MS = 20_000;
const READY_TIMEOUT_MS = 20_000;

/** Base URL the headless browser navigates to — same process, so always localhost. */
function baseUrl(): string {
  const port = process.env.PORT ?? "3000";
  return `http://127.0.0.1:${port}`;
}

export async function captureRouteScreenshot(bagId: string, dateStr: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  try {
    const url = `${baseUrl()}/snapshot/bag/${encodeURIComponent(bagId)}/day/${encodeURIComponent(dateStr)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    await page.waitForSelector(READY_SELECTOR, { state: "attached", timeout: READY_TIMEOUT_MS });
    // Tiles report `load` as soon as the visible set is in, but a short settle
    // avoids capturing mid-paint on slower machines.
    await page.waitForTimeout(300);
    const buffer = await page.screenshot({ type: "png" });
    return buffer;
  } finally {
    await page.close().catch(() => {});
  }
}
