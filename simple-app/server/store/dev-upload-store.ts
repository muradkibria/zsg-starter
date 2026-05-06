// ─────────────────────────────────────────────────────────────────────────────
// Dev upload queue — tracks pending media uploads while writes are disabled.
//
// In dry-run mode, when a user uploads a file the server doesn't actually
// send it to Colorlight. It records metadata here so the dashboard can show
// "PENDING (DEV)" entries in the Media list, and so the deploy flow can
// reference them.
//
// When COLORLIGHT_WRITES_ENABLED is flipped to true, these entries are
// considered stale — the user should re-upload through the live path.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE = path.join(DATA_DIR, "dev-uploads.json");

export interface DevUpload {
  id: string;                  // dev_<ts>_<rand>
  filename: string;
  mime_type: string;
  size_bytes: number;
  file_type: "video" | "image";
  duration_seconds: number;
  width: number;
  height: number;
  created: string;
  deployed_to: { bagIds: string[]; programName: string; at: string }[];
}

let cache: DevUpload[] | null = null;

function load(): DevUpload[] {
  if (cache !== null) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) {
      cache = [];
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(FILE, "utf8")) as DevUpload[];
    return cache;
  } catch (err) {
    console.warn("[dev-upload-store] load failed, starting empty:", (err as Error).message);
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
    console.error("[dev-upload-store] save failed:", (err as Error).message);
    throw err;
  }
}

function makeId() {
  return `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function listDevUploads(): DevUpload[] {
  return [...load()];
}

export function getDevUpload(id: string): DevUpload | null {
  return load().find((u) => u.id === id) ?? null;
}

export function recordDevUpload(input: Omit<DevUpload, "id" | "created" | "deployed_to">): DevUpload {
  const list = load();
  const upload: DevUpload = {
    id: makeId(),
    created: new Date().toISOString(),
    deployed_to: [],
    ...input,
  };
  list.push(upload);
  save();
  return upload;
}

export function recordDeployment(uploadId: string, bagIds: string[], programName: string): DevUpload | null {
  const list = load();
  const idx = list.findIndex((u) => u.id === uploadId);
  if (idx === -1) return null;
  list[idx].deployed_to.push({
    bagIds,
    programName,
    at: new Date().toISOString(),
  });
  save();
  return list[idx];
}

export function deleteDevUpload(id: string): boolean {
  const list = load();
  const idx = list.findIndex((u) => u.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  save();
  return true;
}
