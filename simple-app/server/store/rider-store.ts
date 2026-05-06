// ─────────────────────────────────────────────────────────────────────────────
// Rider store — JSON-backed persistence for rider profiles and documents.
//
// Colorlight has no concept of riders; this is our domain. We persist to a
// single JSON file at ${DATA_DIR}/riders.json (DATA_DIR defaults to ./data).
//
// On Railway, mount a Volume at /data and set DATA_DIR=/data so the file
// survives redeploys. Without a volume the data resets on each deploy.
//
// Documents are stored inline as base64 to keep V1 simple. Caps:
//   - Per-document ~5MB (Express body limit set in server/index.ts)
//   - Total file ~10MB practical before reads slow down
// Refactor to filesystem storage if you grow beyond ~50 riders with docs.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const RIDERS_FILE = path.join(DATA_DIR, "riders.json");

export interface RiderDocument {
  id: string;
  type: string;        // "National ID", "Proof of Address", "DBS Check", etc.
  filename: string;
  mime_type: string;
  data: string;        // data: URL with base64 payload
  size_bytes: number;
  uploaded: string;    // ISO timestamp
}

export interface Rider {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  bag_id: string | null;       // assigned terminal id (string form of Colorlight id)
  status: "active" | "inactive";
  documents: RiderDocument[];
  notes: string;
  created: string;
  updated: string;
}

let cache: Rider[] | null = null;

function load(): Rider[] {
  if (cache !== null) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(RIDERS_FILE)) {
      cache = [];
      return cache;
    }
    const raw = fs.readFileSync(RIDERS_FILE, "utf8");
    cache = JSON.parse(raw) as Rider[];
    return cache;
  } catch (err) {
    console.warn("[rider-store] load failed, starting empty:", (err as Error).message);
    cache = [];
    return cache;
  }
}

function save() {
  if (cache == null) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(RIDERS_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.error("[rider-store] save failed:", (err as Error).message);
    throw err;
  }
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listRiders(): Rider[] {
  return [...load()];
}

export function getRider(id: string): Rider | null {
  return load().find((r) => r.id === id) ?? null;
}

export function getRiderByBagId(bagId: string): Rider | null {
  return load().find((r) => r.bag_id === bagId) ?? null;
}

export interface CreateRiderInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  bag_id?: string | null;
  status?: "active" | "inactive";
  notes?: string;
}

export function createRider(input: CreateRiderInput): Rider {
  const list = load();
  const now = new Date().toISOString();
  // If a bag is being assigned, ensure no other rider holds it
  if (input.bag_id) {
    for (const r of list) {
      if (r.bag_id === input.bag_id) r.bag_id = null;
    }
  }
  const rider: Rider = {
    id: makeId("rdr"),
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    bag_id: input.bag_id ?? null,
    status: input.status ?? "active",
    documents: [],
    notes: input.notes ?? "",
    created: now,
    updated: now,
  };
  list.push(rider);
  save();
  return rider;
}

export type UpdateRiderInput = Partial<Omit<Rider, "id" | "created" | "updated" | "documents">>;

export function updateRider(id: string, updates: UpdateRiderInput): Rider | null {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  // Maintain bag_id uniqueness across riders
  if (updates.bag_id && updates.bag_id !== list[idx].bag_id) {
    for (const r of list) {
      if (r.id !== id && r.bag_id === updates.bag_id) r.bag_id = null;
    }
  }
  list[idx] = {
    ...list[idx],
    ...updates,
    updated: new Date().toISOString(),
  };
  save();
  return list[idx];
}

export function deleteRider(id: string): boolean {
  const list = load();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  save();
  return true;
}

export interface AddDocumentInput {
  type: string;
  filename: string;
  mime_type: string;
  data: string;        // data:...;base64,...
  size_bytes: number;
}

export function addDocument(riderId: string, input: AddDocumentInput): Rider | null {
  const list = load();
  const idx = list.findIndex((r) => r.id === riderId);
  if (idx === -1) return null;
  const doc: RiderDocument = {
    id: makeId("doc"),
    type: input.type,
    filename: input.filename,
    mime_type: input.mime_type,
    data: input.data,
    size_bytes: input.size_bytes,
    uploaded: new Date().toISOString(),
  };
  list[idx] = {
    ...list[idx],
    documents: [...list[idx].documents, doc],
    updated: new Date().toISOString(),
  };
  save();
  return list[idx];
}

export function removeDocument(riderId: string, docId: string): Rider | null {
  const list = load();
  const idx = list.findIndex((r) => r.id === riderId);
  if (idx === -1) return null;
  list[idx] = {
    ...list[idx],
    documents: list[idx].documents.filter((d) => d.id !== docId),
    updated: new Date().toISOString(),
  };
  save();
  return list[idx];
}

export function getStorageInfo() {
  return {
    file: path.resolve(RIDERS_FILE),
    riderCount: load().length,
    persistent: !!process.env.DATA_DIR,
  };
}
