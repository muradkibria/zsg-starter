// Last 14 days: moving hours per London day as columns (pick a day to see it
// on the map), with the same numbers listed underneath as the readable table.

import { useState } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { addDays, todayLondon, type BagDayDto, type BagDetail } from "@digilite/shared";
import { useBagDays } from "@/lib/queries";
import { ErrorState, Spinner, cx } from "@/components/ui";
import { dayLabel, formatDuration, hours, km, longDay, num, time } from "@/lib/format";
import { Section } from "../bits";

interface DayPoint {
  day: string;
  d: BagDayDto | null;
  hours: number;
  out: boolean;
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "narrow" });

const SHOWN = 7;

export function DaysSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const days = useBagDays(bag.id);
  const [showAll, setShowAll] = useState(false);
  const today = todayLondon();
  const byDay = new Map((days.data ?? []).map((d) => [d.day, d]));
  const series: DayPoint[] = Array.from({ length: 14 }, (_, i) => {
    const day = addDays(today, i - 13);
    const d = byDay.get(day) ?? null;
    return { day, d, hours: d ? d.movingSeconds / 3600 : 0, out: !!d && d.points > 0 };
  });
  const out = series.filter((p) => p.out);
  const notOut = series.filter((p) => !p.out);
  const total = out.reduce(
    (a, p) => ({ moving: a.moving + p.d!.movingSeconds, km: a.km + p.d!.km, plays: a.plays + p.d!.plays }),
    { moving: 0, km: 0, plays: 0 },
  );

  const sub = days.data
    ? out.length
      ? `Out ${out.length} of 14 days · ${hours(total.moving)} moving · ${km(total.km)} · ${num(total.plays)} plays`
      : "Not out in the last 14 days"
    : undefined;

  return (
    <Section title="Last 14 days" sub={sub} className={className}>
      {days.isLoading && <Spinner label="Loading days…" />}
      {days.error && <ErrorState error={days.error} retry={() => void days.refetch()} />}
      {/* Not out at all: the header line says so; an empty chart would add nothing. */}
      {days.data && out.length > 0 && (
        <>
          <DaysChart series={series} bagId={bag.id} today={today} />
          <div className="flex flex-col gap-1">
            <div
              className="hidden grid-cols-[84px_84px_56px_56px_56px_minmax(0,1fr)] gap-x-3 border-b border-rule pr-7 pb-1.5 text-[11px] font-semibold text-muted sm:grid"
              aria-hidden="true"
            >
              <span>Day</span>
              <span>Out</span>
              <span>Moving</span>
              <span>Ridden</span>
              <span>Plays</span>
              <span>Most time in</span>
            </div>
            <ul className="m-0 flex list-none flex-col p-0" aria-label="Days out">
              {[...out]
                .reverse()
                .slice(0, showAll ? undefined : SHOWN)
                .map((p) => (
                  <DayRow key={p.day} p={p} bagId={bag.id} today={today} />
                ))}
            </ul>
            {out.length > SHOWN && (
              <button onClick={() => setShowAll((v) => !v)} className="min-h-11 self-start text-[13px] font-semibold text-accent md:min-h-0">
                {showAll ? "Show fewer days" : `Show all ${out.length} days out`}
              </button>
            )}
          </div>
          {notOut.length > 0 && (
            <p className="m-0 text-xs text-muted">
              Not out: {notOut.map((p) => (p.day === today ? "today (so far)" : dayLabel(p.day))).join(", ")}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function niceTop(maxHours: number): number {
  if (maxHours <= 2) return 2;
  return Math.ceil(maxHours / 2) * 2;
}

function DaysChart({ series, bagId, today }: { series: DayPoint[]; bagId: string; today: string }) {
  const top = niceTop(Math.max(0, ...series.map((p) => p.hours)));
  let peak = -1;
  series.forEach((p, i) => {
    if (p.out && p.hours > 0 && (peak < 0 || p.hours > series[peak].hours)) peak = i;
  });

  return (
    <figure className="m-0" aria-label="Moving hours per day, last 14 days">
      <div className="flex pt-2">
        <div className="relative w-8 shrink-0 text-[10px] text-caption" aria-hidden="true">
          <span className="num absolute top-0 right-2 -translate-y-1/2">{top} h</span>
          <span className="num absolute top-1/2 right-2 -translate-y-1/2">{top / 2} h</span>
          <span className="num absolute right-2 bottom-0 translate-y-1/2">0</span>
        </div>
        <div className="relative h-[128px] flex-1">
          <div className="absolute inset-x-0 top-0 border-t border-rule-soft" aria-hidden="true" />
          <div className="absolute inset-x-0 top-1/2 border-t border-rule-soft" aria-hidden="true" />
          <div className="absolute inset-x-0 bottom-0 border-t border-line" aria-hidden="true" />
          <ol className="absolute inset-0 m-0 flex list-none items-end p-0">
            {series.map((p, i) => (
              <Column key={p.day} p={p} i={i} top={top} peak={i === peak} bagId={bagId} isToday={p.day === today} />
            ))}
          </ol>
        </div>
      </div>
      <div className="flex pt-1.5 pl-8" aria-hidden="true">
        {series.map((p) => (
          <span key={p.day} className={cx("num flex-1 text-center text-[10px] leading-tight", p.day === today ? "font-bold text-ink" : "text-caption")}>
            {WEEKDAY.format(new Date(`${p.day}T12:00:00Z`))}
            <br />
            {Number(p.day.slice(8))}
          </span>
        ))}
      </div>
    </figure>
  );
}

function Column({ p, i, top, peak, bagId, isToday }: { p: DayPoint; i: number; top: number; peak: boolean; bagId: string; isToday: boolean }) {
  const pct = Math.min(100, (p.hours / top) * 100);
  const align = i < 3 ? "left-0" : i > 10 ? "right-0" : "left-1/2 -translate-x-1/2";
  const tip = (
    <span
      role="tooltip"
      className={cx(
        "pointer-events-none absolute z-10 hidden w-max max-w-[190px] rounded-lg bg-navy px-2.5 py-1.5 text-left text-[11px] leading-snug text-white shadow-lg group-hover:block group-focus-visible:block",
        align,
      )}
      style={{ bottom: `calc(${p.out ? Math.max(pct, 2) : 0}% + 8px)` }}
    >
      <span className="block text-xs font-semibold">{p.out ? `${hours(p.d!.movingSeconds)} moving` : "Not out"}</span>
      <span className="block text-white/80">
        {dayLabel(p.day)}
        {isToday && " · so far"}
      </span>
      {p.out && (
        <span className="block text-white/80">
          {km(p.d!.km)} · {num(p.d!.plays)} plays
        </span>
      )}
    </span>
  );

  if (!p.out) {
    return (
      <li className="group relative flex h-full flex-1 items-end justify-center">
        <span className="mb-[-1px] block h-[3px] w-[calc(100%-10px)] max-w-3 rounded-full bg-line" aria-hidden="true" />
        <span className="sr-only">{longDay(p.day)}: not out</span>
        {tip}
      </li>
    );
  }

  return (
    <li className="relative flex h-full flex-1 justify-center">
      <Link
        to={`/map?bag=${bagId}&day=${p.day}`}
        aria-label={`${longDay(p.day)}${isToday ? " (so far)" : ""}: ${hours(p.d!.movingSeconds)} moving, ${km(p.d!.km)}, ${num(p.d!.plays)} plays. See it on the map.`}
        className="group relative flex h-full w-full items-end justify-center rounded-sm no-underline"
      >
        <span
          className={cx(
            "block w-[calc(100%-4px)] max-w-6 rounded-t-[4px] transition-colors group-hover:bg-accent group-focus-visible:bg-accent",
            isToday ? "bg-navy/55" : "bg-navy",
          )}
          style={{ height: `${Math.max(pct, 2)}%` }}
        />
        {peak && (
          <span className="num pointer-events-none absolute left-1/2 -translate-x-1/2 text-[10px] font-semibold whitespace-nowrap text-ink-2 group-hover:hidden" style={{ bottom: `calc(${pct}% + 3px)` }}>
            {hours(p.d!.movingSeconds)}
          </span>
        )}
        {tip}
      </Link>
    </li>
  );
}

function DayRow({ p, bagId, today }: { p: DayPoint; bagId: string; today: string }) {
  const d = p.d!;
  const zones = d.zones.length
    ? `${d.zones[0].name} ${formatDuration(d.zones[0].seconds)}${d.zones.length > 1 ? ` +${d.zones.length - 1}` : ""}`
    : "No zones";
  const day = p.day === today ? "Today" : dayLabel(p.day);
  return (
    <li className="border-b border-rule-soft last:border-b-0">
      <Link
        to={`/map?bag=${bagId}&day=${p.day}`}
        aria-label={`${p.day === today ? "Today so far" : longDay(p.day)}: out ${time(d.first)} to ${time(d.last)}, ${hours(d.movingSeconds)} moving, ${km(d.km)}, ${num(d.plays)} plays, most time in ${zones}. See it on the map.`}
        className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-[13px] text-ink no-underline hover:bg-paper"
      >
        {/* Phone: two lines */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:hidden">
          <span className="flex justify-between gap-2">
            <span className="font-semibold">{day}</span>
            <span className="num text-ink-2">
              {time(d.first)}–{time(d.last)}
            </span>
          </span>
          <span className="num truncate text-ink-2">
            <strong className="font-semibold text-ink">{hours(d.movingSeconds)}</strong> moving · {km(d.km)} · {num(d.plays)} plays · {zones}
          </span>
        </span>
        {/* Wider: one aligned row under the header */}
        <span className="hidden min-w-0 flex-1 grid-cols-[84px_84px_56px_56px_56px_minmax(0,1fr)] items-center gap-x-3 sm:grid">
          <span className="font-semibold">{day}</span>
          <span className="num text-ink-2">
            {time(d.first)}–{time(d.last)}
          </span>
          <span className="num font-semibold">{hours(d.movingSeconds)}</span>
          <span className="num text-ink-2">{km(d.km)}</span>
          <span className="num text-ink-2">{num(d.plays)}</span>
          <span className="truncate text-ink-2">{zones}</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-caption" aria-hidden="true" />
      </Link>
    </li>
  );
}
