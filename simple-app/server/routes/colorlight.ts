import { Router } from "express";
import { pb } from "../db/pocketbase.js";
import { colortlightService } from "../services/colorlight.js";
import { logAudit } from "./audit.js";

export const colortlightRouter = Router();

colortlightRouter.post("/sync", async (req, res) => {
  const devices = await colortlightService.getDeviceList();
  let created = 0;
  let updated = 0;

  for (const device of devices) {
    const existing = await pb.collection("bags").getFirstListItem(
      pb.filter("colorlight_device_id = {:id}", { id: device.id })
    ).catch(() => null);

    const status = device.online ? "active" : "offline";

    if (existing) {
      await pb.collection("bags").update(existing.id, { status, last_gps_at: new Date().toISOString() });
      updated++;
    } else {
      await pb.collection("bags").create({
        colorlight_device_id: device.id,
        name: device.name ?? `Device ${device.id}`,
        status,
      });
      created++;
    }
  }

  await logAudit(req.user!.userId, "colorlight.sync", "system", undefined, { created, updated });
  res.json({ synced: devices.length, created, updated });
});

colortlightRouter.post("/deploy/:bagId", async (req, res) => {
  try {
    const bag = await pb.collection("bags").getOne(req.params.bagId);
    const { programId } = req.body;
    if (!programId) { res.status(400).json({ error: "programId required" }); return; }

    await colortlightService.assignProgramToDevice(bag["colorlight_device_id"], programId);
    await colortlightService.publishDevice(bag["colorlight_device_id"]);

    await logAudit(req.user!.userId, "colorlight.deploy", "bag", bag.id, { programId });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Bag not found" });
  }
});

colortlightRouter.post("/restart/:bagId", async (req, res) => {
  try {
    const bag = await pb.collection("bags").getOne(req.params.bagId);
    await colortlightService.restartDevice(bag["colorlight_device_id"]);
    await logAudit(req.user!.userId, "colorlight.restart", "bag", bag.id, {});
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Bag not found" });
  }
});
