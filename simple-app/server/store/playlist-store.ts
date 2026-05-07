// ─────────────────────────────────────────────────────────────────────────────
// Playlist store — ordered, named lists of media items deployable to bags.
//
// One playlist = one Colorlight program. We track per-bag deployment state
// (which Colorlight program ID was minted for this playlist on this bag) so
// re-deploys reuse the same program rather than creating a new one each time.
//
// Persisted to ${DATA_DIR}/playlists.json on the Railway volume.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE = path.join(DATA_DIR, "playlists.json");

export interface PlaylistItem {
  // media_id can be a Colorlight numeric id (e.g. "6421932") or a dev-upload
  // id (e.g. "dev_mounv0f3_yfiib6"). The deploy flow handles both.
  media_id: string;
  filename: string;          // cached for display
  file_type: "video" | "image" | string;
  duration_seconds: number;  // natural duration of the file
  source_url?: string;       // cached; only populated when added from live Colorlight
  thumbnail_url?: string;
  fileID?: number;           // Colorlight numeric id, when available
}

export interface PlaylistDeployment {
  bag_id: string;
  program_id: number;        // Colorlight program id (-1 in dry-run mode)
  program_name: string;
  deployed_at: string;
  dry_run: boolean;          // true if deployed while writes were disabled
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
  deployed_to: PlaylistDeployment[];
  created: string;
  updated: string;
}

let cache: Playlist[] | null = null;

function load(): Playlist[] {
  if (cache !== null) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) {
      cache = [];
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(FILE, "utf8")) as Playlist[];
    return cache;
  } catch (err) {
    console.warn("[playlist-store] load failed, starting empty:", (err as Error).message);
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
    console.error("[playlist-store] save failed:", (err as Error).message);
    throw err;
  }
}

function makeId() {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listPlaylists(): Playlist[] {
  return [...load()];
}

export function getPlaylist(id: string): Playlist | null {
  return load().find((p) => p.id === id) ?? null;
}

/** Returns the playlist currently deployed to a bag, if any. */
export function getPlaylistByBagId(bagId: string): Playlist | null {
  return load().find((p) => p.deployed_to.some((d) => d.bag_id === bagId)) ?? null;
}

export interface CreatePlaylistInput {
  name: string;
  items: PlaylistItem[];
}

export function createPlaylist(input: CreatePlaylistInput): Playlist {
  const list = load();
  const now = new Date().toISOString();
  const playlist: Playlist = {
    id: makeId(),
    name: input.name,
    items: input.items ?? [],
    deployed_to: [],
    created: now,
    updated: now,
  };
  list.push(playlist);
  save();
  return playlist;
}

export interface UpdatePlaylistInput {
  name?: string;
  items?: PlaylistItem[];
}

export function updatePlaylist(id: string, input: UpdatePlaylistInput): Playlist | null {
  const list = load();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  list[idx] = {
    ...list[idx],
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.items !== undefined ? { items: input.items } : {}),
    updated: new Date().toISOString(),
  };
  save();
  return list[idx];
}

export function deletePlaylist(id: string): boolean {
  const list = load();
  const idx = list.findIndex((p) => p.id === id);
  if (idx === -1) return false;
  list.splice(idx, 1);
  save();
  return true;
}

// ── Deployment tracking ──────────────────────────────────────────────────────

/**
 * Record that a playlist has been deployed (or re-deployed) to a set of bags.
 * Enforces the "one playlist per bag" rule by removing each bag from any
 * other playlist's deployed_to list when assigned here.
 */
export function recordDeployment(
  playlistId: string,
  deployments: { bag_id: string; program_id: number; program_name: string; dry_run: boolean }[]
): Playlist | null {
  const list = load();
  const target = list.findIndex((p) => p.id === playlistId);
  if (target === -1) return null;

  const now = new Date().toISOString();

  for (const dep of deployments) {
    // Strip this bag from every other playlist (one-playlist-per-bag rule)
    for (let i = 0; i < list.length; i++) {
      if (i === target) continue;
      list[i].deployed_to = list[i].deployed_to.filter((d) => d.bag_id !== dep.bag_id);
    }
    // Update or insert in target playlist
    const existing = list[target].deployed_to.findIndex((d) => d.bag_id === dep.bag_id);
    const record: PlaylistDeployment = {
      bag_id: dep.bag_id,
      program_id: dep.program_id,
      program_name: dep.program_name,
      deployed_at: now,
      dry_run: dep.dry_run,
    };
    if (existing >= 0) list[target].deployed_to[existing] = record;
    else list[target].deployed_to.push(record);
  }

  list[target].updated = now;
  save();
  return list[target];
}

/** Remove a bag from a playlist's deployed_to list. */
export function unassignFromBag(playlistId: string, bagId: string): Playlist | null {
  const list = load();
  const idx = list.findIndex((p) => p.id === playlistId);
  if (idx === -1) return null;
  list[idx].deployed_to = list[idx].deployed_to.filter((d) => d.bag_id !== bagId);
  list[idx].updated = new Date().toISOString();
  save();
  return list[idx];
}

// ── Cross-references (used by Media page for delete-blocking) ────────────────

/** Returns playlists that reference the given media id. */
export function playlistsUsingMedia(mediaId: string): Playlist[] {
  return load().filter((p) => p.items.some((i) => i.media_id === mediaId));
}
