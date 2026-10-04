// Who carried which bag, and when. The bag owns the data; a rider's hours and
// routes are the bag's data between the assignment's start and end.

import type { BagRiderRef, Stint } from "@digilite/shared";
import { getAll, parsePbDate, type RecordModel } from "../pb";

export interface AssignmentRow {
  id: string;
  bagId: string;
  riderId: string;
  riderName: string;
  riderDemo: boolean;
  start: Date;
  end: Date | null;
}

let cache: { at: number; rows: AssignmentRow[] } | null = null;

export function invalidateAssignments() {
  cache = null;
}

export async function allAssignments(): Promise<AssignmentRow[]> {
  if (cache && Date.now() - cache.at < 10000) return cache.rows;
  const recs = await getAll<RecordModel>("assignments", { sort: "start_at", expand: "rider" });
  const rows = recs
    .map((r) => ({
      id: r.id,
      bagId: r.bag,
      riderId: r.rider,
      riderName: (r.expand?.rider as RecordModel | undefined)?.name ?? "Unknown rider",
      riderDemo: !!(r.expand?.rider as RecordModel | undefined)?.demo,
      start: parsePbDate(r.start_at)!,
      end: parsePbDate(r.end_at),
    }))
    .filter((r) => r.start);
  cache = { at: Date.now(), rows };
  return rows;
}

export function activeAt(rows: AssignmentRow[], bagId: string, at: Date): AssignmentRow | null {
  const t = at.getTime();
  let found: AssignmentRow | null = null;
  for (const r of rows) {
    if (r.bagId !== bagId) continue;
    if (r.start.getTime() <= t && (!r.end || r.end.getTime() > t)) found = r;
  }
  return found;
}

export async function currentRiderByBag(now = new Date()): Promise<Map<string, BagRiderRef>> {
  const rows = await allAssignments();
  const map = new Map<string, BagRiderRef>();
  for (const r of rows) {
    if (r.start.getTime() <= now.getTime() && (!r.end || r.end.getTime() > now.getTime())) {
      map.set(r.bagId, { id: r.riderId, name: r.riderName, since: r.start.toISOString(), demo: r.riderDemo });
    }
  }
  return map;
}

export async function stintsForBag(bagId: string): Promise<Stint[]> {
  const rows = (await allAssignments()).filter((r) => r.bagId === bagId);
  return rows
    .map((r) => ({
      assignmentId: r.id,
      riderId: r.riderId,
      riderName: r.riderName,
      start: r.start.toISOString(),
      end: r.end ? r.end.toISOString() : null,
      demo: r.riderDemo,
    }))
    .sort((a, b) => b.start.localeCompare(a.start));
}

export async function assignmentsForRider(riderId: string): Promise<AssignmentRow[]> {
  return (await allAssignments()).filter((r) => r.riderId === riderId);
}
