// ─────────────────────────────────────────────────────────────────────────────
// TfL footfall store — persists the user's uploaded station footfall dataset.
//
// V2 (2026-05-17): accepts TfL's official daily tap-count export directly.
// That format is one row per (Station, TravelDate) with EntryTapCount /
// ExitTapCount columns and NO coordinates. We:
//   1. Parse each row
//   2. Aggregate across dates → mean daily footfall per station
//   3. Look up lat/lng from a bundled TfL StopPoint JSON (461 stations)
//   4. Skip stations we can't resolve (logged so the user can investigate)
//
// We also still accept the legacy "lat,lng,daily_entries,daily_exits"
// per-station format for backwards compatibility.
//
// Stored as a parsed JSON file at ${DATA_DIR}/tfl-stations.json so we don't
// have to re-parse the CSV on every report request. Re-upload replaces.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DATA_DIR = process.env.DATA_DIR ?? "./data";
const FILE = path.join(DATA_DIR, "tfl-stations.json");

// Bundled lookup: normalized-station-name → { name, lat, lng }. Built once
// from TfL's public StopPoint API across tube/dlr/overground/elizabeth/tram
// modes, with a couple of manual overrides for National Rail stations that
// don't surface in that feed. Lives next to this file so it ships with the
// server bundle.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let coordsLookup: Record<string, { name: string; lat: number; lng: number }> | null = null;
function loadCoordsLookup() {
  if (coordsLookup !== null) return coordsLookup;
  try {
    const raw = fs.readFileSync(path.join(__dirname, "tfl-station-coords.json"), "utf8");
    coordsLookup = JSON.parse(raw);
  } catch (err) {
    console.warn("[tfl-store] coords lookup unreadable, station resolution disabled:", (err as Error).message);
    coordsLookup = {};
  }
  return coordsLookup!;
}

/**
 * Normalise a station name so user-typed variants ("Liverpool St NR",
 * "Liverpool Street", "St James Street", etc.) collide on the same key as
 * TfL's official commonName ("Liverpool Street Underground Station").
 * Mirrors the normaliser used when the lookup file was built — keep the two
 * in sync if you ever rebuild the coords file.
 */
function normaliseStationName(name: string): string {
  let s = String(name ?? "").toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");            // strip parens content
  s = s.replace(/['.]/g, "");                  // delete apostrophes/periods (no space)
  s = s.replace(/[&\-_/]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\b(underground|rail|dlr|overground|station|stations|elizabeth line|elizabeth|line)\b/g, " ");
  s = s.replace(/\b(nr|el|lo|sr|met|tfl|hex|c h|d p|ell|dist picc|berks|bucks|b)\b/g, " ");
  s = s.replace(/\bt(\d+)( (\d+))?/g, (_m, a, _b, c) => c ? `terminal ${a} ${c}` : `terminal ${a}`);
  s = s.replace(/\bterminals\b/g, "terminal");
  s = s.replace(/\bw\b/g, "west");
  s = s.replace(/\be\b/g, "east");
  s = s.replace(/\bn\b/g, "north");
  s = s.replace(/\brd\b/g, "road");
  s = s.replace(/\bst\b/g, "street");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

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
  rowCount: number;             // number of stations resolved to lat/lng
  uploadedAt: string;
  sourceFilename: string;
  /** Total rows read from the CSV before dedupe/aggregation (informational). */
  sourceRowCount?: number;
  /** Stations that had no coordinate match — surface to the user. */
  unmatchedStations?: string[];
  /** Range of footfall values in the dataset — quick sanity check on import */
  minFootfall: number;
  maxFootfall: number;
  /** Bounding box of stations — useful for diagnosing geographic mismatches */
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

export function replaceDataset(
  stations: TflStation[],
  sourceFilename: string,
  extras: { sourceRowCount?: number; unmatchedStations?: string[] } = {}
): TflDatasetMeta {
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
    sourceRowCount: extras.sourceRowCount,
    unmatchedStations: extras.unmatchedStations,
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
  daily_entries: ["daily_entries", "entries", "daily entries", "annual_entries", "entrytapcount"],
  daily_exits: ["daily_exits", "exits", "daily exits", "annual_exits", "exittapcount"],
  zone: ["zone", "fare_zone", "fare zone"],
};

export interface ParseResult {
  ok: TflStation[];
  errors: { row: number; reason: string }[];
  /** Rows we parsed before aggregation/dedupe — useful for "averaged from N rows" messaging. */
  sourceRowCount?: number;
  /** Stations the parser saw but couldn't match to coords (only set in tap-count mode). */
  unmatchedStations?: string[];
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

  // Detect which mode we're in:
  //   Mode A — legacy per-station with lat/lng baked in
  //   Mode B — TfL daily-tap-count export: rows like (Station, TravelDate, EntryTapCount, ExitTapCount).
  //           Resolve coords from the bundled lookup, aggregate to per-station mean.
  const hasCoords = columnIndex.lat !== -1 && columnIndex.lng !== -1;
  const hasStationName = columnIndex.station_name !== -1;
  const hasCountColumns = columnIndex.daily_entries !== -1 || columnIndex.daily_exits !== -1;

  if (!hasStationName) {
    return {
      ok: [],
      errors: [{
        row: 0,
        reason: `Missing station name column (looked for: ${HEADER_ALIASES.station_name.join(", ")}). Got headers: ${headers.join(", ")}.`,
      }],
    };
  }

  if (hasCoords) {
    return parseLegacyFormat(lines, columnIndex);
  }
  if (hasCountColumns) {
    return parseTapCountFormat(lines, columnIndex);
  }
  return {
    ok: [],
    errors: [{
      row: 0,
      reason: `Need either lat/lng columns OR entry/exit count columns. Got headers: ${headers.join(", ")}.`,
    }],
  };
}

/** Legacy parser: one row per station, lat/lng provided in the CSV itself. */
function parseLegacyFormat(
  lines: string[],
  columnIndex: Record<keyof typeof HEADER_ALIASES, number>
): ParseResult {
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

/**
 * TfL tap-count parser: rows like (TravelDate, Station, EntryTapCount, ExitTapCount).
 * Aggregates to per-station mean daily totals, then joins to bundled coords.
 */
function parseTapCountFormat(
  lines: string[],
  columnIndex: Record<keyof typeof HEADER_ALIASES, number>
): ParseResult {
  const lookup = loadCoordsLookup();
  const agg = new Map<string, { name: string; entries: number; exits: number; rows: number }>();
  const errors: ParseResult["errors"] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    const station_name = (row[columnIndex.station_name] ?? "").trim();
    if (!station_name) {
      errors.push({ row: i + 1, reason: "station_name empty" });
      continue;
    }
    const entries =
      columnIndex.daily_entries >= 0
        ? Math.max(0, Number((row[columnIndex.daily_entries] ?? "0").replace(/,/g, "")) || 0)
        : 0;
    const exits =
      columnIndex.daily_exits >= 0
        ? Math.max(0, Number((row[columnIndex.daily_exits] ?? "0").replace(/,/g, "")) || 0)
        : 0;
    const cur = agg.get(station_name) ?? { name: station_name, entries: 0, exits: 0, rows: 0 };
    cur.entries += entries;
    cur.exits += exits;
    cur.rows += 1;
    agg.set(station_name, cur);
  }

  const ok: TflStation[] = [];
  const unmatched: string[] = [];
  for (const [name, a] of Array.from(agg)) {
    const key = normaliseStationName(name);
    const coords = lookup[key];
    if (!coords) {
      unmatched.push(name);
      continue;
    }
    ok.push({
      station_name: name,
      lat: coords.lat,
      lng: coords.lng,
      daily_entries: Math.round(a.entries / a.rows),
      daily_exits: Math.round(a.exits / a.rows),
    });
  }

  return { ok, errors, sourceRowCount: lines.length - 1, unmatchedStations: unmatched };
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
