// riders area routes (mounted under /api). Owned by the riders feature.
//
// The rider pipeline, protected documents (streamed through here only, with
// riders.documents, and every open audited), bag assignments and performance.

import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";
import { z } from "zod";
import {
  addDays,
  gbDateFormat,
  can,
  DOC_MAX_BYTES,
  DOC_MIME_TYPES,
  isDay,
  londonDayStart,
  RIDER_DOC_KINDS,
  RIDER_DOC_LABEL,
  RIDER_STAGE_LABEL,
  todayLondon,
  type RiderActionResult,
  type RiderDocKind,
  type RiderStage,
} from "@digilite/shared";
import { audit } from "../../domain/audit";
import { invalidateAssignments } from "../../domain/assignments";
import { bagById, loadBags } from "../../domain/bags";
import {
  applyChanges,
  currentOrUpcoming,
  effectiveStage,
  endOfDay,
  freshAssignments,
  leftWithoutBag,
  listRiders,
  planAssign,
  planEnd,
  queueChanges,
  resolveStart,
  riderCoverage,
  riderDetail,
  riderDocuments,
  riderPay,
  riderPerformance,
  spareBags,
  toDocDto,
  type PlanConflict,
} from "../../domain/riders";
import { ClientResponseError, getAll, getOneOrNull, pb, pbDate, q, type RecordModel } from "../../pb";
import { pipeFile } from "../files";
import { badRequest, HttpError, need, notFound, param, parse, user } from "../http";

// ── Helpers ───────────────────────────────────────────────────────────────────
async function requireRider(id: string): Promise<RecordModel> {
  const rec = id ? await getOneOrNull<RecordModel>("riders", id) : null;
  if (!rec) throw notFound("Rider not found");
  return rec;
}

const dayFmt = gbDateFormat({ timeZone: "Europe/London", day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayText = (d: Date) => dayFmt.format(d);
const firstName = (name: string) => name.split(/\s+/)[0] ?? name;

/** Documents named in sentences: "Viewed right to work for Amara Osei". */
const DOC_NOUN: Record<RiderDocKind, string> = {
  id: "photo ID",
  right_to_work: "right to work",
  address: "proof of address",
  agreement: "contractor agreement",
  dbs: "DBS check",
  insurance: "insurance",
  other: "a document",
};

/** Plain ASCII for a download file name (header-safe). */
function asciiName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ._-]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "document";
}

async function bagNames(): Promise<Map<string, string>> {
  return new Map((await loadBags()).map((b) => [b.id, b.name as string]));
}

function conflictMessage(c: PlanConflict, riderName: string, names: Map<string, string>): string {
  const bag = names.get(c.row.bagId) ?? "That bag";
  switch (c.kind) {
    case "already":
      return `${riderName} already carries ${bag}.`;
    case "bag_history":
      return `${bag} was with ${c.row.riderName} after that date. Pick a later start, or end ${firstName(c.row.riderName)}'s assignment with the right last day first.`;
    case "bag_booked":
      return `${bag} is booked for ${c.row.riderName} from ${dayText(c.row.start)}.`;
    case "rider_history":
      return `${riderName} was carrying ${bag} after that date. Pick a later start.`;
    case "before_start":
      return `${riderName} got ${bag} on ${dayText(c.row.start)}. Pick a last day on or after that.`;
  }
}

function daysParam(req: Request): number {
  const n = Number(req.query.days ?? 14);
  return Number.isFinite(n) ? Math.min(31, Math.max(1, Math.round(n))) : 14;
}

// ── Uploads (memory → PocketBase protected file) ─────────────────────────────
const EXT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
};

function docMime(file: Express.Multer.File): string | null {
  const ext = (file.originalname.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "").trim();
  if (DOC_MIME_TYPES.includes(file.mimetype)) return file.mimetype;
  if (file.mimetype === "image/heif") return "image/heic";
  // Some browsers send HEIC and others with no type at all.
  if ((!file.mimetype || file.mimetype === "application/octet-stream") && EXT_TYPES[ext]) return EXT_TYPES[ext];
  return null;
}

const uploadOne = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOC_MAX_BYTES, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => {
    const type = docMime(file);
    if (!type) return cb(new HttpError(400, "Upload a PDF, JPG, PNG, HEIC or WebP file"));
    file.mimetype = type;
    cb(null, true);
  },
}).single("file");

function receiveFile(req: Request, res: Response, next: NextFunction) {
  uploadOne(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(err.code === "LIMIT_FILE_SIZE" ? new HttpError(413, "That file is over 15 MB") : badRequest("We couldn't read that upload"));
    }
    next(err);
  });
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const settable = z.enum(["applied", "checked", "waiting"]);
const optionalEmail = z.union([z.literal(""), z.email("That email address doesn't look right").max(200)]);
const day = (msg: string) => z.string().refine((v) => isDay(v), msg);

const createSchema = z.object({
  name: z.string().trim().min(1, "Add the rider's name").max(120),
  phone: z.string().trim().max(40).optional(),
  email: optionalEmail.optional(),
  stage: settable.optional(),
  notes: z.string().max(5000).optional(),
});

const patchSchema = z.object({
  name: z.string().trim().min(1, "The name can't be empty").max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: optionalEmail.optional(),
  stage: settable.optional(),
  notes: z.string().max(5000).optional(),
});

const docFields = z.object({
  kind: z.enum(RIDER_DOC_KINDS as [RiderDocKind, ...RiderDocKind[]]),
  expiresDay: day("Pick a valid expiry date").optional(),
  notes: z.string().max(1000).optional(),
});

const docPatch = z.object({
  status: z.enum(["pending", "checked", "rejected"]).optional(),
  expiresDay: day("Pick a valid expiry date").nullable().optional(),
  notes: z.string().max(1000).optional(),
});

const assignSchema = z.object({
  bagId: z.string().min(1, "Choose a bag"),
  startDay: day("Pick a valid start date").optional(),
});

const endSchema = z.object({
  lastDay: day("Pick their last day"),
  bagAction: z.enum(["spare", "give"]),
  nextRiderId: z.string().optional(),
  reason: z.string().trim().min(1, "Say why the assignment is ending").max(500),
});

export function ridersRouter(): Router {
  const r = express.Router();

  // ── Riders ─────────────────────────────────────────────────────────────────
  r.get("/riders", need("riders.view"), async (_req, res) => {
    res.json(await listRiders());
  });

  r.post("/riders", need("riders.edit"), async (req, res) => {
    const body = parse(createSchema, req.body);
    const rec = await pb.collection("riders").create<RecordModel>({
      name: body.name,
      phone: body.phone ?? "",
      email: body.email ?? "",
      stage: body.stage ?? "applied",
      notes: body.notes ?? "",
      joined_at: pbDate(new Date()),
      demo: false,
    });
    await audit(user(req), "rider.create", `Added rider ${rec.name}`, { type: "rider", id: rec.id });
    res.status(201).json(await riderDetail(rec));
  });

  r.get("/riders/:id", need("riders.view"), async (req, res) => {
    res.json(await riderDetail(await requireRider(param(req, "id"))));
  });

  r.patch("/riders/:id", need("riders.edit"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    const body = parse(patchSchema, req.body);
    const data: Record<string, unknown> = {};
    const fields: string[] = [];
    for (const k of ["name", "phone", "email", "notes"] as const) {
      if (body[k] !== undefined && body[k] !== (rec[k] ?? "")) {
        data[k] = body[k];
        fields.push(k);
      }
    }
    let stageNote = "";
    if (body.stage && body.stage !== rec.stage) {
      const open = (await freshAssignments()).find((a) => a.riderId === rec.id && !a.end);
      if (open) {
        const names = await bagNames();
        throw badRequest(`${rec.name} has ${names.get(open.bagId) ?? "a bag"}. End the assignment first.`);
      }
      data.stage = body.stage;
      if (rec.stage === "ended") {
        data.ended_at = "";
        data.ended_reason = "";
      }
      stageNote = rec.stage === "ended" ? `Brought ${rec.name} back (${RIDER_STAGE_LABEL[body.stage].toLowerCase()})` : `Moved ${rec.name} to ${RIDER_STAGE_LABEL[body.stage].toLowerCase()}`;
    }
    if (!Object.keys(data).length) return void res.json(await riderDetail(rec));
    const updated = await pb.collection("riders").update<RecordModel>(rec.id, data);
    if (stageNote) await audit(user(req), "rider.stage", stageNote, { type: "rider", id: rec.id }, { from: rec.stage, to: body.stage });
    if (fields.length) {
      // Field names only — never the personal details themselves.
      await audit(user(req), "rider.update", `Updated ${updated.name}'s ${fields.join(", ")}`, { type: "rider", id: rec.id }, { fields });
    }
    res.json(await riderDetail(updated));
  });

  // ── Documents ──────────────────────────────────────────────────────────────
  r.get("/riders/:id/documents", need("riders.view"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    const canOpen = can(user(req).role, "riders.documents");
    res.json((await riderDocuments(rec.id)).map((d) => toDocDto(d, canOpen)));
  });

  r.post("/riders/:id/documents", need("riders.documents"), receiveFile, async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const body = parse(docFields, { kind: b.kind, expiresDay: b.expiresDay || b.expires_at || undefined, notes: b.notes || undefined });
    const file = req.file;
    if (!file) throw badRequest("Choose a file to upload");
    const ext = Object.entries(EXT_TYPES).find(([, t]) => t === file.mimetype)?.[0] ?? "bin";
    const form = new FormData();
    form.set("rider", rec.id);
    form.set("kind", body.kind);
    form.set("status", "pending");
    if (body.expiresDay) form.set("expires_at", pbDate(londonDayStart(body.expiresDay)));
    if (body.notes) form.set("notes", body.notes);
    // A neutral stored name; the download name is built from the rider and kind.
    form.set("file", new File([new Uint8Array(file.buffer)], `${body.kind}.${ext}`, { type: file.mimetype }));
    let doc: RecordModel;
    try {
      doc = await pb.collection("rider_documents").create<RecordModel>(form);
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 400) {
        throw badRequest("That file couldn't be stored. Upload a PDF, JPG, PNG, HEIC or WebP under 15 MB.");
      }
      throw err;
    }
    await audit(user(req), "rider.document.add", `Added ${DOC_NOUN[body.kind]} for ${rec.name}`, { type: "rider", id: rec.id }, { documentId: doc.id, kind: body.kind });
    res.status(201).json(toDocDto(doc, true));
  });

  async function requireDoc(req: Request): Promise<{ rider: RecordModel; doc: RecordModel }> {
    const rider = await requireRider(param(req, "id"));
    const doc = await getOneOrNull<RecordModel>("rider_documents", param(req, "docId"));
    if (!doc || doc.rider !== rider.id) throw notFound("Document not found");
    return { rider, doc };
  }

  r.get("/riders/:id/documents/:docId/file", need("riders.documents"), async (req, res) => {
    const { rider, doc } = await requireDoc(req);
    if (!doc.file) throw notFound("No file is attached to this document");
    const download = req.query.download === "1";
    const kind = doc.kind as RiderDocKind;
    const ext = (String(doc.file).match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "bin").toLowerCase();
    const filename = asciiName(`${rider.name} - ${RIDER_DOC_LABEL[kind]}`) + `.${ext}`;
    if (!download) res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    await pipeFile(res, "rider_documents", doc.id, doc.file, { download: download ? filename : undefined, cacheSeconds: 0 });
    await audit(
      user(req),
      download ? "rider.document.download" : "rider.document.view",
      `${download ? "Downloaded" : "Viewed"} ${DOC_NOUN[kind]} for ${rider.name}`,
      { type: "rider", id: rider.id },
      { documentId: doc.id, kind },
    );
  });

  r.patch("/riders/:id/documents/:docId", need("riders.documents"), async (req, res) => {
    const { rider, doc } = await requireDoc(req);
    const body = parse(docPatch, req.body);
    const data: Record<string, unknown> = {};
    if (body.status && body.status !== doc.status) {
      data.status = body.status;
      data.checked_at = body.status === "checked" ? pbDate(new Date()) : "";
    }
    if (body.expiresDay !== undefined) data.expires_at = body.expiresDay ? pbDate(londonDayStart(body.expiresDay)) : "";
    if (body.notes !== undefined) data.notes = body.notes;
    if (!Object.keys(data).length) return void res.json(toDocDto(doc, true));
    const updated = await pb.collection("rider_documents").update<RecordModel>(doc.id, data);
    const noun = DOC_NOUN[doc.kind as RiderDocKind];
    const summary =
      data.status === "checked"
        ? `Checked ${noun} for ${rider.name}`
        : data.status === "rejected"
          ? `Rejected ${noun} for ${rider.name}`
          : `Updated ${noun} for ${rider.name}`;
    await audit(user(req), "rider.document.update", summary, { type: "rider", id: rider.id }, { documentId: doc.id, kind: doc.kind, fields: Object.keys(data) });
    res.json(toDocDto(updated, true));
  });

  r.delete("/riders/:id/documents/:docId", need("riders.documents"), async (req, res) => {
    const { rider, doc } = await requireDoc(req);
    await pb.collection("rider_documents").delete(doc.id);
    await audit(user(req), "rider.document.delete", `Deleted ${DOC_NOUN[doc.kind as RiderDocKind]} for ${rider.name}`, { type: "rider", id: rider.id }, { documentId: doc.id, kind: doc.kind });
    res.json({ ok: true });
  });

  // ── Assignments ────────────────────────────────────────────────────────────
  r.get("/spare-bags", need("riders.view"), async (_req, res) => {
    res.json(await spareBags());
  });

  r.post("/riders/:id/assign", need("riders.edit"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    const body = parse(assignSchema, req.body);
    const bag = await bagById(body.bagId);
    if (!bag) throw notFound("Bag not found");
    if ((bag.lifecycle || "active") === "retired") throw badRequest(`${bag.name} is retired. Mark it active on its page first.`);
    if (rec.stage === "ended") throw badRequest(`${rec.name} has ended. Bring them back first.`);
    if (rec.stage === "applied") throw badRequest(`Check ${firstName(rec.name)}'s documents before giving them a bag.`);
    const now = new Date();
    const today = todayLondon(now);
    if (body.startDay && (body.startDay < addDays(today, -90) || body.startDay > addDays(today, 30))) {
      throw badRequest("Pick a start within the last 90 days or the next 30");
    }
    const rows = await freshAssignments();
    const start = resolveStart(body.startDay, now);
    const plan = planAssign(rows, { bagId: bag.id, riderId: rec.id, start, now });
    const names = await bagNames();
    if (plan.conflict) throw badRequest(conflictMessage(plan.conflict, rec.name, names));

    const after = applyChanges(rows, plan.changes);
    const batch = pb.createBatch();
    queueChanges(batch, plan.changes, `${bag.name} given to ${rec.name}`);
    batch.collection("riders").update(rec.id, { stage: "active", ...(rec.joined_at ? {} : { joined_at: pbDate(start) }) });
    // Anyone whose bag this was and who's now left with none goes back to waiting.
    const left = leftWithoutBag(after, plan.displaced, now);
    const displacedRecs = left.length ? await getAll<RecordModel>("riders", { filter: left.map((id) => `id = ${q(id)}`).join(" || "), fields: "id,name,stage" }) : [];
    for (const d of displacedRecs) if (d.stage === "active") batch.collection("riders").update(d.id, { stage: "waiting" });
    await batch.send();
    invalidateAssignments();

    const prev = plan.displaced.map((id) => rows.find((a) => a.riderId === id)?.riderName).filter(Boolean) as string[];
    const when = body.startDay ? `from ${dayText(start)}` : `from now (${timeFmt.format(start)})`;
    const message = `${bag.name} goes to ${rec.name} ${when}.` + (prev.length ? ` ${prev.join(" and ")}'s assignment on it ends then.` : "");
    await audit(user(req), "rider.assign", `Gave ${bag.name} to ${rec.name} ${when}` + (prev.length ? ` (ended ${prev.join(", ")}'s assignment)` : ""), { type: "rider", id: rec.id }, {
      bagId: bag.id,
      start: start.toISOString(),
      changes: plan.changes.map((c) => c.op),
    });
    const result: RiderActionResult = { rider: await riderDetail(await requireRider(rec.id)), message };
    res.json(result);
  });

  r.post("/riders/:id/end", need("riders.edit"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    const body = parse(endSchema, req.body);
    const now = new Date();
    if (body.lastDay > todayLondon(now)) throw badRequest("The last day can't be in the future");
    if (rec.stage === "ended") throw badRequest(`${rec.name} has already ended`);
    const rows = await freshAssignments();
    const names = await bagNames();
    const endAt = endOfDay(body.lastDay);
    const plan = planEnd(rows, { riderId: rec.id, endAt, now });
    if (plan.conflict) throw badRequest(conflictMessage(plan.conflict, rec.name, names));

    const bagId = plan.ended?.bagId ?? null;
    const bagName = bagId ? names.get(bagId) ?? "the bag" : null;
    let next: RecordModel | null = null;
    let giveChanges: ReturnType<typeof planAssign>["changes"] = [];
    if (bagId && body.bagAction === "give") {
      if (!body.nextRiderId) throw badRequest("Choose who gets the bag");
      if (body.nextRiderId === rec.id) throw badRequest("Choose a different rider for the bag");
      next = await requireRider(body.nextRiderId);
      const afterEnd = applyChanges(rows, plan.changes);
      const nextStage = effectiveStage(next.stage as RiderStage, !!currentOrUpcoming(afterEnd, next.id, now));
      if (nextStage !== "waiting" && nextStage !== "checked") throw badRequest(`${next.name} isn't waiting for a bag`);
      const give = planAssign(afterEnd, { bagId, riderId: next.id, start: endAt, now });
      if (give.conflict) throw badRequest(conflictMessage(give.conflict, next.name, names));
      giveChanges = give.changes;
    }

    const batch = pb.createBatch();
    queueChanges(batch, plan.changes, body.reason);
    if (next) {
      queueChanges(batch, giveChanges, `${bagName} given to ${next.name}`);
      batch.collection("riders").update(next.id, { stage: "active", ...(next.joined_at ? {} : { joined_at: pbDate(endAt) }) });
    }
    batch.collection("riders").update(rec.id, { stage: "ended", ended_at: pbDate(londonDayStart(body.lastDay)), ended_reason: body.reason });
    await batch.send();
    invalidateAssignments();

    const last = dayText(londonDayStart(body.lastDay));
    const bagPart = bagName
      ? next
        ? ` ${bagName} goes to ${next.name} from ${dayText(endAt)}.`
        : ` ${bagName} goes back to the depot as a spare.`
      : "";
    const message = `Ended ${rec.name}'s assignment (last day ${last}).${bagPart}`;
    await audit(user(req), "rider.end", message, { type: "rider", id: rec.id }, {
      lastDay: body.lastDay,
      bagId,
      bagAction: bagId ? body.bagAction : null,
      nextRiderId: next?.id ?? null,
    });
    const result: RiderActionResult = { rider: await riderDetail(await requireRider(rec.id)), message };
    res.json(result);
  });

  // ── Performance, coverage, pay ─────────────────────────────────────────────
  r.get("/riders/:id/performance", need("riders.view"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    res.json(await riderPerformance(rec.id, daysParam(req)));
  });

  r.get("/riders/:id/coverage", need("riders.view"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    res.json(await riderCoverage(rec.id, daysParam(req)));
  });

  r.get("/riders/:id/pay", need("riders.view"), async (req, res) => {
    const rec = await requireRider(param(req, "id"));
    const today = todayLondon();
    const toDay = isDay(req.query.toDay) && req.query.toDay <= today ? req.query.toDay : today;
    res.json(await riderPay(rec.id, toDay));
  });

  return r;
}

