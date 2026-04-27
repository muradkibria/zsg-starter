import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { pb } from "../db/pocketbase.js";
import { getIO } from "../socket.js";
import type { Feature, Polygon, MultiPolygon } from "geojson";

interface ZoneRecord {
  id: string;
  type: "radius" | "polygon";
  center_lat: number | null;
  center_lng: number | null;
  radius_meters: number | null;
  polygon_geojson: unknown;
}

let cachedZones: ZoneRecord[] = [];

// bagId -> zoneId -> open dwell event PocketBase record id
const activeOccupancy = new Map<string, Map<string, string>>();

export async function refreshZones() {
  const zones = await pb.collection("zones").getFullList({ filter: 'active = true' });
  cachedZones = zones as unknown as ZoneRecord[];
}

export async function checkPosition(bagId: string, lat: number, lng: number) {
  const pt = point([lng, lat]);
  const bagZones = activeOccupancy.get(bagId) ?? new Map<string, string>();

  for (const zone of cachedZones) {
    let inside = false;

    if (zone.type === "polygon" && zone.polygon_geojson) {
      try {
        const geo = zone.polygon_geojson as Feature<Polygon | MultiPolygon>;
        inside = booleanPointInPolygon(pt, (geo.geometry ?? geo) as any);
      } catch {}
    } else if (zone.type === "radius" && zone.center_lat != null && zone.center_lng != null && zone.radius_meters) {
      const dx = (lng - zone.center_lng) * 111320 * Math.cos((lat * Math.PI) / 180);
      const dy = (lat - zone.center_lat) * 110540;
      inside = Math.sqrt(dx * dx + dy * dy) <= zone.radius_meters;
    }

    const wasInside = bagZones.has(zone.id);

    if (inside && !wasInside) {
      // Zone entry — create dwell event, store its ID for later update on exit
      try {
        const dwell = await pb.collection("zone_dwell_events").create({
          bag_id: bagId,
          zone_id: zone.id,
          entered_at: new Date().toISOString(),
        });
        bagZones.set(zone.id, dwell.id);
        activeOccupancy.set(bagId, bagZones);
        try { getIO().emit("zone:enter", { bagId, zoneId: zone.id, timestamp: new Date().toISOString() }); } catch {}
      } catch {}

    } else if (!inside && wasInside) {
      // Zone exit — close the open dwell event
      const dwellId = bagZones.get(zone.id);
      bagZones.delete(zone.id);
      activeOccupancy.set(bagId, bagZones);

      if (dwellId) {
        try {
          const dwell = await pb.collection("zone_dwell_events").getOne(dwellId);
          const exitedAt = new Date();
          const dwellSeconds = (exitedAt.getTime() - new Date(dwell["entered_at"]).getTime()) / 1000;
          await pb.collection("zone_dwell_events").update(dwellId, {
            exited_at: exitedAt.toISOString(),
            dwell_seconds: dwellSeconds,
          });
        } catch {}
      }

      try { getIO().emit("zone:exit", { bagId, zoneId: zone.id, timestamp: new Date().toISOString() }); } catch {}
    }
  }
}
