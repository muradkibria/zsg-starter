// zones area routes (mounted under /api). Owned by the zones feature.
//
//   POST   /zones                 add a zone                         zones.edit
//   PATCH  /zones/:id             rename / retype / reshape          zones.edit
//   DELETE /zones/:id             delete                             zones.edit
//   GET    /zones/stats           time in each zone for a period    fleet.view
//   POST   /zones/preview         what a shape would have recorded   zones.edit
//   GET    /zones/heat            where bags spent time (14 days)    fleet.view
//   GET    /settings/recompute    progress of a recompute            settings.view
//   POST   /settings/recompute    recompute the last N days          settings.edit
//   GET    /settings/fleet-loop-options  loops to pick the fleet loop from   settings.view
//
// Any change to a zone's shape (or adding / deleting one) recomputes zone time
// for the last 14 days of every bag, so stats, routes and reports agree.

import express, { type Router } from "express";
import { z } from "zod";
import {
  addDays,
  describeZoneShape,
  isDay,
  programNameFromVsn,
  ringCentroid,
  todayLondon,
  validateZoneName,
  validateZoneShape,
  ZONE_PREVIEW_DAYS,
  ZONE_STATS_MAX_DAYS,
  ZONE_TYPE_LABEL,
  type FleetLoopOption,
  type ZoneDto,
} from "@digilite/shared";
import { audit } from "../../domain/audit";
import { loadBags } from "../../domain/bags";
import { invalidateZones, listZones, toZoneDto } from "../../domain/zones";
import {
  invalidatePreviewCache,
  previewZone,
  recomputeRecent,
  recomputeStatus,
  sameShape,
  shapeFields,
  shapeOf,
  zoneHeat,
  zoneStats,
} from "../../domain/zones-extra";
import { getAll, getOneOrNull, pb, type RecordModel } from "../../pb";
import { badRequest, need, notFound, param, parse, user } from "../http";

/** A saved change recomputes the same days a preview measures. */
const RECOMPUTE_DAYS = ZONE_PREVIEW_DAYS;

const zoneType = z.enum(["neighbourhood", "high_street", "station", "other"]);
const shapeFieldsSchema = {
  kind: z.enum(["circle", "polygon"]),
  centerLat: z.number().nullable().optional(),
  centerLng: z.number().nullable().optional(),
  radiusM: z.number().nullable().optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])).max(1000).nullable().optional(),
};
const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  type: zoneType,
  active: z.boolean().optional(),
  ...shapeFieldsSchema,
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: zoneType.optional(),
  active: z.boolean().optional(),
  kind: shapeFieldsSchema.kind.optional(),
  centerLat: shapeFieldsSchema.centerLat,
  centerLng: shapeFieldsSchema.centerLng,
  radiusM: shapeFieldsSchema.radiusM,
  polygon: shapeFieldsSchema.polygon,
});
const previewSchema = z.object({
  zoneId: z.string().max(40).nullable().optional(),
  shape: z.object(shapeFieldsSchema),
});

function checkShape(input: z.infer<typeof previewSchema>["shape"]) {
  const check = validateZoneShape(input);
  if (!check.ok) throw badRequest(check.error);
  return check.shape;
}

async function requireZone(id: string): Promise<ZoneDto> {
  const rec = await getOneOrNull<RecordModel>("zones", id);
  if (!rec) throw notFound("Zone not found");
  return toZoneDto(rec);
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const n = name.trim().toLowerCase();
  return (await listZones({ fresh: true })).some((z) => z.id !== exceptId && z.name.trim().toLowerCase() === n);
}

function radiusText(m: number | null) {
  return m == null ? "—" : `${Math.round(m).toLocaleString("en-GB")} m`;
}

function dayRange(query: Record<string, unknown>): { fromDay: string; toDay: string } {
  const yesterday = addDays(todayLondon(), -1);
  const toDay = isDay(query.toDay) ? query.toDay : yesterday;
  const fromDay = isDay(query.fromDay) ? query.fromDay : toDay;
  if (toDay < fromDay) throw badRequest("The end date is before the start date");
  if (toDay > todayLondon()) throw badRequest("Pick days up to today");
  if (addDays(fromDay, ZONE_STATS_MAX_DAYS - 1) < toDay) throw badRequest(`Pick ${ZONE_STATS_MAX_DAYS} days or fewer`);
  return { fromDay, toDay };
}

export function zonesRouter(): Router {
  const r = express.Router();

  // ── Stats, preview, heat ───────────────────────────────────────────────────
  r.get("/zones/stats", need("fleet.view"), async (req, res) => {
    const { fromDay, toDay } = dayRange(req.query as Record<string, unknown>);
    res.json(await zoneStats(fromDay, toDay));
  });

  r.post("/zones/preview", need("zones.edit"), async (req, res) => {
    const body = parse(previewSchema, req.body);
    res.json(await previewZone(body.zoneId ?? null, checkShape(body.shape)));
  });

  r.get("/zones/heat", need("fleet.view"), async (_req, res) => {
    res.json(await zoneHeat());
  });

  // ── Add / change / delete ──────────────────────────────────────────────────
  r.post("/zones", need("zones.edit"), async (req, res) => {
    const nameError = validateZoneName(req.body?.name);
    if (nameError) throw badRequest(nameError);
    const body = parse(createSchema, req.body);
    const shape = checkShape(body);
    if (await nameTaken(body.name)) throw badRequest("There's already a zone with that name");
    const zones = await listZones({ fresh: true });
    const sort = zones.reduce((m, z) => Math.max(m, z.sort), -1) + 1;
    const rec = await pb.collection("zones").create<RecordModel>({
      name: body.name.trim(),
      type: body.type,
      active: body.active ?? true,
      sort,
      ...shapeFields(shape, shape.polygon ? ringCentroid(shape.polygon) : undefined),
    });
    invalidateZones();
    const dto = toZoneDto(rec);
    await audit(user(req), "zone.create", `Added zone ${dto.name} (${describeZoneShape(shape)})`, { type: "zone", id: dto.id });
    if (dto.active) await recomputeRecent(RECOMPUTE_DAYS, `Zone "${dto.name}" added`);
    res.status(201).json(dto);
  });

  r.patch("/zones/:id", need("zones.edit"), async (req, res) => {
    const before = await requireZone(param(req, "id"));
    if (req.body?.name !== undefined) {
      const nameError = validateZoneName(req.body.name);
      if (nameError) throw badRequest(nameError);
    }
    const body = parse(patchSchema, req.body);
    const update: Record<string, unknown> = {};
    const changes: string[] = [];

    if (body.name !== undefined && body.name.trim() !== before.name) {
      if (await nameTaken(body.name, before.id)) throw badRequest("There's already a zone with that name");
      update.name = body.name.trim();
      changes.push(`renamed from "${before.name}"`);
    }
    if (body.type !== undefined && body.type !== before.type) {
      update.type = body.type;
      changes.push(`type ${ZONE_TYPE_LABEL[before.type]} → ${ZONE_TYPE_LABEL[body.type]}`);
    }
    let reshaped = false;
    const touchesShape = ["kind", "centerLat", "centerLng", "radiusM", "polygon"].some((k) => (body as Record<string, unknown>)[k] !== undefined);
    if (touchesShape) {
      const kind = body.kind ?? before.kind;
      const same = kind === before.kind;
      const next = checkShape({
        kind,
        centerLat: body.centerLat !== undefined ? body.centerLat : same ? before.centerLat : null,
        centerLng: body.centerLng !== undefined ? body.centerLng : same ? before.centerLng : null,
        radiusM: body.radiusM !== undefined ? body.radiusM : same ? before.radiusM : null,
        polygon: body.polygon !== undefined ? body.polygon : same ? before.polygon : null,
      });
      const prev = shapeOf(before);
      if (!sameShape(prev, next)) {
        Object.assign(update, shapeFields(next, next.polygon ? ringCentroid(next.polygon) : undefined));
        reshaped = true;
        if (prev.kind === "circle" && next.kind === "circle") {
          const moved = prev.centerLat !== next.centerLat || prev.centerLng !== next.centerLng;
          const resized = prev.radiusM !== next.radiusM;
          changes.push(
            [moved && "moved", resized && `radius ${radiusText(prev.radiusM)} → ${radiusText(next.radiusM)}`].filter(Boolean).join(", "),
          );
        } else if (prev.kind !== next.kind) {
          changes.push(`${describeZoneShape(prev).toLowerCase()} → ${describeZoneShape(next).toLowerCase()}`);
        } else {
          changes.push(`outline redrawn (${describeZoneShape(next).replace("Outline · ", "")})`);
        }
      }
    }
    const activeChanged = body.active !== undefined && body.active !== before.active;
    if (activeChanged) {
      update.active = body.active;
      changes.push(body.active ? "counting again" : "no longer counted");
    }

    if (!Object.keys(update).length) return void res.json(before);
    const rec = await pb.collection("zones").update<RecordModel>(before.id, update);
    invalidateZones();
    const after = toZoneDto(rec);
    await audit(user(req), "zone.update", `Changed zone ${after.name}: ${changes.join("; ")}`, { type: "zone", id: after.id });
    // Renaming or retyping doesn't change any times; reshaping does.
    if (reshaped || activeChanged) await recomputeRecent(RECOMPUTE_DAYS, `Zone "${after.name}" changed`);
    res.json(after);
  });

  r.delete("/zones/:id", need("zones.edit"), async (req, res) => {
    const zone = await requireZone(param(req, "id"));
    await pb.collection("zones").delete(zone.id);
    invalidateZones();
    await audit(user(req), "zone.delete", `Deleted zone ${zone.name}`, { type: "zone", id: zone.id });
    if (zone.active) await recomputeRecent(RECOMPUTE_DAYS, `Zone "${zone.name}" deleted`);
    res.json({ ok: true });
  });

  // ── Settings helpers ───────────────────────────────────────────────────────
  r.get("/settings/recompute", need("settings.view"), (_req, res) => {
    res.json(recomputeStatus());
  });

  const recomputeSchema = z.object({ days: z.number().int().min(1).max(31) });
  r.post("/settings/recompute", need("settings.edit"), async (req, res) => {
    const { days } = parse(recomputeSchema, req.body);
    const span = days === 1 ? "today" : `the last ${days} days`;
    invalidatePreviewCache();
    const status = await recomputeRecent(days, `Recompute of ${span}`);
    await audit(
      user(req),
      "settings.recompute",
      `Asked to recompute routes, hours and zone time for ${span} (${status.total} bag-days)`,
      { type: "settings", id: "main" },
    );
    res.json(status);
  });

  r.get("/settings/fleet-loop-options", need("settings.view"), async (_req, res) => {
    const [loops, bags] = await Promise.all([
      getAll<RecordModel>("loops", { filter: 'status != "archived"', fields: "name,colorlight_program_name,status" }),
      loadBags(),
    ]);
    const playing = new Map<string, number>();
    for (const b of bags) {
      const name = b.playing_program || programNameFromVsn(b.playing_vsn);
      if (name) playing.set(name, (playing.get(name) ?? 0) + 1);
    }
    const options = new Map<string, FleetLoopOption>();
    for (const l of loops) {
      const name = String(l.colorlight_program_name || l.name || "").trim();
      if (name && !options.has(name)) options.set(name, { name, playingOn: playing.get(name) ?? 0, known: true });
    }
    for (const [name, n] of playing) if (!options.has(name)) options.set(name, { name, playingOn: n, known: false });
    res.json([...options.values()].sort((a, b) => b.playingOn - a.playingOn || a.name.localeCompare(b.name)));
  });

  return r;
}
