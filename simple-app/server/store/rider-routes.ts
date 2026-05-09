import { Router } from "express";
import {
  listRiders,
  getRider,
  getRiderByBagId,
  createRider,
  updateRider,
  deleteRider,
  addDocument,
  removeDocument,
} from "./rider-store.js";

const router = Router();

// ── Rider CRUD ───────────────────────────────────────────────────────────────

router.get("/riders", (_req, res) => {
  res.json(listRiders());
});

router.get("/riders/:id", (req, res) => {
  const rider = getRider(req.params.id);
  if (!rider) { res.status(404).json({ error: "Rider not found" }); return; }
  res.json(rider);
});

router.post("/riders", (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || name.trim() === "") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const rider = createRider({
    name: name.trim(),
    phone: req.body.phone ?? null,
    email: req.body.email ?? null,
    address: req.body.address ?? null,
    bag_id: req.body.bag_id ?? null,
    status: req.body.status ?? "active",
    notes: req.body.notes ?? "",
  });
  res.status(201).json(rider);
});

router.put("/riders/:id", (req, res) => {
  const updated = updateRider(req.params.id, {
    name: req.body.name,
    phone: req.body.phone,
    email: req.body.email,
    address: req.body.address,
    bag_id: req.body.bag_id,
    status: req.body.status,
    notes: req.body.notes,
  });
  if (!updated) { res.status(404).json({ error: "Rider not found" }); return; }
  res.json(updated);
});

router.delete("/riders/:id", (req, res) => {
  const ok = deleteRider(req.params.id);
  if (!ok) { res.status(404).json({ error: "Rider not found" }); return; }
  res.json({ success: true });
});

// ── Bag ↔ rider allocation ───────────────────────────────────────────────────

router.get("/bags/:bagId/rider", (req, res) => {
  const rider = getRiderByBagId(req.params.bagId);
  if (!rider) { res.status(404).json({ error: "No rider assigned to this bag" }); return; }
  res.json(rider);
});

/**
 * Assign a registered rider to a bag.
 *   PUT /api/bags/:bagId/rider
 *   body: { riderId: string }
 *
 * If the rider was on another bag, they're auto-unassigned from it.
 * If another rider currently holds this bag, they're auto-unassigned from it.
 */
router.put("/bags/:bagId/rider", (req, res) => {
  const { riderId } = req.body ?? {};
  if (!riderId || typeof riderId !== "string") {
    res.status(400).json({ error: "riderId is required" });
    return;
  }

  // Verify the rider exists before mutating
  const target = getRider(riderId);
  if (!target) { res.status(404).json({ error: "Rider not found" }); return; }

  // updateRider handles the "one bag per rider, one rider per bag" rule
  const updated = updateRider(riderId, { bag_id: req.params.bagId });
  if (!updated) { res.status(500).json({ error: "Allocation failed" }); return; }
  res.json({ rider: updated, bagId: req.params.bagId });
});

/**
 * Unassign whichever rider is currently on this bag.
 *   DELETE /api/bags/:bagId/rider
 */
router.delete("/bags/:bagId/rider", (req, res) => {
  const rider = getRiderByBagId(req.params.bagId);
  if (!rider) {
    // Nothing to unassign — be idempotent
    res.json({ success: true, message: "No rider was assigned to this bag" });
    return;
  }
  updateRider(rider.id, { bag_id: null });
  res.json({ success: true, riderId: rider.id });
});

// ── Documents ────────────────────────────────────────────────────────────────

router.post("/riders/:id/documents", (req, res) => {
  const { type, filename, mime_type, data, size_bytes } = req.body ?? {};
  if (!type || !filename || !data) {
    res.status(400).json({ error: "type, filename, and data are required" });
    return;
  }
  const updated = addDocument(req.params.id, {
    type: String(type),
    filename: String(filename),
    mime_type: String(mime_type ?? "application/octet-stream"),
    data: String(data),
    size_bytes: Number(size_bytes ?? 0),
  });
  if (!updated) { res.status(404).json({ error: "Rider not found" }); return; }
  res.json(updated);
});

router.delete("/riders/:id/documents/:docId", (req, res) => {
  const updated = removeDocument(req.params.id, req.params.docId);
  if (!updated) { res.status(404).json({ error: "Rider or document not found" }); return; }
  res.json(updated);
});

// ── Sessions / hours stubs (real implementations live in colorlight/routes.ts) ──

// /riders/:id/sessions is handled in colorlight/routes.ts, which has access to
// the GPS track API. This file exports just the rider-CRUD subset.

export { router as riderStoreRouter };
