// Colorlight sync: the whole fleet's device status in one call, recorded on `bags`.

import { bagNameFromColorlight, programNameFromVsn } from "@digilite/shared";
import { listTerminals } from "../client";
import type { ClLedStatus, ClTerminal } from "../types";
import { confirmCommands } from "../../domain/commands";
import { invalidateBags, loadBags } from "../../domain/bags";
import { matchPlayingLoop, type LoopRef, type PlayingSource } from "../../domain/playing";
import { noteReconnect, RECONNECT_GAP_MS } from "./reconcile";
import { publish } from "../../events";
import { logger } from "../../log";
import { getAll, pb, pbDate, parsePbDate, type RecordModel } from "../../pb";
import { markOk } from "../../jobs/state";

const log = logger("colorlight:status");

function epoch(v: unknown): Date | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

/** Keep the useful device status, drop SIM/phone identifiers (IMSI, ICCID, IMEI, numbers). */
function sanitizeStatus(s: ClLedStatus | undefined): Record<string, unknown> {
  if (!s) return {};
  const copy: Record<string, unknown> = { ...s };
  const g = s["4ginfo"]?.data;
  copy["4ginfo"] = g ? { networktype: g.networktype ?? null, datastate: g.datastate ?? null, simstate: g.simstate ?? null } : null;
  delete copy.ifstatus;
  delete copy.http_verification;
  return copy;
}

function groupId(t: ClTerminal): number | null {
  const g = t.terminalgroup?.[0];
  if (g == null) return null;
  return typeof g === "number" ? g : g.id;
}

export function terminalToFields(t: ClTerminal): Record<string, unknown> {
  const s = t.post_meta?._led_status;
  const info = s?.info?.info ?? {};
  const title = t.title?.raw ?? t.title?.rendered ?? `Terminal ${t.id}`;
  const storage = info.storage;
  const vsn = info.playing?.name ?? "";
  const report = epoch(t.post_meta?._led_latest_report_time);
  const shot = epoch(t.post_meta?._led_latest_screenshot_time);
  return {
    colorlight_id: t.id,
    colorlight_name: title,
    group_id: groupId(t),
    model: info.model ?? "",
    firmware: info.vername ?? "",
    serial: info.serialno ?? "",
    width: s?.dimension?.real_width ?? s?.dimension?.width ?? null,
    height: s?.dimension?.real_height ?? s?.dimension?.height ?? null,
    brightness_raw: s?.brightnessandcolortemp?.brightness ?? null,
    timezone: s?.rtc?.timezone ?? "",
    locale: s?.locale ? `${s.locale.country ?? ""}/${s.locale.language ?? ""}` : "",
    playing_vsn: vsn,
    playing_program: programNameFromVsn(vsn) ?? "",
    downloaded_programs: (t.post_meta?.download_status?.programs ?? []).map((p) => ({ id: p.id, name: p.name })),
    storage_used_pct: storage?.total ? Math.round(100 * (1 - (storage.free ?? 0) / storage.total)) : null,
    power_on: s?.powerstatus?.powerstatus === 1,
    ws_connected: s?.WebSocketStatus?.status === "1",
    last_report_at: report ? pbDate(report) : "",
    last_screenshot_at: shot ? pbDate(shot) : "",
    gps_interval_s: s?.reporttime?.gps_report_interval ?? null,
    device_status: sanitizeStatus(s),
  };
}

const COMPARE = [
  "colorlight_name", "group_id", "model", "firmware", "serial", "width", "height", "brightness_raw", "timezone", "locale",
  "playing_vsn", "playing_loop", "downloaded_programs", "storage_used_pct", "power_on", "ws_connected", "last_report_at",
  "last_screenshot_at", "gps_interval_s",
];

function sameDate(a: unknown, b: unknown) {
  const da = parsePbDate(a as string)?.getTime() ?? null;
  const db = parsePbDate(b as string)?.getTime() ?? null;
  return da === db;
}

export async function syncStatus(): Promise<void> {
  const terminals = await listTerminals();
  const existing = new Map((await loadBags({ fresh: true })).map((b) => [b.colorlight_id as number, b]));
  const loops = await getAll<RecordModel & LoopRef>("loops", {
    fields: "id,name,status,colorlight_program_id,colorlight_program_name,colorlight_vsn",
  });
  const batch = pb.createBatch();
  let creates = 0;
  const changed: string[] = [];
  const reconnected: { bagId: string; lastSeen: Date }[] = [];
  for (const t of terminals) {
    const fields = terminalToFields(t);
    fields.playing_loop = matchPlayingLoop(fields as PlayingSource, loops)?.id ?? "";
    const cur = existing.get(t.id);
    if (!cur) {
      batch.collection("bags").create({
        ...fields,
        name: bagNameFromColorlight(fields.colorlight_name as string, t.id),
        lifecycle: "active",
        status_synced_at: pbDate(new Date()),
      });
      creates++;
      continue;
    }
    // Back after a long silence: it may upload plays it kept while offline.
    const before = parsePbDate(cur.last_report_at);
    const after = parsePbDate(fields.last_report_at as string);
    if (before && after && after.getTime() - before.getTime() > RECONNECT_GAP_MS) reconnected.push({ bagId: cur.id, lastSeen: before });
    const diff = COMPARE.some((k) =>
      k.endsWith("_at") ? !sameDate(cur[k], fields[k]) : JSON.stringify(cur[k] ?? null) !== JSON.stringify(fields[k] ?? null),
    );
    if (diff) {
      batch.collection("bags").update(cur.id, { ...fields, status_synced_at: pbDate(new Date()) });
      changed.push(cur.id);
    }
  }
  if (creates || changed.length) await batch.send();
  invalidateBags();
  if (creates) log.info(`added ${creates} new bag(s) from Colorlight`);
  markOk("lastStatusSync");
  if (changed.length) publish({ type: "bags.status", bagIds: changed });
  for (const r of reconnected) await noteReconnect(r.bagId, r.lastSeen);

  // Confirm brightness commands once bags report the new value.
  const pending = await getAll<RecordModel>("commands", { filter: 'status = "sent"', fields: "bag" });
  if (pending.length) {
    const bags = await loadBags();
    for (const bagId of new Set(pending.map((p) => p.bag as string))) {
      const bag = bags.find((b) => b.id === bagId);
      if (bag) await confirmCommands(bag);
    }
  }
}
