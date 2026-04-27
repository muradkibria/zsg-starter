import { Router } from "express";
import { z } from "zod";
import { pb } from "../db/pocketbase.js";
import { colortlightService } from "../services/colorlight.js";
import { logAudit } from "./audit.js";

export const campaignsRouter = Router();

const campaignSchema = z.object({
  name: z.string().min(1),
  client_name: z.string().min(1),
  status: z.enum(["draft", "active", "paused", "ended"]).default("draft"),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

campaignsRouter.get("/", async (_req, res) => {
  const campaigns = await pb.collection("campaigns").getFullList({ sort: "-created" });
  res.json(campaigns);
});

campaignsRouter.post("/", async (req, res) => {
  const parsed = campaignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  const campaign = await pb.collection("campaigns").create({
    ...parsed.data,
    created_by: req.user!.userId,
  });

  await logAudit(req.user!.userId, "campaign.create", "campaign", campaign.id, { name: campaign["name"] });
  res.status(201).json(campaign);
});

campaignsRouter.get("/:id", async (req, res) => {
  try {
    const [campaign, media] = await Promise.all([
      pb.collection("campaigns").getOne(req.params.id),
      pb.collection("media_assets").getFullList({
        filter: pb.filter("campaign_id = {:id}", { id: req.params.id }),
      }),
    ]);
    const enrichedMedia = media.map((a) => ({
      ...a,
      fileUrl: a["file"] ? pb.getFileUrl(a, a["file"] as string) : null,
    }));
    res.json({ ...campaign, mediaAssets: enrichedMedia });
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});

campaignsRouter.put("/:id", async (req, res) => {
  const parsed = campaignSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }

  try {
    const campaign = await pb.collection("campaigns").update(req.params.id, parsed.data);
    await logAudit(req.user!.userId, "campaign.update", "campaign", campaign.id, {});
    res.json(campaign);
  } catch {
    res.status(404).json({ error: "Campaign not found" });
  }
});

campaignsRouter.post("/:id/deploy", async (req, res) => {
  const [campaign, mediaAssets] = await Promise.all([
    pb.collection("campaigns").getOne(req.params.id),
    pb.collection("media_assets").getFullList({
      filter: pb.filter("campaign_id = {:id}", { id: req.params.id }),
    }),
  ]);

  const firstMedia = mediaAssets[0];
  if (!firstMedia) {
    res.status(400).json({ error: "No media assets attached to this campaign" });
    return;
  }

  const scheduleList = await pb.collection("schedules").getFullList({
    filter: pb.filter("media_id = {:mid}", { mid: firstMedia.id }),
    expand: "bag_id",
  });

  const results: Array<{ bagId: string; ok: boolean; error?: string }> = [];

  for (const schedule of scheduleList) {
    const bag = schedule.expand?.["bag_id"] as any;
    if (!bag) continue;

    try {
      const programId = await colortlightService.createProgram(campaign["name"], firstMedia.id);
      await colortlightService.assignProgramToDevice(bag["colorlight_device_id"], programId);
      await colortlightService.publishDevice(bag["colorlight_device_id"]);

      await pb.collection("colorlight_programs").create({
        bag_id: bag.id,
        colorlight_program_id: programId,
        name: campaign["name"],
        synced_at: new Date().toISOString(),
      });

      results.push({ bagId: bag.id, ok: true });
    } catch (err: any) {
      results.push({ bagId: schedule["bag_id"], ok: false, error: err.message });
    }
  }

  await logAudit(req.user!.userId, "campaign.deploy", "campaign", campaign.id, { results });
  res.json({ results });
});
