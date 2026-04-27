import { Router } from "express";
import { z } from "zod";
import { pb } from "../db/pocketbase.js";

export const ridersRouter = Router();

const riderSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
});

ridersRouter.get("/", async (_req, res) => {
  const riders = await pb.collection("riders").getFullList({ sort: "-created" });
  res.json(riders);
});

ridersRouter.post("/", async (req, res) => {
  const parsed = riderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const rider = await pb.collection("riders").create(parsed.data);
  res.status(201).json(rider);
});

ridersRouter.get("/:id", async (req, res) => {
  try {
    const [rider, bags] = await Promise.all([
      pb.collection("riders").getOne(req.params.id),
      pb.collection("bags").getFullList({
        filter: pb.filter("rider_id = {:id}", { id: req.params.id }),
      }),
    ]);
    res.json({ ...rider, bags });
  } catch {
    res.status(404).json({ error: "Rider not found" });
  }
});

ridersRouter.put("/:id", async (req, res) => {
  const parsed = riderSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const rider = await pb.collection("riders").update(req.params.id, parsed.data);
    res.json(rider);
  } catch {
    res.status(404).json({ error: "Rider not found" });
  }
});

ridersRouter.get("/:id/hours", async (req, res) => {
  const sessions = await pb.collection("rider_sessions").getFullList({
    filter: pb.filter("rider_id = {:id}", { id: req.params.id }),
  });

  let totalSeconds = 0;
  const now = Date.now();
  for (const s of sessions) {
    const start = new Date(s["started_at"]).getTime();
    const end = s["ended_at"] ? new Date(s["ended_at"]).getTime() : now;
    totalSeconds += (end - start) / 1000;
  }

  res.json({ totalSeconds: Math.round(totalSeconds), totalHours: +(totalSeconds / 3600).toFixed(2) });
});
