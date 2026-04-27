import cron from "node-cron";
import { pb } from "../db/pocketbase.js";
import { colortlightService } from "./colorlight.js";

export function startScheduleEnforcer() {
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const todayDate = now.toISOString().split("T")[0];
    const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
    const dow = now.getDay();

    let schedules: any[];

    try {
      schedules = await pb.collection("schedules").getFullList({
        filter: pb.filter(
          "start_date <= {:today} && end_date >= {:today} && start_time <= {:time} && end_time >= {:time}",
          { today: todayDate, time: currentTime }
        ),
        expand: "bag_id,media_id",
      });
    } catch {
      return;
    }

    // Filter client-side for day-of-week (JSON array field not queryable server-side)
    const active = schedules.filter((s) => {
      const days: number[] = s["days_of_week"] ?? [0, 1, 2, 3, 4, 5, 6];
      return days.includes(dow);
    });

    for (const schedule of active) {
      const bag = schedule.expand?.["bag_id"];
      const media = schedule.expand?.["media_id"];
      if (!bag || !media) continue;

      try {
        const programId = await colortlightService.createProgram(`auto-${schedule.id}`, media.id);
        await colortlightService.assignProgramToDevice(bag["colorlight_device_id"], programId);

        await pb.collection("ad_play_events").create({
          bag_id: bag.id,
          media_id: media.id,
          played_at: now.toISOString(),
          duration_seconds: media["duration_seconds"] ?? null,
        });
      } catch (err: any) {
        console.warn(`[schedule-enforcer] bag ${bag.id}:`, err.message);
      }
    }
  });

  console.log("[schedule-enforcer] started");
}
