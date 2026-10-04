// Core routes: fleet, bags, routes/days, commands, zones (read), settings,
// search and system status. Everything is served from PocketBase.

import express, { type Router } from "express";
import { z } from "zod";
import {
  addDays,
  BAG_LIFECYCLE_LABEL,
  bagStatus,
  isDay,
  londonDayBounds,
  RIDER_STAGE_LABEL,
  todayLondon,
  type BagDetail,
  type BagStatus,
  type LiveResponse,
  type SearchResult,
} from "@digilite/shared";
import { config } from "../config";
import { audit } from "../domain/audit";
import { stintsForBag, currentRiderByBag } from "../domain/assignments";
import { bagById, fleetContext, invalidateBags, loadBags, toBagSummary } from "../domain/bags";
import { recentCommands, runBagCommand } from "../domain/commands";
import { fleetOverview, liveBags } from "../domain/fleet";
import { getSettings, updateSettings } from "../domain/settings";
import { bagDays, buildRoute, lastActiveDay, toBagDayDto } from "../domain/tracks";
import { listZones } from "../domain/zones";
import { getAll, getFirst, pb, parsePbDate, q, type RecordModel } from "../pb";
import { health } from "../jobs/state";
import { pipeFile } from "./files";
import { badRequest, need, notFound, param, parse, user } from "./http";
import { liveStream } from "./live";

const statuses = z
  .string()
  .optional()
  .transform((s) => (s ? (s.split(",").filter((x) => ["now", "day", "idle", "gone"].includes(x)) as BagStatus[]) : undefined));

async function requireBag(id: string): Promise<RecordModel> {
  const bag = await bagById(id);
  if (!bag) throw notFound("Bag not found");
  return bag;
}

function rangeFromQuery(query: Record<string, unknown>): { from: Date; to: Date; day: string | null } {
  if (isDay(query.day)) {
    const [from, to] = londonDayBounds(query.day);
    return { from, to, day: query.day };
  }
  const fromDay = isDay(query.fromDay) ? query.fromDay : null;
  const toDay = isDay(query.toDay) ? query.toDay : null;
  if (fromDay && toDay) {
    if (toDay < fromDay) throw badRequest("The end date is before the start date");
    if (addDays(fromDay, 31) < toDay) throw badRequest("Pick 31 days or fewer");
    return { from: londonDayBounds(fromDay)[0], to: londonDayBounds(toDay)[1], day: fromDay === toDay ? fromDay : null };
  }
  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
    if (to.getTime() - from.getTime() > 31 * 86400000) throw badRequest("Pick 31 days or fewer");
    return { from, to, day: null };
  }
  const today = todayLondon();
  const [s, e] = londonDayBounds(today);
  return { from: s, to: e, day: today };
}

export function coreRouter(): Router {
  const r = express.Router();

  // ── Fleet ──────────────────────────────────────────────────────────────────
  r.get("/fleet", need("fleet.view"), async (_req, res) => {
    res.json(await fleetOverview());
  });

  r.get("/fleet/live", need("fleet.view"), async (req, res) => {
    const s = statuses.parse(req.query.statuses);
    const body: LiveResponse = { asOf: new Date().toISOString(), bags: await liveBags({ statuses: s }) };
    res.json(body);
  });

  r.get("/live", need("fleet.view"), liveStream);

  // ── Bags ───────────────────────────────────────────────────────────────────
  r.get("/bags", need("fleet.view"), async (_req, res) => {
    const bags = await loadBags();
    const ctx = await fleetContext(bags);
    res.json(bags.map((b) => toBagSummary(b, ctx)));
  });

  r.get("/bags/:id", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    const ctx = await fleetContext();
    const shot = await getFirst<RecordModel>("screenshots", `bag = ${q(bag.id)}`, { sort: "-taken_at" });
    const status = (bag.device_status ?? {}) as Record<string, { data?: { networktype?: string } } | undefined>;
    const detail: BagDetail = {
      ...toBagSummary(bag, ctx),
      colorlightName: bag.colorlight_name,
      lifecycleNote: bag.lifecycle_note || "",
      device: {
        model: bag.model || null,
        serial: bag.serial || null,
        resolution: bag.width && bag.height ? `${bag.width} × ${bag.height}` : null,
        firmware: bag.firmware || null,
        latestFirmware: ctx.latestFirmware,
        storageUsedPct: bag.storage_used_pct ?? null,
        powerOn: bag.power_on ?? null,
        // Colorlight's own "connected" flag stays on for bags that have been off for months.
        connected: bagStatus(parsePbDate(bag.last_report_at)) === "now",
        network: (status["4ginfo"] as { networktype?: string } | undefined)?.networktype ?? null,
        gpsIntervalS: bag.gps_interval_s ?? null,
        brightnessRaw: bag.brightness_raw ?? null,
        downloadedPrograms: ((bag.downloaded_programs ?? []) as { name: string }[]).map((p) => p.name),
      },
      stints: await stintsForBag(bag.id),
      screenshot: shot
        ? { takenAt: parsePbDate(shot.taken_at)!.toISOString(), url: `/api/bags/${bag.id}/screenshot?v=${shot.id}` }
        : null,
      commands: await recentCommands(bag.id),
      deviceSchedule: bag.device_schedule ?? null,
      lastActiveDay: await lastActiveDay(bag.id),
    };
    res.json(detail);
  });

  const bagPatch = z.object({
    lifecycle: z.enum(["active", "storage", "repair", "lost", "retired"]).optional(),
    lifecycleNote: z.string().max(500).optional(),
  });
  r.patch("/bags/:id", need("bags.edit"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    const body = parse(bagPatch, req.body);
    await pb.collection("bags").update(bag.id, {
      ...(body.lifecycle ? { lifecycle: body.lifecycle } : {}),
      ...(body.lifecycleNote !== undefined ? { lifecycle_note: body.lifecycleNote } : {}),
    });
    invalidateBags();
    if (body.lifecycle && body.lifecycle !== bag.lifecycle) {
      const label = BAG_LIFECYCLE_LABEL[body.lifecycle].toLowerCase();
      await audit(user(req), "bag.lifecycle", `${bag.name} marked as ${label}`, { type: "bag", id: bag.id });
    }
    const ctx = await fleetContext();
    res.json(toBagSummary((await bagById(bag.id))!, ctx));
  });

  r.get("/bags/:id/route", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    const { from, to, day } = rangeFromQuery(req.query as Record<string, unknown>);
    res.json(await buildRoute(bag, from, to, day));
  });

  /** The bag's most recent day out (what the map shows when you pick a bag). */
  r.get("/bags/:id/last-route", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    const day = (await lastActiveDay(bag.id)) ?? todayLondon();
    const [from, to] = londonDayBounds(day);
    res.json(await buildRoute(bag, from, to, day));
  });

  r.get("/bags/:id/days", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    const toDay = isDay(req.query.toDay) ? req.query.toDay : todayLondon();
    const fromDay = isDay(req.query.fromDay) ? req.query.fromDay : addDays(toDay, -13);
    const rows = await bagDays([bag.id], fromDay, toDay);
    res.json(await Promise.all(rows.map((row) => toBagDayDto(row, bag.name))));
  });

  r.get("/bags/:id/commands", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    res.json(await recentCommands(bag.id, 30));
  });

  const commandSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("brightness"), value: z.number().min(1).max(100) }),
    z.object({ type: z.literal("reboot") }),
    z.object({ type: z.literal("screenshot") }),
    z.object({ type: z.literal("sleep") }),
    z.object({ type: z.literal("wakeup") }),
  ]);
  r.post("/bags/:id/commands", need("bags.control"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    res.json(await runBagCommand(bag, parse(commandSchema, req.body), user(req)));
  });

  r.get("/bags/:id/screenshot", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "id"));
    const shot = await getFirst<RecordModel>("screenshots", `bag = ${q(bag.id)}`, { sort: "-taken_at" });
    if (!shot) throw notFound("No screenshot yet");
    await pipeFile(res, "screenshots", shot.id, shot.file, { cacheSeconds: 3600 });
  });

  // ── Zones (read; editing lives in the zones area) ──────────────────────────
  r.get("/zones", need("fleet.view"), async (_req, res) => {
    res.json(await listZones({ fresh: true }));
  });

  // ── Settings ───────────────────────────────────────────────────────────────
  r.get("/settings", need("settings.view"), async (_req, res) => {
    res.json({ ...(await getSettings()), writeMode: config.COLORLIGHT_WRITES, testBagColorlightIds: config.testBagIds });
  });

  const settingsPatch = z
    .object({
      fleetWritesEnabled: z.boolean(),
      fleetLoopName: z.string().max(200),
      brightnessTargetPct: z.number().min(5).max(100),
      brightnessCommandScale: z.union([z.literal(100), z.literal(255)]),
      shiftBreakMin: z.number().min(10).max(240),
      signalGapMin: z.number().min(1).max(60),
      stopRadiusM: z.number().min(10).max(500),
      stopMin: z.number().min(1).max(120),
      payRate: z.string().max(60),
      payMinHours: z.number().min(0).max(200),
      paySignalGaps: z.boolean(),
    })
    .partial();
  r.patch("/settings", need("settings.edit"), async (req, res) => {
    const body = parse(settingsPatch, req.body);
    const before = await getSettings();
    const after = await updateSettings(body);
    const changes = Object.keys(body)
      .filter((k) => JSON.stringify((before as never)[k]) !== JSON.stringify((after as never)[k]))
      .map((k) => `${k}: ${JSON.stringify((before as never)[k])} → ${JSON.stringify((after as never)[k])}`);
    if (changes.length) {
      await audit(
        user(req),
        body.fleetWritesEnabled !== undefined && before.fleetWritesEnabled !== after.fleetWritesEnabled
          ? "settings.fleet_writes"
          : "settings.update",
        body.fleetWritesEnabled !== undefined && before.fleetWritesEnabled !== after.fleetWritesEnabled
          ? `Changes to the whole fleet switched ${after.fleetWritesEnabled ? "ON" : "off"}`
          : `Settings changed (${changes.length})`,
        { type: "settings", id: "main" },
        { changes },
      );
    }
    res.json({ ...after, writeMode: config.COLORLIGHT_WRITES, testBagColorlightIds: config.testBagIds });
  });

  // ── Search (⌘K) ────────────────────────────────────────────────────────────
  r.get("/search", need("fleet.view"), async (req, res) => {
    const term = String(req.query.q ?? "").trim().toLowerCase();
    if (!term) return void res.json([]);
    const out: SearchResult[] = [];
    const riders = await currentRiderByBag();
    for (const b of await loadBags()) {
      const rider = riders.get(b.id);
      const hay = `${b.name} ${b.colorlight_name} ${b.colorlight_id} ${rider?.name ?? ""}`.toLowerCase();
      if (hay.includes(term)) {
        out.push({ kind: "bag", id: b.id, label: b.name, sublabel: rider ? `Carried by ${rider.name}` : "No rider", href: `/map?bag=${b.id}` });
      }
    }
    for (const rd of await getAll<RecordModel>("riders", { fields: "id,name,stage" })) {
      if (String(rd.name).toLowerCase().includes(term)) {
        const stage = RIDER_STAGE_LABEL[rd.stage as keyof typeof RIDER_STAGE_LABEL] ?? rd.stage;
        out.push({ kind: "rider", id: rd.id, label: rd.name, sublabel: `Rider · ${stage}`, href: `/riders/${rd.id}` });
      }
    }
    for (const z of await listZones()) {
      if (z.name.toLowerCase().includes(term)) out.push({ kind: "zone", id: z.id, label: z.name, sublabel: "Zone", href: `/zones?zone=${z.id}` });
    }
    res.json(out.slice(0, 12));
  });

  // ── System ─────────────────────────────────────────────────────────────────
  r.get("/system", need("fleet.view"), async (_req, res) => {
    res.json({ sync: health, writeMode: config.COLORLIGHT_WRITES, testBagColorlightIds: config.testBagIds, version: "0.1.0" });
  });

  return r;
}
