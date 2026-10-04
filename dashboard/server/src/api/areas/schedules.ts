// schedules area routes (mounted under /api). The fleet schedule, bags' own
// schedules, the week preview, the checks before applying, and applying them
// (per bag, through the write gate).

import express, { type Router } from "express";
import { z } from "zod";
import {
  isDay,
  MAX_BRIGHTNESS_STEPS,
  MAX_RULES,
  scheduleProblems,
  todayLondon,
  type ScheduleContent,
  type ScheduleResponse,
} from "@digilite/shared";
import { audit } from "../../domain/audit";
import { bagById, isTestBag, loadBags } from "../../domain/bags";
import {
  applySchedule,
  bagRecord,
  bagRecords,
  buildPreview,
  describeContentChange,
  fleetRecord,
  inService,
  loadLoopInfo,
  readContent,
  saveContent,
  scheduleBagRows,
  scheduleChecks,
  toScheduleDto,
  toScheduleLoop,
} from "../../domain/schedules";
import { pb, type RecordModel } from "../../pb";
import { badRequest, need, notFound, param, parse, user } from "../http";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-05");
const hm = z.string().regex(/^\d{2}:\d{2}$/, "Use a time like 17:30");

const ruleSchema = z.object({
  id: z.string().max(40).optional().default(""),
  loopId: z.string().min(1, "Pick a loop").max(40),
  startDate: day,
  endDate: day.nullable().optional().default(null),
  weekdays: z.array(z.boolean()).length(7),
  startTime: hm,
  endTime: hm,
  priority: z.number().int().min(1).max(999),
});

const saveSchema = z.object({
  defaultLoopId: z.string().max(40).nullable().optional().default(null),
  rules: z.array(ruleSchema).max(MAX_RULES),
  brightness: z
    .array(z.object({ from: z.string().max(10), pct: z.number().int().min(1).max(100) }))
    .max(MAX_BRIGHTNESS_STEPS),
});

const applySchema = z.object({
  target: z.enum(["test", "fleet", "bag"]),
  bagId: z.string().max(40).optional(),
});

async function requireBag(id: string): Promise<RecordModel> {
  const bag = await bagById(id);
  if (!bag) throw notFound("Bag not found");
  return bag;
}

/** Checks the body against the schedule rules and the loops that exist. */
async function validContent(body: unknown): Promise<ScheduleContent> {
  const c = parse(saveSchema, body) as ScheduleContent;
  const loops = await loadLoopInfo();
  const byId = new Map(loops.map((l) => [l.id, l]));
  const problems = scheduleProblems(c, (id) => byId.get(id)?.name ?? null);
  const used = [...(c.defaultLoopId ? [c.defaultLoopId] : []), ...c.rules.map((r) => r.loopId)];
  if (used.some((id) => !byId.has(id))) problems.unshift("One of the loops no longer exists. Pick another.");
  if (problems.length) throw badRequest(problems[0], problems.join("\n"));
  return c;
}

async function response(rec: RecordModel | null, bag: RecordModel | null): Promise<ScheduleResponse> {
  const bags = await loadBags();
  const loops = await loadLoopInfo(bags);
  const ownIds = new Set((await bagRecords()).map((r) => r.bag as string));
  const served = bags.filter(inService);
  return {
    schedule: rec ? toScheduleDto(rec, bag?.name ?? null) : null,
    loops: loops.filter((l) => l.status !== "archived" || (rec && usesLoop(readContent(rec), l.id))).map(toScheduleLoop),
    bag: bag ? { id: bag.id, name: bag.name, isTestBag: isTestBag(bag) } : null,
    bags: { total: served.length, own: served.filter((b) => ownIds.has(b.id)).length },
    today: todayLondon(),
  };
}

const usesLoop = (c: ScheduleContent, id: string) => c.defaultLoopId === id || c.rules.some((r) => r.loopId === id);

export function schedulesRouter(): Router {
  const r = express.Router();

  // ── The fleet schedule ─────────────────────────────────────────────────────
  r.get("/schedules/fleet", need("fleet.view"), async (_req, res) => {
    res.json(await response(await fleetRecord(), null));
  });

  r.put("/schedules/fleet", need("schedules.edit"), async (req, res) => {
    const content = await validContent(req.body);
    const { rec, before } = await saveContent(null, content);
    const names = new Map((await loadLoopInfo()).map((l) => [l.id, l.name]));
    const after = readContent(rec);
    await audit(
      user(req),
      "schedule.update",
      `Fleet schedule changed: ${describeContentChange(before, after, (id) => names.get(id) ?? "removed loop")}`,
      { type: "schedule", id: rec.id },
      { before, after },
    );
    res.json(await response(rec, null));
  });

  // ── Bags and their own schedules ───────────────────────────────────────────
  r.get("/schedules/bags", need("fleet.view"), async (_req, res) => {
    res.json(await scheduleBagRows());
  });

  r.get("/schedules/bag/:bagId", need("fleet.view"), async (req, res) => {
    const bag = await requireBag(param(req, "bagId"));
    res.json(await response(await bagRecord(bag.id), bag));
  });

  /** Save a bag's own schedule. `{copyFleet: true}` starts it as a copy of the fleet schedule. */
  r.put("/schedules/bag/:bagId", need("schedules.edit"), async (req, res) => {
    const bag = await requireBag(param(req, "bagId"));
    const copy = req.body && typeof req.body === "object" && (req.body as { copyFleet?: unknown }).copyFleet === true;
    const content = copy ? readContent(await fleetRecord()) : await validContent(req.body);
    const { rec, before } = await saveContent({ bag }, content);
    const names = new Map((await loadLoopInfo()).map((l) => [l.id, l.name]));
    await audit(
      user(req),
      before ? "schedule.update" : "schedule.create",
      before
        ? `${bag.name}'s own schedule changed: ${describeContentChange(before, readContent(rec), (id) => names.get(id) ?? "removed loop")}`
        : `${bag.name} given its own schedule${copy ? " (a copy of the fleet schedule)" : ""}`,
      { type: "bag", id: bag.id },
      { schedule: rec.id, before, after: readContent(rec) },
    );
    res.json(await response(rec, bag));
  });

  r.delete("/schedules/bag/:bagId", need("schedules.edit"), async (req, res) => {
    const bag = await requireBag(param(req, "bagId"));
    const rec = await bagRecord(bag.id);
    if (!rec) throw notFound(`${bag.name} doesn't have its own schedule.`);
    await pb.collection("schedules").delete(rec.id);
    await audit(user(req), "schedule.delete", `${bag.name}'s own schedule removed: it follows the fleet schedule again`, { type: "bag", id: bag.id }, {
      removed: readContent(rec),
    });
    res.json({ ok: true, message: `${bag.name} follows the fleet schedule again. Apply the fleet schedule to update the bag.` });
  });

  // ── Week preview ───────────────────────────────────────────────────────────
  r.get("/schedules/preview", need("fleet.view"), async (req, res) => {
    const today = todayLondon();
    const weekOf = isDay(req.query.weekOf) ? req.query.weekOf : today;
    const bagId = typeof req.query.bag === "string" && req.query.bag ? req.query.bag : null;
    let rec: RecordModel | null;
    if (bagId) {
      const bag = await requireBag(bagId);
      rec = (await bagRecord(bag.id)) ?? (await fleetRecord());
    } else {
      rec = await fleetRecord();
    }
    const names = new Map((await loadLoopInfo()).map((l) => [l.id, l.name]));
    res.json(buildPreview(readContent(rec), weekOf, names, today));
  });

  // ── Checks and apply ───────────────────────────────────────────────────────
  r.get("/schedules/checks", need("fleet.view"), async (req, res) => {
    const bagId = typeof req.query.bag === "string" && req.query.bag ? req.query.bag : undefined;
    res.json(await scheduleChecks(bagId));
  });

  r.post("/schedules/apply", need("schedules.edit"), async (req, res) => {
    const body = parse(applySchema, req.body);
    if (body.target === "bag" && !body.bagId) throw badRequest("Pick a bag to apply to.");
    res.json(await applySchedule(user(req), body));
  });

  return r;
}
