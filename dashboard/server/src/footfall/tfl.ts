// TfL station footfall: how many people tapped in and out of each Tube, DLR,
// Overground and Elizabeth line station, day by day, from TfL's open data
// ("Network Demand/StationFootfall_*.csv" on crowding.data.tfl.gov.uk). It's the
// basis of the estimated impressions (shared/src/impressions.ts).
//
// Kept in PocketBase (`tfl_footfall`, one row per station, every day TfL has
// published) and refreshed weekly: TfL adds the latest week every week or so.
// Days already held are never thrown away. Station names are matched to
// locations with the bundled TfL StopPoint list (station-coords.json).

import type { FootfallStation } from "@digilite/shared";
import { logger } from "../log";
import { getState, setState } from "../jobs/state";
import { getAll, pb, type RecordModel } from "../pb";
import coords from "./station-coords.json" with { type: "json" };

const log = logger("tfl");
const BUCKET = "https://s3-eu-west-1.amazonaws.com/crowding.data.tfl.gov.uk";
const STATE_KEY = "tfl:footfall";

const lookup = coords as Record<string, { name: string; lat: number; lng: number }>;

/** "Liverpool Street NR", "Liverpool St (Elizabeth line)" … → the key in station-coords.json. */
export function stationKey(name: string): string {
  let s = String(name ?? "").toLowerCase();
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/['.]/g, "");
  s = s.replace(/[&\-_/]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/\b(underground|rail|dlr|overground|station|stations|elizabeth line|elizabeth|line)\b/g, " ");
  s = s.replace(/\b(nr|el|lo|sr|met|tfl|hex|c h|d p|ell|dist picc|berks|bucks|b)\b/g, " ");
  s = s.replace(/\bt(\d+)( (\d+))?/g, (_m, a, _b, c) => (c ? `terminal ${a} ${c}` : `terminal ${a}`));
  s = s.replace(/\bterminals\b/g, "terminal");
  s = s.replace(/\bw\b/g, "west");
  s = s.replace(/\be\b/g, "east");
  s = s.replace(/\bn\b/g, "north");
  s = s.replace(/\brd\b/g, "road");
  s = s.replace(/\bst\b/g, "street");
  return s.replace(/\s+/g, " ").trim();
}

/** "Liverpool Street Underground Station" → "Liverpool Street" */
const displayName = (n: string) => n.replace(/\s+(Underground|DLR|Rail|Overground|Elizabeth line)?\s*Station$/i, "").replace(/\s+(Underground|DLR)$/i, "").trim();

// ── Reading ───────────────────────────────────────────────────────────────────

let cache: { at: number; stations: FootfallStation[]; latestDay: string | null } | null = null;

/** Every station with its daily taps (entries + exits), cached for 10 minutes. */
export async function footfall(): Promise<{ stations: FootfallStation[]; latestDay: string | null }> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
  const rows = await getAll<RecordModel>("tfl_footfall", { fields: "key,name,lat,lng,days" }).catch(() => []);
  let latestDay: string | null = null;
  const stations = rows.map((r) => {
    const days = (r.days ?? {}) as Record<string, [number, number]>;
    const taps: Record<string, number> = {};
    for (const [day, [entries, exits]] of Object.entries(days)) {
      taps[day] = (entries || 0) + (exits || 0);
      if (!latestDay || day > latestDay) latestDay = day;
    }
    return { key: r.key, name: r.name, lat: r.lat, lng: r.lng, taps };
  });
  cache = { at: Date.now(), stations, latestDay };
  return cache;
}

// ── Refreshing from TfL ───────────────────────────────────────────────────────

/** The most recently updated StationFootfall file in TfL's bucket. */
async function latestFile(): Promise<string> {
  const res = await fetch(`${BUCKET}/?list-type=2&prefix=${encodeURIComponent("Network Demand/StationFootfall")}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`TfL's file list answered ${res.status}`);
  const xml = await res.text();
  const files = [...xml.matchAll(/<Key>([^<]+)<\/Key>\s*<LastModified>([^<]+)<\/LastModified>/g)].map((m) => ({ key: m[1], modified: m[2] }));
  const csv = files.filter((f) => f.key.toLowerCase().endsWith(".csv")).sort((a, b) => b.modified.localeCompare(a.modified))[0];
  if (!csv) throw new Error("no StationFootfall file in TfL's bucket");
  return csv.key;
}

/** Fetch TfL's latest footfall file and merge it into what we hold. Returns the days now held up to. */
export async function refreshFootfall(): Promise<{ stations: number; latestDay: string | null; unmatched: string[] }> {
  const key = await latestFile();
  const res = await fetch(`${BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`TfL's footfall file answered ${res.status}`);
  const text = await res.text();

  // station key → day → [entries, exits], summing the lines of one station (e.g. "Woolwich Arsenal NR" + "… DLR").
  const parsed = new Map<string, Map<string, [number, number]>>();
  const unmatched = new Set<string>();
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [cDate, cStation, cIn, cOut] = [col("traveldate"), col("station"), col("entrytapcount"), col("exittapcount")];
  if ([cDate, cStation, cIn, cOut].some((c) => c < 0)) throw new Error("TfL's footfall file has unexpected columns");
  for (const line of lines.slice(1)) {
    const p = line.split(",");
    if (p.length <= Math.max(cDate, cStation, cIn, cOut)) continue;
    const d = p[cDate].trim();
    if (!/^\d{8}$/.test(d)) continue;
    const k = stationKey(p[cStation]);
    if (!lookup[k]) {
      unmatched.add(p[cStation].trim());
      continue;
    }
    const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const days = parsed.get(k) ?? new Map<string, [number, number]>();
    const cur = days.get(day) ?? [0, 0];
    days.set(day, [cur[0] + (Number(p[cIn]) || 0), cur[1] + (Number(p[cOut]) || 0)]);
    parsed.set(k, days);
  }

  const existing = new Map((await getAll<RecordModel>("tfl_footfall", { fields: "id,key,days" })).map((r) => [r.key as string, r]));
  let latestDay: string | null = null;
  for (const [k, days] of parsed) {
    const row = existing.get(k);
    const merged = { ...((row?.days ?? {}) as Record<string, [number, number]>), ...Object.fromEntries(days) };
    for (const day of Object.keys(merged)) if (!latestDay || day > latestDay) latestDay = day;
    const at = lookup[k];
    const body = { key: k, name: displayName(at.name), lat: at.lat, lng: at.lng, days: merged };
    if (row) await pb.collection("tfl_footfall").update(row.id, body);
    else await pb.collection("tfl_footfall").create(body);
  }
  cache = null;
  if (unmatched.size) log.warn(`${unmatched.size} station name(s) in TfL's file have no known location: ${[...unmatched].slice(0, 5).join(", ")}`);
  log.info(`TfL footfall: ${parsed.size} stations, up to ${latestDay} (${key})`);
  return { stations: parsed.size, latestDay, unmatched: [...unmatched] };
}

/** Refresh at start if it's been a week, then every day check whether a week has passed. */
export function startFootfallRefresh() {
  const due = async () => {
    try {
      const last = await getState<{ at: number }>(STATE_KEY);
      if (last && Date.now() - last.at < 7 * 86400_000) return;
      const r = await refreshFootfall();
      await setState(STATE_KEY, { at: Date.now(), latestDay: r.latestDay });
    } catch (err) {
      log.warn(`couldn't refresh TfL footfall: ${(err as Error).message}`);
    }
  };
  setTimeout(due, 20_000);
  setInterval(due, 24 * 3600_000);
}
