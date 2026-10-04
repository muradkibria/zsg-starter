// A bag's day on one time axis: movement (moving / stopped / no signal),
// zones passed through, and what was on screen.

import clsx from "clsx";
import type { RouteResponse } from "@digilite/shared";
import { londonHour } from "@digilite/shared";
import { time } from "@/lib/format";

const HOUR = 3600_000;

function axis(route: RouteResponse): [number, number] {
  const first = route.summary.first ? Date.parse(route.summary.first) : Date.parse(route.from);
  const last = route.summary.last ? Date.parse(route.summary.last) : Date.parse(route.to);
  const start = Math.floor(first / HOUR) * HOUR;
  const end = Math.max(Math.ceil(last / HOUR) * HOUR, start + 2 * HOUR);
  return [start, end];
}

export function RouteTimeline({ route, compact, playing }: { route: RouteResponse; compact?: boolean; playing?: string | null }) {
  const [a, b] = axis(route);
  const span = b - a;
  const pos = (iso: string) => ((Date.parse(iso) - a) / span) * 100;
  const width = (s: string, e: string) => Math.max(0.35, pos(e) - pos(s));
  const ticks: number[] = [];
  const step = span > 10 * HOUR ? 3 * HOUR : span > 5 * HOUR ? 2 * HOUR : HOUR;
  for (let t = a; t <= b; t += step) ticks.push(t);
  // Merge same-zone stretches split by brief exits (< 3 min) and hide blips (< 2 min).
  const zones: typeof route.zoneTimeline = [];
  for (const z of route.zoneTimeline) {
    if (!z.zoneId) continue;
    const last = zones[zones.length - 1];
    if (last && last.zoneId === z.zoneId && Date.parse(z.start) - Date.parse(last.end) < 180_000) last.end = z.end;
    else zones.push({ ...z });
  }
  const shownZones = zones.filter((z) => Date.parse(z.end) - Date.parse(z.start) >= 120_000);
  const labelW = compact ? "w-16" : "w-24";

  if (!route.summary.first) return <p className="m-0 text-sm text-muted">No movement recorded for this day.</p>;

  return (
    <div className="flex flex-col gap-2" aria-label="Timeline">
      <div className="flex items-center gap-3">
        <span className={clsx("shrink-0 text-[11px] text-muted", labelW)}>Movement</span>
        <div className="relative h-4 flex-1 overflow-hidden rounded bg-paper">
          {route.timeline.map((p, i) => (
            <div
              key={i}
              title={`${p.kind === "moving" ? "Moving" : p.kind === "stopped" ? "Stopped" : "No signal"} ${time(p.start)}–${time(p.end)}`}
              className="absolute inset-y-0"
              style={{
                left: `${pos(p.start)}%`,
                width: `${width(p.start, p.end)}%`,
                background:
                  p.kind === "moving" ? "#061b47" : p.kind === "stopped" ? "#b7791f" : "repeating-linear-gradient(45deg,#b8b0a0 0 3px,#f6f4ef 3px 6px)",
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={clsx("shrink-0 text-[11px] text-muted", labelW)}>Zone</span>
        <div className="relative h-5 flex-1 overflow-hidden rounded bg-paper">
          {shownZones.map((z, i) => (
            <div
              key={i}
              title={`${z.name} ${time(z.start)}–${time(z.end)}`}
              className="absolute inset-y-0 overflow-hidden border-l-2 border-white bg-tint px-1 text-[10px] leading-5 font-bold whitespace-nowrap text-navy"
              style={{ left: `${pos(z.start)}%`, width: `${width(z.start, z.end)}%` }}
            >
              {width(z.start, z.end) > 9 ? z.name?.split(" ")[0] : ""}
            </div>
          ))}
        </div>
      </div>
      {!compact && (
        <div className="flex items-center gap-3">
          <span className={clsx("shrink-0 text-[11px] text-muted", labelW)}>On screen</span>
          <div className="relative h-4 flex-1 overflow-hidden rounded bg-paper">
            {route.summary.first && route.summary.last && (
              <div
                className="absolute inset-y-0 truncate rounded border border-[#c9d3ea] bg-info-bg px-1.5 text-[10px] leading-[14px] font-bold text-info-ink"
                style={{ left: `${pos(route.summary.first)}%`, width: `${width(route.summary.first, route.summary.last)}%` }}
              >
                {playing ?? route.playing ?? "Loop"} (as the bag reports now)
              </div>
            )}
          </div>
        </div>
      )}
      <div className="flex gap-3">
        <span className={clsx("shrink-0", labelW)} />
        <div className="relative h-3 flex-1 text-[10px] text-caption">
          {ticks.map((t) => (
            <span key={t} className="num absolute -translate-x-1/2" style={{ left: `${((t - a) / span) * 100}%` }}>
              {String(Math.floor(londonHour(new Date(t)))).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-4 pt-1 text-[11px] text-ink-2">
          <Legend color="#061b47" label="Moving" />
          <Legend color="#b7791f" label="Stopped 15 min+" />
          <Legend pattern label="No signal" />
          <Legend color="#dce3f3" label="In a zone" />
        </div>
      )}
    </div>
  );
}

function Legend({ color, label, pattern }: { color?: string; label: string; pattern?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2 w-3 rounded-sm"
        style={{ background: pattern ? "repeating-linear-gradient(45deg,#b8b0a0 0 2px,#f6f4ef 2px 4px)" : color }}
      />
      {label}
    </span>
  );
}
