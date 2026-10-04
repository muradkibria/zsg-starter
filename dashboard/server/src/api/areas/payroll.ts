// Payroll routes (mounted under /api). Hours per rider per London day, the
// review queue, changes with a note, approval (a frozen snapshot) and export.

import express, { type Router } from "express";
import { z } from "zod";
import { PAY_MAX_DAYS, addDays, isDay, payDayCount, payLastCompletedFortnight, todayLondon, type PayRange } from "@digilite/shared";
import {
  adjustHours,
  approvePeriod,
  auditPayrollExport,
  payrollCsv,
  payrollFilename,
  payrollFor,
  payrollXlsx,
  reopenPeriod,
} from "../../domain/payroll";
import { CONTENT_TYPES } from "../../domain/exports";
import { badRequest, need, parse, user } from "../http";

/** A real calendar day (rejects 2026-02-31). */
const realDay = (s: unknown): s is string => isDay(s) && addDays(s, 0) === s;

function rangeOf(startDay: unknown, endDay: unknown): PayRange {
  if (startDay === undefined && endDay === undefined) return payLastCompletedFortnight(todayLondon());
  if (!realDay(startDay) || !realDay(endDay)) throw badRequest("Pick a start and an end date");
  if (endDay < startDay) throw badRequest("The end date is before the start date");
  if (payDayCount(startDay, endDay) > PAY_MAX_DAYS) throw badRequest(`Pick ${PAY_MAX_DAYS} days or fewer`);
  return { startDay, endDay };
}

const day = z.string().refine(realDay, "Use a date like 2026-09-14");
const period = z.object({ startDay: day, endDay: day });
const adjustSchema = period.extend({
  riderId: z.string().min(1).max(40),
  day,
  hours: z.number().min(0, "Hours can't be negative").max(24, "A day has 24 hours at most"),
  note: z.string().max(500, "Keep the note under 500 characters").default(""),
  asCalculated: z.boolean().optional(),
});

export function payrollRouter(): Router {
  const r = express.Router();

  r.get("/payroll", need("payroll.view"), async (req, res) => {
    res.json(await payrollFor(rangeOf(req.query.startDay, req.query.endDay)));
  });

  r.post("/payroll/adjust", need("payroll.approve"), async (req, res) => {
    const body = parse(adjustSchema, req.body);
    const range = rangeOf(body.startDay, body.endDay);
    res.status(201).json(await adjustHours(range, body, user(req)));
  });

  r.post("/payroll/approve", need("payroll.approve"), async (req, res) => {
    const body = parse(period, req.body);
    res.json(await approvePeriod(rangeOf(body.startDay, body.endDay), user(req)));
  });

  /** Owner only (checked inside): an approved period back to draft. Audited. */
  r.post("/payroll/reopen", need("payroll.approve"), async (req, res) => {
    const body = parse(period, req.body);
    res.json(await reopenPeriod(rangeOf(body.startDay, body.endDay), user(req)));
  });

  r.get("/payroll/export", need("payroll.view"), async (req, res) => {
    const range = rangeOf(req.query.startDay, req.query.endDay);
    const format = req.query.format === "xlsx" ? "xlsx" : req.query.format === "csv" ? "csv" : null;
    if (!format) throw badRequest("Pick CSV or Excel");
    const p = await payrollFor(range);
    const body = format === "csv" ? Buffer.from(payrollCsv(p), "utf8") : await payrollXlsx(p);
    await auditPayrollExport(user(req), p, format);
    res.setHeader("Content-Type", CONTENT_TYPES[format]);
    res.setHeader("Content-Disposition", `attachment; filename="${payrollFilename(range, format)}"`);
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  });

  return r;
}
