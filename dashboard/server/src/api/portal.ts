// The client portal's API (mounted at /api/portal). Only a client's session gets
// in, and every route checks the campaign belongs to that client. Nothing here
// is reachable with a team session, and nothing in the team's API is reachable
// with a client's.
//
//   GET /portal/overview                         the client and their campaigns
//   GET /portal/campaigns/:id                    a campaign to date: figures, days, ads, report periods
//   GET /portal/campaigns/:id/report?fromDay&toDay  the client report (never with rider names)
//   GET /portal/ads/:id/thumb                    one of their ads' thumbnail

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { addDays, isDay, todayLondon, type PortalOverview } from "@digilite/shared";
import { campaignReport } from "../domain/campaigns";
import { clientOwnsCreative, portalCampaignDetail, portalCampaignRow, portalCampaigns } from "../domain/clients";
import { pipeFile } from "./files";
import { badRequest, client, HttpError, notFound, param } from "./http";

function requireClient(req: Request, _res: Response, next: NextFunction) {
  if (!req.portalClient) return next(new HttpError(401, "Please sign in"));
  next();
}

export function portalRouter(): Router {
  const r = express.Router();
  r.use(requireClient);
  // Figures change through the day; nothing here is worth caching in between.
  r.use((_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-cache");
    next();
  });

  r.get("/overview", async (req, res) => {
    const me = client(req);
    const out: PortalOverview = { client: me, today: todayLondon(), campaigns: await portalCampaigns(me.id) };
    res.json(out);
  });

  r.get("/campaigns/:id", async (req, res) => {
    const me = client(req);
    const c = await portalCampaignRow(me.id, param(req, "id"));
    const summary = c && (await portalCampaigns(me.id)).find((x) => x.id === c.id);
    if (!c || !summary) throw notFound("Campaign not found");
    res.json(await portalCampaignDetail(c, summary));
  });

  r.get("/campaigns/:id/report", async (req, res) => {
    const me = client(req);
    const c = await portalCampaignRow(me.id, param(req, "id"));
    if (!c) throw notFound("Campaign not found");
    const today = todayLondon();
    // Within the campaign's dates, up to today.
    const start = c.startDay ?? today;
    const end = c.endDay && c.endDay < today ? c.endDay : today;
    if (start > today) throw badRequest("This campaign hasn't started yet");
    let fromDay = isDay(req.query.fromDay) ? req.query.fromDay : start;
    let toDay = isDay(req.query.toDay) ? req.query.toDay : end;
    if (fromDay < start) fromDay = start;
    if (toDay > end) toDay = end;
    if (toDay < fromDay) throw badRequest("Pick dates within the campaign");
    if (addDays(fromDay, 400) < toDay) throw badRequest("Pick 400 days or fewer");
    const report = await campaignReport(c, { fromDay, toDay }, { requested: false, permitted: false });
    // The bags' names are the hub's; the portal shows them as plain counts.
    res.json({ ...report, stats: { ...report.stats, bags: [] } });
  });

  r.get("/ads/:id/thumb", async (req, res) => {
    const cr = await clientOwnsCreative(client(req).id, param(req, "id"));
    if (!cr?.thumb) throw notFound("No picture for this ad");
    await pipeFile(res, "creatives", cr.id, cr.thumb, { cacheSeconds: 86400 });
  });

  return r;
}
