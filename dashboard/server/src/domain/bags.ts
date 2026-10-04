// Bag records → API shapes, including the per-bag issue checks.

import {
  bagStatus,
  brightnessPct,
  clockMatchesLondon,
  compareVersions,
  describeTz,
  programNameFromVsn,
  type BagIssue,
  type BagRiderRef,
  type BagSummary,
  type SettingsDto,
} from "@digilite/shared";
import { config } from "../config";
import { getAll, parsePbDate, type RecordModel } from "../pb";
import { currentRiderByBag } from "./assignments";
import { getSettings } from "./settings";

let cache: { at: number; rows: RecordModel[] } | null = null;

export async function loadBags(opts: { fresh?: boolean } = {}): Promise<RecordModel[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < 5000) return cache.rows;
  const rows = await getAll<RecordModel>("bags", { sort: "name" });
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateBags() {
  cache = null;
}

export async function bagById(id: string): Promise<RecordModel | null> {
  return (await loadBags()).find((b) => b.id === id) ?? null;
}

export async function bagByColorlightId(cid: number): Promise<RecordModel | null> {
  return (await loadBags()).find((b) => b.colorlight_id === cid) ?? null;
}

export interface FleetContext {
  now: Date;
  settings: SettingsDto;
  riders: Map<string, BagRiderRef>;
  latestFirmware: string | null;
  /** The fleet loop's current Colorlight file, when exactly one loop has the fleet loop's name. */
  fleetLoopVsn?: string | null;
}

let loopFilesCache: { at: number; rows: RecordModel[] } | null = null;

async function loopFiles(): Promise<RecordModel[]> {
  if (loopFilesCache && Date.now() - loopFilesCache.at < 60000) return loopFilesCache.rows;
  const rows = await getAll<RecordModel>("loops", {
    filter: 'status != "archived"',
    fields: "id,name,colorlight_program_name,colorlight_vsn",
  });
  loopFilesCache = { at: Date.now(), rows };
  return rows;
}

async function fleetLoopVsn(settings: SettingsDto): Promise<string | null> {
  const name = settings.fleetLoopName.trim().toLowerCase();
  if (!name) return null;
  const named = (await loopFiles()).filter((l) => String(l.colorlight_program_name || l.name).trim().toLowerCase() === name);
  return named.length === 1 ? named[0].colorlight_vsn || null : null;
}

export async function fleetContext(bags?: RecordModel[]): Promise<FleetContext> {
  const rows = bags ?? (await loadBags());
  let latest: string | null = null;
  for (const b of rows) if (b.firmware && (!latest || compareVersions(b.firmware, latest) > 0)) latest = b.firmware;
  const settings = await getSettings();
  return {
    now: new Date(),
    settings,
    riders: await currentRiderByBag(),
    latestFirmware: latest,
    fleetLoopVsn: await fleetLoopVsn(settings),
  };
}

export function isTestBag(b: RecordModel): boolean {
  return config.testBagIds.includes(b.colorlight_id);
}

export function bagIssues(b: RecordModel, ctx: FleetContext): BagIssue[] {
  const issues: BagIssue[] = [];
  const status = bagStatus(parsePbDate(b.last_report_at), ctx.now.getTime());
  const lifecycle = b.lifecycle || "active";
  const test = isTestBag(b);
  if (status === "gone" && lifecycle === "active") {
    const days = b.last_report_at ? Math.floor((ctx.now.getTime() - parsePbDate(b.last_report_at)!.getTime()) / 86400000) : null;
    issues.push({ kind: "not_seen", label: days != null ? `Not seen for ${days} days` : "Never seen" });
  }
  const clockOk = clockMatchesLondon(b.timezone, ctx.now);
  if (clockOk === false) issues.push({ kind: "clock", label: `Clock set to ${describeTz(b.timezone)}` });
  const playing = b.playing_program || programNameFromVsn(b.playing_vsn);
  if (!test && playing && ctx.settings.fleetLoopName) {
    if (playing !== ctx.settings.fleetLoopName) {
      issues.push({ kind: "old_loop", label: `Playing "${playing}"` });
    } else if (ctx.fleetLoopVsn && b.playing_vsn && b.playing_vsn !== ctx.fleetLoopVsn) {
      issues.push({ kind: "old_loop", label: `Playing an older copy of "${playing}"` });
    }
  }
  const pct = brightnessPct(b.brightness_raw);
  if (!test && pct != null && Math.abs(pct - ctx.settings.brightnessTargetPct) > 8) {
    issues.push({ kind: "brightness", label: `Brightness ${pct}% (fleet ${ctx.settings.brightnessTargetPct}%)` });
  }
  if (b.firmware && ctx.latestFirmware && compareVersions(b.firmware, ctx.latestFirmware) < 0) {
    issues.push({ kind: "software", label: `Software ${b.firmware}` });
  }
  if (!test && (status === "now" || status === "day") && !ctx.riders.get(b.id)) {
    issues.push({ kind: "no_rider", label: "Out without a rider" });
  }
  return issues;
}

export function toBagSummary(b: RecordModel, ctx: FleetContext): BagSummary {
  const lastReport = parsePbDate(b.last_report_at);
  return {
    id: b.id,
    colorlightId: b.colorlight_id,
    name: b.name,
    status: bagStatus(lastReport, ctx.now.getTime()),
    lifecycle: b.lifecycle || "active",
    isTestBag: isTestBag(b),
    lastReportAt: lastReport ? lastReport.toISOString() : null,
    lastGpsAt: parsePbDate(b.last_gps_at)?.toISOString() ?? null,
    position: b.lat != null && b.lng != null && (b.lat !== 0 || b.lng !== 0) ? { lat: b.lat, lng: b.lng } : null,
    speed: b.speed ?? null,
    heading: b.heading ?? null,
    rider: ctx.riders.get(b.id) ?? null,
    playing: b.playing_program || programNameFromVsn(b.playing_vsn),
    brightnessPct: brightnessPct(b.brightness_raw),
    firmware: b.firmware || null,
    clock: { tz: b.timezone || null, label: describeTz(b.timezone), ok: clockMatchesLondon(b.timezone, ctx.now) },
    issues: bagIssues(b, ctx),
  };
}

export async function bagSummaries(): Promise<BagSummary[]> {
  const bags = await loadBags();
  const ctx = await fleetContext(bags);
  return bags.map((b) => toBagSummary(b, ctx));
}
