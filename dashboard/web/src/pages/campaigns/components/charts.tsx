// Small, quiet charts for measured numbers: one series, thin bars grown from
// one baseline, a 2px gap between bars, hairline grid, and a readout that
// follows the pointer or the arrow keys. Every chart can switch to a table.

import { useState, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import type { CampaignDayPlays } from "@digilite/shared";
import { compact, dayShort, dayWeek, hourLabel, n, screenHours, weekday } from "../format";

export const CHART = {
  bar: "#3a67c6",
  barActive: "#061b47",
  track: "#efebe2",
  grid: "#e3ded3",
  noData: "repeating-linear-gradient(135deg, #e3ded3 0 2px, #f6f4ef 2px 6px)",
};

export interface Bar {
  key: string;
  /** Axis label (only shown where `tick` is true) */
  label: string;
  tick?: boolean;
  value: number;
  /** Readout text for this bar */
  readout: string;
  noData?: boolean;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}

export function BarChart({
  bars,
  height = 132,
  ariaLabel,
  idleReadout,
  compactTicks,
}: {
  bars: Bar[];
  height?: number;
  ariaLabel: string;
  /** What the readout says when nothing is hovered */
  idleReadout: ReactNode;
  compactTicks?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!bars.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const d = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.min(bars.length - 1, Math.max(0, (a ?? (d > 0 ? -1 : bars.length)) + d)));
    } else if (e.key === "Escape") setActive(null);
  };
  const cur = active != null ? bars[active] : null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="min-h-[18px] text-xs text-ink-2" aria-live="polite">
        {cur ? <span className="font-semibold text-ink">{cur.readout}</span> : idleReadout}
      </div>
      <div className="flex gap-2">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            role="img"
            aria-label={ariaLabel}
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="relative flex items-end gap-[2px] rounded-sm outline-offset-4"
            style={{ height }}
          >
            {[0.5, 1].map((f) => (
              <div key={f} className="pointer-events-none absolute inset-x-0 h-px" style={{ bottom: `${f * 100}%`, background: CHART.grid }} />
            ))}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-line" />
            {bars.map((b, i) => (
              <div
                key={b.key}
                onPointerEnter={() => setActive(i)}
                className="relative flex h-full min-w-0 flex-1 items-end justify-center"
              >
                {b.noData && <div className="absolute inset-x-0 top-0 bottom-0 opacity-70" style={{ background: CHART.noData }} />}
                {!b.noData && b.value > 0 && (
                  <div
                    className="relative w-full max-w-6 rounded-t-[4px] transition-colors"
                    style={{ height: `${Math.max(1.5, (b.value / max) * 100)}%`, background: active === i ? CHART.barActive : CHART.bar }}
                  />
                )}
                {active === i && <div className="pointer-events-none absolute inset-y-0 -inset-x-px rounded-sm bg-navy/5" />}
              </div>
            ))}
          </div>
          <div className="relative mt-1 h-4 text-[11px] text-muted">
            {bars.map((b, i) =>
              b.tick ? (
                <span
                  key={b.key}
                  className="num absolute whitespace-nowrap"
                  style={{
                    left: `${((i + 0.5) / bars.length) * 100}%`,
                    transform: i === 0 ? "translateX(-25%)" : i === bars.length - 1 ? "translateX(-75%)" : "translateX(-50%)",
                  }}
                >
                  {b.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
        <div className="relative w-9 shrink-0 text-right text-[11px] text-muted" style={{ height }}>
          <span className="num absolute right-0 -translate-y-1/2" style={{ top: 0 }}>
            {compactTicks ? compact(max) : n(max)}
          </span>
          <span className="num absolute right-0 -translate-y-1/2" style={{ top: "50%" }}>
            {compactTicks ? compact(max / 2) : n(max / 2)}
          </span>
          <span className="num absolute right-0 translate-y-[-100%]" style={{ top: "100%" }}>
            0
          </span>
        </div>
      </div>
    </div>
  );
}

/** Pick about `count` evenly spaced tick positions (always first and last). */
function tickSet(len: number, count: number): Set<number> {
  const s = new Set<number>([0, len - 1]);
  if (len <= count) for (let i = 0; i < len; i++) s.add(i);
  else for (let k = 1; k < count - 1; k++) s.add(Math.round((k * (len - 1)) / (count - 1)));
  return s;
}

export function DailyBars({ days, height }: { days: CampaignDayPlays[]; height?: number }) {
  const ticks = tickSet(days.length, days.length > 20 ? 5 : days.length > 10 ? 4 : days.length);
  const withData = days.filter((d) => !d.noRecords);
  const total = withData.reduce((s, d) => s + d.plays, 0);
  const peak = withData.reduce<CampaignDayPlays | null>((p, d) => (!p || d.plays > p.plays ? d : p), null);
  const bars: Bar[] = days.map((d, i) => ({
    key: d.day,
    label: i === 0 || i === days.length - 1 || days.length <= 10 ? dayShort(d.day) : String(Number(d.day.slice(8))),
    tick: ticks.has(i),
    value: d.plays,
    noData: d.noRecords,
    readout: d.noRecords
      ? `${dayWeek(d.day)} · no play records for this day`
      : `${dayWeek(d.day)} · ${n(d.plays)} plays · ${screenHours(d.seconds)} on screen · ${d.bags} ${d.bags === 1 ? "bag" : "bags"}`,
  }));
  return (
    <BarChart
      bars={bars}
      height={height}
      compactTicks
      ariaLabel={`Plays per day. ${n(total)} in total${peak && peak.plays > 0 ? `, most on ${dayWeek(peak.day)} with ${n(peak.plays)}` : ""}.`}
      idleReadout={
        peak && peak.plays > 0 ? (
          <>
            Busiest day <span className="font-semibold text-ink">{dayWeek(peak.day)}</span> · {n(peak.plays)} plays
          </>
        ) : (
          "No plays recorded in this period"
        )
      }
    />
  );
}

export function HourBars({ byHour, height }: { byHour: number[]; height?: number }) {
  const total = byHour.reduce((s, v) => s + v, 0);
  const peakH = byHour.reduce((p, v, h) => (v > byHour[p] ? h : p), 0);
  const bars: Bar[] = byHour.map((v, h) => ({
    key: String(h),
    label: String(h).padStart(2, "0"),
    tick: h % 6 === 0 || h === 23,
    value: v,
    readout: `${hourLabel(h)}–${hourLabel((h + 1) % 24)} · ${n(v)} plays${total ? ` · ${Math.round((v / total) * 100)}%` : ""}`,
  }));
  return (
    <BarChart
      bars={bars}
      height={height}
      compactTicks
      ariaLabel={`Plays by hour of day, London time.${total ? ` Most between ${hourLabel(peakH)} and ${hourLabel((peakH + 1) % 24)}.` : ""}`}
      idleReadout={
        total ? (
          <>
            Busiest hour <span className="font-semibold text-ink">{hourLabel(peakH)}–{hourLabel((peakH + 1) % 24)}</span> · London time
          </>
        ) : (
          "No plays recorded in this period"
        )
      }
    />
  );
}

/** Horizontal bars with a label and a value: zones, time-of-day bands. */
export function HBarList({
  rows,
  className,
  dense,
}: {
  rows: { key: string; label: ReactNode; value: number; display: ReactNode; sub?: ReactNode }[];
  className?: string;
  dense?: boolean;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value)) || 1;
  return (
    <ul className={clsx("m-0 flex list-none flex-col p-0", dense ? "gap-2" : "gap-3", className)}>
      {rows.map((r) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="num shrink-0 font-semibold">{r.display}</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: CHART.track }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: CHART.bar }} />
          </div>
          {r.sub && <div className="text-[11px] text-muted">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}

/** A small table view for any chart. */
export function ChartTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-rule">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-paper text-left text-xs text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={clsx("px-3 py-2 font-semibold", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-rule-soft">
              {r.map((c, j) => (
                <td key={j} className={clsx("px-3 py-1.5", j > 0 && "num text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const isWeekend = (day: string) => [0, 6].includes(weekday(day));
