// campaigns area routes (mounted under /api). Owned by the campaigns feature.
//
//   GET    /campaigns                          list with honest status + measured plays
//   POST   /campaigns                          create
//   GET    /campaigns/:id                      detail + chain (creatives → loops → bags → riders)
//   PATCH  /campaigns/:id                      update
//   DELETE /campaigns/:id                      delete (creatives are unlinked first)
//   PUT    /campaigns/:id/creatives            set the linked creatives {creativeIds}
//   GET    /campaigns/:id/suggested-creatives  likely matches by advertiser name + the library
//   GET    /campaigns/:id/stats                measured stats for ?fromDay&toDay
//   GET    /inventory                          live inventory (sold / house / unsold slots)

import express, { type Router } from "express";
import { z } from "zod";
import { addDays, can, isDay, londonDayStart, todayLondon, type LinkCreativesResponse } from "@digilite/shared";
import { audit } from "../../domain/audit";
import {
  campaignDetail,
  campaignLabel,
  campaignStats,
  defaultPeriod,
  getCampaignRow,
  invalidateCampaigns,
  listCampaigns,
  liveInventory,
  setCampaignCreatives,
  storedStatus,
  suggestedCreatives,
  unlinkAll,
  type CampaignRow,
} from "../../domain/campaigns";
import { pb, pbDate } from "../../pb";
import { badRequest, need, notFound, param, parse, user } from "../http";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-01");
const fields = {
  advertiser: z.string().trim().min(1, "Add the advertiser").max(200),
  name: z.string().trim().min(1, "Add a campaign name").max(200),
  startDay: day,
  endDay: day,
  contractedBags: z.number().int().min(0).max(10000),
  confirmed: z.boolean(),
  notes: z.string().max(5000).optional(),
};
const createSchema = z.object(fields);
const patchSchema = z.object(fields).partial();
const linkSchema = z.object({ creativeIds: z.array(z.string().min(1).max(40)).max(2000) });

async function requireCampaign(id: string): Promise<CampaignRow> {
  const c = await getCampaignRow(id);
  if (!c) throw notFound("Campaign not found");
  return c;
}

function checkDates(startDay: string, endDay: string) {
  if (!isDay(startDay) || !isDay(endDay)) throw badRequest("Pick a start and an end date");
  if (endDay < startDay) throw badRequest("The end date is before the start date");
  if (addDays(startDay, 3 * 366) < endDay) throw badRequest("Campaigns can run for up to three years");
}

const describe = (c: { advertiser: string; name: string; startDay: string | null; endDay: string | null; contractedBags: number; confirmed: boolean; notes: string }) => ({
  advertiser: c.advertiser,
  name: c.name,
  startDay: c.startDay,
  endDay: c.endDay,
  contractedBags: c.contractedBags,
  confirmed: c.confirmed,
  notes: c.notes,
});

export function campaignsRouter(): Router {
  const r = express.Router();

  r.get("/campaigns", need("campaigns.view"), async (_req, res) => {
    res.json(await listCampaigns());
  });

  r.post("/campaigns", need("campaigns.edit"), async (req, res) => {
    const body = parse(createSchema, req.body);
    checkDates(body.startDay, body.endDay);
    const rec = await pb.collection("campaigns").create({
      advertiser: body.advertiser,
      name: body.name,
      start_date: pbDate(londonDayStart(body.startDay)),
      end_date: pbDate(londonDayStart(body.endDay)),
      contracted_bags: body.contractedBags,
      status: storedStatus(body.confirmed, body.endDay),
      notes: body.notes ?? "",
      demo: false,
    });
    invalidateCampaigns();
    const c = await requireCampaign(rec.id);
    await audit(user(req), "campaign.create", `Added campaign ${campaignLabel(c)}`, { type: "campaign", id: c.id }, { after: describe(c) });
    res.status(201).json(await campaignDetail(c, { showRiders: can(user(req).role, "riders.view") }));
  });

  r.get("/campaigns/:id", need("campaigns.view"), async (req, res) => {
    const c = await requireCampaign(param(req, "id"));
    res.json(await campaignDetail(c, { showRiders: can(user(req).role, "riders.view") }));
  });

  r.patch("/campaigns/:id", need("campaigns.edit"), async (req, res) => {
    const before = await requireCampaign(param(req, "id"));
    const body = parse(patchSchema, req.body);
    const startDay = body.startDay ?? before.startDay;
    const endDay = body.endDay ?? before.endDay;
    if (!startDay || !endDay) throw badRequest("Pick a start and an end date");
    checkDates(startDay, endDay);
    const confirmed = body.confirmed ?? before.confirmed;
    await pb.collection("campaigns").update(before.id, {
      ...(body.advertiser !== undefined ? { advertiser: body.advertiser } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.startDay !== undefined ? { start_date: pbDate(londonDayStart(body.startDay)) } : {}),
      ...(body.endDay !== undefined ? { end_date: pbDate(londonDayStart(body.endDay)) } : {}),
      ...(body.contractedBags !== undefined ? { contracted_bags: body.contractedBags } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      status: storedStatus(confirmed, endDay),
    });
    invalidateCampaigns();
    const after = await requireCampaign(before.id);
    const a = describe(before) as Record<string, unknown>;
    const b = describe(after) as Record<string, unknown>;
    const changes = Object.keys(b)
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => (k === "notes" ? "notes changed" : `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`));
    if (changes.length) {
      await audit(user(req), "campaign.update", `Changed campaign ${campaignLabel(after)} (${changes.length})`, { type: "campaign", id: after.id }, { changes });
    }
    res.json(await campaignDetail(after, { showRiders: can(user(req).role, "riders.view") }));
  });

  r.delete("/campaigns/:id", need("campaigns.edit"), async (req, res) => {
    const c = await requireCampaign(param(req, "id"));
    const unlinked = await unlinkAll(c.id);
    await pb.collection("campaigns").delete(c.id);
    invalidateCampaigns();
    await audit(user(req), "campaign.delete", `Deleted campaign ${campaignLabel(c)}`, { type: "campaign", id: c.id }, { before: describe(c), creativesUnlinked: unlinked });
    res.json({ ok: true, creativesUnlinked: unlinked });
  });

  r.put("/campaigns/:id/creatives", need("campaigns.edit"), async (req, res) => {
    const c = await requireCampaign(param(req, "id"));
    const body = parse(linkSchema, req.body);
    const out = await setCampaignCreatives(c, [...new Set(body.creativeIds)]);
    if ("error" in out) throw badRequest(out.error!);
    if (out.added.length || out.removed.length) {
      const bits = [
        out.added.length ? `linked ${out.added.length} ${out.added.length === 1 ? "file" : "files"}` : null,
        out.removed.length ? `unlinked ${out.removed.length}` : null,
      ].filter(Boolean);
      await audit(
        user(req),
        "campaign.creatives",
        `${campaignLabel(c)}: ${bits.join(", ")}`,
        { type: "campaign", id: c.id },
        { added: out.added, removed: out.removed, moved: out.moved },
      );
    }
    const body2: LinkCreativesResponse = {
      linked: out.linked,
      files: out.files,
      moved: [...out.moved],
      detail: await campaignDetail(c, { showRiders: can(user(req).role, "riders.view") }),
    };
    res.json(body2);
  });

  r.get("/campaigns/:id/suggested-creatives", need("campaigns.view"), async (req, res) => {
    const c = await requireCampaign(param(req, "id"));
    res.json(await suggestedCreatives(c));
  });

  r.get("/campaigns/:id/stats", need("campaigns.view"), async (req, res) => {
    const c = await requireCampaign(param(req, "id"));
    const def = defaultPeriod(c);
    const fromDay = isDay(req.query.fromDay) ? req.query.fromDay : def.fromDay;
    const toDay = isDay(req.query.toDay) ? req.query.toDay : def.toDay;
    if (toDay < fromDay) throw badRequest("The end date is before the start date");
    if (addDays(fromDay, 400) < toDay) throw badRequest("Pick 400 days or fewer");
    if (fromDay > todayLondon()) throw badRequest("That period hasn't started yet");
    const riders = can(user(req).role, "riders.view");
    res.json(await campaignStats(c, fromDay, toDay, { riderNames: riders ? "full" : null }));
  });

  r.get("/inventory", need("campaigns.view"), async (_req, res) => {
    res.json(await liveInventory());
  });

  return r;
}
