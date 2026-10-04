// Riders × days: paid hours per cell, amber where something needs a look.
// Desktop: a table that scrolls sideways inside its card for long ranges.
// Phone: one card per rider with a compact strip; open it for the days.

import { useState } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { payWeekday, type PayCell, type PayRiderRow, type PayrollResponse } from "@digilite/shared";
import { formatDuration } from "@/lib/format";
import { CELL_STYLE, CellMark, bagLine, cellState, cellSummary, cellText, fmtHours } from "./parts";

const dayNum = (day: string) => String(Number(day.slice(8)));
const weekend = (day: string) => ["Sat", "Sun"].includes(payWeekday(day));

export function PayGrid({ data, onOpen }: { data: PayrollResponse; onOpen: (riderId: string, day: string) => void }) {
  const n = data.days.length;
  const cols = `repeat(${n}, minmax(30px, 1fr))`;
  const minWidth = 32 + 150 + 72 + n * 30 + (n - 1) * 3;
  return (
    <div role="table" aria-label="Paid hours by rider and day" className="card overflow-hidden">
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <div role="row" className="flex items-end border-b border-rule px-4 pt-2.5 pb-2 text-[11px] font-semibold text-muted">
            <span role="columnheader" className="w-[150px] shrink-0 text-xs">
              Rider
            </span>
            <div className="grid flex-1 gap-[3px] text-center" style={{ gridTemplateColumns: cols }}>
              {data.days.map((d) => (
                <span key={d} role="columnheader" className={clsx("flex flex-col leading-tight", weekend(d) && "text-ink")}>
                  <span>{payWeekday(d)}</span>
                  <span className="font-bold">{dayNum(d)}</span>
                </span>
              ))}
            </div>
            <span role="columnheader" className="w-[72px] shrink-0 text-right text-xs">
              Paid
            </span>
          </div>
          {data.riders.map((r) => (
            <GridRow key={r.riderId} row={r} days={data.days} cols={cols} paySignalGaps={data.rules.paySignalGaps} payMin={data.rules.payMinHours} onOpen={onOpen} />
          ))}
          <div role="row" className="flex items-center bg-paper px-4 py-2">
            <span role="rowheader" className="w-[150px] shrink-0 text-xs font-bold text-ink-2">
              All riders
            </span>
            <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: cols }}>
              {data.dayTotals.map((t, i) => (
                <span key={data.days[i]} role="cell" className="num text-center text-[11px] font-bold text-ink-2">
                  {t ? Math.round(t) : "–"}
                </span>
              ))}
            </div>
            <span role="cell" className="num w-[72px] shrink-0 text-right text-sm font-bold">
              {fmtHours(data.totals.hours)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GridRow({
  row,
  days,
  cols,
  paySignalGaps,
  payMin,
  onOpen,
}: {
  row: PayRiderRow;
  days: string[];
  cols: string;
  paySignalGaps: boolean;
  payMin: number;
  onOpen: (riderId: string, day: string) => void;
}) {
  const byDay = new Map(row.cells.map((c) => [c.day, c]));
  const bags = bagLine(row);
  return (
    <div role="row" className="flex items-center border-b border-rule-soft px-4 py-1">
      <span role="rowheader" className="flex w-[150px] shrink-0 flex-col pr-2 leading-tight">
        <Link to={`/riders/${row.riderId}`} className="truncate text-[13px] font-semibold text-ink no-underline hover:underline">
          {row.riderName}
        </Link>
        <span className={clsx("truncate text-[11px]", bags.handover ? "text-amber-ink" : "text-caption")}>{bags.text}</span>
      </span>
      <div className="grid flex-1 gap-[3px]" style={{ gridTemplateColumns: cols }}>
        {days.map((d) => {
          const c = byDay.get(d);
          const st = cellState(c);
          const label = cellSummary(row, d, c, paySignalGaps);
          return (
            <span key={d} role="cell" className="flex">
              <button
                title={label}
                aria-label={label.replace(/\n/g, ". ")}
                onClick={() => onOpen(row.riderId, d)}
                className={clsx(
                  "num relative flex h-[28px] w-full items-center justify-center overflow-hidden rounded-md border text-xs transition-shadow hover:shadow-[0_0_0_2px_var(--color-navy)]",
                  CELL_STYLE[st],
                )}
              >
                {cellText(c)}
                <CellMark state={st} />
              </button>
            </span>
          );
        })}
      </div>
      <span role="cell" className="flex w-[72px] shrink-0 flex-col items-end leading-tight">
        <span className="num text-sm font-bold">{fmtHours(row.hours)}</span>
        {!row.qualifies && row.hours > 0 && <span className="text-[10px] font-semibold text-amber-ink">under {payMin} h</span>}
      </span>
    </div>
  );
}

/** Phone: one card per rider, a strip of days, and the days as a list on demand. */
export function RiderCards({ data, onOpen }: { data: PayrollResponse; onOpen: (riderId: string, day: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label="Paid hours by rider">
      {data.riders.map((r) => (
        <RiderCard key={r.riderId} row={r} data={data} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function RiderCard({ row, data, onOpen }: { row: PayRiderRow; data: PayrollResponse; onOpen: (riderId: string, day: string) => void }) {
  const [open, setOpen] = useState(false);
  const byDay = new Map(row.cells.map((c) => [c.day, c]));
  const bags = bagLine(row);
  const n = data.days.length;
  const perRow = n <= 14 ? n : 7;
  const daysOut = row.cells.filter((c) => c.shifts.length).length;
  return (
    <li className="card overflow-hidden">
      <div className="flex items-start gap-3 px-3.5 pt-3">
        <div className="min-w-0 flex-1">
          <Link to={`/riders/${row.riderId}`} className="block truncate text-[15px] font-semibold text-ink no-underline">
            {row.riderName}
          </Link>
          <div className={clsx("truncate text-xs", bags.handover ? "text-amber-ink" : "text-muted")}>{bags.text}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="num font-display text-lg leading-tight font-semibold">{fmtHours(row.hours)}</div>
          <div className="text-[11px] text-muted">
            {daysOut === 0 ? "not out" : `${daysOut} ${daysOut === 1 ? "day" : "days"} out`}
            {row.toReview > 0 && <span className="font-semibold text-amber-ink"> · {row.toReview} to check</span>}
            {!row.qualifies && row.hours > 0 && <span className="font-semibold text-amber-ink"> · under {data.rules.payMinHours} h</span>}
          </div>
        </div>
      </div>
      <div aria-hidden className="grid gap-[2px] px-3.5 pt-2.5" style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}>
        {data.days.map((d) => (
          <span key={`h${d}`} className={clsx("text-center text-[9px] leading-tight", weekend(d) ? "font-bold text-ink-2" : "text-caption")}>
            {payWeekday(d)[0]}
            <br />
            {dayNum(d)}
          </span>
        ))}
        {data.days.map((d) => {
          const c = byDay.get(d);
          const st = cellState(c);
          return (
            <span
              key={d}
              className={clsx("num relative flex h-6 items-center justify-center overflow-hidden rounded-[5px] border text-[9.5px] tracking-tight", CELL_STYLE[st])}
            >
              {cellText(c)}
              <CellMark state={st} />
            </span>
          );
        })}
      </div>
      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="mt-1 flex h-11 w-full items-center justify-center gap-1.5 text-[13px] font-semibold text-accent"
      >
        {open ? "Hide days" : "See days"}
        <ChevronDown className={clsx("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="m-0 list-none border-t border-rule-soft p-0">
          {row.cells.length === 0 && <li className="px-3.5 py-3 text-sm text-muted">Not out in this period.</li>}
          {row.cells.map((c) => (
            <DayRow key={c.day} c={c} onClick={() => onOpen(row.riderId, c.day)} />
          ))}
        </ul>
      )}
    </li>
  );
}

function DayRow({ c, onClick }: { c: PayCell; onClick: () => void }) {
  const st = cellState(c);
  return (
    <li>
      <button onClick={onClick} className="flex min-h-12 w-full items-center gap-3 border-b border-rule-soft px-3.5 py-2 text-left last:border-b-0">
        <span className={clsx("num relative flex h-8 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border text-[13px]", CELL_STYLE[st])}>
          {cellText(c)}
          <CellMark state={st} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {payWeekday(c.day)} {dayNum(c.day)}
            <span className="font-normal text-muted"> · {[...new Set(c.shifts.map((s) => s.bagName))].join(", ") || "no data"}</span>
          </span>
          <span className={clsx("block truncate text-xs", st === "look" ? "text-amber-ink" : "text-muted")}>
            {c.flags.length ? c.flags.map((f) => f.text).join(" · ") : `Moving ${formatDuration(c.movingSeconds)} · stopped ${formatDuration(c.stoppedSeconds)}`}
          </span>
        </span>
      </button>
    </li>
  );
}

export function GridLegend() {
  const item = (st: Parameters<typeof CellMark>[0]["state"], label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={clsx("relative inline-block size-3.5 overflow-hidden rounded border", st === "empty" ? "border-line bg-paper" : CELL_STYLE[st])}>
        <CellMark state={st} />
      </span>
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
      {item("paid", "Paid hours")}
      {item("look", "Needs a look")}
      {item("checked", "Checked")}
      {item("changed", "Changed by hand")}
      {item("empty", "Not out")}
      <span className="md:ml-auto">Pick a day for its shifts. Times are London time.</span>
    </div>
  );
}
