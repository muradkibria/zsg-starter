// Fleet overview: status counts and the "needs attention" list.

import { STATUS_ORDER, type AttentionItem, type BagStatus, type BagSummary, type FleetOverview, type LiveBag } from "@digilite/shared";
import { config } from "../config";
import { health } from "../jobs/state";
import { bagSummaries, loadBags } from "./bags";
import { riderAttentionCounts } from "./riders";
import { getSettings } from "./settings";
import { recentTrails } from "./tracks";

function names(bags: BagSummary[], max = 3) {
  const list = bags.slice(0, max).map((b) => b.name);
  const more = bags.length - list.length;
  return list.join(", ") + (more > 0 ? ` and ${more} more` : "");
}

export async function attentionItems(bags: BagSummary[]): Promise<AttentionItem[]> {
  const s = await getSettings();
  const by = (k: string) => bags.filter((b) => b.issues.some((i) => i.kind === k));
  const items: AttentionItem[] = [];

  const gone = by("not_seen");
  if (gone.length)
    items.push({
      kind: "not_seen", severity: "red", count: gone.length,
      title: gone.length === 1 ? "A bag not seen for over a week" : "Bags not seen for over a week",
      body: "In storage, broken or lost? Mark them so they stop counting as missing.",
      bagIds: gone.map((b) => b.id), href: "/bags?issue=not_seen",
    });

  const clocks = by("clock");
  if (clocks.length)
    items.push({
      kind: "clock", severity: "red", count: clocks.length,
      title: "Clocks not on London time",
      body: `${names(clocks)}. Schedules would run at the wrong time on these bags. Fix before applying any.`,
      bagIds: clocks.map((b) => b.id), href: "/bags?issue=clock",
    });

  const noRider = by("no_rider");
  if (noRider.length)
    items.push({
      kind: "no_rider", severity: "amber", count: noRider.length,
      title: "Out without a rider",
      body: "Their hours and routes can't be credited to anyone until a rider is assigned.",
      bagIds: noRider.map((b) => b.id), href: "/bags?issue=no_rider",
    });

  const loops = by("old_loop");
  if (loops.length)
    items.push({
      kind: "old_loop", severity: "amber", count: loops.length,
      title: "Playing a different loop",
      body: s.fleetLoopName ? `The fleet loop is "${s.fleetLoopName}". ${names(loops)} play something else.` : `${names(loops)}.`,
      bagIds: loops.map((b) => b.id), href: "/bags?issue=old_loop",
    });

  const bright = by("brightness");
  if (bright.length) {
    const pcts = bright.map((b) => b.brightnessPct ?? 0);
    items.push({
      kind: "brightness", severity: "amber", count: bright.length,
      title: "Brighter or dimmer than the rest",
      body: `Fleet brightness is ${s.brightnessTargetPct}%. These range from ${Math.min(...pcts)}% to ${Math.max(...pcts)}%.`,
      bagIds: bright.map((b) => b.id), href: "/bags?issue=brightness",
    });
  }

  const sw = by("software");
  if (sw.length)
    items.push({
      kind: "software", severity: "info", count: sw.length,
      title: "Older software",
      body: `${names(sw)}. The rest of the fleet runs newer software.`,
      bagIds: sw.map((b) => b.id), href: "/bags?issue=software",
    });

  // Riders: waiting for a bag, documents due within 30 days.
  const riders = await riderAttentionCounts();
  if (riders.waiting)
    items.push({
      kind: "riders_waiting", severity: "info", count: riders.waiting,
      title: riders.waiting === 1 ? "A rider waiting for a bag" : "Riders waiting for a bag",
      body: "Give them a spare bag to get them out.",
      bagIds: [], href: "/riders?stage=waiting",
    });
  if (riders.docsDue)
    items.push({
      kind: "documents_due", severity: "amber", count: riders.docsDue,
      title: riders.docsDue === 1 ? "A rider's documents need attention" : "Riders' documents need attention",
      body: "Expired, expiring within 30 days, or missing.",
      bagIds: [], href: "/riders?docs=due",
    });

  const rank = { red: 0, amber: 1, info: 2 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function fleetOverview(): Promise<FleetOverview> {
  const bags = (await bagSummaries()).filter((b) => b.lifecycle !== "retired");
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<BagStatus, number>;
  for (const b of bags) counts[b.status]++;
  const s = await getSettings();
  return {
    asOf: new Date().toISOString(),
    total: bags.length,
    counts,
    attention: await attentionItems(bags),
    writeMode: config.COLORLIGHT_WRITES,
    fleetWritesEnabled: s.fleetWritesEnabled,
    testBagIds: (await loadBags()).filter((b) => config.testBagIds.includes(b.colorlight_id)).map((b) => b.id),
    fleetLoop: s.fleetLoopName || null,
    brightnessTargetPct: s.brightnessTargetPct,
    sync: { ...health },
  };
}

/** Bags for the live map, with a 30-minute trail for bags out now. */
export async function liveBags(filter?: { ids?: string[]; statuses?: BagStatus[] }): Promise<LiveBag[]> {
  let bags = (await bagSummaries()).filter((b) => b.lifecycle !== "retired");
  if (filter?.ids) bags = bags.filter((b) => filter.ids!.includes(b.id));
  if (filter?.statuses?.length) bags = bags.filter((b) => filter.statuses!.includes(b.status));
  const trails = await recentTrails(bags.filter((b) => b.status === "now").map((b) => b.id), 30);
  return bags.map((b) => ({ ...b, trail: trails.get(b.id) ?? [] }));
}
