// bags area routes (mounted under /api) — extra bag endpoints beyond core.ts. Owned by the bags feature.
//
//   POST /api/bags/lifecycle   mark several bags at once (e.g. not-seen bags → "in storage")

import express, { type Router } from "express";
import { z } from "zod";
import { BAG_LIFECYCLE_LABEL, type BagsLifecycleResult, type Lifecycle } from "@digilite/shared";
import { audit } from "../../domain/audit";
import { bagById, fleetContext, invalidateBags, toBagSummary } from "../../domain/bags";
import { pb, type RecordModel } from "../../pb";
import { need, notFound, parse, user } from "../http";

const lifecycleSchema = z.object({
  bagIds: z.array(z.string().trim().min(1).max(40)).min(1, "Pick at least one bag").max(200),
  lifecycle: z.enum(["active", "storage", "repair", "lost", "retired"]),
  lifecycleNote: z.string().max(500).optional(),
});

export function bagsRouter(): Router {
  const r = express.Router();

  r.post("/bags/lifecycle", need("bags.edit"), async (req, res) => {
    const body = parse(lifecycleSchema, req.body);
    const ids = [...new Set(body.bagIds)];
    const bags: RecordModel[] = [];
    for (const id of ids) {
      const bag = await bagById(id);
      if (!bag) throw notFound(ids.length === 1 ? "Bag not found" : "One of those bags wasn't found. Refresh and try again.");
      bags.push(bag);
    }

    const who = user(req);
    const changed: string[] = [];
    for (const bag of bags) {
      const from = (bag.lifecycle || "active") as Lifecycle;
      const noteChanged = body.lifecycleNote !== undefined && body.lifecycleNote !== (bag.lifecycle_note || "");
      if (from === body.lifecycle && !noteChanged) continue;
      await pb.collection("bags").update(bag.id, {
        lifecycle: body.lifecycle,
        ...(body.lifecycleNote !== undefined ? { lifecycle_note: body.lifecycleNote } : {}),
      });
      if (from !== body.lifecycle) {
        changed.push(bag.id);
        // Same action and wording as core's single-bag PATCH, so the audit log reads the same either way.
        await audit(who, "bag.lifecycle", `${bag.name} marked as ${BAG_LIFECYCLE_LABEL[body.lifecycle as Lifecycle].toLowerCase()}`, { type: "bag", id: bag.id }, {
          from,
          to: body.lifecycle,
          bulk: ids.length > 1,
        });
      }
    }

    invalidateBags();
    const ctx = await fleetContext();
    const out: BagsLifecycleResult = { bags: [], changed };
    for (const id of ids) {
      const fresh = await bagById(id);
      if (fresh) out.bags.push(toBagSummary(fresh, ctx));
    }
    res.json(out);
  });

  return r;
}
