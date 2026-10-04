// Small shared pieces for the payroll page: hour formatting, cell states, the
// change-hours form and the day detail dialog.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, Check, MapPin, X } from "lucide-react";
import type { PayCell, PayRange, PayRiderRow } from "@digilite/shared";
import { Button, Field, Input, Textarea, buttonClass } from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useOverlay } from "@/components/overlay";
import { dayLabel, formatDuration, km, longDay, shortDate, time } from "@/lib/format";
import { useAdjustHours } from "./api";

/** "71.6 h" */
export const fmtHours = (h: number, dp = 1) => `${h.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp })} h`;
/** Hours from seconds, "1.5 h" */
export const secHours = (s: number) => fmtHours(Math.round(s / 360) / 10);

export type CellState = "empty" | "paid" | "zero" | "look" | "changed" | "checked";

export function isChanged(c: PayCell): boolean {
  return !!c.adjustment && Math.abs(c.adjustment.hours - c.calculatedHours) >= 0.005;
}

export function cellState(c: PayCell | undefined): CellState {
  if (!c) return "empty";
  if (c.flags.length && !c.adjustment) return "look";
  if (isChanged(c)) return "changed";
  if (c.adjustment) return "checked";
  return c.hours > 0 ? "paid" : "zero";
}

export const CELL_STYLE: Record<CellState, string> = {
  empty: "bg-paper text-caption border-paper",
  zero: "bg-paper-2 text-muted border-paper-2",
  paid: "bg-tint text-navy border-tint",
  checked: "bg-tint text-navy border-tint",
  changed: "bg-tint text-navy border-navy/40 border-dashed",
  look: "bg-amber-bg text-amber-ink border-amber-line font-bold",
};

/** Shape markers so state never rests on colour alone. */
export function CellMark({ state }: { state: CellState }) {
  if (state === "look") return <span aria-hidden className="absolute top-0 right-0 size-0 border-t-[7px] border-l-[7px] border-t-amber-ink border-l-transparent" />;
  if (state === "changed") return <span aria-hidden className="absolute top-[3px] right-[3px] size-[5px] rounded-full bg-navy" />;
  if (state === "checked") return <Check aria-hidden className="absolute top-[1px] right-[1px] size-[9px] text-green-ink" strokeWidth={3.5} />;
  return null;
}

/** "5.1", "0", "" */
export const cellText = (c: PayCell | undefined) => (c ? (c.hours === 0 ? "0" : c.hours.toFixed(1)) : "");

/** Plain-text summary of a rider-day (tooltips and screen readers). */
export function cellSummary(row: PayRiderRow, day: string, c: PayCell | undefined, paySignalGaps: boolean): string {
  const lines = [`${row.riderName} · ${dayLabel(day)}`];
  if (!c) return [...lines, "Not out"].join("\n");
  const bags = [...new Set(c.shifts.map((s) => s.bagName))].join(", ");
  if (bags) lines[0] += ` · ${bags}`;
  lines.push(`Paid ${fmtHours(c.hours)}${isChanged(c) ? ` (calculated ${fmtHours(c.calculatedHours)})` : ""} · moving ${formatDuration(c.movingSeconds)}`);
  const other = [
    c.stoppedSeconds > 0 && `stopped ${formatDuration(c.stoppedSeconds)} (not paid)`,
    c.gapSeconds > 0 && `no signal ${formatDuration(c.gapSeconds)} (${paySignalGaps ? "paid" : "not paid"})`,
  ].filter(Boolean);
  if (other.length) lines.push(other.join(" · "));
  if (c.flags.length) lines.push(`${c.adjustment ? "Checked" : "Needs a look"}: ${c.flags.map((f) => f.text).join("; ")}`);
  if (c.adjustment) lines.push(isChanged(c) ? `Changed by ${c.adjustment.byName}: ${c.adjustment.note}` : `Approved as calculated by ${c.adjustment.byName}`);
  return lines.join("\n");
}

export function bagLine(row: PayRiderRow): { text: string; handover: boolean } {
  if (!row.bags.length) return { text: "No bag", handover: false };
  const parts = row.bags.map((b) => {
    const bits = [b.bagName];
    if (b.from) bits.push(`from ${shortDate(`${b.from}T12:00:00Z`)}`);
    if (b.to) bits.push(`back ${shortDate(`${b.to}T12:00:00Z`)}`);
    return bits.join(" · ");
  });
  return { text: parts.join(", "), handover: row.bags.some((b) => b.from || b.to) || row.bags.length > 1 };
}

// ── Change hours ──────────────────────────────────────────────────────────────

export function ChangeHoursForm({
  initial,
  saving,
  onSave,
  onCancel,
  compact,
}: {
  initial: number;
  saving: boolean;
  onSave: (hours: number, note: string) => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  const [hours, setHours] = useState(String(initial));
  const [note, setNote] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const n = Number(hours);
  const badHours = hours.trim() === "" || !Number.isFinite(n) || n < 0 || n > 24;
  return (
    <form
      className={clsx("flex flex-col gap-2.5", !compact && "rounded-xl bg-paper p-3")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!badHours && note.trim()) onSave(Math.round(n * 100) / 100, note.trim());
      }}
    >
      <Field label="Hours to pay" error={hours.trim() && badHours ? "Enter hours between 0 and 24" : undefined}>
        <Input ref={ref} type="number" inputMode="decimal" step="0.1" min={0} max={24} value={hours} onChange={(e) => setHours(e.target.value)} className="w-32" />
      </Field>
      <Field label="Why" hint="Saved with your name and shown in the payroll export.">
        <Textarea rows={2} className="min-h-16" value={note} maxLength={500} placeholder="e.g. Checked the route, rider was on a break" onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" className="h-11 px-4 md:h-8" loading={saving} disabled={badHours || !note.trim()}>
          Save hours
        </Button>
        <Button size="sm" className="h-11 px-4 md:h-8" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Adjust / approve-as-calculated for one rider-day, with toasts. */
export function useDayActions(range: PayRange) {
  const adjust = useAdjustHours();
  const { toast } = useFeedback();
  const approve = (riderId: string, riderName: string, day: string, hours: number, done?: () => void) =>
    adjust.mutate(
      { ...range, riderId, day, hours, note: "", asCalculated: true },
      {
        onSuccess: (a) => {
          toast(`${riderName}, ${dayLabel(day)}: ${fmtHours(a.hours)} approved as calculated`);
          done?.();
        },
        onError: (e) => toast(e.message, "error"),
      },
    );
  const change = (riderId: string, riderName: string, day: string, hours: number, note: string, done?: () => void) =>
    adjust.mutate(
      { ...range, riderId, day, hours, note },
      {
        onSuccess: (a) => {
          toast(`${riderName}, ${dayLabel(day)}: now ${fmtHours(a.hours)}`);
          done?.();
        },
        onError: (e) => toast(e.message, "error"),
      },
    );
  return { approve, change, saving: adjust.isPending };
}

// ── Day detail dialog ─────────────────────────────────────────────────────────

export function DayDialog({
  row,
  day,
  range,
  paySignalGaps,
  canChange,
  onClose,
}: {
  row: PayRiderRow;
  day: string;
  range: PayRange;
  paySignalGaps: boolean;
  canChange: boolean;
  onClose: () => void;
}) {
  const c = row.cells.find((x) => x.day === day);
  const [editing, setEditing] = useState(false);
  const actions = useDayActions(range);
  const panel = useRef<HTMLDivElement>(null);
  useOverlay(true, panel, onClose);
  const bagId = c?.bagIds[0] ?? row.bags[0]?.bagId;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 md:items-center md:p-4" onClick={onClose}>
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-dialog-title"
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 pb-8 shadow-[var(--shadow-pop)] outline-none md:rounded-2xl md:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="day-dialog-title" className="m-0 font-display text-xl font-semibold">
              {row.riderName}
            </h2>
            <p className="m-0 mt-0.5 text-sm text-muted">
              {longDay(day)}
              {c?.shifts.length ? ` · ${[...new Set(c.shifts.map((s) => s.bagName))].join(", ")}` : ""}
            </p>
          </div>
          <button data-autofocus onClick={onClose} aria-label="Close" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-paper-2 hover:bg-rule md:size-10">
            <X className="size-5" />
          </button>
        </div>

        {!c || !c.shifts.length ? (
          <p className="mt-4 mb-0 text-sm text-muted">No shifts recorded for {row.riderName.split(" ")[0]} on this day.</p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Mini label="Paid" value={fmtHours(c.hours)} sub={isChanged(c) ? `calculated ${fmtHours(c.calculatedHours)}` : "under the pay rules"} strong />
              <Mini label="Stopped" value={c.stoppedSeconds > 0 ? formatDuration(c.stoppedSeconds) : "None"} sub="not paid" />
              <Mini label="No signal" value={c.gapSeconds > 0 ? formatDuration(c.gapSeconds) : "None"} sub={paySignalGaps ? "paid" : "not paid"} />
            </div>
            <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
              {c.shifts.map((s, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-rule-soft px-3 py-2 text-[13px]">
                  <span className="num font-semibold">
                    {time(s.start)}–{time(s.end)}
                  </span>
                  <span className="text-muted">{s.bagName}</span>
                  <span className="ml-auto num font-semibold">{fmtHours(Math.round(s.paidSeconds / 36) / 100, 2)}</span>
                  <span className="w-full text-xs text-muted">
                    {[
                      `Moving ${formatDuration(s.movingSeconds)}`,
                      s.stoppedSeconds > 0 && `stopped ${formatDuration(s.stoppedSeconds)}`,
                      s.gapSeconds > 0 && `no signal ${formatDuration(s.gapSeconds)}`,
                      km(s.km),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {c && c.flags.length > 0 && (
          <div className={clsx("mt-3 rounded-xl px-3.5 py-2.5 text-[13px]", c.adjustment ? "bg-paper text-ink-2" : "bg-amber-bg text-amber-ink")}>
            <div className="mb-1 flex items-center gap-1.5 font-semibold">
              {c.adjustment ? <Check className="size-4 text-green-ink" /> : <AlertTriangle className="size-4" />}
              {c.adjustment ? "Checked" : "Needs a look"}
            </div>
            <ul className="m-0 list-disc pl-5">
              {c.flags.map((f, i) => (
                <li key={i}>{f.text}</li>
              ))}
            </ul>
          </div>
        )}

        {c?.adjustment && (
          <p className="mt-3 mb-0 text-[13px] text-ink-2">
            {isChanged(c) ? (
              <>
                Changed to <strong>{fmtHours(c.adjustment.hours)}</strong> by {c.adjustment.byName} on {shortDate(c.adjustment.at)}: “{c.adjustment.note}”
              </>
            ) : (
              <>
                Approved as calculated by {c.adjustment.byName} on {shortDate(c.adjustment.at)}.
              </>
            )}
          </p>
        )}

        {editing ? (
          <div className="mt-4">
            <ChangeHoursForm
              initial={c?.hours ?? 0}
              saving={actions.saving}
              onCancel={() => setEditing(false)}
              onSave={(h, note) => actions.change(row.riderId, row.riderName, day, h, note, onClose)}
            />
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            {canChange && c && c.flags.length > 0 && !c.adjustment && (
              <Button variant="primary" loading={actions.saving} onClick={() => actions.approve(row.riderId, row.riderName, day, c.calculatedHours, onClose)}>
                Approve {fmtHours(c.calculatedHours)}
              </Button>
            )}
            {canChange && <Button onClick={() => setEditing(true)}>{c?.shifts.length ? "Change hours" : "Add hours"}</Button>}
            {bagId && c?.shifts.length ? (
              <Link to={`/map?bag=${bagId}&day=${day}`} className={buttonClass("ghost", "md", "text-accent")}>
                <MapPin className="size-4" /> See the day
              </Link>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, sub, strong }: { label: string; value: ReactNode; sub?: string; strong?: boolean }) {
  return (
    <div className="rounded-xl bg-paper px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={clsx("num font-display text-lg leading-tight font-semibold", strong && "text-navy")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
