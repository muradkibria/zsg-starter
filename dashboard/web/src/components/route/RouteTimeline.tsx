// A bag's day on one time axis: movement (moving / stopped / no signal),
// zones passed through, and what was on screen. Given a `replay`, it also has a
// playhead: drag along the timeline (or press play) and the map draws the
// journey up to that moment.

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import clsx from "clsx";
import { Pause, Play, X } from "lucide-react";
import type { RouteResponse } from "@digilite/shared";
import { londonHour } from "@digilite/shared";
import { time } from "@/lib/format";
import type { Replay } from "./useReplay";

const HOUR = 3600_000;

function axis(route: RouteResponse): [number, number] {
  const first = route.summary.first ? Date.parse(route.summary.first) : Date.parse(route.from);
  const last = route.summary.last ? Date.parse(route.summary.last) : Date.parse(route.to);
  const start = Math.floor(first / HOUR) * HOUR;
  const end = Math.max(Math.ceil(last / HOUR) * HOUR, start + 2 * HOUR);
  return [start, end];
}

export function RouteTimeline({
  route,
  compact,
  playing,
  replay,
}: {
  route: RouteResponse;
  compact?: boolean;
  playing?: string | null;
  replay?: Replay;
}) {
  const [a, b] = axis(route);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
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

  // ── Replay ──
  const canReplay = !!replay?.span;
  const at = replay?.at ?? null;
  const fromX = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    return r ? a + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span : a;
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!replay || !canReplay || !r || e.clientX < r.left - 8) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    replay.pause();
    replay.seek(fromX(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragging.current && replay) replay.seek(fromX(e.clientX));
  };
  const endDrag = () => (dragging.current = false);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!replay?.span || at === null) return;
    const step = (e.shiftKey ? 10 : 1) * 60_000;
    const keys: Record<string, () => void> = {
      ArrowRight: () => replay.seek(at + step),
      ArrowLeft: () => replay.seek(at - step),
      Home: () => replay.seek(replay.span![0]),
      End: () => replay.seek(replay.span![1]),
      " ": () => (replay.playing ? replay.pause() : replay.play()),
      Escape: () => replay.stop(),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };
  const within = (s: string, e: string) => at !== null && Date.parse(s) <= at && at < Date.parse(e);
  const moving = at === null ? null : route.timeline.find((p) => within(p.start, p.end))?.kind;
  const zoneNow = at === null ? null : shownZones.find((z) => within(z.start, z.end))?.name;
  const stateNow = [moving === "moving" ? "Moving" : moving === "stopped" ? "Stopped" : moving === "gap" ? "No signal" : null, zoneNow]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-2" aria-label="Timeline">
      {replay && canReplay && (
        <div className={clsx("flex items-center gap-2", compact ? "text-xs" : "text-[13px]")}>
          {at === null ? (
            <>
              <button
                onClick={replay.play}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:border-navy"
              >
                <Play className="size-3.5" aria-hidden="true" />
                Replay the day
              </button>
              {!compact && <span className="text-xs text-muted">or drag along the timeline</span>}
            </>
          ) : (
            <>
              <button
                onClick={replay.playing ? replay.pause : replay.play}
                aria-label={replay.playing ? "Pause" : "Play"}
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy text-white hover:bg-navy-2"
              >
                {replay.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <span className="num shrink-0 font-display text-[15px] font-semibold">{time(at)}</span>
              <span className="min-w-0 flex-1 truncate text-ink-2">{stateNow}</span>
              <button
                onClick={replay.nextSpeed}
                title={`Playing ${replay.speed / 60} minute${replay.speed === 60 ? "" : "s"} of the day each second`}
                className="num h-7 shrink-0 rounded-full border border-line bg-white px-2.5 text-xs font-semibold whitespace-nowrap text-ink hover:border-navy"
              >
                {replay.speed / 60} min/s
              </button>
              <button
                onClick={replay.stop}
                aria-label={compact ? "Whole day" : undefined}
                title="Back to the whole day"
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap text-muted hover:bg-paper hover:text-ink"
              >
                <X className="size-3.5" aria-hidden="true" />
                {!compact && "Whole day"}
              </button>
            </>
          )}
        </div>
      )}
      <div
        className={clsx("relative flex flex-col gap-2", canReplay && "cursor-pointer touch-pan-y select-none")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="flex items-center gap-3">
          <span className={clsx("shrink-0 text-[11px] text-muted", labelW)}>Movement</span>
          <div ref={barRef} className="relative h-4 flex-1 overflow-hidden rounded bg-paper">
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
                  {playing ?? route.playing ?? "Loop"}
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
        {at !== null && (
          <div className={clsx("pointer-events-none absolute top-0 right-0 bottom-4", compact ? "left-[4.75rem]" : "left-[6.75rem]")}>
            {/* Covered so far: the rest of the day is dimmed. */}
            <div className="absolute inset-y-0 right-0 bg-white/55" style={{ left: `${((at - a) / span) * 100}%` }} />
            <div className="absolute inset-y-[-3px] w-0.5 -translate-x-1/2 rounded-full bg-navy" style={{ left: `${((at - a) / span) * 100}%` }}>
              <div
                role="slider"
                tabIndex={0}
                aria-label="Replay time"
                aria-valuemin={replay?.span?.[0]}
                aria-valuemax={replay?.span?.[1]}
                aria-valuenow={Math.round(at)}
                aria-valuetext={`${time(at)}${stateNow ? `, ${stateNow}` : ""}`}
                onKeyDown={onKey}
                className="pointer-events-auto absolute -top-1.5 left-1/2 size-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-white bg-navy shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              />
            </div>
          </div>
        )}
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
