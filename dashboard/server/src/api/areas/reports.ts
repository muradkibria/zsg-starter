// reports area routes (mounted under /api). Owned by the reports feature.
//
//   GET /reports/campaign/:id?fromDay&toDay&riderNames=0|1
//
// A client (proof-of-play) report: measured figures only, a plain-English
// summary written from those numbers, and no estimated reach until its method
// is agreed. Rider names are off unless asked for by someone who can see riders.

import express, { type Router } from "express";
import { addDays, can, isDay } from "@digilite/shared";
import { campaignReport, defaultPeriod, getCampaignRow } from "../../domain/campaigns";
import { badRequest, need, notFound, param, user } from "../http";

export function reportsRouter(): Router {
  const r = express.Router();

  r.get("/reports/campaign/:id", need("campaigns.view"), async (req, res) => {
    const c = await getCampaignRow(param(req, "id"));
    if (!c) throw notFound("Campaign not found");
    const def = defaultPeriod(c);
    const fromDay = isDay(req.query.fromDay) ? req.query.fromDay : def.fromDay;
    const toDay = isDay(req.query.toDay) ? req.query.toDay : def.toDay;
    if (toDay < fromDay) throw badRequest("The end date is before the start date");
    if (addDays(fromDay, 400) < toDay) throw badRequest("Pick 400 days or fewer");
    const requested = req.query.riderNames === "1" || req.query.riderNames === "true";
    res.json(
      await campaignReport(c, { fromDay, toDay }, { requested, permitted: can(user(req).role, "riders.view") }),
    );
  });

  return r;
}
