import { pb } from "../db/pocketbase.js";
import { colortlightService } from "./colorlight.js";
import { checkPosition, refreshZones } from "./geo-fence.js";
import { getIO } from "../socket.js";

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startGpsPoller() {
  if (pollTimer) return;

  refreshZones().catch((err) => console.error("[gps-poller] zone load:", err));
  setInterval(() => refreshZones().catch(() => {}), 60_000);

  pollTimer = setInterval(async () => {
    let activeBags: any[];

    try {
      activeBags = await pb.collection("bags").getFullList({
        filter: 'status = "active"',
        fields: "id,colorlight_device_id",
      });
    } catch {
      return;
    }

    if (activeBags.length === 0) return;

    const now = new Date().toISOString();
    const results = await Promise.allSettled(
      activeBags.map((bag) => colortlightService.getDeviceGPS(bag["colorlight_device_id"]))
    );

    const gpsInserts: Promise<any>[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const bag = activeBags[i];

      if (result.status === "rejected") {
        console.warn(`[gps-poller] ${bag["colorlight_device_id"]}:`, result.reason?.message);
        continue;
      }

      const { lat, lng, speed, heading } = result.value;
      if (lat == null || lng == null) continue;

      // Write GPS event to PocketBase
      gpsInserts.push(
        pb.collection("gps_events").create({
          bag_id: bag.id,
          lat,
          lng,
          speed,
          heading,
        }, { $autoCancel: false }).catch(() => {})
      );

      // Update bag's last known position inline (for fleet/live query efficiency)
      gpsInserts.push(
        pb.collection("bags").update(bag.id, {
          last_lat: lat,
          last_lng: lng,
          last_speed: speed,
          last_heading: heading,
          last_gps_at: now,
          status: "active",
        }, { $autoCancel: false }).catch(() => {})
      );

      checkPosition(bag.id, lat, lng).catch(() => {});

      try {
        getIO().emit("bag:position", { bagId: bag.id, lat, lng, speed, heading, timestamp: now });
      } catch {}
    }

    await Promise.allSettled(gpsInserts);
  }, 3_000);

  console.log("[gps-poller] started");
}

export function stopGpsPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
