// Hours out each day (the bag's time out while this rider held it), with the
// stopped share flagged against the fleet. A table view carries every value
// without hovering. (The pay minimum in Settings is per pay period, not per
// day, so it's shown with pay rather than drawn here.)

import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle } from "lucide-react";
import { STOPPED_WELL_ABOVE_POINTS, type RiderDayRow, type RiderPerformance } from "@digilite/shared";
import { Segmented } from "@/components/ui";
import { dayLabel, formatDuration, km, num, time } from "@/lib/format";
import { stoppedWellAbove } from "./bits";

const H = (s: number) => s / 3600;
const oneDp = (s: number) => (s / 3600).toFixed(1);
const stoppedPct = (r: RiderDayRow) => (r.onSeconds > 0 ? (r.stoppedSeconds / r.onSeconds) * 100 : null);

function describe(r: RiderDayRow): string {
  if (!r.carrying) return `${dayLabel(r.day)}: no bag this day`;
  if (!r.onSeconds) return `${dayLabel(r.day)}: not out`;
  const sp = stoppedPct(r);
  return `${dayLabel(r.day)}: ${oneDp(r.onSeconds)} hours out${r.bagName ? ` on ${r.bagName}` : ""}, ${time(r.first)} to ${time(r.last)}, ${sp != null ? `${Math.round(sp)}% stopped, ` : ""}${r.gaps} signal ${r.gaps === 1 ? "gap" : "gaps"}`;
}

export function HoursChart({ perf }: { perf: RiderPerformance }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  const rows = perf.rows;
  const n = rows.length;
  const maxH = Math.max(4, ...rows.map((r) => H(r.onSeconds)));
  const step = maxH <= 6 ? 2 : maxH <= 12 ? 4 : 6;
  const top = Math.ceil(maxH / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const high = (r: RiderDayRow) => r.out && stoppedWellAbove(stoppedPct(r), perf.fleet);
  // Label sparingly: the longest day and the most recent day out.
  const outIdx = rows.map((r, i) => (r.onSeconds > 0 ? i : -1)).filter((i) => i >= 0);
  const maxIdx = outIdx.reduce((m, i) => (m < 0 || rows[i].onSeconds > rows[m].onSeconds ? i : m), -1);
  const lastIdx = outIdx.at(-1) ?? -1;
  const labelled = new Set([maxIdx, lastIdx].filter((i) => i >= 0));
  const anyHigh = rows.some(high);
  const anyNoBag = rows.some((r) => !r.carrying);
  const h = hover != null ? rows[hover] : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-display text-[15px] font-semibold">Hours out each day</h3>
        <Segmented
          label="Show as"
          value={view}
          onChange={setView}
          options={[
            { value: "chart", label: "Chart" },
            { value: "table", label: "Table" },
          ]}
        />
      </div>

      {view === "chart" ? (
        <div className="relative select-none" onMouseLeave={() => setHover(null)}>
          {/* Plot */}
          <div className="relative ml-8 h-[176px]">
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-rule-soft" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden>
                <span className="num absolute -left-8 w-7 -translate-y-1/2 text-right text-[10px] text-caption">{t} h</span>
              </div>
            ))}
            <div className="absolute inset-0 flex items-end gap-[2px]" role="group" aria-label="Hours out each day. Focus a day for details.">
              {rows.map((r, i) => {
                const hrs = H(r.onSeconds);
                const pctH = (hrs / top) * 100;
                const warn = high(r);
                return (
                  <button
                    key={r.day}
                    type="button"
                    aria-label={describe(r)}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className={clsx("relative flex h-full min-w-0 flex-1 items-end justify-center rounded-md outline-offset-0", hover === i && "bg-paper")}
                  >
                    {r.carrying && r.onSeconds > 0 ? (
                      <>
                        <span
                          className={clsx("block w-full max-w-[24px] rounded-t-[4px]", warn ? "bg-st-idle" : "bg-navy", hover === i && "opacity-85")}
                          style={{ height: `max(3px, ${pctH}%)` }}
                        />
                        {(labelled.has(i) || warn) && (
                          <span
                            className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 text-[10px] leading-none font-semibold whitespace-nowrap text-ink-2"
                            style={{ bottom: `calc(${pctH}% + 4px)` }}
                          >
                            {warn && <AlertTriangle className="size-3 text-amber-ink" aria-hidden />}
                            {labelled.has(i) && <span className="num">{hrs.toFixed(1)}</span>}
                          </span>
                        )}
                      </>
                    ) : r.carrying ? (
                      <span className="block h-[2px] w-full max-w-[24px] rounded bg-line" />
                    ) : (
                      <span className="mb-0.5 block size-1 rounded-full bg-line" />
                    )}
                  </button>
                );
              })}
            </div>

            {h && (
              <div
                className="pointer-events-none absolute top-0 z-10 w-max max-w-[230px] rounded-lg border border-rule bg-white px-3 py-2 text-xs shadow-[var(--shadow-float)]"
                style={{
                  left: `${((hover! + 0.5) / n) * 100}%`,
                  transform: hover! < 3 ? "translateX(-12px)" : hover! > n - 4 ? "translateX(calc(-100% + 12px))" : "translateX(-50%)",
                }}
              >
                <div className="font-semibold text-ink">
                  {dayLabel(h.day)}
                  {h.bagName ? ` · ${h.bagName}` : ""}
                </div>
                {h.onSeconds > 0 ? (
                  <div className="mt-0.5 flex flex-col gap-0.5 text-ink-2">
                    <span>
                      <strong className="num text-ink">{oneDp(h.onSeconds)} h</strong> out · {time(h.first)}–{time(h.last)}
                    </span>
                    <span>
                      {formatDuration(h.movingSeconds)} moving · <span className={clsx(high(h) && "font-semibold text-amber-ink")}>{Math.round(stoppedPct(h) ?? 0)}% stopped</span>
                    </span>
                    <span>
                      {h.gaps} signal {h.gaps === 1 ? "gap" : "gaps"} · {km(h.km)} · {num(h.plays)} plays
                    </span>
                  </div>
                ) : (
                  <div className="mt-0.5 text-ink-2">{h.carrying ? "Not out" : "No bag this day"}</div>
                )}
              </div>
            )}
          </div>
          {/* Day axis */}
          <div className="ml-8 mt-1.5 flex gap-[2px]" aria-hidden>
            {rows.map((r, i) => (
              <span key={r.day} className={clsx("flex min-w-0 flex-1 flex-col items-center text-[10px] leading-tight", i === n - 1 ? "font-bold text-ink" : "text-caption")}>
                <span>{dayLabel(r.day).slice(0, 1)}</span>
                <span className="num">{Number(r.day.slice(8))}</span>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[620px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-rule text-left text-xs text-muted">
                <th className="py-2 pr-3 font-semibold">Day</th>
                <th className="py-2 pr-3 font-semibold">Bag</th>
                <th className="py-2 pr-3 font-semibold">Out</th>
                <th className="py-2 pr-3 text-right font-semibold">Hours out</th>
                <th className="py-2 pr-3 text-right font-semibold">Moving</th>
                <th className="py-2 pr-3 text-right font-semibold">Stopped</th>
                <th className="py-2 pr-3 text-right font-semibold">Signal gaps</th>
                <th className="py-2 pr-3 text-right font-semibold">Distance</th>
                <th className="py-2 text-right font-semibold">Plays</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => {
                const sp = stoppedPct(r);
                return (
                  <tr key={r.day} className="num border-b border-rule-soft last:border-b-0">
                    <td className="py-2 pr-3 whitespace-nowrap">{dayLabel(r.day)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{r.bagName ?? "—"}</td>
                    {r.onSeconds > 0 ? (
                      <>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {time(r.first)}–{time(r.last)}
                        </td>
                        <td className="py-2 pr-3 text-right">{oneDp(r.onSeconds)} h</td>
                        <td className="py-2 pr-3 text-right">{oneDp(r.movingSeconds)} h</td>
                        <td className={clsx("py-2 pr-3 text-right", high(r) && "font-semibold text-amber-ink")}>
                          {high(r) && <AlertTriangle className="mr-1 inline size-3" aria-label="Well above the fleet" />}
                          {sp != null ? `${Math.round(sp)}%` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right">{r.gaps}</td>
                        <td className="py-2 pr-3 text-right">{km(r.km)}</td>
                        <td className="py-2 text-right">{num(r.plays)}</td>
                      </>
                    ) : (
                      <td colSpan={7} className="py-2 text-muted">
                        {r.carrying ? "Not out" : "No bag this day"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-navy" aria-hidden /> Hours out
        </span>
        {anyHigh && perf.fleet.stoppedPct != null && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-st-idle" aria-hidden />
            <AlertTriangle className="size-3 text-amber-ink" aria-hidden /> Stopped {Math.round(perf.fleet.stoppedPct + STOPPED_WELL_ABOVE_POINTS)}%+ (fleet {Math.round(perf.fleet.stoppedPct)}%)
          </span>
        )}
        {anyNoBag && (
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1 rounded-full bg-line" aria-hidden /> No bag that day
          </span>
        )}
      </div>
    </div>
  );
}
