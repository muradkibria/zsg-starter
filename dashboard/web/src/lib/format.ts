// Display formatting — always London time, British English.

import { formatDuration, gbDateFormat, londonDay, londonTime } from "@digilite/shared";

export { formatDuration };

const dayFmt = gbDateFormat({ timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });
const longDayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" });
const dateFmt = gbDateFormat({ timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" });
const shortDateFmt = gbDateFormat({ timeZone: "Europe/London", day: "numeric", month: "short" });

const toDate = (v: string | number | Date) => (v instanceof Date ? v : new Date(v));

/** "17:47" */
export function time(v: string | number | Date | null | undefined): string {
  return v ? londonTime(toDate(v)) : "—";
}

/** "Mon 28 Sep" */
export function dayLabel(day: string): string {
  return dayFmt.format(new Date(`${day}T12:00:00Z`));
}

/** "Monday 28 September" */
export function longDay(day: string): string {
  return longDayFmt.format(new Date(`${day}T12:00:00Z`));
}

/** "28 Sep 2026" */
export function date(v: string | number | Date | null | undefined): string {
  return v ? dateFmt.format(toDate(v)) : "—";
}

/** "28 Sep" */
export function shortDate(v: string | number | Date | null | undefined): string {
  return v ? shortDateFmt.format(toDate(v)) : "—";
}

/** "today 17:47", "yesterday 22:47", "Mon 21 Sep", "3 months ago" */
export function when(v: string | null | undefined, now = new Date()): string {
  if (!v) return "never";
  const d = new Date(v);
  const ageMs = now.getTime() - d.getTime();
  if (ageMs < 60_000) return "just now";
  if (ageMs < 3600_000) return `${Math.round(ageMs / 60_000)} min ago`;
  const today = londonDay(now);
  const day = londonDay(d);
  if (day === today) return `today ${londonTime(d)}`;
  const y = londonDay(new Date(now.getTime() - 86400_000));
  if (day === y) return `yesterday ${londonTime(d)}`;
  const days = Math.floor(ageMs / 86400_000);
  if (days < 7) return dayLabel(day);
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function km(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} km`;
}

export function hours(seconds: number): string {
  return `${(seconds / 3600).toFixed(1)} h`;
}

export function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v)}%`;
}

export function num(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("en-GB");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function shortName(name: string | null | undefined): string {
  if (!name) return "";
  const [first, last] = name.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
}
