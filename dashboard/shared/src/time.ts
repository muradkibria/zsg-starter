// London-time helpers. Every "day" in DigiLite Hub is a London calendar day
// (midnight to midnight, British Summer Time aware), never a UTC day.

const TZ = "Europe/London";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface LondonParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function londonParts(d: Date): LondonParts {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(d)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Minutes London is ahead of UTC at instant d (0 in winter, 60 in summer). */
export function londonOffsetMinutes(d: Date): number {
  const p = londonParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** London calendar day of an instant, as YYYY-MM-DD. */
export function londonDay(d: Date): string {
  const p = londonParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:MM" in London time. */
export function londonTime(d: Date): string {
  const p = londonParts(d);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Fractional London hour-of-day (e.g. 17.5 = 17:30). */
export function londonHour(d: Date): number {
  const p = londonParts(d);
  return p.hour + p.minute / 60 + p.second / 3600;
}

export function isDay(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** UTC instant of London local midnight at the start of `day`. */
export function londonDayStart(day: string): Date {
  const [y, m, dd] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, dd, 0, 0, 0);
  // Offset can differ either side of midnight on change days; refine twice.
  let t = guess - londonOffsetMinutes(new Date(guess)) * 60000;
  t = guess - londonOffsetMinutes(new Date(t)) * 60000;
  return new Date(t);
}

/** [start, end) UTC instants covering the London day. */
export function londonDayBounds(day: string): [Date, Date] {
  return [londonDayStart(day), londonDayStart(addDays(day, 1))];
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Inclusive list of days from `from` to `to`. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayLondon(now = new Date()): string {
  return londonDay(now);
}

/** Colorlight timestamps are UTC but arrive without a "Z". */
export function parseColorlightTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Colorlight query times: "YYYY-MM-DDTHH:MM:SS" in UTC, no suffix. */
export function toColorlightTime(d: Date): string {
  return d.toISOString().slice(0, 19);
}

/** PocketBase date field format. */
export function toPbDate(d: Date): string {
  return d.toISOString().replace("T", " ");
}

export function fromPbDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "5h 38m", "41 min", "25 s". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${pad(mm)}m` : `${h}h`;
}

/**
 * An en-GB date formatter that writes "Sep": newer ICU data abbreviates
 * September as "Sept", which reads oddly beside "Aug" and "Oct".
 */
export function gbDateFormat(options: Intl.DateTimeFormatOptions): { format(date: Date | number): string } {
  const fmt = new Intl.DateTimeFormat("en-GB", options);
  return { format: (date) => fmt.format(date).replace(/\bSept\b/g, "Sep") };
}
