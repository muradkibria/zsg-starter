// ─────────────────────────────────────────────────────────────────────────────
// Campaign store — JSON-backed persistence for marketing campaigns.
//
// A campaign tracks a contractual relationship: a client has paid for their
// ad to appear on N bags between two dates. The store is the source of truth
// for the Campaigns sub-tab and feeds the Occupancy KPI roll-up.
//
// Mirrors the rider-store pattern: single JSON file at ${DATA_DIR}/campaigns.json
// on the Railway volume. No new infra.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE = path.join(DATA_DIR, "campaigns.json");

export type CampaignStatus = "draft" | "active" | "paused" | "ended";

export interface Campaign {
  id: string;
  client_name: string;
  campaign_name: string;
  status: CampaignStatus;
  start_date: string | null;       // YYYY-MM-DD
  end_date: string | null;         // YYYY-MM-DD
  contracted_bags: number;         // bags the client paid for (= slots sold)
  notes: string;
  created: string;
  updated: string;
}

let cache: Campaign[] | null = null;

function load(): Campaign[] {
  if (cache !== null) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) {
      cache = [];
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(FILE, "utf8")) as Campaign[];
    return cache;
  } catch (err) {
    console.warn("[campaign-store] load failed, starting empty:", (err as Error).message);
    cache = [];
    return cache;
  }
}

function save() {
  if (cache == null) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.error("[campaign-store] save failed:", (err as Error).message);
    throw err;
  }
}

function makeId() {
  return `cam_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listCampaigns(): Campaign[] {
  return [...load()];
}

export function getCampaign(id: string): Campaign | null {
  return load().find((c) => c.id === id) ?? null;
}

export interface CreateCampaignInput {
  client_name: string;
  campaign_name: string;
  status?: CampaignStatus;
  start_date?: string | null;
  end_date?: string | null;
  contracted_bags?: number;
  notes?: string;
}

export function createCampaign(input: CreateCampaignInput): Campaign {
  const list = load();
  const now = new Date().toISOString();
  const campaign: Campaign = {
    id: makeId(),
    client_name: input.client_name,
    campaign_name: input.campaign_name,
    status: input.status ?? "draft",
    start_date: normaliseDate(input.start_date),
    end_date: normaliseDate(input.end_date),
    contracted_bags: Math.max(0, Math.floor(Number(input.contracted_bags ?? 0))),
    notes: input.notes ?? "",
    created: now,
    updated: now,
  };
  list.push(campaign);
  save();
  return campaign;
}

export type UpdateCampaignInput = Partial<Omit<Campaign, "id" | "created" | "updated">>;

export function updateCampaign(id: string, updates: UpdateCampaignInput): Campaign | null {
  const list = load();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  const existing = list[idx];
  list[idx] = {
    ...existing,
    ...updates,
    contracted_bags:
      updates.contracted_bags !== undefined
        ? Math.max(0, Math.floor(Number(updates.contracted_bags)))
        : existing.contracted_bags,
    start_date:
      updates.start_date !== undefined ? normaliseDate(updates.start_date) : existing.start_date,
    end_date:
      updates.end_date !== undefined ? normaliseDate(updates.end_date) : existing.end_date,
    updated: new Date().toISOString(),
  };
  save();
  return list[idx];
}

export function deleteCampaign(id: string): boolean {
  const list = load();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  save();
  return true;
}

// ── Active-campaign rule ─────────────────────────────────────────────────────
// A campaign is "active" for Occupancy purposes when:
//   1. Its status is exactly "active", AND
//   2. Today's date is within [start_date, end_date] (when those are set).
// Date checks are inclusive on both ends. Null start/end = open-ended that side.

export function isCampaignActive(c: Campaign, today: Date = new Date()): boolean {
  if (c.status !== "active") return false;
  const t = today.toISOString().slice(0, 10);
  if (c.start_date && c.start_date > t) return false;
  if (c.end_date && c.end_date < t) return false;
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalise a date string to YYYY-MM-DD or null. Defends against bad input. */
function normaliseDate(d: string | null | undefined): string | null {
  if (!d) return null;
  // Accept YYYY-MM-DD directly; also tolerate ISO timestamps and chop them
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}
