// ─────────────────────────────────────────────────────────────────────────────
// Colorlight GPS poller — every 10s, fetch the latest position for all
// terminals from /monitor/query/latest and emit a Socket.IO `bag:position`
// event for each one whose timestamp changed.
//
// The frontend's `useLiveBags` hook seeds from /api/fleet/live and then layers
// these Socket.IO events on top, so the map updates in near-real-time without
// each browser hammering Colorlight directly.
// ─────────────────────────────────────────────────────────────────────────────

import { listTerminals, getLatestGpsBatched, type ColorlightLatestGps } from "./client.js";
import { getIO } from "../socket.js";

const POLL_INTERVAL_MS = 10_000;

let timer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;
const lastReportTimeByTerminal = new Map<number, string>();

export function startColorlightGpsPoller() {
  if (timer) return;

  const tick = async () => {
    let gps: ColorlightLatestGps[] = [];
    try {
      const terminals = await listTerminals();
      gps = await getLatestGpsBatched(terminals.map((t) => t.id));
      consecutiveFailures = 0;
    } catch (err: any) {
      consecutiveFailures++;
      // Quiet logs after the first few — Colorlight outages can be long
      if (consecutiveFailures <= 3 || consecutiveFailures % 30 === 0) {
        console.warn(
          `[colorlight-gps] poll failed (${consecutiveFailures}× in a row): ${err.message}`
        );
      }
      return;
    }

    let io;
    try { io = getIO(); }
    catch { return; } // Socket.IO not initialised yet — skip emit

    let emitted = 0;
    for (const p of gps) {
      if (p.latitude == null || p.longitude == null) continue;
      const last = lastReportTimeByTerminal.get(p.terminalId);
      if (last === p.reportTime) continue; // unchanged
      lastReportTimeByTerminal.set(p.terminalId, p.reportTime);

      io.emit("bag:position", {
        bagId: String(p.terminalId),
        lat: p.latitude,
        lng: p.longitude,
        speed: p.speed ?? null,
        heading: p.direct ?? null,
        timestamp: p.reportTime,
      });
      emitted++;
    }

    if (emitted > 0) {
      // Single concise log per tick — not per terminal
      // (helpful for verifying the poller is alive without log spam)
      // Comment out if too chatty.
      // console.log(`[colorlight-gps] emitted ${emitted} updates`);
    }
  };

  // Fire once immediately so the map populates without waiting 10s
  tick().catch(() => {});
  timer = setInterval(tick, POLL_INTERVAL_MS);
  console.log(`[colorlight-gps] poller started (${POLL_INTERVAL_MS / 1000}s interval)`);
}

export function stopColorlightGpsPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
