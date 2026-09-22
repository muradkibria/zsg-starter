// ─────────────────────────────────────────────────────────────────────────────
// Route screenshot store — mirrors report-store.ts's shape. PNG files live on
// disk under DATA_DIR; a small JSON index (summaries only) makes listing fast.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const SCREENSHOTS_DIR = path.join(DATA_DIR, "route-screenshots");
const INDEX_FILE = path.join(DATA_DIR, "route-screenshots-index.json");

export interface ScreenshotRecord {
  id: string;
  campaign_id: string;
  campaign_name: string;
  bag_id: string;
  bag_name: string;
  date: string;          // YYYY-MM-DD
  captured_at: string;   // ISO timestamp
  file_path: string;     // absolute path on disk
  size_bytes: number;
}

let indexCache: ScreenshotRecord[] | null = null;

function loadIndex(): ScreenshotRecord[] {
  if (indexCache !== null) return indexCache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_FILE)) {
      indexCache = [];
      return indexCache;
    }
    indexCache = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as ScreenshotRecord[];
    return indexCache;
  } catch (err) {
    console.warn("[screenshot-store] index load failed, starting empty:", (err as Error).message);
    indexCache = [];
    return indexCache;
  }
}

function saveIndex() {
  if (indexCache == null) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexCache, null, 2), "utf8");
}

function makeId(bagId: string, date: string): string {
  return `snap_${bagId}_${date}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface SaveScreenshotInput {
  campaign_id: string;
  campaign_name: string;
  bag_id: string;
  bag_name: string;
  date: string;
  png: Buffer;
}

/** Re-capture of the same bag+date overwrites — treated as a refresh. */
export function saveScreenshot(input: SaveScreenshotInput): ScreenshotRecord {
  const id = makeId(input.bag_id, input.date);
  const dir = path.join(SCREENSHOTS_DIR, input.bag_id);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.resolve(dir, `${input.date}.png`);
  fs.writeFileSync(filePath, input.png);

  const record: ScreenshotRecord = {
    id,
    campaign_id: input.campaign_id,
    campaign_name: input.campaign_name,
    bag_id: input.bag_id,
    bag_name: input.bag_name,
    date: input.date,
    captured_at: new Date().toISOString(),
    file_path: filePath,
    size_bytes: input.png.length,
  };

  const list = loadIndex();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) list.push(record);
  else list[idx] = record;
  indexCache = list;
  saveIndex();

  return record;
}

export function listScreenshots(filter: { campaignId?: string; bagId?: string } = {}): ScreenshotRecord[] {
  return loadIndex()
    .filter((r) => !filter.campaignId || r.campaign_id === filter.campaignId)
    .filter((r) => !filter.bagId || r.bag_id === filter.bagId)
    .sort((a, b) => b.date.localeCompare(a.date) || a.bag_id.localeCompare(b.bag_id));
}

export function getScreenshot(id: string): ScreenshotRecord | null {
  return loadIndex().find((r) => r.id === id) ?? null;
}

export function deleteScreenshot(id: string): boolean {
  const list = loadIndex();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const [removed] = list.splice(idx, 1);
  indexCache = list;
  saveIndex();
  try {
    if (fs.existsSync(removed.file_path)) fs.unlinkSync(removed.file_path);
  } catch {
    // Index already updated; file removal failure shouldn't block the response
  }
  return true;
}
