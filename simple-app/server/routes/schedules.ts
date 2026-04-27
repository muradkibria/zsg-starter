import { Router } from "express";
import { z } from "zod";
import { pb } from "../db/pocketbase.js";

export const schedulesRouter = Router();

const scheduleSchema = z.object({
  bag_id: z.string().min(1),
  media_id: z.string().min(1),
  start_date: z.string(),
  end_date: z.string(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  days_of_week: z.array(z.number().int().min(0).max(6)).default([0, 1, 2, 3, 4, 5, 6]),
  priority: z.number().int().default(0),
});

schedulesRouter.get("/", async (req, res) => {
  const filter = req.query.bag_id
    ? pb.filter("bag_id = {:id}", { id: req.query.bag_id as string })
    : "";

  const schedules = await pb.collection("schedules").getFullList({
    sort: "-created",
    expand: "bag_id,media_id",
    ...(filter ? { filter } : {}),
  });
  res.json(schedules);
});

schedulesRouter.post("/", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const schedule = await pb.collection("schedules").create(parsed.data);
  res.status(201).json(schedule);
});

schedulesRouter.put("/:id", async (req, res) => {
  const parsed = scheduleSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const schedule = await pb.collection("schedules").update(req.params.id, parsed.data);
    res.json(schedule);
  } catch {
    res.status(404).json({ error: "Schedule not found" });
  }
});

schedulesRouter.delete("/:id", async (req, res) => {
  await pb.collection("schedules").delete(req.params.id);
  res.json({ ok: true });
});
