// Audit log: every change anyone makes, in plain English.

import type { SessionUser } from "@digilite/shared";
import { pb } from "../pb";
import { logger } from "../log";

const log = logger("audit");

export async function audit(
  actor: SessionUser | null,
  action: string,
  summary: string,
  entity?: { type: string; id: string },
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    await pb.collection("audit_log").create({
      actor: actor?.id ?? "",
      actor_name: actor?.name ?? "System",
      action,
      entity_type: entity?.type ?? "",
      entity_id: entity?.id ?? "",
      summary,
      meta: meta ?? {},
    });
  } catch (err) {
    log.warn(`could not write audit entry "${action}"`, err);
  }
}
