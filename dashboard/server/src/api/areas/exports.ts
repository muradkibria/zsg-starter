// Exports routes (mounted under /api): pickers, a "before you download" check
// with sample rows, and the streamed download itself (audited).

import express, { type Request, type Router } from "express";
import { z } from "zod";
import {
  EXPORT_TYPE_LABEL,
  PAY_MAX_DAYS,
  addDays,
  can,
  isDay,
  payDayCount,
  payLastCompletedFortnight,
  payPeriodLabel,
  todayLondon,
  type ExportFormat,
  type ExportOptions,
  type ExportRequest,
} from "@digilite/shared";
import { audit } from "../../domain/audit";
import { currentRiderByBag } from "../../domain/assignments";
import { loadBags } from "../../domain/bags";
import { CONTENT_TYPES, exportFilename, exportPreview, loadExportContext, writeExport } from "../../domain/exports";
import { logger } from "../../log";
import { getAll, parsePbDate, type RecordModel } from "../../pb";
import { badRequest, forbidden, need, parse, user } from "../http";

const log = logger("exports");

const realDay = (s: unknown): s is string => isDay(s) && addDays(s, 0) === s;
const day = z.string().refine(realDay, "Use a date like 2026-09-28");
const ids = z
  .string()
  .optional()
  .transform((s) => (s ? [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))] : []))
  .pipe(z.array(z.string().regex(/^[a-z0-9]{15}$/, "That isn't a bag or rider we know")).max(200, "Pick 200 or fewer"));

const querySchema = z.object({
  type: z.enum(["routes", "shifts", "plays", "zones"], "Pick what to export"),
  bagIds: ids,
  riderIds: ids,
  fromDay: day,
  toDay: day,
  format: z.enum(["csv", "xlsx", "gpx", "kml"], "Pick a format").optional(),
});

const FORMAT_LABEL: Record<ExportFormat, string> = { csv: "CSV", xlsx: "Excel", gpx: "GPX map file", kml: "KML map file" };

/** Validated request, plus whether rider names are hidden for this user. */
async function readRequest(req: Request): Promise<{ request: ExportRequest; format?: ExportFormat; hideRiders: boolean; riderNames: Map<string, string> }> {
  const qy = parse(querySchema, req.query);
  if (qy.toDay < qy.fromDay) throw badRequest("The end date is before the start date");
  if (payDayCount(qy.fromDay, qy.toDay) > PAY_MAX_DAYS) throw badRequest(`Pick ${PAY_MAX_DAYS} days or fewer`);
  const hideRiders = !can(user(req).role, "riders.view");
  if (hideRiders && qy.riderIds.length) throw forbidden("You don't have permission to pick riders");
  const bags = new Set((await loadBags()).map((b) => b.id));
  if (qy.bagIds.some((id) => !bags.has(id))) throw badRequest("Some of those bags don't exist any more");
  const riderNames = new Map<string, string>();
  if (qy.riderIds.length) {
    const recs = await getAll<RecordModel>("riders", { fields: "id,name" });
    for (const r of recs) riderNames.set(r.id, r.name);
    if (qy.riderIds.some((id) => !riderNames.has(id))) throw badRequest("Some of those riders don't exist any more");
  }
  const { format, ...request } = qy;
  return { request, format, hideRiders, riderNames };
}

export function exportsRouter(): Router {
  const r = express.Router();

  /** Bags and riders for the "Who" picker. */
  r.get("/exports/options", need("exports.run"), async (req, res) => {
    const hideRiders = !can(user(req).role, "riders.view");
    const [bags, current] = await Promise.all([loadBags(), currentRiderByBag()]);
    const bagOf = new Map<string, string>();
    for (const [bagId, rider] of current) bagOf.set(rider.id, bags.find((b) => b.id === bagId)?.name ?? "");
    const riders = hideRiders ? [] : await getAll<RecordModel>("riders", { fields: "id,name,stage,demo", sort: "name" });
    const today = todayLondon();
    const body: ExportOptions = {
      bags: bags
        .map((b) => ({
          id: b.id,
          name: b.name as string,
          riderName: hideRiders ? null : current.get(b.id)?.name ?? null,
          lifecycle: b.lifecycle || "active",
          lastReportAt: parsePbDate(b.last_report_at)?.toISOString() ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "en-GB", { numeric: true })),
      riders: riders.map((rd) => ({ id: rd.id, name: rd.name, bagName: bagOf.get(rd.id) || null, stage: rd.stage || "active", demo: !!rd.demo })),
      today,
      lastPayPeriod: payLastCompletedFortnight(today),
      maxDays: PAY_MAX_DAYS,
    };
    res.json(body);
  });

  r.get("/exports/preview", need("exports.run"), async (req, res) => {
    const { request, hideRiders } = await readRequest(req);
    res.json(await exportPreview(request, hideRiders));
  });

  r.get("/exports/download", need("exports.run"), async (req, res) => {
    const { request, format, hideRiders, riderNames } = await readRequest(req);
    if (!format) throw badRequest("Pick a format");
    if ((format === "gpx" || format === "kml") && request.type !== "routes") throw badRequest("Map files are only for routes");
    const ctx = await loadExportContext(request, hideRiders);
    const who =
      request.bagIds.length === 1 && !request.riderIds.length
        ? ctx.bagName(request.bagIds[0])
        : request.riderIds.length === 1 && !request.bagIds.length
          ? riderNames.get(request.riderIds[0]) ?? null
          : null;
    const picked = [...request.bagIds.map(ctx.bagName), ...request.riderIds.map((id) => riderNames.get(id) ?? "a rider")];
    const whoText = picked.length === 0 ? "every bag" : picked.length <= 3 ? picked.join(", ") : `${picked.slice(0, 2).join(", ")} and ${picked.length - 2} more`;

    res.setHeader("Content-Type", CONTENT_TYPES[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${exportFilename(request, format, who)}"`);
    res.setHeader("Cache-Control", "no-store");
    let rows: number | null = null;
    try {
      rows = await writeExport(res, ctx, format);
    } catch (err) {
      log.warn(`${request.type} ${format} export failed`, err);
      if (!res.headersSent) throw err;
      res.destroy();
    } finally {
      await audit(
        user(req),
        "export.download",
        `Downloaded ${EXPORT_TYPE_LABEL[request.type].toLowerCase()} (${FORMAT_LABEL[format]}) for ${whoText}, ${payPeriodLabel(request.fromDay, request.toDay, { short: true, year: true })}` +
          (rows !== null ? ` · ${rows.toLocaleString("en-GB")} rows` : " · not finished"),
        { type: "export", id: request.type },
        { ...request, format, rows, completed: rows !== null && !res.destroyed },
      );
    }
  });

  return r;
}
