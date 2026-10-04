// In-process event bus: the Colorlight sync publishes, the SSE endpoint listens.

import { EventEmitter } from "node:events";

export type BusEvent =
  | { type: "bags.status"; bagIds: string[] }
  | { type: "bags.positions"; bagIds: string[] }
  | { type: "tracks.updated"; bagIds: string[] };

const bus = new EventEmitter();
bus.setMaxListeners(200);

export function publish(e: BusEvent) {
  bus.emit("event", e);
}

export function subscribe(fn: (e: BusEvent) => void): () => void {
  bus.on("event", fn);
  return () => bus.off("event", fn);
}
