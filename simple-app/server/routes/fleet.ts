import { Router } from "express";
import { pb } from "../db/pocketbase.js";

export const fleetRouter = Router();

fleetRouter.get("/live", async (_req, res) => {
  // Bags store their latest GPS position inline (updated by the GPS poller)
  // so this is a single query — no JOIN required
  const bags = await pb.collection("bags").getFullList({ expand: "rider_id" });

  const live = bags.map((bag) => ({
    id: bag.id,
    name: bag["name"],
    status: bag["status"],
    colorlight_device_id: bag["colorlight_device_id"],
    rider: bag.expand?.["rider_id"] ?? null,
    gps: bag["last_lat"] != null
      ? {
          lat: bag["last_lat"],
          lng: bag["last_lng"],
          speed: bag["last_speed"] ?? null,
          heading: bag["last_heading"] ?? null,
          recorded_at: bag["last_gps_at"] ?? null,
        }
      : null,
  }));

  res.json(live);
});
