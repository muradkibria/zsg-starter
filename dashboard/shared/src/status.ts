// Bag status buckets, device checks and small domain helpers.

import { londonOffsetMinutes } from "./time";

export type BagStatus = "now" | "day" | "idle" | "gone";
export type Lifecycle = "active" | "storage" | "repair" | "lost" | "retired";
export type Role = "owner" | "ops" | "sales" | "viewer";

export const STATUS_ORDER: BagStatus[] = ["now", "day", "idle", "gone"];

export const STATUS_LABEL: Record<BagStatus, string> = {
  now: "Out now",
  day: "Out in the last day",
  idle: "Idle 1 – 7 days",
  gone: "Not seen for over a week",
};

/** Validated for colour-blind separation and contrast on the paper background. Always pair with shape. */
export const STATUS_COLOR: Record<BagStatus, string> = {
  now: "#1F8A55",
  day: "#3E6FD8",
  idle: "#B7791F",
  gone: "#B3261E",
};

export const STATUS_MS = {
  /** A bag is "out now" if it reported in the last 3 minutes (Colorlight reports every ~30–60 s). */
  now: 3 * 60 * 1000,
  day: 24 * 3600 * 1000,
  idle: 7 * 24 * 3600 * 1000,
};

export function bagStatus(lastReportAt: Date | null, now = Date.now()): BagStatus {
  if (!lastReportAt) return "gone";
  const age = now - lastReportAt.getTime();
  if (age <= STATUS_MS.now) return "now";
  if (age <= STATUS_MS.day) return "day";
  if (age <= STATUS_MS.idle) return "idle";
  return "gone";
}

/** "Terminal 006" → "Bag 006"; "Terminal3982" → "Bag 3982". */
export function bagNameFromColorlight(name: string, id: number): string {
  const m = String(name ?? "").match(/(\d+)\s*$/);
  return m ? `Bag ${m[1]}` : `Bag ${id}`;
}

/** "June 26_83fca0e7…_7174.vsn" → "June 26". */
export function programNameFromVsn(vsn: string | null | undefined): string | null {
  if (!vsn) return null;
  const s = vsn.replace(/\.vsn$/i, "");
  const m = s.match(/^(.*)_[0-9a-f]{32}_\d+$/i);
  return (m ? m[1] : s).trim() || null;
}

export function brightnessPct(raw: number | null | undefined): number | null {
  if (raw == null || Number.isNaN(raw)) return null;
  return Math.round((raw / 255) * 100);
}

/** Compare dotted version strings: -1, 0, 1. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Device clock offset like "+01" / "+08" in hours, or null. */
export function parseTzHours(tz: string | null | undefined): number | null {
  if (!tz) return null;
  const m = String(tz).match(/^([+-])?(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
  return m[1] === "-" ? -h : h;
}

/** True when the device clock offset matches London right now (GMT or BST). */
export function clockMatchesLondon(tz: string | null | undefined, now = new Date()): boolean | null {
  const h = parseTzHours(tz);
  if (h == null) return null;
  return h * 60 === londonOffsetMinutes(now);
}

export function describeTz(tz: string | null | undefined): string {
  const h = parseTzHours(tz);
  if (h == null) return "Unknown";
  if (h === 0 || h === 1) return "London time";
  if (h === 8) return "China time (+08)";
  return `UTC${h >= 0 ? "+" : ""}${h}`;
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  ops: "Operations",
  sales: "Sales",
  viewer: "Read-only",
};

export type Permission =
  | "fleet.view"
  | "bags.control"
  | "bags.edit"
  | "riders.view"
  | "riders.edit"
  | "riders.documents"
  | "loops.edit"
  | "loops.publish"
  | "schedules.edit"
  | "payroll.view"
  | "payroll.approve"
  | "exports.run"
  | "campaigns.view"
  | "campaigns.edit"
  | "zones.edit"
  | "settings.view"
  | "settings.edit"
  | "team.edit"
  | "audit.view";

const ALL: Permission[] = [
  "fleet.view", "bags.control", "bags.edit", "riders.view", "riders.edit", "riders.documents", "loops.edit",
  "loops.publish", "schedules.edit", "payroll.view", "payroll.approve", "exports.run", "campaigns.view",
  "campaigns.edit", "zones.edit", "settings.view", "settings.edit", "team.edit", "audit.view",
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  ops: ALL.filter((p) => !["settings.edit", "team.edit"].includes(p)),
  sales: ["fleet.view", "campaigns.view", "campaigns.edit", "loops.edit", "exports.run", "settings.view"],
  viewer: ["fleet.view", "riders.view", "campaigns.view", "payroll.view", "settings.view"],
};

export function can(role: Role | null | undefined, p: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role]?.includes(p);
}
