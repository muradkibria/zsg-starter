// Bag commands (brightness, restart, screenshot, sleep, wake): recorded in
// PocketBase, sent through the gate, confirmed later by the status sync.

import type { BagCommandRequest, CommandResult, CommandSummary, SessionUser } from "@digilite/shared";
import { sendCommand } from "../colorlight/writes";
import { getAll, parsePbDate, pb, pbDate, q, type RecordModel } from "../pb";
import { audit } from "./audit";
import { getSettings } from "./settings";

/** The command's details without the full Colorlight payload (that stays in PocketBase). */
function listedValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value ?? null;
  const { payload: _payload, ...rest } = value as Record<string, unknown>;
  return rest;
}

export function toCommandSummary(r: RecordModel): CommandSummary {
  return {
    id: r.id,
    bagId: r.bag,
    type: r.type,
    value: listedValue(r.value),
    status: r.status,
    error: r.error || null,
    createdAt: parsePbDate(r.created)?.toISOString() ?? "",
    requestedBy: (r.expand?.requested_by as RecordModel | undefined)?.name ?? null,
  };
}

export async function recentCommands(bagId: string, limit = 10): Promise<CommandSummary[]> {
  const res = await pb.collection("commands").getList(1, limit, {
    filter: `bag = ${q(bagId)}`,
    sort: "-created",
    expand: "requested_by",
    skipTotal: true,
  });
  return res.items.map(toCommandSummary);
}

const LABEL: Record<BagCommandRequest["type"], string> = {
  brightness: "brightness",
  reboot: "restart",
  screenshot: "screenshot",
  sleep: "screen off",
  wakeup: "screen on",
};

export async function runBagCommand(bag: RecordModel, req: BagCommandRequest, user: SessionUser): Promise<CommandResult> {
  const settings = await getSettings();
  let value: number | undefined;
  let valueJson: unknown = null;
  if (req.type === "brightness") {
    const pct = Math.max(1, Math.min(100, Math.round(req.value)));
    value = settings.brightnessCommandScale === 255 ? Math.round(pct * 2.55) : pct;
    valueJson = { pct, sent: value, scale: settings.brightnessCommandScale };
  }

  let status: CommandSummary["status"];
  let error = "";
  let response: unknown = null;
  let message: string;
  try {
    const outcome = await sendCommand(req.type, [bag.colorlight_id], value);
    response = outcome.response ?? null;
    if (outcome.decision.action === "send") {
      status = "sent";
      message = `Sent to ${bag.name}. It applies when the bag next checks in.`;
    } else if (outcome.decision.action === "dry_run") {
      status = "dry_run";
      message = `Dry run: ${outcome.decision.reason}`;
    } else {
      status = "blocked";
      error = outcome.decision.reason;
      message = outcome.decision.reason;
    }
  } catch (err) {
    status = "failed";
    error = (err as Error).message;
    message = `Couldn't send to ${bag.name}: ${error}`;
  }

  const rec = await pb.collection("commands").create(
    { bag: bag.id, type: req.type, value: valueJson, status, response, error, requested_by: user.id },
    { expand: "requested_by" },
  );
  await audit(
    user,
    `bag.${req.type}`,
    `${LABEL[req.type][0].toUpperCase()}${LABEL[req.type].slice(1)} on ${bag.name}${req.type === "brightness" ? ` to ${(valueJson as { pct: number }).pct}%` : ""} — ${status.replace("_", " ")}`,
    { type: "bag", id: bag.id },
  );
  return { command: toCommandSummary(rec), message };
}

/**
 * Mark sent schedules confirmed once the schedule read back from the bag names
 * every loop file the send did (the device sync reads schedules hourly).
 */
export async function confirmScheduleCommands(bag: RecordModel, deviceSchedule: unknown): Promise<void> {
  if (!deviceSchedule) return;
  const pending = await getAll<RecordModel>("commands", {
    filter: `bag = ${q(bag.id)} && status = "sent" && type = "schedule"`,
    sort: "-created",
  });
  if (!pending.length) return;
  const onBag = JSON.stringify(deviceSchedule);
  for (const c of pending) {
    const payload = (c.value as { payload?: unknown } | null)?.payload;
    if (!payload) continue;
    const files = [...JSON.stringify(payload).matchAll(/"vsn":"((?:[^"\\]|\\.)+)"/g)].map((m) => `"vsn":"${m[1]}"`);
    if (files.length && files.every((f) => onBag.includes(f))) {
      await pb.collection("commands").update(c.id, { status: "confirmed", confirmed_at: pbDate(new Date()) });
    }
  }
}

/** Mark sent brightness commands confirmed once the bag reports the new value. */
export async function confirmCommands(bag: RecordModel): Promise<void> {
  const pending = await getAll<RecordModel>("commands", {
    filter: `bag = ${q(bag.id)} && status = "sent" && type = "brightness"`,
    sort: "-created",
  });
  for (const c of pending) {
    const pct = (c.value as { pct?: number } | null)?.pct;
    const nowPct = bag.brightness_raw != null ? Math.round((bag.brightness_raw / 255) * 100) : null;
    if (pct != null && nowPct != null && Math.abs(nowPct - pct) <= 2) {
      await pb.collection("commands").update(c.id, { status: "confirmed", confirmed_at: pbDate(new Date()) });
    }
  }
}
