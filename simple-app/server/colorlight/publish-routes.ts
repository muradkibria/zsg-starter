// ─────────────────────────────────────────────────────────────────────────────
// Publish flow endpoints — upload media, then deploy to selected bags.
//
// All Colorlight write operations are gated by the COLORLIGHT_WRITES_ENABLED
// flag (see client.ts → writesEnabled()). When the flag is OFF (default),
// uploads land in the dev-upload store, deploys log what *would* have been
// pushed, and nothing reaches real bags.
// ─────────────────────────────────────────────────────────────────────────────

import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import {
  writesEnabled,
  searchByChecksum,
  tusCreate,
  tusUpload,
  registerMedia,
  createProgram,
  assignProgramToTerminals,
  listTerminals,
  type ProgramMediaItem,
} from "./client.js";
import {
  listDevUploads,
  getDevUpload,
  recordDevUpload,
  recordDeployment,
  deleteDevUpload,
  type DevUpload,
} from "../store/dev-upload-store.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB cap
});

const router = Router();

// ── System status (UI uses this to show DEV banner) ──────────────────────────

router.get("/system/status", (_req, res) => {
  res.json({
    writesEnabled: writesEnabled(),
    mode: process.env.MOCK === "true" ? "mock" : "live",
    devUploadCount: listDevUploads().length,
  });
});

// ── Upload ───────────────────────────────────────────────────────────────────

const DEFAULT_DURATION = 10;
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 120;

router.post("/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const file = req.file;
    const declaredDuration = Number(req.body?.duration_seconds);
    const durationSeconds = Number.isFinite(declaredDuration) && declaredDuration > 0
      ? Math.round(declaredDuration)
      : DEFAULT_DURATION;
    const fileType: "video" | "image" = file.mimetype.startsWith("video") ? "video" : "image";

    if (!writesEnabled()) {
      // DRY RUN — record metadata only, do not contact Colorlight
      const entry = recordDevUpload({
        filename: file.originalname,
        mime_type: file.mimetype,
        size_bytes: file.size,
        file_type: fileType,
        duration_seconds: durationSeconds,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
      });
      console.warn(
        `[publish] DRY-RUN upload accepted: ${file.originalname} ` +
        `(${(file.size / 1024).toFixed(1)} KB, ${fileType}, ${durationSeconds}s)`
      );
      res.status(201).json({
        ...entry,
        dryRun: true,
        message: "Upload recorded in dev queue. Set COLORLIGHT_WRITES_ENABLED=true to actually upload.",
      });
      return;
    }

    // LIVE upload path
    const md5 = crypto.createHash("md5").update(file.buffer).digest("hex");

    // 1. Check for existing file by checksum
    const existing = await searchByChecksum(md5);
    let tusUri: string;
    if (existing?.alreadyExists) {
      console.log(`[publish] file already on Colorlight (md5 match), skipping upload: ${file.originalname}`);
      tusUri = existing.uri;
    } else {
      // 2. Create new TUS upload
      const created = await tusCreate(file.originalname, file.mimetype, file.size);
      tusUri = created.uri;
      // 3. Upload in chunks (single chunk for V1; chunk-loop later if files grow)
      await tusUpload(tusUri, file.buffer, 0);
    }

    // 4. Register as media attachment
    const media = await registerMedia(tusUri, file.originalname.replace(/\.[^.]+$/, ""));
    if (!media) { res.status(500).json({ error: "Media registration failed" }); return; }

    res.status(201).json({
      id: media.id,
      filename: media.title?.rendered ?? file.originalname,
      file_type: fileType,
      mime_type: media.mime_type,
      size_bytes: media.media_details?.filesize ?? file.size,
      source_url: media.source_url,
      thumbnail_url: media.video_thumbnail_jpg ?? media.source_url,
      duration_seconds: media.media_details?.playtime_seconds ?? durationSeconds,
      live: true,
    });
  } catch (err) {
    next(err);
  }
});

// ── List uploads (live + dev-queue) ──────────────────────────────────────────

router.get("/uploads/dev-queue", (_req, res) => {
  res.json(listDevUploads());
});

router.delete("/uploads/dev-queue/:id", (req, res) => {
  const ok = deleteDevUpload(req.params.id);
  if (!ok) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ success: true });
});

// ── Deploy: take an uploaded file + a list of bag IDs, push it ───────────────

router.post("/deploy", async (req, res, next) => {
  try {
    const { uploadId, mediaId, bagIds, programName } = req.body ?? {};
    const targetBagIds: string[] = Array.isArray(bagIds) ? bagIds : [];
    if (targetBagIds.length === 0) {
      res.status(400).json({ error: "No bags selected" });
      return;
    }

    const name = String(programName ?? "Untitled Program").slice(0, 100);

    // Resolve the media reference into a ProgramMediaItem
    let programMedia: ProgramMediaItem;

    if (uploadId) {
      // Dev-queue item (DRY RUN path)
      const dev: DevUpload | null = getDevUpload(String(uploadId));
      if (!dev) { res.status(404).json({ error: "Dev upload not found" }); return; }
      programMedia = {
        fileID: -1,
        filename: dev.filename,
        source_url: `dryrun://dev/${dev.id}`,
        thumbnail_url: undefined,
        file_type: dev.mime_type.split("/")[1] ?? dev.file_type,
        type: dev.file_type,
        duration_seconds: dev.duration_seconds,
        width: dev.width,
        height: dev.height,
      };
    } else if (mediaId) {
      // Real Colorlight media — caller passes the live media id (number) and we treat it as such
      programMedia = {
        fileID: Number(mediaId),
        filename: req.body.filename ?? `Media-${mediaId}`,
        source_url: req.body.source_url ?? "",
        thumbnail_url: req.body.thumbnail_url,
        file_type: req.body.file_type ?? "mp4",
        type: req.body.type ?? "video",
        duration_seconds: Number(req.body.duration_seconds ?? DEFAULT_DURATION),
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
      };
    } else {
      res.status(400).json({ error: "Either uploadId (dev) or mediaId (live) is required" });
      return;
    }

    // 1. Determine the terminal group id (we cache one — the user's tenant).
    //    Pull from the first terminal in the list.
    let terminalGroupId = 0;
    try {
      const terminals = await listTerminals();
      terminalGroupId = terminals[0]?.terminalgroup?.[0]?.id ?? 0;
    } catch (err) {
      if (writesEnabled()) {
        next(err);
        return;
      }
      // Dry-run: continue with placeholder group id
      terminalGroupId = 0;
    }

    // 2. Create program
    const program = await createProgram(name, [programMedia]);

    // 3. Assign to terminals
    const numericBagIds = targetBagIds.map((id) => Number(id)).filter((n) => Number.isFinite(n));
    const assign = await assignProgramToTerminals(program.id, terminalGroupId, numericBagIds);

    // 4. If this was a dev-queue upload, record the deployment in the queue
    if (uploadId) {
      recordDeployment(String(uploadId), targetBagIds, name);
    }

    res.json({
      programId: program.id,
      programName: program.name,
      bagIds: targetBagIds,
      dryRun: !writesEnabled(),
      assigned: assign,
      message: writesEnabled()
        ? `Program ${program.id} created and assigned to ${targetBagIds.length} bag(s)`
        : `DRY RUN — would have created program "${name}" and assigned to ${targetBagIds.length} bag(s). No actual changes made.`,
    });
  } catch (err) {
    next(err);
  }
});

export { router as publishRouter };
