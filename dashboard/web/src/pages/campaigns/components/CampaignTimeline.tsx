// Campaign dates on a shared axis: the run, a today marker, and (hatched) any
// time it kept playing after its end date.

import { addDays } from "@digilite/shared";
import clsx from "clsx";
import { dayDiff, monthShort } from "../format";

export interface Axis {
  from: string;
  to: string;
}

/** An axis covering every campaign and today, padded to whole months. */
export function axisFor(items: { startDay: string | null; endDay: string | null }[], today: string): Axis {
  const days = items.flatMap((c) => [c.startDay, c.endDay]).filter((d): d is string => !!d);
  let from = [today, ...days].sort()[0];
  let to = [today, ...days].sort().slice(-1)[0];
  from = `${from.slice(0, 7)}-01`;
  const [y, m] = to.split("-").map(Number);
  to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`, -1);
  // Keep it readable: at most ~8 months either side of today.
  if (dayDiff(from, today) > 240) from = `${addDays(today, -240).slice(0, 7)}-01`;
  if (dayDiff(today, to) > 240) to = addDays(today, 240);
  return { from, to };
}

export function monthTicks(axis: Axis): { day: string; left: number; label: string }[] {
  const out: { day: string; left: number; label: string }[] = [];
  const span = dayDiff(axis.from, axis.to) + 1;
  let d = `${axis.from.slice(0, 7)}-01`;
  for (let i = 0; i < 24 && d <= axis.to; i++) {
    if (d >= axis.from) out.push({ day: d, left: (dayDiff(axis.from, d) / span) * 100, label: monthShort(d) });
    const [y, m] = d.split("-").map(Number);
    d = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  }
  return out;
}

export function CampaignTimeline({
  axis,
  startDay,
  endDay,
  today,
  afterEnd,
  color = "#3a67c6",
  className,
}: {
  axis: Axis;
  startDay: string | null;
  endDay: string | null;
  today: string;
  afterEnd?: boolean;
  color?: string;
  className?: string;
}) {
  const span = dayDiff(axis.from, axis.to) + 1;
  const pos = (d: string) => Math.min(100, Math.max(0, (dayDiff(axis.from, d) / span) * 100));
  const end = endDay ? pos(addDays(endDay, 1)) : 0;
  const start = startDay ? pos(startDay) : 0;
  const now = pos(today) + 100 / span / 2;
  return (
    <div className={clsx("relative h-3", className)} aria-hidden="true">
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />
      {startDay && endDay && (
        <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full" style={{ left: `${start}%`, width: `${Math.max(0.8, end - start)}%`, background: color }} />
      )}
      {afterEnd && endDay && today > endDay && (
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full"
          style={{ left: `${end}%`, width: `${Math.max(0.8, now - end)}%`, background: "repeating-linear-gradient(135deg, #a1261b 0 2px, #fbecea 2px 4px)" }}
        />
      )}
      <div className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 rounded bg-ink" style={{ left: `${now}%` }} />
    </div>
  );
}
