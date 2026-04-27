import { Router } from "express";
import { z } from "zod";
import { pb } from "../db/pocketbase.js";

export const zonesRouter = Router();

const zoneSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["radius", "polygon"]),
  center_lat: z.number().optional(),
  center_lng: z.number().optional(),
  radius_meters: z.number().positive().optional(),
  polygon_geojson: z.record(z.string(), z.unknown()).optional(),
  active: z.boolean().default(true),
});

zonesRouter.get("/", async (_req, res) => {
  const zones = await pb.collection("zones").getFullList({ sort: "-created" });
  res.json(zones);
});

zonesRouter.post("/", async (req, res) => {
  const parsed = zoneSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const zone = await pb.collection("zones").create(parsed.data);
  res.status(201).json(zone);
});

zonesRouter.put("/:id", async (req, res) => {
  const parsed = zoneSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const zone = await pb.collection("zones").update(req.params.id, parsed.data);
    res.json(zone);
  } catch {
    res.status(404).json({ error: "Zone not found" });
  }
});

zonesRouter.delete("/:id", async (req, res) => {
  await pb.collection("zones").delete(req.params.id);
  res.json({ ok: true });
});

zonesRouter.get("/:id/dwells", async (req, res) => {
  const hours = Number(req.query.hours ?? 24);
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace("T", " ");

  const dwells = await pb.collection("zone_dwell_events").getFullList({
    filter: pb.filter("zone_id = {:zone} && entered_at >= {:since}", {
      zone: req.params.id,
      since,
    }),
    sort: "-entered_at",
  });

  res.json(dwells);
});
