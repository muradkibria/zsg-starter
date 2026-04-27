import { Router } from "express";
import { pb } from "../db/pocketbase.js";
import { uploadSingle } from "../middleware/upload.js";
import { logAudit } from "./audit.js";

export const mediaRouter = Router();

mediaRouter.get("/", async (req, res) => {
  const filter = req.query.campaign_id
    ? pb.filter("campaign_id = {:id}", { id: req.query.campaign_id as string })
    : "";

  const assets = await pb.collection("media_assets").getFullList({
    sort: "-created",
    ...(filter ? { filter } : {}),
  });

  // Enrich each record with the public file URL
  const enriched = assets.map((a) => ({
    ...a,
    fileUrl: a["file"] ? pb.getFileUrl(a, a["file"] as string) : null,
  }));

  res.json(enriched);
});

mediaRouter.post("/", uploadSingle, async (req, res) => {
  if (!req.file) { res.status(400).json({ error: "No file provided" }); return; }

  const fileType = req.file.mimetype.startsWith("video/") ? "video" : "image";

  // Build FormData to forward the file to PocketBase
  const formData = new FormData();
  formData.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
  formData.append("original_name", req.file.originalname);
  formData.append("file_type", fileType);
  formData.append("file_size_bytes", String(req.file.size));
  if (req.body.campaignId) formData.append("campaign_id", req.body.campaignId);

  const asset = await pb.collection("media_assets").create(formData);
  const fileUrl = asset["file"] ? pb.getFileUrl(asset, asset["file"] as string) : null;

  await logAudit(req.user!.userId, "media.upload", "media_asset", asset.id, { filename: req.file.originalname });
  res.status(201).json({ ...asset, fileUrl });
});

mediaRouter.delete("/:id", async (req, res) => {
  try {
    await pb.collection("media_assets").delete(req.params.id);
    await logAudit(req.user!.userId, "media.delete", "media_asset", req.params.id, {});
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Asset not found" });
  }
});
