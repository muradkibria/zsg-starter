import { describe, expect, it } from "vitest";
import { DEFAULT_ANALYTICS, exportFormatsFor } from "@digilite/shared";
import type { AssignmentRow } from "../src/domain/assignments";
import {
  buildScope,
  csvCell,
  csvLine,
  exportFilename,
  gapLength,
  handoversIn,
  inIntervals,
  londonStamp,
  mergeIntervals,
  routeRowsForDay,
  routeSegments,
  xmlEscape,
  type GpsRow,
  type RoutePointRow,
} from "../src/domain/exports";

describe("CSV and XML", () => {
  it("quotes only when it has to", () => {
    expect(csvCell("Bag 006")).toBe("Bag 006");
    expect(csvCell("Soho, Covent Garden")).toBe('"Soho, Covent Garden"');
    expect(csvCell('She said "late"')).toBe('"She said ""late"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(" padded")).toBe('" padded"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(-0.07728)).toBe("-0.07728");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("never lets a cell run as a spreadsheet formula", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+44 7700")).toBe("'+44 7700");
    expect(csvCell("@sum")).toBe("'@sum");
    expect(csvCell("-")).toBe("'-");
  });

  it("ends lines with CRLF", () => {
    expect(csvLine(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"\r\n');
  });

  it("escapes XML", () => {
    expect(xmlEscape(`Bag 006 · Tom & "Jo" <x>`)).toBe("Bag 006 · Tom &amp; &quot;Jo&quot; &lt;x&gt;");
  });
});

describe("London time in files", () => {
  it("uses BST in summer and GMT in winter", () => {
    expect(londonStamp(Date.parse("2026-09-28T18:40:06Z"))).toEqual({ date: "2026-09-28", time: "19:40:06" });
    expect(londonStamp(Date.parse("2026-09-28T23:30:00Z"))).toEqual({ date: "2026-09-29", time: "00:30:00" });
    expect(londonStamp(Date.parse("2026-12-01T18:40:06Z"))).toEqual({ date: "2026-12-01", time: "18:40:06" });
  });

  it("gets the hour right on the day the clocks go back", () => {
    expect(londonStamp(Date.parse("2026-10-25T00:30:00Z")).time).toBe("01:30:00"); // still BST
    expect(londonStamp(Date.parse("2026-10-25T01:30:00Z")).time).toBe("01:30:00"); // GMT again
  });

  it("writes gap lengths plainly", () => {
    expect(gapLength(872)).toBe("14m 32s");
    expect(gapLength(3900)).toBe("1h 05m");
  });
});

describe("what goes in an export", () => {
  const from = Date.parse("2026-09-20T23:00:00Z");
  const to = Date.parse("2026-09-27T23:00:00Z");
  const asg = (bagId: string, riderId: string, start: string, end: string | null): AssignmentRow => ({
    id: `${bagId}${riderId}`,
    bagId,
    riderId,
    riderName: riderId,
    riderDemo: true,
    start: new Date(start),
    end: end ? new Date(end) : null,
  });

  it("merges overlapping windows", () => {
    expect(mergeIntervals([{ start: 5, end: 8 }, { start: 1, end: 3 }, { start: 2, end: 6 }, { start: 9, end: 9 }])).toEqual([{ start: 1, end: 8 }]);
    expect(inIntervals([{ start: 1, end: 3 }], 3)).toBe(false);
    expect(inIntervals([{ start: 1, end: 3 }], 1)).toBe(true);
  });

  it("covers picked bags for the whole range and picked riders only while they had a bag", () => {
    const assignments = [asg("bag14", "marco", "2026-08-01T00:00:00Z", "2026-09-24T12:00:00Z"), asg("bag14", "grace", "2026-09-24T12:00:00Z", null)];
    const byRider = buildScope({ from, to, bagIds: [], riderIds: ["grace"], everyBagId: ["bag6", "bag14"], assignments });
    expect([...byRider.keys()]).toEqual(["bag14"]);
    expect(byRider.get("bag14")).toEqual([{ start: Date.parse("2026-09-24T12:00:00Z"), end: to }]);
    const both = buildScope({ from, to, bagIds: ["bag14"], riderIds: ["grace"], everyBagId: [], assignments });
    expect(both.get("bag14")).toEqual([{ start: from, end: to }]);
    const everyone = buildScope({ from, to, bagIds: [], riderIds: [], everyBagId: ["bag6", "bag14"], assignments });
    expect([...everyone.keys()]).toEqual(["bag6", "bag14"]);
  });

  it("reports hand-overs inside the range", () => {
    const assignments = [asg("bag14", "marco", "2026-08-01T00:00:00Z", "2026-09-24T12:00:00Z"), asg("bag14", "grace", "2026-09-24T12:00:00Z", null)];
    expect(handoversIn(assignments, new Set(["bag14"]), from, to, () => "Bag 014")).toEqual([
      { bagId: "bag14", bagName: "Bag 014", day: "2026-09-24", fromRiderName: "marco", toRiderName: "grace" },
    ]);
    expect(handoversIn(assignments, new Set(["bag6"]), from, to, () => "Bag 006")).toEqual([]);
  });

  it("names files sensibly", () => {
    const req = { type: "routes" as const, bagIds: ["x"], riderIds: [], fromDay: "2026-09-21", toDay: "2026-09-27" };
    expect(exportFilename(req, "gpx", "Bag 006")).toBe("digilite-routes-bag-006-2026-09-21-to-2026-09-27.gpx");
    expect(exportFilename({ ...req, toDay: "2026-09-21" }, "csv", null)).toBe("digilite-routes-2026-09-21.csv");
  });

  it("offers map files for routes only", () => {
    expect(exportFormatsFor("routes")).toContain("gpx");
    expect(exportFormatsFor("shifts")).toEqual(["xlsx", "csv"]);
  });
});

// Move east for 20 min, stop 20 min, 12 min with no signal (then a late batch), move 10 min.
function evening(): GpsRow[] {
  const pts: GpsRow[] = [];
  let t = Date.parse("2026-09-28T17:00:00Z");
  let lng = -0.08;
  for (let i = 0; i < 40; i++) pts.push({ t: (t += 30_000), lat: 51.52, lng: (lng += 0.0005), seq: 0 });
  for (let i = 0; i < 40; i++) pts.push({ t: (t += 30_000), lat: 51.52, lng, seq: 0 });
  t += 12 * 60_000;
  // Two points stored while offline, sent together with one arrival time.
  pts.push({ t, lat: 51.52, lng: (lng += 0.0005), seq: 0, late: true }, { t, lat: 51.52, lng: (lng += 0.0005), seq: 1, late: true });
  for (let i = 0; i < 20; i++) pts.push({ t: (t += 30_000), lat: 51.52, lng: (lng += 0.0005), seq: 0 });
  return pts;
}

describe("route rows", () => {
  const rows = routeRowsForDay(evening(), DEFAULT_ANALYTICS);
  const points = rows.filter((r): r is RoutePointRow => r.kind === "point");

  it("keeps every point and adds one 'no signal' row at the gap, without filling it", () => {
    expect(points).toHaveLength(102);
    const gaps = rows.filter((r) => r.kind === "gap");
    expect(gaps).toHaveLength(1);
    const gi = rows.findIndex((r) => r.kind === "gap");
    // The gap sits between the last point before the silence and the first after it.
    expect(rows[gi - 1].t).toBe(Date.parse("2026-09-28T17:40:00Z"));
    // From the last real point to when the late batch arrived: the whole silence, once.
    expect(gaps[0].kind === "gap" && gaps[0].seconds).toBe(12 * 60);
  });

  it("marks stops, moving and late points; no speed from estimated times", () => {
    expect(points.slice(0, 37).every((p) => p.state === "Moving")).toBe(true);
    expect(points.slice(45, 79).every((p) => p.state === "Stopped")).toBe(true);
    const late = points.filter((p) => p.late);
    expect(late).toHaveLength(2);
    expect(late.every((p) => p.kmh === null)).toBe(true);
    // Late points keep their (shared) arrival time: nothing is invented.
    expect(late[0].t).toBe(late[1].t);
    expect(points[5].kmh).toBeGreaterThan(3);
    // The first point after the batch has no speed either (its previous point is late).
    expect(points[points.indexOf(late[1]) + 1].kmh).toBeNull();
  });

  it("splits map lines at the gap", () => {
    const segs = routeSegments(rows);
    expect(segs.length).toBe(2);
    expect(segs.flat()).toHaveLength(102);
  });

  it("gives a long break between shifts no row but still splits the line", () => {
    const a = evening();
    const later = a.map((p) => ({ ...p, t: p.t + 3 * 3600_000 }));
    const r = routeRowsForDay([...a, ...later], DEFAULT_ANALYTICS);
    expect(r.filter((x) => x.kind === "gap")).toHaveLength(2);
    expect(routeSegments(r)).toHaveLength(4);
  });
});
