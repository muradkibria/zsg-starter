// clients area routes (mounted under /api). Owned by the clients feature.
//
//   GET   /clients                  every client and the campaigns their portal shows   clients.edit
//   POST  /clients                  add a client; returns their code                     clients.edit
//   PATCH /clients/:id              rename, contact, campaigns, switch off/on             clients.edit
//   POST  /clients/:id/new-code     a new code (the old one stops working)                clients.edit
//
// Codes are made here at random and are unique across the team and clients, so
// the sign-in page can tell who it is from the code alone. A code is returned
// once and never logged.

import express, { type Response, type Router } from "express";
import { z } from "zod";
import type { ClientCodeResult } from "@digilite/shared";
import { audit } from "../../domain/audit";
import { getClientAccount, listClients, setClientCampaigns } from "../../domain/clients";
import { campaignLabel, loadCampaignRows } from "../../domain/campaigns";
import { getAll, getOneOrNull, pb, type RecordModel } from "../../pb";
import { forgetClient, setClientCode, unusedCode } from "../auth";
import { badRequest, need, notFound, param, parse, user } from "../http";

const contact = {
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email("Add a valid email address").max(200)]).optional(),
};
const campaignIds = z.array(z.string().min(1).max(40)).max(500);
const createSchema = z.object({ name: z.string().trim().min(1, "Add the client's name").max(200), ...contact, campaignIds: campaignIds.optional() });
const patchSchema = z.object({ name: z.string().trim().min(1).max(200).optional(), ...contact, disabled: z.boolean().optional(), campaignIds: campaignIds.optional() });

/** Responses that carry a code must never be cached anywhere. */
function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}

async function checkCampaigns(ids: string[]) {
  const known = new Set((await loadCampaignRows()).map((c) => c.id));
  if (ids.some((id) => !known.has(id))) throw badRequest("One of those campaigns doesn't exist any more. Reload and try again.");
}

const list = (cs: { advertiser: string; name: string }[]) => cs.map(campaignLabel).join(", ");

export function clientsRouter(): Router {
  const r = express.Router();

  r.get("/clients", need("clients.edit"), async (_req, res) => {
    res.json(await listClients());
  });

  r.post("/clients", need("clients.edit"), async (req, res) => {
    const me = user(req);
    const body = parse(createSchema, req.body);
    const existing = await getAll<RecordModel>("clients", { fields: "name" });
    if (existing.some((c) => String(c.name).toLowerCase() === body.name.toLowerCase())) throw badRequest("There's already a client with that name");
    if (body.campaignIds?.length) await checkCampaigns(body.campaignIds);
    const code = await unusedCode();
    const rec = await pb.collection("clients").create<RecordModel>({
      name: body.name,
      contact_name: body.contactName ?? "",
      contact_email: body.contactEmail ?? "",
      disabled: false,
      session_version: 0,
      login_code: code,
    });
    await audit(me, "client.create", `Added ${body.name} as a client`, { type: "client", id: rec.id });
    if (body.campaignIds?.length) {
      const moved = await setClientCampaigns(rec.id, body.campaignIds);
      await audit(me, "client.campaigns", `${body.name}'s portal now shows ${list(moved.added)}`, { type: "client", id: rec.id });
    }
    noStore(res);
    const out: ClientCodeResult = { client: (await getClientAccount(rec.id))!, code };
    res.status(201).json(out);
  });

  r.patch("/clients/:id", need("clients.edit"), async (req, res) => {
    const me = user(req);
    const body = parse(patchSchema, req.body);
    const target = await getOneOrNull<RecordModel>("clients", param(req, "id"));
    if (!target) throw notFound("That client doesn't exist");
    const name = body.name ?? target.name;

    const update: Record<string, unknown> = {};
    const notes: { action: string; summary: string }[] = [];
    if (body.name !== undefined && body.name !== target.name) {
      const existing = await getAll<RecordModel>("clients", { fields: "id,name" });
      if (existing.some((c) => c.id !== target.id && String(c.name).toLowerCase() === body.name!.toLowerCase())) throw badRequest("There's already a client with that name");
      update.name = body.name;
      notes.push({ action: "client.rename", summary: `Renamed client ${target.name} to ${body.name}` });
    }
    if (body.contactName !== undefined && body.contactName !== (target.contact_name ?? "")) update.contact_name = body.contactName;
    if (body.contactEmail !== undefined && body.contactEmail !== (target.contact_email ?? "")) update.contact_email = body.contactEmail;
    if ((update.contact_name !== undefined || update.contact_email !== undefined) && !notes.length) notes.push({ action: "client.contact", summary: `Updated ${name}'s contact details` });
    if (body.disabled !== undefined && body.disabled !== !!target.disabled) {
      update.disabled = body.disabled;
      // Switching off also ends any portal session straight away.
      if (body.disabled) update["session_version+"] = 1;
      notes.push(
        body.disabled
          ? { action: "client.disable", summary: `Switched off ${name}'s portal login` }
          : { action: "client.enable", summary: `Switched ${name}'s portal login back on` },
      );
    }
    if (Object.keys(update).length) {
      await pb.collection("clients").update(target.id, update);
      forgetClient(target.id);
    }
    if (body.campaignIds) {
      await checkCampaigns(body.campaignIds);
      const moved = await setClientCampaigns(target.id, body.campaignIds);
      if (moved.added.length) notes.push({ action: "client.campaigns", summary: `${name}'s portal now shows ${list(moved.added)}${moved.taken.length ? " (moved from another client)" : ""}` });
      if (moved.removed.length) notes.push({ action: "client.campaigns", summary: `${name}'s portal no longer shows ${list(moved.removed)}` });
    }
    for (const n of notes) await audit(me, n.action, n.summary, { type: "client", id: target.id });
    res.json(await getClientAccount(target.id));
  });

  r.post("/clients/:id/new-code", need("clients.edit"), async (req, res) => {
    const target = await getOneOrNull<RecordModel>("clients", param(req, "id"));
    if (!target) throw notFound("That client doesn't exist");
    const code = await unusedCode();
    await setClientCode(target.id, code);
    await audit(user(req), "client.new_code", `Gave ${target.name} a new portal sign-in code`, { type: "client", id: target.id });
    noStore(res);
    const out: ClientCodeResult = { client: (await getClientAccount(target.id))!, code };
    res.json(out);
  });

  return r;
}
