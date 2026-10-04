import { describe, expect, it } from "vitest";
import {
  busiestStretch,
  campaignStatus,
  computeInventory,
  dayDiff,
  findLoop,
  isHouse,
  matchScore,
  NO_FACTS,
  periodPhrase,
  screenTimePhrase,
  shortRiderName,
  slotKind,
  summaryText,
  timeOfDay,
  type InvCampaign,
  type InvCreative,
  type InvLoop,
} from "../src/domain/campaigns";

const TODAY = "2026-09-29";
const confirmed = (startDay: string | null, endDay: string | null) => ({ confirmed: true, startDay, endDay });
const facts = (f: Partial<typeof NO_FACTS>) => ({ ...NO_FACTS, creativeFiles: 1, bagsCarrying: 5, ...f });

describe("campaign status", () => {
  it("is a draft when not confirmed or undated", () => {
    expect(campaignStatus({ confirmed: false, startDay: "2026-10-01", endDay: "2026-10-31" }, TODAY, NO_FACTS)).toMatchObject({
      phase: "draft",
      label: "Draft",
      warn: false,
    });
    expect(campaignStatus(confirmed(null, null), TODAY, NO_FACTS).phase).toBe("draft");
    // A draft already on screen is a problem worth flagging.
    expect(campaignStatus({ confirmed: false, startDay: "2026-10-01", endDay: "2026-10-31" }, TODAY, facts({ bagsCarrying: 3 }))).toMatchObject({
      phase: "draft",
      warn: true,
      note: "Not confirmed · already on 3 bags",
    });
  });

  it("shows the start date before it starts", () => {
    const s = campaignStatus(confirmed("2026-10-06", "2026-11-30"), TODAY, facts({ bagsCarrying: 0 }));
    expect(s).toMatchObject({ phase: "upcoming", label: "Starts 6 Oct", tone: "info", note: "Not on screen yet" });
    expect(campaignStatus(confirmed("2026-10-06", "2026-11-30"), TODAY, NO_FACTS).note).toBe("No creatives linked yet");
  });

  it("is live with the day count while running", () => {
    expect(campaignStatus(confirmed("2026-09-01", "2026-10-31"), TODAY, facts({}))).toMatchObject({
      phase: "live",
      label: "Live",
      tone: "green",
      note: "Day 29 of 61",
      warn: false,
    });
  });

  it("flags a live campaign that isn't on screen or has no creatives", () => {
    expect(campaignStatus(confirmed("2026-09-01", "2026-10-31"), TODAY, facts({ bagsCarrying: 0 }))).toMatchObject({
      phase: "live",
      note: "Not on screen in the last 7 days",
      warn: true,
    });
    expect(campaignStatus(confirmed("2026-09-01", "2026-10-31"), TODAY, NO_FACTS)).toMatchObject({ note: "No creatives linked", warn: true });
  });

  it("counts down in the last week", () => {
    expect(campaignStatus(confirmed("2026-09-01", "2026-10-02"), TODAY, facts({})).label).toBe("Ending in 3 days");
    expect(campaignStatus(confirmed("2026-09-01", "2026-09-30"), TODAY, facts({})).label).toBe("Ends tomorrow");
    expect(campaignStatus(confirmed("2026-09-01", TODAY), TODAY, facts({})).label).toBe("Ends today");
    expect(campaignStatus(confirmed("2026-09-01", "2026-10-06"), TODAY, facts({})).phase).toBe("ending");
    expect(campaignStatus(confirmed("2026-09-01", "2026-10-07"), TODAY, facts({})).phase).toBe("live");
  });

  it("says ended — still on screen when bags played it after the end date this week", () => {
    const s = campaignStatus(confirmed("2026-06-01", "2026-08-31"), TODAY, facts({ playsAfterEnd: 1200, bagsAfterEnd: 38 }));
    expect(s).toMatchObject({ phase: "ended_on_screen", label: "Ended — still on screen", tone: "red", note: "Still playing on 38 bags", warn: true });
  });

  it("is plainly ended once it's off screen", () => {
    expect(campaignStatus(confirmed("2026-06-01", "2026-08-31"), TODAY, facts({ bagsCarrying: 0 }))).toMatchObject({
      phase: "ended",
      label: "Ended",
      note: "Ended 31 Aug",
    });
    // Played after the end in the past, but not this week: ended, with the count as a note.
    expect(campaignStatus(confirmed("2026-06-01", "2026-08-31"), TODAY, facts({ playsAfterEnd: 1500, bagsAfterEnd: 0 }))).toMatchObject({
      phase: "ended",
      note: "1,500 plays after it ended",
    });
  });

  it("counts days between London days", () => {
    expect(dayDiff("2026-09-29", "2026-10-02")).toBe(3);
    // Across the clocks going back (25 Oct 2026) — still whole days.
    expect(dayDiff("2026-10-24", "2026-10-26")).toBe(2);
  });
});

// ── Inventory ────────────────────────────────────────────────────────────────

const NOW = new Date("2026-09-29T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

function world() {
  const creatives = new Map<string, InvCreative>([
    ["kpp", { id: "kpp", name: "CV-kung poa panda- Final", advertiser: "", campaignId: "c-live" }],
    ["fox", { id: "fox", name: "DigiLite- Fox- V1", advertiser: "", campaignId: null }],
    ["mtf", { id: "mtf", name: "MTF EVENT our ad", advertiser: "", campaignId: null }],
    ["pmj", { id: "pmj", name: "CV- Pure Mo-Ja- Final", advertiser: "", campaignId: "c-ended" }],
    ["ori", { id: "ori", name: "Oriel IPO v2", advertiser: "", campaignId: "c-draft" }],
  ]);
  const campaigns = new Map<string, InvCampaign>([
    ["c-live", { id: "c-live", label: "Kung Pao Panda — Autumn menu", advertiser: "Kung Pao Panda", phase: "live", demo: true }],
    ["c-ended", { id: "c-ended", label: "Pure Mo Ja — Launch", advertiser: "Pure Mo Ja", phase: "ended_on_screen", demo: false }],
    ["c-draft", { id: "c-draft", label: "Oriel IPO — Weekend", advertiser: "Oriel IPO", phase: "draft", demo: false }],
  ]);
  const loops: InvLoop[] = [
    { id: "L1", name: "June 26", programName: "June 26", status: "imported", publishedAt: new Date("2026-06-09"), items: [{ creative: "kpp" }, { creative: "fox" }, { creative: "mtf" }, { creative: "pmj" }, { creative: "ori" }, { creative: "gone" }] },
    // An older loop with the same name: the most recently published one wins.
    { id: "L0", name: "June 26", programName: "June 26", status: "imported", publishedAt: new Date("2026-01-01"), items: [{ creative: "fox" }] },
    { id: "L2", name: "House only", programName: "House only", status: "imported", publishedAt: new Date("2026-05-01"), items: [{ creative: "fox" }, { creative: "fox" }] },
  ];
  return { creatives, campaigns, loops };
}

describe("inventory", () => {
  it("classifies slots honestly", () => {
    const { creatives, campaigns } = world();
    expect(slotKind(creatives.get("kpp")!, campaigns.get("c-live")!)).toBe("sold");
    expect(slotKind(creatives.get("fox")!, null)).toBe("house");
    expect(slotKind(creatives.get("mtf")!, null)).toBe("unsold");
    expect(slotKind(creatives.get("pmj")!, campaigns.get("c-ended")!)).toBe("unsold_ended");
    expect(slotKind(creatives.get("ori")!, campaigns.get("c-draft")!)).toBe("unsold");
    expect(slotKind(null, null)).toBe("unsold");
    // A live campaign for DigiLite itself is still house, not sold.
    expect(slotKind({ id: "x", name: "Advertise here", advertiser: "", campaignId: "h" }, { id: "h", label: "DigiLite — House", advertiser: "DigiLite", phase: "live", demo: false })).toBe("house");
  });

  it("recognises DigiLite's own ads", () => {
    expect(isHouse("DigiLite- Fox- V4")).toBe(true);
    expect(isHouse("Digilite Charity Right - V99.1")).toBe(true);
    expect(isHouse("Digi Lite promo")).toBe(true);
    expect(isHouse("Isla Delice")).toBe(false);
    expect(isHouse("")).toBe(false);
  });

  it("matches a bag's loop by name, newest first", () => {
    const { loops } = world();
    expect(findLoop(loops, "June 26")?.id).toBe("L1");
    expect(findLoop(loops, " june 26 ")?.id).toBe("L1");
    expect(findLoop(loops, "Nope")).toBeNull();
    expect(findLoop(loops, null)).toBeNull();
  });

  it("counts bags out in the last 7 days × their loop's slots", () => {
    const { creatives, campaigns, loops } = world();
    const inv = computeInventory({
      now: NOW,
      creatives,
      campaigns,
      loops,
      bags: [
        { id: "b1", name: "Bag 001", lastReportAt: daysAgo(0.01), lifecycle: "active", isTest: false, playing: "June 26" },
        { id: "b2", name: "Bag 002", lastReportAt: daysAgo(6.5), lifecycle: "active", isTest: false, playing: "June 26" },
        { id: "b3", name: "Bag 003", lastReportAt: daysAgo(2), lifecycle: "active", isTest: false, playing: "House only" },
        { id: "b4", name: "Bag 004", lastReportAt: daysAgo(9), lifecycle: "active", isTest: false, playing: "June 26" },
        { id: "b5", name: "Bag 005", lastReportAt: null, lifecycle: "storage", isTest: false, playing: "House only" },
        { id: "b6", name: "Bag 006", lastReportAt: daysAgo(1), lifecycle: "active", isTest: false, playing: "Something we never copied" },
        { id: "b7", name: "Bag 007", lastReportAt: daysAgo(1), lifecycle: "retired", isTest: false, playing: "June 26" },
        { id: "t", name: "Bag 028", lastReportAt: daysAgo(0.01), lifecycle: "active", isTest: true, playing: "June 26" },
      ],
    });
    expect(inv.bagsCounted).toBe(4); // b1, b2, b3, b6 (retired and the test bag are left out)
    expect(inv.bagsNotCounted).toBe(2); // b4, b5
    expect(inv.slotsNotCounted).toBe(6 + 2);
    expect(inv.bagsUnknownLoop).toBe(1); // b6
    // b1 + b2 play June 26 (6 slots each), b3 plays House only (2 slots)
    expect(inv.totalSlots).toBe(14);
    expect(inv.sold).toBe(2);
    expect(inv.house).toBe(2 + 2);
    expect(inv.unsold).toBe(8); // mtf, pmj, ori, missing × 2 bags
    expect(inv.unsoldEnded).toBe(2);
    expect(inv.sold + inv.house + inv.unsold).toBe(inv.totalSlots);
    expect(inv.soldBy).toEqual([{ campaignId: "c-live", label: "Kung Pao Panda — Autumn menu", slots: 2, demo: true }]);
    expect(inv.endedBy).toEqual([{ campaignId: "c-ended", label: "Pure Mo Ja — Launch", slots: 2 }]);
    expect(inv.testBagExcluded).toBe(true);
    // Grid: counted bags first, with one cell per slot.
    expect(inv.bags.map((b) => b.counted)).toEqual([true, true, true, true, false, false]);
    expect(inv.bags.find((b) => b.bagId === "b1")!.cells).toEqual(["sold", "house", "unsold", "unsold_ended", "unsold", "unsold"]);
    expect(inv.loops.map((l) => [l.name, l.bags])).toEqual([
      ["June 26", 2],
      ["House only", 1],
    ]);
  });

  it("is empty but well-formed with no bags out", () => {
    const { creatives, campaigns, loops } = world();
    const inv = computeInventory({ now: NOW, creatives, campaigns, loops, bags: [] });
    expect(inv).toMatchObject({ bagsCounted: 0, totalSlots: 0, sold: 0, house: 0, unsold: 0, testBagExcluded: false });
  });
});

// ── Suggestions ──────────────────────────────────────────────────────────────

describe("suggested creatives", () => {
  it("matches names that contain the advertiser", () => {
    expect(matchScore("Isla Delice", "Isla Delice- Fillet- 2nd ad- Final")?.score).toBe(1);
    expect(matchScore("Isla Delice", "CV-Isla Delice-Fillet- Final")?.score).toBe(1);
    expect(matchScore("Pure Mo Ja", "CV- Pure Mo-Ja- Final")?.score).toBe(1);
    expect(matchScore("Connectbike", "Connectbike- V4.2")?.score).toBe(1);
  });

  it("tolerates small typos and extra words", () => {
    const m = matchScore("Kung Pao Panda", "CV-kung poa panda- Final");
    expect(m?.score).toBeGreaterThanOrEqual(0.5);
    expect(matchScore("Midas Building Services", "Midas advert")?.score).toBeGreaterThanOrEqual(0.5);
  });

  it("uses the creative's advertiser field when set", () => {
    expect(matchScore("Isla Delice", "Brunch 10s", "isla delice")?.score).toBe(1);
  });

  it("doesn't match unrelated ads", () => {
    expect(matchScore("Isla Delice", "DigiLite- Fox- V1")).toBeNull();
    expect(matchScore("Kung Pao Panda", "MTF EVENT our ad")).toBeNull();
    expect(matchScore("Oriel IPO", "Ambala 800")).toBeNull();
    expect(matchScore("A", "A great ad")).toBeNull();
  });
});

// ── Time of day and summary ──────────────────────────────────────────────────

const hours = (pairs: Record<number, number>) => Array.from({ length: 24 }, (_, h) => pairs[h] ?? 0);

describe("time of day", () => {
  it("puts every hour in exactly one band", () => {
    const all = Array.from({ length: 24 }, () => 1);
    const bands = timeOfDay(all);
    expect(bands.reduce((s, b) => s + b.plays, 0)).toBe(24);
    expect(bands.find((b) => b.key === "night")).toMatchObject({ range: "23–06", plays: 7 });
    expect(bands.reduce((s, b) => s + b.share, 0)).toBeCloseTo(1);
    expect(timeOfDay(hours({})).every((b) => b.share === 0)).toBe(true);
  });

  it("finds the busiest three-hour stretch, wrapping past midnight", () => {
    expect(busiestStretch(hours({ 17: 50, 18: 90, 19: 80, 12: 60 }))).toEqual({ startHour: 17, endHour: 20, plays: 220 });
    expect(busiestStretch(hours({ 23: 40, 0: 40, 1: 40, 12: 10 }))).toEqual({ startHour: 23, endHour: 2, plays: 120 });
    expect(busiestStretch(hours({}))).toBeNull();
  });
});

describe("summary paragraph", () => {
  it("writes the period in plain English", () => {
    expect(periodPhrase("2026-09-28", "2026-09-28")).toBe("on 28 September");
    expect(periodPhrase("2026-09-01", "2026-09-28")).toBe("between 1 and 28 September");
    expect(periodPhrase("2026-09-30", "2026-10-02")).toBe("between 30 September and 2 October");
    expect(periodPhrase("2026-12-28", "2027-01-03")).toBe("between 28 December 2026 and 3 January 2027");
  });

  it("rounds screen time sensibly", () => {
    expect(screenTimePhrase(30)).toBe("1 minute");
    expect(screenTimePhrase(38 * 60)).toBe("38 minutes");
    expect(screenTimePhrase(4.46 * 3600)).toBe("4.5 hours");
    expect(screenTimePhrase(713.4 * 3600)).toBe("713 hours");
    expect(screenTimePhrase(1250 * 3600)).toBe("1,250 hours");
  });

  const base = {
    name: "Autumn menu",
    fromDay: "2026-09-01",
    toDay: "2026-09-28",
    plays: 256560,
    seconds: 713 * 3600,
    bags: 26,
    km: 22393.4,
    zones: [
      { name: "Shoreditch & Hoxton", seconds: 16.4 * 3600 },
      { name: "Soho & Covent Garden", seconds: 19.3 * 3600 },
      { name: "The City", seconds: 3.6 * 3600 },
    ],
    byHour: hours({ 9: 100, 12: 300, 17: 500, 18: 600, 19: 550, 21: 200 }),
  };

  it("is built from the measured numbers only", () => {
    expect(summaryText(base)).toBe(
      "Your Autumn menu ad played 256,560 times on 26 DigiLite bags between 1 and 28 September — 713 hours on screen. " +
        "On the days it played, the bags carrying it covered 22,393 km, spending most time around Soho & Covent Garden and Shoreditch & Hoxton. " +
        "The busiest stretch was between 17:00 and 20:00.",
    );
  });

  it("never mentions reach, impressions or anything estimated", () => {
    const text = summaryText(base).toLowerCase();
    for (const word of ["reach", "impression", "people", "seen", "estimate", "audience"]) expect(text).not.toContain(word);
  });

  it("is deterministic", () => {
    expect(summaryText(base)).toBe(summaryText({ ...base }));
  });

  it("handles one bag, no zones and no distance", () => {
    expect(summaryText({ ...base, plays: 1, seconds: 10, bags: 1, km: 0, zones: [], byHour: hours({ 18: 1 }) })).toBe(
      "Your Autumn menu ad played 1 time on 1 DigiLite bag between 1 and 28 September — 1 minute on screen.",
    );
  });

  it("says so plainly when nothing played", () => {
    expect(summaryText({ ...base, plays: 0, seconds: 0, bags: 0 })).toBe("No plays of your Autumn menu ad were recorded between 1 and 28 September.");
  });
});

describe("rider names for clients", () => {
  it("shortens to first name and initial", () => {
    expect(shortRiderName("Amara Osei")).toBe("Amara O.");
    expect(shortRiderName("Cher")).toBe("Cher");
    expect(shortRiderName("  Luis  Ortega Diaz ")).toBe("Luis O.");
  });
});
