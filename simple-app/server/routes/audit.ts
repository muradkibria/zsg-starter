import { Router } from "express";
import { pb } from "../db/pocketbase.js";

export const auditRouter = Router();

export async function logAudit(
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  try {
    await pb.collection("audit_logs").create({ user_id: userId, action, entity_type: entityType, entity_id: entityId, details });
  } catch {
    // Non-fatal — don't let audit failures break the request
  }
}

auditRouter.get("/", async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  const filter = req.query.entity_type
    ? pb.filter("entity_type = {:type}", { type: req.query.entity_type as string })
    : "";

  const result = await pb.collection("audit_logs").getList(page, limit, {
    sort: "-created",
    ...(filter ? { filter } : {}),
  });

  res.json(result.items);
});
