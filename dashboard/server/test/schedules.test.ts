import { describe, expect, it } from "vitest";
import {
  addDays,
  brightnessDay,
  describeRule,
  describeWeekdays,
  hmToMin,
  londonClockChange,
  londonSunTimes,
  minToHm,
  mondayOf,
  resolveDay,
  scheduleProblems,
  weekdayIndex,
  type LoopRule,
  type ScheduleContent,
} from "@digilite/shared";
import { assertSafePayload } from "../src/colorlight/gate";
import type { RecordModel } from "../src/pb";
import {
  brightnessCommands,
  buildColorlightSchedule,
  clockProblem,
  contentHash,
  contentPeriods,
  FAR_END,
  resolveLoopInfo,
  scaleBrightness,
  scheduleBlockers,
  sunChunks,
  summarizeDeviceSchedule,
  type ProgramRef,
  type TerminalScheduleJson,
} from "../src/domain/schedules";

const TEST_BAG = 5786440;
const EVERY_DAY = [true, true, true, true, true, true, true];
const toMin = (hm: string) => hmToMin(hm)!;

const rule = (p: Partial<LoopRule> & Pick<LoopRule, "loopId" | "priority">): LoopRule => ({
  id: `r-${p.loopId}-${p.priority}`,
  startDate: "2026-09-01",
  endDate: null,
  weekdays: EVERY_DAY,
  startTime: "00:00",
  endTime: "24:00",
  ...p,
});

const programs = new Map<string, ProgramRef>([
  ["evening", { programId: 101, name: "June 26", vsn: "June 26_83fca0e70b30cbf5090390702f9aa5c3_7174.vsn" }],
  ["lunch", { programId: 102, name: "Lunch", vsn: "Lunch_0e00de0f6efa488fd273e759b9fa64cb_7001.vsn" }],
  ["late", { programId: 103, name: "Late", vsn: "Late_0d79b93d7792d0620b229efa541ebd43_7002.vsn" }],
  ["promo", { programId: 104, name: "Promo", vsn: "Promo_651cbd87a7080367bc5c8e33b988abec_7003.vsn" }],
  ["house", { programId: 105, name: "House", vsn: "House_2f31201682a349b0195d35c450187792_7004.vsn" }],
]);

// ── Sunrise / sunset ───────────────────────────────────────────────────────────

describe("London sunrise and sunset", () => {
  // Reference: US Naval Observatory (aa.usno.navy.mil) for 51.5074 N, 0.1278 W, London local time.
  const reference: [string, string, string][] = [
    ["2026-09-29", "06:58", "18:43"], // BST, a week after the equinox
    ["2026-10-24", "07:40", "17:49"], // last BST day
    ["2026-10-26", "06:43", "16:45"], // first full GMT week
    ["2026-12-12", "07:57", "15:51"], // earliest sunset
    ["2026-12-21", "08:04", "15:53"], // winter solstice
    ["2026-12-31", "08:06", "16:01"],
    ["2026-06-21", "04:43", "21:22"], // summer solstice
    ["2026-03-28", "05:45", "18:27"], // last GMT day
    ["2026-03-29", "06:43", "19:29"], // clocks go forward
  ];
  it.each(reference)("%s: sunrise %s, sunset %s (within 2 minutes)", (day, rise, set) => {
    const t = londonSunTimes(day);
    expect(Math.abs(t.sunriseMin - toMin(rise))).toBeLessThanOrEqual(2);
    expect(Math.abs(t.sunsetMin - toMin(set))).toBeLessThanOrEqual(2);
  });

  it("follows British Summer Time", () => {
    // Clocks go back on 25 Oct 2026: sunset jumps about an hour earlier on the clock.
    const before = londonSunTimes("2026-10-24").sunsetMin;
    const after = londonSunTimes("2026-10-25").sunsetMin;
    expect(before - after).toBeGreaterThan(55);
    expect(before - after).toBeLessThan(65);
    expect(londonClockChange("2026-10-25")).toBe("back");
    expect(londonClockChange("2026-03-29")).toBe("forward");
    expect(londonClockChange("2026-09-29")).toBeNull();
  });

  it("gives December sunsets around four o'clock GMT", () => {
    for (let d = "2026-12-01"; d <= "2026-12-31"; d = addDays(d, 1)) {
      const s = londonSunTimes(d).sunsetMin;
      expect(s).toBeGreaterThanOrEqual(toMin("15:49"));
      expect(s).toBeLessThanOrEqual(toMin("16:03"));
    }
  });
});

// ── Week and time helpers ──────────────────────────────────────────────────────

describe("time helpers", () => {
  it("reads and writes HH:MM", () => {
    expect(hmToMin("17:30")).toBe(1050);
    expect(hmToMin("24:00")).toBe(1440);
    expect(hmToMin("24:30")).toBeNull();
    expect(hmToMin("7:30")).toBeNull();
    expect(minToHm(1050)).toBe("17:30");
    expect(minToHm(1440)).toBe("24:00");
  });
  it("weeks start on Monday", () => {
    expect(weekdayIndex("2026-09-28")).toBe(0); // Monday
    expect(weekdayIndex("2026-10-04")).toBe(6); // Sunday
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
    expect(mondayOf("2026-09-29")).toBe("2026-09-28");
  });
  it("describes rules in plain English", () => {
    expect(describeWeekdays(EVERY_DAY)).toBe("every day");
    expect(describeWeekdays([true, true, true, true, true, false, false])).toBe("weekdays");
    expect(describeWeekdays([false, false, false, false, false, true, true])).toBe("Sat and Sun");
    expect(describeWeekdays([true, false, true, false, true, false, false])).toBe("Mon, Wed and Fri");
    expect(describeWeekdays([true, true, true, true, false, false, false])).toBe("Mon – Thu");
    expect(
      describeRule(rule({ loopId: "evening", priority: 1, startDate: "2026-10-01", endDate: "2026-10-31", startTime: "17:00", endTime: "23:30" }), "2026-09-29"),
    ).toBe("1 Oct – 31 Oct · every day · 17:00 – 23:30");
    expect(describeRule(rule({ loopId: "late", priority: 2, startDate: "2026-10-03", startTime: "21:00", endTime: "02:00" }), "2026-09-29")).toBe(
      "From 3 Oct · every day · 21:00 – 02:00 (next day)",
    );
  });
});

// ── Priority resolution ────────────────────────────────────────────────────────

describe("which loop plays when", () => {
  it("fills gaps with the default loop", () => {
    const c: ScheduleContent = {
      defaultLoopId: "house",
      rules: [rule({ loopId: "evening", priority: 1, startTime: "17:00", endTime: "23:30" })],
      brightness: [],
    };
    expect(resolveDay(c, "2026-09-29").map((b) => [minToHm(b.start), minToHm(b.end), b.loopId, b.priority])).toEqual([
      ["00:00", "17:00", "house", null],
      ["17:00", "23:30", "evening", 1],
      ["23:30", "24:00", "house", null],
    ]);
  });

  it("plays the higher rule where two overlap (1 is the top)", () => {
    const c: ScheduleContent = {
      defaultLoopId: null,
      rules: [
        rule({ loopId: "promo", priority: 2, startTime: "12:00", endTime: "20:00" }),
        rule({ loopId: "evening", priority: 1, startTime: "17:00", endTime: "23:30", weekdays: [true, true, true, true, true, false, false] }),
      ],
      brightness: [],
    };
    // Tuesday: evening wins from 17:00
    expect(resolveDay(c, "2026-09-29").map((b) => [minToHm(b.start), minToHm(b.end), b.loopId])).toEqual([
      ["00:00", "12:00", null],
      ["12:00", "17:00", "promo"],
      ["17:00", "23:30", "evening"],
      ["23:30", "24:00", null],
    ]);
    // Saturday: the evening rule is weekdays only
    expect(resolveDay(c, "2026-10-03").map((b) => [minToHm(b.start), minToHm(b.end), b.loopId])).toEqual([
      ["00:00", "12:00", null],
      ["12:00", "20:00", "promo"],
      ["20:00", "24:00", null],
    ]);
    // Swap the priorities and promo wins instead
    const swapped = { ...c, rules: c.rules.map((r) => ({ ...r, priority: r.priority === 1 ? 2 : 1 })) };
    expect(resolveDay(swapped, "2026-09-29").find((b) => b.start <= 18 * 60 && b.end > 18 * 60)?.loopId).toBe("promo");
  });

  it("respects the date range", () => {
    const c: ScheduleContent = {
      defaultLoopId: "house",
      rules: [rule({ loopId: "promo", priority: 1, startDate: "2026-10-01", endDate: "2026-10-31" })],
      brightness: [],
    };
    expect(resolveDay(c, "2026-09-30")[0].loopId).toBe("house");
    expect(resolveDay(c, "2026-10-01")[0].loopId).toBe("promo");
    expect(resolveDay(c, "2026-10-31")[0].loopId).toBe("promo");
    expect(resolveDay(c, "2026-11-01")[0].loopId).toBe("house");
  });

  it("runs overnight rules into the next morning", () => {
    const c: ScheduleContent = {
      defaultLoopId: "house",
      // Fridays and Saturdays, 21:00 until 02:00
      rules: [rule({ loopId: "late", priority: 1, startTime: "21:00", endTime: "02:00", weekdays: [false, false, false, false, true, true, false] })],
      brightness: [],
    };
    const blocks = (d: string) => resolveDay(c, d).map((b) => [minToHm(b.start), minToHm(b.end), b.loopId]);
    expect(blocks("2026-10-01")).toEqual([["00:00", "24:00", "house"]]); // Thursday
    expect(blocks("2026-10-02")).toEqual([["00:00", "21:00", "house"], ["21:00", "24:00", "late"]]); // Friday
    expect(blocks("2026-10-03")).toEqual([["00:00", "02:00", "late"], ["02:00", "21:00", "house"], ["21:00", "24:00", "late"]]); // Saturday
    expect(blocks("2026-10-04")).toEqual([["00:00", "02:00", "late"], ["02:00", "24:00", "house"]]); // Sunday morning
  });

  it("treats 00:00 as the end of the day", () => {
    const c: ScheduleContent = { defaultLoopId: null, rules: [rule({ loopId: "evening", priority: 1, startTime: "18:00", endTime: "00:00" })], brightness: [] };
    expect(resolveDay(c, "2026-09-29").map((b) => [minToHm(b.start), minToHm(b.end), b.loopId])).toEqual([
      ["00:00", "18:00", null],
      ["18:00", "24:00", "evening"],
    ]);
  });
});

// ── Brightness ─────────────────────────────────────────────────────────────────

describe("brightness plan", () => {
  const plan = [
    { from: "sunrise", pct: 85 },
    { from: "sunset", pct: 65 },
    { from: "22:00", pct: 45 },
  ];
  it("steps through the day with London's sunset", () => {
    const d = brightnessDay(plan, "2026-09-29");
    expect(d.startPct).toBe(45); // carried over from 22:00 the evening before
    expect(d.steps.map((s) => [minToHm(s.at), s.pct])).toEqual([
      ["06:58", 85],
      ["18:43", 65],
      ["22:00", 45],
    ]);
  });
  it("re-orders steps when the sun moves past a fixed time", () => {
    const summer = brightnessDay([{ from: "21:00", pct: 50 }, { from: "sunset", pct: 60 }], "2026-06-21");
    expect(summer.steps.map((s) => s.pct)).toEqual([50, 60]); // sunset 21:22 comes after 21:00
    const winter = brightnessDay([{ from: "21:00", pct: 50 }, { from: "sunset", pct: 60 }], "2026-12-21");
    expect(winter.steps.map((s) => s.pct)).toEqual([60, 50]);
  });
  it("scales brightness to the device's units", () => {
    expect(scaleBrightness(85, 100)).toBe(85);
    expect(scaleBrightness(85, 255)).toBe(217);
    expect(scaleBrightness(100, 255)).toBe(255);
    expect(scaleBrightness(0, 100)).toBe(1);
  });
});

// ── Validation ─────────────────────────────────────────────────────────────────

describe("schedule validation", () => {
  it("accepts a sensible schedule", () => {
    expect(
      scheduleProblems({
        defaultLoopId: "house",
        rules: [rule({ loopId: "evening", priority: 1, startTime: "17:00", endTime: "23:30" })],
        brightness: [{ from: "sunset", pct: 65 }],
      }),
    ).toEqual([]);
  });
  it("needs distinct priorities, real dates and times", () => {
    const problems = scheduleProblems({
      defaultLoopId: null,
      rules: [
        rule({ loopId: "evening", priority: 1, startDate: "2026-10-10", endDate: "2026-10-01" }),
        rule({ loopId: "promo", priority: 1, startTime: "17:00", endTime: "17:00" }),
        rule({ loopId: "lunch", priority: 2, weekdays: [false, false, false, false, false, false, false], startTime: "25:00" }),
      ],
      brightness: [
        { from: "sunset", pct: 0 },
        { from: "sunset", pct: 50 },
        { from: "7pm", pct: 50 },
      ],
    });
    expect(problems.some((p) => p.includes("end date is before the start date"))).toBe(true);
    expect(problems.some((p) => p.includes("Two rules have priority 1"))).toBe(true);
    expect(problems.some((p) => p.includes("start and end times are the same"))).toBe(true);
    expect(problems.some((p) => p.includes("at least one day"))).toBe(true);
    expect(problems.some((p) => p.includes("start time isn't right"))).toBe(true);
    expect(problems.some((p) => p.includes("from 1% to 100%"))).toBe(true);
    expect(problems.some((p) => p.includes("Two brightness steps start at sunset"))).toBe(true);
    expect(problems.some((p) => p.includes("the time isn't right"))).toBe(true);
  });
  it("hashes content, not rule ids", () => {
    const a: ScheduleContent = { defaultLoopId: "house", rules: [rule({ loopId: "evening", priority: 1 })], brightness: [] };
    const b: ScheduleContent = { ...a, rules: [{ ...a.rules[0], id: "other-id", priority: 5 }] };
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(a)).not.toBe(contentHash({ ...a, defaultLoopId: "promo" }));
  });
});

// ── Colorlight payload ─────────────────────────────────────────────────────────

/** Program ids the device would consider playing at a London day + minute. */
function activeAt(json: TerminalScheduleJson, day: string, minute: number): number[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hms = `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:00`;
  return json.schedules.contentsSchedule
    .filter((e) => {
      if (e.if_limit_date && (day < e.limit_date.start || day > e.limit_date.end)) return false;
      if (e.if_limit_weekday && !e.limit_weekday[weekdayIndex(day)]) return false;
      if (e.if_limit_time && (hms < e.limit_time.start_time || hms > e.limit_time.end_time)) return false;
      return true;
    })
    .map((e) => e.operation.id);
}

describe("Colorlight schedule payload", () => {
  const fromDay = "2026-09-29";
  const busy: ScheduleContent = {
    defaultLoopId: "house",
    rules: [
      rule({ loopId: "evening", priority: 1, startTime: "17:00", endTime: "23:30" }),
      rule({ loopId: "lunch", priority: 2, startDate: "2026-10-03", startTime: "11:00", endTime: "15:00", weekdays: [false, false, false, false, false, true, true] }),
      rule({ loopId: "late", priority: 3, endDate: "2026-10-17", startTime: "21:00", endTime: "02:00", weekdays: [false, false, false, false, true, true, false] }),
      rule({ loopId: "promo", priority: 4, startDate: "2026-10-01", endDate: "2026-10-31", startTime: "12:00", endTime: "20:00" }),
      rule({ loopId: "lunch", priority: 5, startDate: "2026-08-01", endDate: "2026-08-31" }), // ended: ignored
    ],
    brightness: [
      { from: "sunrise", pct: 85 },
      { from: "sunset", pct: 65 },
      { from: "22:00", pct: 45 },
    ],
  };
  const built = buildColorlightSchedule(busy, programs, { fromDay, brightnessScale: 255 });
  const json = built.scheduleJson;

  it("never targets a group and never applies to sub-groups", () => {
    const text = JSON.stringify(json);
    expect(text).not.toContain("terminalGroupId");
    expect(text).not.toMatch(/"all"\s*:/);
    expect(json.to_children).toBe(false);
    expect(() => assertSafePayload("schedule", { ...json, to_children: false }, [TEST_BAG])).not.toThrow();
  });

  it("gives every loop part its own priority", () => {
    const priorities = json.schedules.contentsSchedule.map((e) => e.priority);
    expect(priorities.length).toBeGreaterThan(3);
    expect(new Set(priorities).size).toBe(priorities.length);
    for (const e of json.schedules.contentsSchedule) {
      expect(e.name).toBe("Play_Program");
      expect(e.type).toBe("rotation");
      expect(e.type_priority).toBe(200);
      expect(e.operation.source).toBe("internet");
      expect(e.operation.vsn).toMatch(/\.vsn$/);
    }
    expect(json.program_ids.sort()).toEqual([101, 102, 103, 104, 105]);
    expect(json.thumbnails.map((t) => t.id).sort()).toEqual([101, 102, 103, 104, 105]);
  });

  it("plays exactly one loop at a time, the one the rules say (every 10 minutes for 10 weeks)", () => {
    for (let day = fromDay, i = 0; i < 70; i++, day = addDays(day, 1)) {
      const blocks = resolveDay(busy, day);
      for (let m = 0; m < 1440; m += 10) {
        const expected = blocks.find((b) => b.start <= m && b.end > m)!.loopId;
        const got = activeAt(json, day, m);
        expect({ day, m, got }).toEqual({ day, m, got: expected ? [programs.get(expected)!.programId] : [] });
      }
    }
  });

  it("windows end a second before the next begins", () => {
    const evening = json.schedules.contentsSchedule.find((e) => e.operation.id === 101 && e.limit_time.start_time === "17:00:00");
    expect(evening?.limit_time.end_time).toBe("23:29:59");
    const lastHouse = json.schedules.contentsSchedule.find((e) => e.operation.id === 105 && e.limit_time.end_time === "23:59:59");
    expect(lastHouse).toBeTruthy();
  });

  it("leaves open-ended parts unlimited by date", () => {
    const simple = buildColorlightSchedule(
      { defaultLoopId: "house", rules: [rule({ loopId: "evening", priority: 1, startTime: "17:00", endTime: "23:30" })], brightness: [] },
      programs,
      { fromDay, brightnessScale: 100 },
    ).scheduleJson.schedules.contentsSchedule;
    expect(simple).toHaveLength(3);
    for (const e of simple) {
      expect(e.if_limit_date).toBe(false);
      expect(e.if_limit_weekday).toBe(false);
      expect(e.limit_date.end).toBe(FAR_END);
    }
    expect(simple.map((e) => [e.operation.id, e.limit_time.start_time, e.limit_time.end_time])).toEqual([
      [105, "00:00:00", "16:59:59"],
      [101, "17:00:00", "23:29:59"],
      [105, "23:30:00", "23:59:59"],
    ]);
  });

  it("splits the dates where rules start and end", () => {
    const periods = contentPeriods(busy, fromDay);
    const starts = periods.map((p) => p.start);
    expect(starts).toContain("2026-10-01"); // promo starts
    expect(starts).toContain("2026-10-03"); // lunch starts
    expect(starts).toContain("2026-10-18"); // late rule's last evening was 17 Oct…
    expect(starts).toContain("2026-10-19"); // …and its overnight tail ends on the 18th
    expect(starts).toContain("2026-11-01"); // promo ends
    expect(periods[periods.length - 1].end).toBeNull();
  });

  it("leaves out loops that aren't on Colorlight and says so", () => {
    const partial = new Map([...programs].filter(([k]) => k !== "lunch"));
    const b = buildColorlightSchedule(busy, partial, { fromDay, brightnessScale: 100 });
    expect(b.missing).toEqual(["lunch"]);
    expect(b.scheduleJson.program_ids).not.toContain(102);
  });

  it("writes brightness as timed commands, sunset per week, split at the clock change", () => {
    const { entries, until } = brightnessCommands(busy.brightness, { fromDay, brightnessScale: 255, horizonDays: 182 });
    expect(until).toBe(addDays(fromDay, 181));
    const fixed = entries.filter((e) => !e.if_limit_date);
    expect(fixed).toHaveLength(1);
    expect(fixed[0].op_time).toEqual(["22:00:00"]);
    expect(fixed[0].content).toEqual({ name: "Value", value: 45 });
    expect(JSON.parse(fixed[0].operation.content)).toEqual({ brightness: "115" }); // 45% of 255
    for (const e of entries) {
      expect(e.name).toBe("Brightness_Control");
      expect(e.operation.author_url).toBe("api/brightness");
      expect(e.operation.karma).toBe(2);
    }
    for (const which of ["sunset", "sunrise"] as const) {
      const pct = which === "sunset" ? 65 : 85;
      const list = entries.filter((e) => e.if_limit_date && e.content.value === pct).sort((a, b) => a.limit_date.start.localeCompare(b.limit_date.start));
      // Contiguous cover of the horizon, no gaps or overlaps
      expect(list[0].limit_date.start).toBe(fromDay);
      expect(list[list.length - 1].limit_date.end).toBe(until);
      for (let i = 1; i < list.length; i++) expect(list[i].limit_date.start).toBe(addDays(list[i - 1].limit_date.end, 1));
      // No entry spans the night the clocks go back
      expect(list.some((e) => e.limit_date.start <= "2026-10-24" && e.limit_date.end >= "2026-10-25")).toBe(false);
      // Each week's time is within 10 minutes of the real time on every day it covers
      for (const e of list) {
        const op = toMin(e.op_time[0].slice(0, 5));
        for (let d = e.limit_date.start; d <= e.limit_date.end; d = addDays(d, 1)) {
          const t = londonSunTimes(d);
          expect(Math.abs((which === "sunset" ? t.sunsetMin : t.sunriseMin) - op)).toBeLessThanOrEqual(10);
        }
      }
      expect(list.length).toBeLessThanOrEqual(30);
    }
  });

  it("sun weeks are at most 7 days and change where the clocks do", () => {
    const chunks = sunChunks("2026-10-20", 21);
    expect(chunks[0]).toEqual({ start: "2026-10-20", end: "2026-10-24" });
    expect(chunks[1].start).toBe("2026-10-25");
    for (const c of chunks) expect(addDays(c.start, 6) >= c.end).toBe(true);
  });

  it("uses the brightness scale from settings", () => {
    const b100 = brightnessCommands([{ from: "sunset", pct: 65 }], { fromDay, brightnessScale: 100, horizonDays: 14 }).entries;
    expect(JSON.parse(b100[0].operation.content)).toEqual({ brightness: "65" });
    const b255 = brightnessCommands([{ from: "sunset", pct: 65 }], { fromDay, brightnessScale: 255, horizonDays: 14 }).entries;
    expect(JSON.parse(b255[0].operation.content)).toEqual({ brightness: "166" });
  });
});

describe("a bag's current schedule, summarised", () => {
  it("handles unread, empty and real schedules", () => {
    expect(summarizeDeviceSchedule(null).read).toBe(false);
    expect(summarizeDeviceSchedule({ scheduleJsonBean: { schedules: { contentsSchedule: [], commandSchedule: [] } } }).text).toBe("No schedule on the bag");
    const s = summarizeDeviceSchedule({
      updateTerminalScheduleTime: 1695453795,
      scheduleJsonBean: {
        schedules: {
          contentsSchedule: [{ operation: { name: "June 26", vsn: "June 26_83fca0e70b30cbf5090390702f9aa5c3_7174.vsn" } }],
          commandSchedule: [{ name: "Brightness_Control" }, { name: "Sleep" }],
        },
      },
    });
    expect(s.loops).toEqual(["June 26"]);
    expect(s.brightnessChanges).toBe(1);
    expect(s.otherCommands).toBe(1);
    expect(s.updatedAt).toBe(new Date(1695453795000).toISOString());
  });
});

// ── Loops ready for a schedule, and what blocks applying ───────────────────────

const rec = (x: Record<string, unknown>) => x as unknown as RecordModel;
const JUNE = "June 26_83fca0e70b30cbf5090390702f9aa5c3_7174.vsn";
const JUNE_OLD = "June 26_0000000000000000000000000000abcd_7001.vsn";

describe("loops that can go on a schedule", () => {
  const bags = [
    rec({ playing_vsn: JUNE, device_status: { vsns: { contents: [{ type: "internet", content: [{ name: JUNE }, { name: JUNE_OLD }] }] } } }),
    rec({ playing_vsn: JUNE, device_status: { vsns: { contents: [{ type: "lan", content: [{ name: "160×120.vsn" }] }] } } }),
    rec({ playing_vsn: "", device_status: { vsns: { contents: [{ content: [{ name: "MTF_01fef33786607b90ea8392b196f6e60f_1333.vsn" }] }] } } }),
  ];
  const loops = resolveLoopInfo(
    [
      rec({ id: "june", name: "June 26", status: "imported", colorlight_program_id: 6696773, colorlight_program_name: "June 26" }),
      rec({ id: "draft", name: "Christmas", status: "draft", colorlight_program_id: 0, colorlight_program_name: "" }),
      rec({ id: "mtf1", name: "MTF", status: "imported", colorlight_program_id: 6436469, colorlight_program_name: "MTF" }),
      rec({ id: "mtf2", name: "MTF", status: "imported", colorlight_program_id: 4468296, colorlight_program_name: "MTF" }),
      rec({ id: "unseen", name: "Autumn", status: "imported", colorlight_program_id: 7000001, colorlight_program_name: "Autumn" }),
      rec({ id: "named", name: "Winter", status: "published", colorlight_program_id: 7000002, colorlight_vsn: "Winter_1111111111111111111111111111aaaa_9.vsn" }),
    ],
    bags,
  );
  const by = new Map(loops.map((l) => [l.id, l]));

  it("uses the file the bags are playing", () => {
    expect(by.get("june")).toMatchObject({ programId: 6696773, vsn: JUNE, problem: null });
  });
  it("says why a loop can't be scheduled", () => {
    expect(by.get("draft")?.problem).toMatch(/Not on Colorlight yet/);
    expect(by.get("mtf1")?.problem).toMatch(/Two loops on Colorlight are called “MTF”/);
    expect(by.get("unseen")?.problem).toMatch(/No bag has downloaded it yet/);
  });
  it("prefers a file name the loops area stored", () => {
    expect(by.get("named")).toMatchObject({ vsn: "Winter_1111111111111111111111111111aaaa_9.vsn", problem: null });
  });
  it("blocks applying a schedule that uses a loop that isn't ready", () => {
    const today = "2026-09-29";
    const content: ScheduleContent = {
      defaultLoopId: "june",
      rules: [
        rule({ loopId: "draft", priority: 1, startTime: "17:00", endTime: "23:30" }),
        rule({ loopId: "unseen", priority: 2, endDate: "2026-09-01" }), // ended: doesn't matter
      ],
      brightness: [],
    };
    const b = scheduleBlockers(content, loops, today);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/“Christmas” can't go on a schedule yet: Not on Colorlight yet/);
    expect(scheduleBlockers({ defaultLoopId: "june", rules: [], brightness: [] }, loops, today)).toEqual([]);
    expect(scheduleBlockers({ defaultLoopId: null, rules: [], brightness: [] }, loops, today)[0]).toMatch(/Nothing to apply yet/);
  });
});

describe("bag clocks", () => {
  const summer = new Date("2026-09-29T18:00:00Z");
  const winter = new Date("2026-12-01T18:00:00Z");
  it("flags China time and says how far off it is", () => {
    expect(clockProblem(rec({ timezone: "+08" }), summer)).toBe("Clock on China time (+08), so the schedule would run 7 hours early");
    expect(clockProblem(rec({ timezone: "+08" }), winter)).toBe("Clock on China time (+08), so the schedule would run 8 hours early");
  });
  it("accepts London time in summer and winter, and unknown clocks", () => {
    expect(clockProblem(rec({ timezone: "+01" }), summer)).toBeNull();
    expect(clockProblem(rec({ timezone: "+00" }), winter)).toBeNull();
    expect(clockProblem(rec({ timezone: "" }), summer)).toBeNull();
  });
  it("catches a clock stuck on summer time in winter", () => {
    expect(clockProblem(rec({ timezone: "+01" }), winter)).toBe("Clock on UTC+1, so the schedule would run 1 hour early");
  });
});
