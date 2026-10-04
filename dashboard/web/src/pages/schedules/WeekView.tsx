// The week: what plays when (Mon–Sun), brightness through each day, and "now".
// Desktop: day columns on a 24-hour axis. Phone: one bar per day plus the
// chosen day spelled out.

import clsx from "clsx";
import { Moon, Sun } from "lucide-react";
import type { PreviewBlock, PreviewDay, SchedulePreview } from "@digilite/shared";
import { Card, Spinner } from "@/components/ui";
import { longDay } from "@/lib/format";
import { DEFAULT_COLOUR, GAP_PATTERN, PriorityBadge, brightnessFill, dayHead, pct, ruleColour } from "./parts";

const HOUR_PX = 22;
const pad = (n: number) => String(n).padStart(2, "0");

function blockColour(b: PreviewBlock): { bg: string; fg: string } | null {
  if (!b.loopId) return null;
  return b.ruleId ? ruleColour(b.priority) : DEFAULT_COLOUR;
}

function blockLabel(b: PreviewBlock): string {
  if (!b.loopId) return "Nothing scheduled";
  return b.loopName ?? "Loop";
}

function describeBlock(b: PreviewBlock): string {
  const who = !b.loopId ? "nothing scheduled" : b.ruleId ? `${b.loopName} (priority ${b.priority})` : `${b.loopName} (default loop)`;
  return `${b.start} to ${b.end}: ${who}`;
}

/** Brightness through a day as [start, end, pct] runs. */
function brightnessRuns(d: PreviewDay): { start: number; end: number; pct: number }[] {
  const out: { start: number; end: number; pct: number }[] = [];
  let at = 0;
  let cur = d.brightness.startPct;
  for (const s of d.brightness.steps) {
    if (s.atMin > at && cur != null) out.push({ start: at, end: s.atMin, pct: cur });
    at = Math.max(at, s.atMin);
    cur = s.pct;
  }
  if (at < 1440 && cur != null) out.push({ start: at, end: 1440, pct: cur });
  return out;
}

export function WeekView({
  preview,
  loading,
  selectedDay,
  onSelectDay,
  today,
  nowMin,
}: {
  preview: SchedulePreview | undefined;
  loading: boolean;
  selectedDay: string;
  onSelectDay: (day: string) => void;
  today: string;
  nowMin: number;
}) {
  if (!preview) {
    return <Card className="p-5">{loading ? <Spinner label="Working out the week…" /> : null}</Card>;
  }
  const selected = preview.days.find((d) => d.day === selectedDay) ?? preview.days[0];
  return (
    <Card className="flex flex-col gap-4 p-3.5 md:p-5" aria-label="Week view">
      <div className="hidden md:block">
        <DesktopGrid days={preview.days} today={today} nowMin={nowMin} selected={selected.day} onSelect={onSelectDay} />
      </div>
      <div className="md:hidden">
        <PhoneWeek days={preview.days} today={today} nowMin={nowMin} selected={selected.day} onSelect={onSelectDay} />
      </div>
      <DayDetail d={selected} today={today} />
      <Legend days={preview.days} />
    </Card>
  );
}

// ── Desktop ────────────────────────────────────────────────────────────────────

function DesktopGrid({ days, today, nowMin, selected, onSelect }: { days: PreviewDay[]; today: string; nowMin: number; selected: string; onSelect: (d: string) => void }) {
  return (
    <div>
      <div className="flex gap-1.5 pl-12">
        {days.map((d) => {
          const isToday = d.day === today;
          const isSel = d.day === selected;
          return (
            <button
              key={d.day}
              onClick={() => onSelect(d.day)}
              aria-pressed={isSel}
              aria-label={`${longDay(d.day)}${isToday ? ", today" : ""}`}
              className={clsx(
                "flex h-11 min-w-0 flex-1 flex-col items-center justify-center rounded-lg text-xs font-semibold transition-colors",
                isSel ? "bg-navy text-white" : "text-ink-2 hover:bg-paper",
              )}
            >
              <span>{dayHead(d.day)}</span>
              {isToday ? (
                <span className={clsx("text-[10px] font-bold tracking-wide uppercase", isSel ? "text-white/80" : "text-red-ink")}>Today</span>
              ) : d.clockChange ? (
                <span className={clsx("text-[10px] font-medium", isSel ? "text-white/80" : "text-muted")}>Clocks {d.clockChange === "back" ? "go back" : "go forward"}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="relative mt-2 flex gap-1.5" style={{ height: 24 * HOUR_PX }}>
        <div className="relative w-12 shrink-0" aria-hidden="true">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span
              key={h}
              className={clsx("num absolute right-2 text-[10px] text-caption", h === 0 ? "" : h === 24 ? "-translate-y-full" : "-translate-y-1/2")}
              style={{ top: h * HOUR_PX }}
            >
              {pad(h)}:00
            </span>
          ))}
        </div>
        {days.map((d) => (
          <DayColumn key={d.day} d={d} isToday={d.day === today} nowMin={nowMin} onSelect={() => onSelect(d.day)} />
        ))}
      </div>
    </div>
  );
}

function DayColumn({ d, isToday, nowMin, onSelect }: { d: PreviewDay; isToday: boolean; nowMin: number; onSelect: () => void }) {
  return (
    <div
      className={clsx("relative min-w-0 flex-1 cursor-pointer overflow-hidden rounded-lg bg-paper", isToday && "ring-1 ring-navy/25")}
      onClick={onSelect}
      role="list"
      aria-label={longDay(d.day)}
    >
      {[3, 6, 9, 12, 15, 18, 21].map((h) => (
        <div key={h} aria-hidden="true" className="absolute inset-x-0 border-t border-dashed border-rule" style={{ top: `${(h / 24) * 100}%` }} />
      ))}
      {d.blocks.map((b) => {
        const c = blockColour(b);
        const px = ((b.endMin - b.startMin) / 60) * HOUR_PX;
        return (
          <div
            key={`${b.startMin}-${b.ruleId ?? b.loopId ?? "gap"}`}
            role="listitem"
            title={describeBlock(b)}
            className="absolute right-[10px] left-[3px] overflow-hidden rounded-md px-1 text-[11px] leading-tight font-semibold"
            style={{
              top: `calc(${(b.startMin / 1440) * 100}% + 1px)`,
              height: `calc(${((b.endMin - b.startMin) / 1440) * 100}% - 2px)`,
              background: c?.bg ?? GAP_PATTERN,
              color: c?.fg ?? "#8E8778",
            }}
          >
            <span className="sr-only">{describeBlock(b)}</span>
            <span aria-hidden="true">
              {px >= 17 && <span className={clsx("block pt-[3px] break-words", px >= 40 ? "line-clamp-2" : "truncate")}>{blockLabel(b)}</span>}
              {px >= 56 && (
                <span className="num block truncate text-[10px] font-medium opacity-80">
                  {b.start}–{b.end}
                </span>
              )}
            </span>
          </div>
        );
      })}
      <div aria-hidden="true" className="absolute inset-y-0 right-[2px] w-[6px] overflow-hidden rounded-full">
        {brightnessRuns(d).map((r) => (
          <div
            key={r.start}
            className="absolute inset-x-0"
            style={{ top: `${(r.start / 1440) * 100}%`, height: `${((r.end - r.start) / 1440) * 100}%`, background: brightnessFill(r.pct) }}
          />
        ))}
      </div>
      {isToday && <NowLine minute={nowMin} />}
    </div>
  );
}

function NowLine({ minute, horizontal }: { minute: number; horizontal?: boolean }) {
  const at = `${(minute / 1440) * 100}%`;
  if (horizontal) {
    return (
      <div className="pointer-events-none absolute inset-y-[-3px] z-10 w-0.5 bg-red-ink" style={{ left: at }}>
        <span className="sr-only">Now</span>
      </div>
    );
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: at }}>
      <div className="relative h-0.5 bg-red-ink">
        <span className="absolute -top-[3px] -left-0.5 size-2 rounded-full bg-red-ink" />
      </div>
      <span className="sr-only">Now</span>
    </div>
  );
}

// ── Phone ──────────────────────────────────────────────────────────────────────

function PhoneWeek({ days, today, nowMin, selected, onSelect }: { days: PreviewDay[]; today: string; nowMin: number; selected: string; onSelect: (d: string) => void }) {
  return (
    <div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {days.map((d) => {
          const isSel = d.day === selected;
          const isToday = d.day === today;
          return (
            <li key={d.day}>
              <button
                onClick={() => onSelect(d.day)}
                aria-pressed={isSel}
                aria-label={`${longDay(d.day)}${isToday ? ", today" : ""}`}
                className={clsx("flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left", isSel ? "bg-info-bg" : "hover:bg-paper")}
              >
                <span className="flex w-[58px] shrink-0 flex-col">
                  <span className="text-[13px] font-semibold">{dayHead(d.day)}</span>
                  {isToday && <span className="text-[10px] font-bold tracking-wide text-red-ink uppercase">Today</span>}
                </span>
                <span className="relative h-6 flex-1 overflow-hidden rounded-md bg-paper">
                  {d.blocks.map((b) => {
                    const c = blockColour(b);
                    return (
                      <span
                        key={`${b.startMin}-${b.ruleId ?? b.loopId ?? "gap"}`}
                        className="absolute inset-y-0 border-r border-white"
                        style={{ left: `${(b.startMin / 1440) * 100}%`, width: `${((b.endMin - b.startMin) / 1440) * 100}%`, background: c?.bg ?? GAP_PATTERN }}
                      />
                    );
                  })}
                  {isToday && <NowLine minute={nowMin} horizontal />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="num mt-1 flex justify-between pr-2 pl-[78px] text-[10px] text-caption" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

// ── The chosen day ─────────────────────────────────────────────────────────────

function DayDetail({ d, today }: { d: PreviewDay; today: string }) {
  const runs = brightnessRuns(d);
  const named = d.blocks.filter((b) => b.ruleId || !b.loopId);
  const defaults = d.blocks.filter((b) => b.loopId && !b.ruleId);
  return (
    <section aria-label={`Details for ${longDay(d.day)}`} className="flex flex-col gap-3 border-t border-rule pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 font-display text-base font-semibold">
          {longDay(d.day)}
          {d.day === today && <span className="ml-2 text-xs font-bold tracking-wide text-red-ink uppercase">Today</span>}
        </h3>
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Sun className="size-3.5" aria-hidden="true" /> Sunrise <strong className="num text-ink">{d.sunrise}</strong>
          </span>
          <span className="inline-flex items-center gap-1">
            <Moon className="size-3.5" aria-hidden="true" /> Sunset <strong className="num text-ink">{d.sunset}</strong>
          </span>
        </span>
      </div>
      {d.clockChange && (
        <p className="m-0 text-xs text-ink-2">
          Clocks {d.clockChange === "back" ? "go back an hour" : "go forward an hour"} early this morning. Times here are London time.
        </p>
      )}

      {/* Phone: what plays, spelled out (the desktop grid already shows it) */}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 md:hidden">
        {named.map((b) => (
          <li key={`${b.startMin}-${b.ruleId ?? "gap"}`} className="flex items-center gap-2.5 text-[13px]">
            {b.loopId ? <PriorityBadge priority={b.priority} /> : <span className="size-6 shrink-0 rounded-[7px]" style={{ background: GAP_PATTERN }} aria-hidden="true" />}
            <span className="num w-[92px] shrink-0 text-muted">
              {b.start}–{b.end}
            </span>
            <span className={clsx("min-w-0 truncate font-semibold", !b.loopId && "font-medium text-muted")}>{blockLabel(b)}</span>
          </li>
        ))}
        {defaults.length > 0 && (
          <li className="flex items-center gap-2.5 text-[13px]">
            <PriorityBadge priority={null} />
            <span className="min-w-0 text-muted">
              {named.length ? "Rest of the day" : "All day"}: <strong className="font-semibold text-ink">{defaults[0].loopName}</strong>
            </span>
          </li>
        )}
      </ul>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-semibold">Brightness</span>
          {!runs.length && <span className="text-xs text-muted">Not scheduled: bags keep their current level</span>}
        </div>
        {runs.length > 0 && (
          <>
            <div className="relative h-8 overflow-hidden rounded-md bg-paper" aria-hidden="true">
              {runs.map((r) => {
                const w = ((r.end - r.start) / 1440) * 100;
                return (
                  <div
                    key={r.start}
                    className="absolute inset-y-0 flex items-center overflow-hidden border-l-2 border-[#C26A00] px-1 text-[11px] font-bold whitespace-nowrap text-amber-ink first:border-l-0"
                    style={{ left: `${(r.start / 1440) * 100}%`, width: `${w}%`, background: brightnessFill(r.pct) }}
                  >
                    {w >= 10 ? pct(r.pct) : w >= 5 ? <span className="hidden md:inline">{pct(r.pct)}</span> : ""}
                  </div>
                );
              })}
            </div>
            <div className="num relative h-3 text-[10px] text-caption" aria-hidden="true">
              {[0, 6, 12, 18, 24].map((h) => (
                <span key={h} className={clsx("absolute", h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: `${(h / 24) * 100}%` }}>
                  {pad(h)}:00
                </span>
              ))}
            </div>
            <p className="m-0 text-xs text-ink-2">
              {d.brightness.startPct != null && d.brightness.steps[0]?.atMin > 0 && <>{pct(d.brightness.startPct)} overnight · </>}
              {d.brightness.steps.map((s, i) => (
                <span key={i}>
                  {i > 0 && " · "}
                  <strong className="num font-semibold text-ink">{pct(s.pct)}</strong> from{" "}
                  {s.from === "sunrise" ? `sunrise ${s.at}` : s.from === "sunset" ? `sunset ${s.at}` : s.at}
                </span>
              ))}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Legend({ days }: { days: PreviewDay[] }) {
  const rules = new Map<number, string>();
  let fallback: string | null = null;
  let gaps = false;
  const bright = days.some((d) => d.brightness.steps.length > 0);
  for (const d of days) {
    for (const b of d.blocks) {
      if (b.ruleId && b.priority != null && !rules.has(b.priority)) rules.set(b.priority, b.loopName ?? "Loop");
      if (b.loopId && !b.ruleId) fallback = b.loopName;
      if (!b.loopId) gaps = true;
    }
  }
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-rule pt-3 text-[11px] text-ink-2">
      {[...rules.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([p, name]) => (
          <span key={p} className="inline-flex items-center gap-1.5">
            <PriorityBadge priority={p} className="size-[18px] rounded-[5px] text-[10px]" />
            {name}
          </span>
        ))}
      {fallback && (
        <span className="inline-flex items-center gap-1.5">
          <PriorityBadge priority={null} className="size-[18px] rounded-[5px] text-[10px]" />
          {fallback} (default)
        </span>
      )}
      {gaps && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm" style={{ background: GAP_PATTERN }} aria-hidden="true" />
          Nothing scheduled
        </span>
      )}
      {bright && (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm" style={{ background: "linear-gradient(90deg, rgba(194,106,0,.2), rgba(194,106,0,.62))" }} aria-hidden="true" />
          Brightness (stronger = brighter)
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 bg-red-ink" aria-hidden="true" />
        Now
      </span>
    </div>
  );
}
