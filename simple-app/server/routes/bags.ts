import { Router } from "express";
import { z } from "zod";
import { pb } from "../db/pocketbase.js";

export const bagsRouter = Router();

const createBagSchema = z.object({
  colorlight_device_id: z.string().min(1),
  name: z.string().min(1),
  rider_id: z.string().optional(),
});

bagsRouter.get("/", async (_req, res) => {
  const bags = await pb.collection("bags").getFullList({ expand: "rider_id", sort: "-created" });
  res.json(bags);
});

bagsRouter.post("/", async (req, res) => {
  const parsed = createBagSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const bag = await pb.collection("bags").create(parsed.data);
  res.status(201).json(bag);
});

bagsRouter.get("/:id", async (req, res) => {
  try {
    const bag = await pb.collection("bags").getOne(req.params.id, { expand: "rider_id" });
    res.json(bag);
  } catch {
    res.status(404).json({ error: "Bag not found" });
  }
});

bagsRouter.put("/:id", async (req, res) => {
  const parsed = createBagSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const bag = await pb.collection("bags").update(req.params.id, parsed.data);
    res.json(bag);
  } catch {
    res.status(404).json({ error: "Bag not found" });
  }
});

bagsRouter.get("/:id/gps", async (req, res) => {
  const hours = Number(req.query.hours ?? 24);
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString().replace("T", " ");

  const events = await pb.collection("gps_events").getFullList({
    filter: pb.filter("bag_id = {:bag} && created >= {:since}", { bag: req.params.id, since }),
    sort: "-created",
    batch: 2000,
  });
  res.json(events);
});

bagsRouter.get("/:id/current-ad", async (req, res) => {
  const now = new Date();
  const todayDate = now.toISOString().split("T")[0];
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const dow = now.getDay();

  const scheduleList = await pb.collection("schedules").getFullList({
    filter: pb.filter(
      "bag_id = {:bag} && start_date <= {:today} && end_date >= {:today} && start_time <= {:time} && end_time >= {:time}",
      { bag: req.params.id, today: todayDate, time: currentTime }
    ),
    expand: "media_id",
    sort: "-priority",
  });

  // Filter client-side for day-of-week (PocketBase JSON array can't be filtered server-side)
  const active = scheduleList.find((s) => {
    const days: number[] = s["days_of_week"] ?? [0, 1, 2, 3, 4, 5, 6];
    return days.includes(dow);
  });

  res.json(active ?? null);
});
