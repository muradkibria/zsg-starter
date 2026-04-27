import { Router } from "express";
import { pb } from "../db/pocketbase.js";

export const reportsRouter = Router();

function groupByDate(records: any[], dateField: string) {
  const map = new Map<string, any[]>();
  for (const r of records) {
    const date = (r[dateField] as string).split(" ")[0].split("T")[0];
    if (!map.has(date)) map.set(date, []);
    map.get(date)!.push(r);
  }
  return map;
}

reportsRouter.get("/campaign/:id", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  let filter = pb.filter("media_id = {:id}", { id: req.params.id });
  if (from) filter += ` && played_at >= "${from}"`;
  if (to) filter += ` && played_at <= "${to}"`;

  const events = await pb.collection("ad_play_events").getFullList({
    filter,
    sort: "played_at",
  });

  const grouped = groupByDate(events, "played_at");
  const rows = Array.from(grouped.entries()).map(([date, items]) => ({
    date,
    plays: items.length,
    totalSeconds: items.reduce((sum, i) => sum + (i.duration_seconds ?? 0), 0),
  }));

  res.json(rows);
});

reportsRouter.get("/zone/:id", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  let filter = pb.filter("zone_id = {:id}", { id: req.params.id });
  if (from) filter += ` && entered_at >= "${from}"`;
  if (to) filter += ` && entered_at <= "${to}"`;

  const events = await pb.collection("zone_dwell_events").getFullList({
    filter,
    sort: "entered_at",
  });

  const grouped = groupByDate(events, "entered_at");
  const rows = Array.from(grouped.entries()).map(([date, items]) => {
    const dwells = items.map((i) => i.dwell_seconds ?? 0).filter((s) => s > 0);
    return {
      date,
      visits: items.length,
      avgDwellSeconds: dwells.length ? +(dwells.reduce((a, b) => a + b, 0) / dwells.length).toFixed(1) : 0,
      totalDwellSeconds: dwells.reduce((a, b) => a + b, 0),
    };
  });

  res.json(rows);
});

reportsRouter.get("/rider/:id", async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };

  let filter = pb.filter("rider_id = {:id}", { id: req.params.id });
  if (from) filter += ` && started_at >= "${from}"`;
  if (to) filter += ` && started_at <= "${to}"`;

  const sessions = await pb.collection("rider_sessions").getFullList({
    filter,
    sort: "started_at",
  });

  const grouped = groupByDate(sessions, "started_at");
  const now = Date.now();
  const rows = Array.from(grouped.entries()).map(([date, items]) => ({
    date,
    sessions: items.length,
    totalSeconds: Math.round(
      items.reduce((sum, s) => {
        const start = new Date(s.started_at).getTime();
        const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
        return sum + (end - start) / 1000;
      }, 0)
    ),
  }));

  res.json(rows);
});

reportsRouter.get("/export/csv", async (req, res) => {
  const { type, id } = req.query as { type?: string; id?: string };
  if (!type || !id) { res.status(400).json({ error: "type and id required" }); return; }

  let csvRows: string[] = [];

  if (type === "campaign") {
    const rows = await pb.collection("ad_play_events").getFullList({
      filter: pb.filter("media_id = {:id}", { id }),
    });
    csvRows = ["bag_id,media_id,played_at,duration_seconds",
      ...rows.map((r) => `${r["bag_id"]},${r["media_id"]},${r["played_at"]},${r["duration_seconds"] ?? ""}`)];
  } else if (type === "zone") {
    const rows = await pb.collection("zone_dwell_events").getFullList({
      filter: pb.filter("zone_id = {:id}", { id }),
    });
    csvRows = ["bag_id,zone_id,entered_at,exited_at,dwell_seconds",
      ...rows.map((r) => `${r["bag_id"]},${r["zone_id"]},${r["entered_at"]},${r["exited_at"] ?? ""},${r["dwell_seconds"] ?? ""}`)];
  } else if (type === "rider") {
    const rows = await pb.collection("rider_sessions").getFullList({
      filter: pb.filter("rider_id = {:id}", { id }),
    });
    csvRows = ["rider_id,bag_id,started_at,ended_at",
      ...rows.map((r) => `${r["rider_id"]},${r["bag_id"]},${r["started_at"]},${r["ended_at"] ?? ""}`)];
  } else {
    res.status(400).json({ error: "Invalid type" });
    return;
  }

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-report.csv"`);
  res.send(csvRows.join("\n"));
});
