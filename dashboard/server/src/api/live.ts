// Server-sent events: pushes bag changes to open dashboards as the Colorlight sync
// stores them. Clients never poll Colorlight; they receive our stored data.

import type { Request, Response } from "express";
import type { LiveEvent } from "@digilite/shared";
import { liveBags, fleetOverview } from "../domain/fleet";
import { subscribe } from "../events";

export function liveStream(req: Request, res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (e: LiveEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  send({ type: "hello", asOf: new Date().toISOString() });

  let pending = new Set<string>();
  let statusChanged = false;
  let timer: NodeJS.Timeout | null = null;

  const flush = async () => {
    timer = null;
    const ids = [...pending];
    pending = new Set();
    try {
      if (ids.length) send({ type: "bags", asOf: new Date().toISOString(), bags: await liveBags({ ids }) });
      if (statusChanged) {
        statusChanged = false;
        send({ type: "overview", overview: await fleetOverview() });
      }
    } catch {
      // next event will retry
    }
  };

  const unsubscribe = subscribe((e) => {
    for (const id of e.bagIds) pending.add(id);
    if (e.type === "bags.status") statusChanged = true;
    if (!timer) timer = setTimeout(flush, 1000);
  });

  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
    unsubscribe();
  });
}
