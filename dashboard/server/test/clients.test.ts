import { describe, expect, it } from "vitest";
import { can } from "@digilite/shared";
import { reportPeriods } from "../src/domain/clients";

describe("the portal's ready-made report periods", () => {
  it("offer the whole campaign, then each Monday-to-Sunday week, latest first, clipped to the campaign", () => {
    const p = reportPeriods("2026-09-30", "2026-10-14", false);
    expect(p[0]).toMatchObject({ kind: "campaign", label: "The campaign so far", fromDay: "2026-09-30", toDay: "2026-10-14" });
    const weeks = p.filter((x) => x.kind === "week");
    expect(weeks.map((w) => [w.fromDay, w.toDay])).toEqual([
      ["2026-10-12", "2026-10-14"],
      ["2026-10-05", "2026-10-11"],
      ["2026-09-30", "2026-10-04"],
    ]);
    expect(weeks[2].label).toMatch(/^30 Sept? – 4 Oct$/);
  });

  it("add calendar months when it spans more than one", () => {
    const months = reportPeriods("2026-09-30", "2026-10-14", true).filter((x) => x.kind === "month");
    expect(months.map((m) => [m.label, m.fromDay, m.toDay])).toEqual([
      ["October 2026", "2026-10-01", "2026-10-14"],
      ["September 2026", "2026-09-30", "2026-09-30"],
    ]);
  });

  it("leave out weeks and months that would just repeat the whole campaign", () => {
    const p = reportPeriods("2026-10-06", "2026-10-09", true);
    expect(p).toHaveLength(1);
    expect(p[0].label).toBe("The whole campaign");
    expect(reportPeriods("2026-10-09", "2026-10-06", false)).toEqual([]);
  });
});

describe("who can manage client logins", () => {
  it("is the owner, ops and sales, not read-only", () => {
    expect(can("owner", "clients.edit")).toBe(true);
    expect(can("ops", "clients.edit")).toBe(true);
    expect(can("sales", "clients.edit")).toBe(true);
    expect(can("viewer", "clients.edit")).toBe(false);
  });
});
