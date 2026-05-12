// ─────────────────────────────────────────────────────────────────────────────
// Saved-report store — persist generated reports so users can re-open them
// without re-paying for LLM tokens.
//
// One JSON file per report at ${DATA_DIR}/reports/<id>.json, plus an index
// file listing summaries for fast load on the saved-reports page.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import type { PreviewOutput } from "./aggregator.js";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const REPORTS_DIR = path.join(DATA_DIR, "reports");
const INDEX_FILE = path.join(DATA_DIR, "reports-index.json");

export interface SavedReportSummary {
  id: string;
  title: string;
  campaign_id: string | null;
  client_name: string | null;
  campaign_name: string | null;
  ad_count: number;
  bag_count: number;
  start_time: string;
  end_time: string;
  estimated_impressions: number;
  total_plays: number;
  generated_at: string;
  model_used: string | null;
}

export interface SavedReport extends SavedReportSummary {
  ad_ids: string[];
  bag_ids: string[];
  numbers: PreviewOutput;
  narrative_markdown: string | null;
  token_usage: { input: number; output: number } | null;
  prompt_override: string | null;
}

let indexCache: SavedReportSummary[] | null = null;

function loadIndex(): SavedReportSummary[] {
  if (indexCache !== null) return indexCache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(INDEX_FILE)) {
      indexCache = [];
      return indexCache;
    }
    indexCache = JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")) as SavedReportSummary[];
    return indexCache;
  } catch (err) {
    console.warn("[report-store] index load failed, starting empty:", (err as Error).message);
    indexCache = [];
    return indexCache;
  }
}

function saveIndex() {
  if (indexCache == null) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexCache, null, 2), "utf8");
}

function reportPath(id: string): string {
  return path.join(REPORTS_DIR, `${id}.json`);
}

function makeId(): string {
  return `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listReports(): SavedReportSummary[] {
  return [...loadIndex()].sort((a, b) =>
    b.generated_at.localeCompare(a.generated_at)
  );
}

export function getReport(id: string): SavedReport | null {
  try {
    const file = reportPath(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")) as SavedReport;
  } catch (err) {
    console.warn("[report-store] getReport failed:", (err as Error).message);
    return null;
  }
}

export interface CreateReportInput {
  title: string;
  campaign_id?: string | null;
  client_name?: string | null;
  campaign_name?: string | null;
  ad_ids: string[];
  bag_ids: string[];
  numbers: PreviewOutput;
  narrative_markdown: string | null;
  model_used: string | null;
  token_usage: { input: number; output: number } | null;
  prompt_override?: string | null;
}

export function saveReport(input: CreateReportInput): SavedReport {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const id = makeId();
  const generated_at = new Date().toISOString();

  const summary: SavedReportSummary = {
    id,
    title: input.title,
    campaign_id: input.campaign_id ?? null,
    client_name: input.client_name ?? null,
    campaign_name: input.campaign_name ?? null,
    ad_count: input.ad_ids.length,
    bag_count: input.bag_ids.length,
    start_time: input.numbers.startTime,
    end_time: input.numbers.endTime,
    estimated_impressions: Math.round(input.numbers.totals.estimatedImpressions),
    total_plays: input.numbers.totals.totalPlays,
    generated_at,
    model_used: input.model_used,
  };

  const full: SavedReport = {
    ...summary,
    ad_ids: input.ad_ids,
    bag_ids: input.bag_ids,
    numbers: input.numbers,
    narrative_markdown: input.narrative_markdown,
    token_usage: input.token_usage,
    prompt_override: input.prompt_override ?? null,
  };

  fs.writeFileSync(reportPath(id), JSON.stringify(full, null, 2), "utf8");

  const list = loadIndex();
  list.push(summary);
  indexCache = list;
  saveIndex();

  return full;
}

export function deleteReport(id: string): boolean {
  const list = loadIndex();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  indexCache = list;
  saveIndex();

  try {
    const file = reportPath(id);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // Index already updated; file removal failure shouldn't block the response
  }
  return true;
}
