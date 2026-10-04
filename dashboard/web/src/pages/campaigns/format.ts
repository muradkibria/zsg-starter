// Formatting for campaigns and client reports. Days are London days
// (YYYY-MM-DD); format them at noon UTC so no time zone can shift the date.

import { addDays, gbDateFormat, todayLondon } from "@digilite/shared";

const at = (day: string) => new Date(`${day}T12:00:00Z`);
const f = (o: Intl.DateTimeFormatOptions) => gbDateFormat({ timeZone: "UTC", ...o });
const dShort = f({ day: "numeric", month: "short" });
const dShortY = f({ day: "numeric", month: "short", year: "numeric" });
const dLong = f({ day: "numeric", month: "long" });
const dLongY = f({ day: "numeric", month: "long", year: "numeric" });
const dWeek = f({ weekday: "short", day: "numeric", month: "short" });
const dMonth = f({ month: "short" });

/** "6 Oct" */
export const dayShort = (day: string) => dShort.format(at(day));
/** "6 Oct 2026" */
export const dayShortY = (day: string) => dShortY.format(at(day));
/** "Tue 6 Oct" */
export const dayWeek = (day: string) => dWeek.format(at(day));
/** "Oct" */
export const monthShort = (day: string) => dMonth.format(at(day));
/** 0 = Sunday … 6 = Saturday */
export const weekday = (day: string) => at(day).getUTCDay();

/** "1 Sep – 31 Oct 2026", "1 – 28 Sep 2026", "28 Dec 2026 – 3 Jan 2027" */
export function dayRange(from: string | null, to: string | null, opts: { long?: boolean } = {}): string {
  if (!from || !to) return "No dates";
  const short = opts.long ? dLong : dShort;
  const withY = opts.long ? dLongY : dShortY;
  if (from === to) return withY.format(at(from));
  if (from.slice(0, 4) !== to.slice(0, 4)) return `${withY.format(at(from))} – ${withY.format(at(to))}`;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))} – ${withY.format(at(to))}`;
  return `${short.format(at(from))} – ${withY.format(at(to))}`;
}

/** Whole days from a to b. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Screen time: "38 min", "4.5 h", "713 h", "1,250 h". */
export function screenHours(seconds: number): string {
  if (seconds <= 0) return "0 h";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const h = seconds / 3600;
  return h < 10 ? `${h.toFixed(1)} h` : `${Math.round(h).toLocaleString("en-GB")} h`;
}

export const n = (v: number) => Math.round(v).toLocaleString("en-GB");

/** "12,340 km", "8.4 km" */
export const kmText = (v: number) => (v <= 0 ? "0 km" : v < 10 ? `${v.toFixed(1)} km` : `${Math.round(v).toLocaleString("en-GB")} km`);

/** Compact: 1,284 / 12.9K / 1.2M (for tight chart labels) */
export function compact(v: number): string {
  if (v < 10_000) return Math.round(v).toLocaleString("en-GB");
  const trim = (x: string) => x.replace(/\.0$/, "");
  if (v < 1_000_000) return `${trim((v / 1000).toFixed(v < 100_000 ? 1 : 0))}K`;
  return `${trim((v / 1_000_000).toFixed(1))}M`;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

// ── Periods (every period selector offers presets and a custom range) ─────────

export type PeriodPreset = "campaign" | "last7" | "yesterday" | "thisMonth" | "lastMonth" | "custom";

export interface Period {
  preset: PeriodPreset;
  fromDay: string;
  toDay: string;
}

const clamp = (from: string, to: string, today: string) => {
  const t = to > today ? today : to;
  return from > t ? { fromDay: t, toDay: t } : { fromDay: from, toDay: t };
};

export function presetPeriod(preset: Exclude<PeriodPreset, "custom">, c: { startDay: string | null; endDay: string | null }, today = todayLondon()): Period {
  switch (preset) {
    case "campaign": {
      const from = c.startDay && c.startDay <= today ? c.startDay : addDays(today, -6);
      const to = c.endDay && c.endDay < today ? c.endDay : today;
      return { preset, ...clamp(from, to, today) };
    }
    case "last7":
      return { preset, fromDay: addDays(today, -6), toDay: today };
    case "yesterday":
      return { preset, fromDay: addDays(today, -1), toDay: addDays(today, -1) };
    case "thisMonth":
      return { preset, fromDay: `${today.slice(0, 7)}-01`, toDay: today };
    case "lastMonth": {
      const firstThis = `${today.slice(0, 7)}-01`;
      const lastPrev = addDays(firstThis, -1);
      return { preset, fromDay: `${lastPrev.slice(0, 7)}-01`, toDay: lastPrev };
    }
  }
}

export const PRESET_LABEL: Record<PeriodPreset, string> = {
  campaign: "Whole campaign",
  last7: "Last 7 days",
  yesterday: "Yesterday",
  thisMonth: "This month",
  lastMonth: "Last month",
  custom: "Custom",
};
