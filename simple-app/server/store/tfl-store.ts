// ─────────────────────────────────────────────────────────────────────────────
// TfL footfall store — persists the user's uploaded station footfall dataset.
//
// The user maintains a CSV of TfL stations with (at minimum) lat/lng and a
// daily entries+exits figure. The exposure model later joins GPS points to
// nearby stations using this dataset and the daily footfall as a baseline
// for impression estimates.
//
// Stored as a parsed JSON file at ${DATA_DIR}/tfl-stations.json so we don't
// have to re-parse the CSV on every report request. Re-upload replaces.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE = path.join(DATA_DIR, "tfl-stations.json");

export interface TflStation {
  station_name: string;
  lat: number;
  lng: number;
  daily_entries: number;
  daily_exits: number;
  /** Optional fare zone (1–9, or NLL/DLR/etc as string). When present, used in zone roll-ups. */
  zone?: string;
  /** Optional pre-computed total = daily_entries + daily_exits (cached for spatial join speed). */
  daily_footfall?: number;
}

export interface TflDatasetMeta {
  rowCount: number;
  uploadedAt: string;
  sourceFilename: string;
  // Range of footfall values in the dataset — quick sanity check on import
  minFootfall: number;
  maxFootfall: number;
  // Bounding box of stations — useful for diagnosing geographic mismatches
  bbox?: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

interface Persisted {
  meta: TflDatasetMeta;
  stations: TflStation[];
}

let cache: Persisted | null = null;

function load(): Persisted {
  if (cache !== null) return cache;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(FILE)) {
      cache = emptyDataset();
      return cache;
    }
    cache = JSON.parse(fs.readFileSync(FILE, "utf8")) as Persisted;
    return cache;
  } catch (err) {
    console.warn("[tfl-store] load failed, starting empty:", (err as Error).message);
    cache = emptyDataset();
    return cache;
  }
}

function emptyDataset(): Persisted {
  return {
    meta: {
      rowCount: 0,
      uploadedAt: "",
      sourceFilename: "",
      minFootfall: 0,
      maxFootfall: 0,
    },
    stations: [],
  };
}

function save() {
  if (cache == null) return;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.error("[tfl-store] save failed:", (err as Error).message);
    throw err;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listStations(): TflStation[] {
  return [...load().stations];
}

export function getMeta(): TflDatasetMeta {
  return { ...load().meta };
}

export function hasDataset(): boolean {
  return load().stations.length > 0;
}

export function replaceDataset(stations: TflStation[], sourceFilename: string): TflDatasetMeta {
  if (!Array.isArray(stations) || stations.length === 0) {
    throw new Error("Dataset must contain at least one station");
  }

  // Normalise + compute pre-aggregates
  const normalised: TflStation[] = [];
  let minF = Infinity;
  let maxF = -Infinity;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;

  for (const raw of stations) {
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const entries = Math.max(0, Number(raw.daily_entries) || 0);
    const exits = Math.max(0, Number(raw.daily_exits) || 0);
    const footfall = entries + exits;
    if (footfall < minF) minF = footfall;
    if (footfall > maxF) maxF = footfall;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    normalised.push({
      station_name: String(raw.station_name ?? "").trim(),
      lat,
      lng,
      daily_entries: entries,
      daily_exits: exits,
      zone: raw.zone ? String(raw.zone).trim() : undefined,
      daily_footfall: footfall,
    });
  }

  if (normalised.length === 0) {
    throw new Error("Dataset had no rows with valid lat/lng — check column headers");
  }

  const meta: TflDatasetMeta = {
    rowCount: normalised.length,
    uploadedAt: new Date().toISOString(),
    sourceFilename,
    minFootfall: minF === Infinity ? 0 : minF,
    maxFootfall: maxF === -Infinity ? 0 : maxF,
    bbox: { minLat, maxLat, minLng, maxLng },
  };

  cache = { meta, stations: normalised };
  save();
  return meta;
}

export function clearDataset() {
  cache = emptyDataset();
  save();
}

// ── CSV parser ────────────────────────────────────────────────────────────────
// Tolerant of common variations: quoted fields, CRLF, BOM, mixed case headers,
// header aliases (lat/latitude, lng/lon/longitude, etc.). We don't pull in a
// CSV library — the format is simple enough to handle inline and avoid the
// dependency.

const HEADER_ALIASES: Record<string, string[]> = {
  station_name: ["station_name", "station", "name", "station name"],
  lat: ["lat", "latitude", "y"],
  lng: ["lng", "lon", "long", "longitude", "x"],
  daily_entries: ["daily_entries", "entries", "daily entries", "annual_entries"],
  daily_exits: ["daily_exits", "exits", "daily exits", "annual_exits"],
  zone: ["zone", "fare_zone", "fare zone"],
};

export interface ParseResult {
  ok: TflStation[];
  errors: { row: number; reason: string }[];
}

export function parseCsv(csv: string): ParseResult {
  // Strip BOM, normalise line endings
  const text = csv.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { ok: [], errors: [{ row: 0, reason: "Empty file" }] };

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  const columnIndex: Record<keyof typeof HEADER_ALIASES, number> = {
    station_name: -1,
    lat: -1,
    lng: -1,
    daily_entries: -1,
    daily_exits: -1,
    zone: -1,
  };
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
    columnIndex[key] = headers.findIndex((h) => aliases.includes(h));
  }

  const required: (keyof typeof HEADER_ALIASES)[] = ["station_name", "lat", "lng"];
  const missing = required.filter((k) => columnIndex[k] === -1);
  if (missing.length > 0) {
    return {
      ok: [],
      errors: [{
        row: 0,
        reason: `Missing required columns: ${missing.join(", ")}. Got headers: ${headers.join(", ")}.`,
      }],
    };
  }

  const ok: TflStation[] = [];
  const errors: ParseResult["errors"] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    try {
      const station_name = (row[columnIndex.station_name] ?? "").trim();
      const lat = Number((row[columnIndex.lat] ?? "").trim());
      const lng = Number((row[columnIndex.lng] ?? "").trim());

      if (!station_name) throw new Error("station_name is empty");
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("lat/lng not numeric");
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error("lat/lng out of range");

      const daily_entries =
        columnIndex.daily_entries >= 0
          ? Math.max(0, Number((row[columnIndex.daily_entries] ?? "0").replace(/,/g, "")) || 0)
          : 0;
      const daily_exits =
        columnIndex.daily_exits >= 0
          ? Math.max(0, Number((row[columnIndex.daily_exits] ?? "0").replace(/,/g, "")) || 0)
          : 0;
      const zone =
        columnIndex.zone >= 0 ? (row[columnIndex.zone] ?? "").trim() || undefined : undefined;

      ok.push({ station_name, lat, lng, daily_entries, daily_exits, zone });
    } catch (err) {
      errors.push({ row: i + 1, reason: (err as Error).message });
    }
  }

  return { ok, errors };
}

/** Parse a single CSV row supporting double-quoted fields with embedded commas. */
function parseRow(line: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          buf += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        buf += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}
