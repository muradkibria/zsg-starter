// Ads & loops routes (mounted under /api): the creative library, loops, and
// sending a loop to bags through the write gate.

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  CREATIVE_MAX_BYTES,
  CREATIVE_TYPES,
  IMAGE_DEFAULT_SECONDS,
  checkCreativeFile,
  creativeTypeOf,
  type LibraryCampaignRef,
  type LoopItemInput,
} from "@digilite/shared";
import { audit } from "../../domain/audit";
import {
  PublishError,
  colorlightFileName,
  deploymentsFor,
  groupOf,
  imageSize,
  latestDeploymentByLoop,
  libraryList,
  loadLoopsContext,
  loopItemsOf,
  loopListOrder,
  normaliseItems,
  publishLoop,
  sniffType,
  toLibraryCreative,
  toLoopDetail,
  toLoopListItem,
  type LoopsContext,
} from "../../domain/loops";
import { getAll, getOneOrNull, parsePbDate, pb, q, type RecordModel } from "../../pb";
import { pipeFile } from "../files";
import { badRequest, HttpError, need, notFound, param, parse, user } from "../http";

// ── Uploads ───────────────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CREATIVE_MAX_BYTES, files: 2, fields: 20 } });

function uploadFields(req: Request, res: Response, next: NextFunction) {
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "thumb", maxCount: 1 },
  ])(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "That file is over the 100 MB limit. Export a smaller file."));
      return next(badRequest("Couldn't read the upload. Try again with one file."));
    }
    next(err);
  });
}

const numField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 100000), "must be a number");

const uploadSchema = z.object({
  name: z.string().trim().min(1, "Give the ad a name").max(300),
  advertiser: z.string().trim().max(200).optional().default(""),
  campaign: z.string().trim().max(30).optional().default(""),
  durationS: numField,
  width: numField,
  height: numField,
});

// ── Schemas ───────────────────────────────────────────────────────────────────

const creativePatch = z
  .object({
    name: z.string().trim().min(1, "Give the ad a name").max(300),
    advertiser: z.string().trim().max(200),
    campaign: z.string().trim().max(30).nullable(),
    archived: z.boolean(),
  })
  .partial();

const itemsSchema = z
  .array(z.object({ creative: z.string().min(1).max(30), seconds: z.number().min(0.1).max(600) }))
  .max(60, "A loop can hold up to 60 ads");

const loopCreate = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  from: z.string().max(30).optional(),
  items: itemsSchema.optional(),
});

const loopPatch = z
  .object({
    name: z.string().trim().min(1, "Give the loop a name").max(120),
    items: itemsSchema,
    notes: z.string().max(2000),
  })
  .partial();

const publishSchema = z.object({
  target: z.enum(["test", "bags", "fleet"]),
  bagIds: z.array(z.string().min(1).max(30)).max(500).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function requireLoop(ctx: LoopsContext, id: string): Promise<RecordModel> {
  const loop = ctx.loops.find((l) => l.id === id);
  if (!loop) throw notFound("Loop not found");
  return loop;
}

async function loopDetailResponse(id: string) {
  const ctx = await loadLoopsContext();
  const loop = await requireLoop(ctx, id);
  const last = (await latestDeploymentByLoop()).get(loop.id) ?? null;
  return toLoopDetail(ctx, loop, last);
}

// Draft edits autosave; note them in the audit log at most every 10 minutes per loop.
const lastEditAudit = new Map<string, number>();

// ── Router ────────────────────────────────────────────────────────────────────

export function loopsRouter(): Router {
  const r = express.Router();

  // ── Creatives ──────────────────────────────────────────────────────────────
  r.get("/creatives", need("loops.edit"), async (_req, res) => {
    const ctx = await loadLoopsContext();
    res.json(libraryList(ctx));
  });

  /** Campaigns an ad can be linked to. */
  r.get("/creatives/campaigns", need("loops.edit"), async (_req, res) => {
    const rows = await getAll<RecordModel>("campaigns", { sort: "-start_date", fields: "id,name,advertiser,end_date,status" }).catch(() => []);
    const out: LibraryCampaignRef[] = rows.map((c) => ({
      id: c.id,
      name: c.name,
      advertiser: c.advertiser || "",
      endDate: parsePbDate(c.end_date)?.toISOString() ?? null,
      status: c.status || null,
    }));
    res.json(out);
  });

  r.get("/creatives/:id", need("loops.edit"), async (req, res) => {
    const ctx = await loadLoopsContext();
    const group = groupOf(ctx, param(req, "id"));
    if (!group) throw notFound("Ad not found");
    res.json(toLibraryCreative(ctx, group));
  });

  r.get("/creatives/:id/thumb", need("fleet.view"), async (req, res) => {
    const c = await getOneOrNull<RecordModel>("creatives", param(req, "id"));
    if (!c?.thumb) throw notFound("No thumbnail for this ad");
    await pipeFile(res, "creatives", c.id, c.thumb, { cacheSeconds: 7 * 86400 });
  });

  r.get("/creatives/:id/file", need("loops.edit"), async (req, res) => {
    const c = await getOneOrNull<RecordModel>("creatives", param(req, "id"));
    if (!c) throw notFound("Ad not found");
    if (!c.file) throw notFound("This ad's file hasn't arrived from Colorlight yet; only its thumbnail is here so far.");
    await pipeFile(res, "creatives", c.id, c.file, {
      cacheSeconds: 86400,
      download: req.query.download ? c.file : undefined,
      range: req.headers.range,
    });
  });

  r.post("/creatives", need("loops.edit"), uploadFields, async (req, res) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
    const file = files.file?.[0];
    if (!file) throw badRequest("Choose a file to upload.");
    const body = parse(uploadSchema, req.body);

    // What the file really is
    const declared = creativeTypeOf(file.mimetype, file.originalname);
    const sniffed = sniffType(file.buffer);
    const type = sniffed && declared && CREATIVE_TYPES[sniffed].media === CREATIVE_TYPES[declared].media ? sniffed : null;
    if (!declared || !sniffed || !type) {
      throw badRequest(declared ? `This doesn't look like a real ${CREATIVE_TYPES[declared].label} file. It may be damaged.` : "Can't use this file type. Use MP4, MOV, JPG, PNG or GIF.");
    }
    const media = CREATIVE_TYPES[type].media;
    const dims = media === "image" ? imageSize(file.buffer, type) : null;
    const width = dims?.width ?? body.width;
    const height = dims?.height ?? body.height;
    const durationS = media === "image" ? IMAGE_DEFAULT_SECONDS : body.durationS;
    const check = checkCreativeFile({ filename: file.originalname, mime: type, sizeBytes: file.size, width, height, durationS });
    const hard = check.problems.find((p) => p.hard);
    if (hard) throw badRequest(`${hard.title}. ${hard.detail}`);

    // Already in the library?
    const key = colorlightFileName(file.buffer);
    const same = await getAll<RecordModel>("creatives", { filter: `colorlight_md5 = ${q(key)}`, fields: "id,name,archived" });
    if (same.length) {
      const s = same.find((x) => !x.archived) ?? same[0];
      throw new HttpError(409, `This file is already in the library as "${s.name}"${s.archived ? " (archived — unarchive it instead)" : ""}.`, s.id);
    }
    if (body.campaign && !(await getOneOrNull("campaigns", body.campaign))) throw badRequest("That campaign no longer exists.");

    const form = new FormData();
    form.append("name", body.name);
    form.append("advertiser", body.advertiser);
    if (body.campaign) form.append("campaign", body.campaign);
    form.append("source", "uploaded");
    form.append("media_type", media);
    if (durationS != null) form.append("duration_s", String(Math.round(durationS * 100) / 100));
    if (width) form.append("width", String(Math.round(width)));
    if (height) form.append("height", String(Math.round(height)));
    form.append("size_bytes", String(file.size));
    form.append("colorlight_md5", key);
    form.append("archived", "false");
    form.append(
      "checks",
      JSON.stringify({ mime: type, width, height, durationS, problems: check.problems.map((p) => p.kind), checkedAt: new Date().toISOString() }),
    );
    form.append("file", new Blob([new Uint8Array(file.buffer)], { type }), file.originalname.replace(/[^\w.\- ]+/g, "_"));
    const thumb = files.thumb?.[0];
    const thumbType = thumb ? sniffType(thumb.buffer) : null;
    if (thumb && thumbType && thumbType.startsWith("image/") && thumb.size <= 5 * 1024 * 1024) {
      form.append("thumb", new Blob([new Uint8Array(thumb.buffer)], { type: thumbType }), `thumb.${thumbType.split("/")[1]}`);
    } else if (media === "image" && file.size <= 5 * 1024 * 1024) {
      form.append("thumb", new Blob([new Uint8Array(file.buffer)], { type }), `thumb.${type.split("/")[1]}`);
    }
    const rec = await pb.collection("creatives").create<RecordModel>(form);
    await audit(user(req), "creative.upload", `Uploaded ad "${rec.name}"${body.advertiser ? ` for ${body.advertiser}` : ""}`, { type: "creative", id: rec.id }, {
      sizeBytes: file.size,
      problems: check.problems.map((p) => p.kind),
    });
    const ctx = await loadLoopsContext();
    res.status(201).json(toLibraryCreative(ctx, groupOf(ctx, rec.id)!));
  });

  r.patch("/creatives/:id", need("loops.edit"), async (req, res) => {
    const body = parse(creativePatch, req.body);
    const ctx = await loadLoopsContext();
    const group = groupOf(ctx, param(req, "id"));
    if (!group) throw notFound("Ad not found");
    if (body.campaign && !(await getOneOrNull("campaigns", body.campaign))) throw badRequest("That campaign no longer exists.");
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.advertiser !== undefined) patch.advertiser = body.advertiser;
    if (body.campaign !== undefined) patch.campaign = body.campaign ?? "";
    if (body.archived !== undefined) patch.archived = body.archived;
    // Identical copies are one ad: keep them in step.
    for (const c of group) await pb.collection("creatives").update(c.id, patch);
    const before = group[0];
    const what =
      body.archived !== undefined && !!before.archived !== body.archived
        ? body.archived
          ? `Archived ad "${before.name}"`
          : `Unarchived ad "${before.name}"`
        : body.name && body.name !== before.name
          ? `Renamed ad "${before.name}" to "${body.name}"`
          : `Updated ad "${before.name}"`;
    await audit(user(req), body.archived !== undefined ? "creative.archive" : "creative.update", what, { type: "creative", id: before.id }, { changes: Object.keys(patch) });
    const fresh = await loadLoopsContext();
    res.json(toLibraryCreative(fresh, groupOf(fresh, before.id)!));
  });

  /** Only a mistaken upload can be deleted: never sent to Colorlight and in no loop. */
  r.delete("/creatives/:id", need("loops.edit"), async (req, res) => {
    const ctx = await loadLoopsContext();
    const c = ctx.creativeById.get(param(req, "id"));
    if (!c) throw notFound("Ad not found");
    if (c.source !== "uploaded" || c.colorlight_media_id > 0) throw new HttpError(409, "This ad is in Colorlight, so it can only be archived.");
    const inLoop = ctx.loops.find((l) => loopItemsOf(l).some((i) => i.creative === c.id));
    if (inLoop) throw new HttpError(409, `This ad is in the loop "${inLoop.name}". Remove it from the loop first, or archive the ad.`);
    await pb.collection("creatives").delete(c.id);
    await audit(user(req), "creative.delete", `Deleted ad "${c.name}"`, { type: "creative", id: c.id });
    res.json({ deleted: true });
  });

  // ── Loops ──────────────────────────────────────────────────────────────────
  r.get("/loops", need("loops.edit"), async (req, res) => {
    const ctx = await loadLoopsContext();
    const last = await latestDeploymentByLoop();
    const withArchived = req.query.archived === "1";
    const list = ctx.loops
      .filter((l) => withArchived || l.status !== "archived")
      .map((l) => toLoopListItem(ctx, l, last.get(l.id) ?? null))
      .sort(loopListOrder);
    res.json(list);
  });

  r.get("/loops/:id", need("loops.edit"), async (req, res) => {
    res.json(await loopDetailResponse(param(req, "id")));
  });

  r.post("/loops", need("loops.edit"), async (req, res) => {
    const body = parse(loopCreate, req.body ?? {});
    const ctx = await loadLoopsContext();
    let items: LoopItemInput[] = [];
    let name = body.name ?? "New loop";
    let notes = "";
    if (body.from) {
      const src = await requireLoop(ctx, body.from);
      // Keep what still exists; a missing ad can't be sent anyway.
      items = loopItemsOf(src).filter((i) => ctx.creativeById.has(i.creative));
      name = body.name ?? `Copy of ${src.name}`.slice(0, 120);
      notes = `Started from "${src.name}"`;
    } else if (body.items) {
      items = body.items;
    }
    const norm = normaliseItems(ctx, items);
    if (norm.error) throw badRequest(norm.error);
    const rec = await pb.collection("loops").create<RecordModel>({ name, status: "draft", items: norm.items, notes });
    await audit(user(req), "loop.create", body.from ? `Started draft loop "${name}" (${notes.toLowerCase()})` : `Started draft loop "${name}"`, { type: "loop", id: rec.id });
    res.status(201).json(await loopDetailResponse(rec.id));
  });

  r.patch("/loops/:id", need("loops.edit"), async (req, res) => {
    const body = parse(loopPatch, req.body);
    const ctx = await loadLoopsContext();
    const loop = await requireLoop(ctx, param(req, "id"));
    if (loop.status !== "draft") {
      throw new HttpError(
        409,
        loop.status === "imported"
          ? "Loops from Colorlight can't be changed here. Duplicate it as a draft to make changes."
          : "This loop has been sent to bags, so it can't be changed. Duplicate it as a draft to make changes.",
      );
    }
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.notes !== undefined) patch.notes = body.notes;
    if (body.items !== undefined) {
      const norm = normaliseItems(ctx, body.items);
      if (norm.error) throw badRequest(norm.error);
      patch.items = norm.items;
    }
    await pb.collection("loops").update(loop.id, patch);
    const renamed = body.name !== undefined && body.name !== loop.name;
    const key = `${loop.id}:${user(req).id}`;
    if (renamed || Date.now() - (lastEditAudit.get(key) ?? 0) > 10 * 60000) {
      lastEditAudit.set(key, Date.now());
      await audit(user(req), "loop.update", renamed ? `Renamed draft loop "${loop.name}" to "${body.name}"` : `Edited draft loop "${loop.name}"`, { type: "loop", id: loop.id });
    }
    res.json(await loopDetailResponse(loop.id));
  });

  /** Delete a draft. One that was already tried (dry runs recorded) is archived instead, keeping the record. */
  r.delete("/loops/:id", need("loops.edit"), async (req, res) => {
    const ctx = await loadLoopsContext();
    const loop = await requireLoop(ctx, param(req, "id"));
    if (loop.status !== "draft") throw new HttpError(409, "Only draft loops can be deleted.");
    const tried = await pb.collection("deployments").getList(1, 1, { filter: `loop = ${q(loop.id)}`, fields: "id", skipTotal: true });
    if (tried.items.length) {
      await pb.collection("loops").update(loop.id, { status: "archived" });
      await audit(user(req), "loop.archive", `Archived draft loop "${loop.name}" (its sends stay on record)`, { type: "loop", id: loop.id });
      return void res.json({ deleted: false, archived: true });
    }
    await pb.collection("loops").delete(loop.id);
    await audit(user(req), "loop.delete", `Deleted draft loop "${loop.name}"`, { type: "loop", id: loop.id });
    res.json({ deleted: true, archived: false });
  });

  r.post("/loops/:id/publish", need("loops.publish"), async (req, res) => {
    const body = parse(publishSchema, req.body);
    try {
      res.json(await publishLoop(param(req, "id"), body, user(req)));
    } catch (err) {
      if (err instanceof PublishError) throw err.message === "Loop not found" ? notFound(err.message) : badRequest(err.message);
      throw err;
    }
  });

  r.get("/loops/:id/deployments", need("loops.edit"), async (req, res) => {
    const ctx = await loadLoopsContext();
    const loop = await requireLoop(ctx, param(req, "id"));
    res.json(await deploymentsFor(ctx, loop.id, 20));
  });

  r.get("/deployments", need("loops.edit"), async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const ctx = await loadLoopsContext();
    res.json(await deploymentsFor(ctx, null, limit));
  });

  return r;
}

