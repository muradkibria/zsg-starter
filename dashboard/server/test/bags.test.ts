import { describe, expect, it } from "vitest";
import { bagSeenLabel, bagSpanLabel, describeBagSchedule, isBagIssueKind } from "@digilite/shared";

const NOW = Date.parse("2026-09-29T18:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("bagSeenLabel", () => {
  it("says out now for bags reporting now", () => {
    expect(bagSeenLabel("now", ago(MIN), NOW)).toBe("Out now");
  });
  it("uses minutes, then hours, within the last day", () => {
    expect(bagSeenLabel("day", ago(40 * MIN), NOW)).toBe("Seen 40 min ago");
    expect(bagSeenLabel("day", ago(4 * HOUR + 20 * MIN), NOW)).toBe("Seen 4 h ago");
  });
  it("uses days for idle bags", () => {
    expect(bagSeenLabel("idle", ago(DAY + HOUR), NOW)).toBe("Seen 1 day ago");
    expect(bagSeenLabel("idle", ago(3 * DAY), NOW)).toBe("Seen 3 days ago");
  });
  it("says how long a missing bag has been gone", () => {
    expect(bagSeenLabel("gone", ago(48 * DAY + 5 * HOUR), NOW)).toBe("Not seen for 48 days");
  });
  it("handles bags that never reported", () => {
    expect(bagSeenLabel("gone", null, NOW)).toBe("Never seen");
  });
});

describe("bagSpanLabel", () => {
  it("formats spans in hours, days, months", () => {
    expect(bagSpanLabel(ago(5 * HOUR), null, NOW)).toBe("5 h");
    expect(bagSpanLabel(ago(12 * DAY), null, NOW)).toBe("12 days");
    expect(bagSpanLabel(ago(107 * DAY), null, NOW)).toBe("4 months");
    expect(bagSpanLabel("2026-03-12T00:00:00Z", "2026-06-01T00:00:00Z", NOW)).toBe("3 months");
  });
});

describe("isBagIssueKind", () => {
  it("accepts only known issue kinds", () => {
    expect(isBagIssueKind("clock")).toBe(true);
    expect(isBagIssueKind("nope")).toBe(false);
    expect(isBagIssueKind(null)).toBe(false);
  });
});

describe("describeBagSchedule", () => {
  const now = new Date(NOW);
  it("treats empty answers as no schedule", () => {
    expect(describeBagSchedule(null, {}, now)).toEqual({ state: "none" });
    expect(describeBagSchedule([], {}, now)).toEqual({ state: "none" });
    expect(describeBagSchedule({}, {}, now)).toEqual({ state: "none" });
    expect(describeBagSchedule({ programSchedules: [], commandSchedules: [] }, {}, now)).toEqual({ state: "none" });
    expect(describeBagSchedule({ data: [] }, {}, now)).toEqual({ state: "none" });
  });

  it("describes loop rules with dates, weekdays and times, in priority order", () => {
    const s = describeBagSchedule(
      {
        programSchedules: [
          { programId: 7, startDate: "2026-10-03", weeks: [6, 7], startTime: "11:00:00", endTime: "15:00:00", priority: 2 },
          { programName: "Autumn loop", startDate: "2026-10-01", endDate: "2026-10-31", startTime: "17:00:00", endTime: "23:30:00", priority: 1 },
        ],
      },
      { "7": "Weekend lunch loop" },
      now,
    );
    expect(s).toEqual({
      state: "rules",
      unreadable: 0,
      lines: [
        { kind: "loop", title: "Loop “Autumn loop”", when: "1 Oct – 31 Oct · every day · 17:00–23:30", priority: 1 },
        { kind: "loop", title: "Loop “Weekend lunch loop”", when: "From 3 Oct · Sat and Sun · 11:00–15:00", priority: 2 },
      ],
    });
  });

  it("describes brightness commands and reads weekday flags", () => {
    const s = describeBagSchedule(
      { commandSchedules: [{ commandType: "BRIGHTNESS", value: 178, operationTime: "20:00:00", weeks: "1,1,1,1,1,0,0" }] },
      {},
      now,
    );
    expect(s.state === "rules" && s.lines).toEqual([{ kind: "brightness", title: "Brightness 70%", when: "Mon–Fri · at 20:00", priority: null }]);
  });

  it("counts rules it can't read instead of guessing", () => {
    const s = describeBagSchedule([{ foo: 1 }, { programName: "House loop" }], {}, now);
    expect(s).toEqual({
      state: "rules",
      unreadable: 1,
      lines: [{ kind: "loop", title: "Loop “House loop”", when: "Every day · all day", priority: null }],
    });
  });
});
