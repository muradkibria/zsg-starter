// Small building blocks shared by the riders screens.

import type { ReactNode } from "react";
import clsx from "clsx";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, FileWarning } from "lucide-react";
import {
  RIDER_STAGE_LABEL,
  STOPPED_WELL_ABOVE_POINTS,
  type BagStatus,
  type FleetBaseline,
  type RiderDocKind,
  type RiderDocsSummary,
  type RiderStage,
} from "@digilite/shared";
import { Pill, type Tone } from "@/components/ui";
import { shortDate } from "@/lib/format";
import { Sheet as SharedSheet } from "@/components/overlay";

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Short document names for pills and tight rows. */
export const DOC_SHORT: Record<RiderDocKind, string> = {
  id: "Photo ID",
  right_to_work: "Right to work",
  address: "Address proof",
  agreement: "Agreement",
  dbs: "DBS check",
  insurance: "Insurance",
  other: "Document",
};

export const STATUS_SHORT: Record<BagStatus, string> = { now: "Out now", day: "Last day", idle: "Idle", gone: "Not seen" };

// ── Stage ─────────────────────────────────────────────────────────────────────
const STAGE_TONE: Record<RiderStage, Tone> = { applied: "neutral", checked: "info", waiting: "amber", active: "green", ended: "neutral" };

export function StagePill({ stage, className }: { stage: RiderStage; className?: string }) {
  return (
    <Pill tone={STAGE_TONE[stage]} className={className}>
      {RIDER_STAGE_LABEL[stage]}
    </Pill>
  );
}

export function DemoPill() {
  return (
    <Pill tone="estimate" className="px-1.5 py-0 text-[10px] uppercase tracking-wide">
      Demo
    </Pill>
  );
}

// ── Documents ─────────────────────────────────────────────────────────────────
export function docsDescription(d: RiderDocsSummary): { tone: Tone; text: string; icon: ReactNode } {
  const one = (list: RiderDocKind[], suffix: string, plural: string) => (list.length === 1 ? `${DOC_SHORT[list[0]]} ${suffix}` : `${list.length} ${plural}`);
  switch (d.state) {
    case "ok":
      return { tone: "green", text: "Complete", icon: <CheckCircle2 className="size-3.5" aria-hidden /> };
    case "expired":
      return {
        tone: "red",
        text: d.expired.length === 1 ? `${DOC_SHORT[d.expired[0]]} expired` : `${d.expired.length} expired`,
        icon: <AlertTriangle className="size-3.5" aria-hidden />,
      };
    case "missing":
      return { tone: "amber", text: one(d.missing, "missing", "documents missing"), icon: <FileWarning className="size-3.5" aria-hidden /> };
    case "pending":
      return { tone: "amber", text: one(d.pending, "to check", "to check"), icon: <Clock3 className="size-3.5" aria-hidden /> };
    case "due":
      return {
        tone: "amber",
        text: d.next ? `${DOC_SHORT[d.next.kind]} · ${shortDate(`${d.next.expiresDay}T12:00:00Z`)}` : "Expiring soon",
        icon: <CalendarClock className="size-3.5" aria-hidden />,
      };
  }
}

export function DocsPill({ docs, className }: { docs: RiderDocsSummary; className?: string }) {
  const d = docsDescription(docs);
  return (
    <Pill tone={d.tone} className={className}>
      {d.icon}
      {d.text}
    </Pill>
  );
}

// ── Stopped share vs the fleet ────────────────────────────────────────────────
export function stoppedWellAbove(pct: number | null | undefined, fleet: FleetBaseline | undefined | null): boolean {
  return pct != null && fleet?.stoppedPct != null && pct >= fleet.stoppedPct + STOPPED_WELL_ABOVE_POINTS;
}

/** "41%" with a small meter and a tick at the fleet average. */
export function StoppedMeter({ pct, fleet }: { pct: number | null; fleet: FleetBaseline | null | undefined }) {
  if (pct == null) return <span className="text-[13px] text-caption">—</span>;
  const high = stoppedWellAbove(pct, fleet);
  const fleetPct = fleet?.stoppedPct ?? null;
  return (
    <span
      className="inline-flex items-center gap-2"
      title={`Stopped ${Math.round(pct)}% of the time out${fleetPct != null ? ` · fleet ${Math.round(fleetPct)}%` : ""}`}
    >
      <span className={clsx("num inline-flex w-12 items-center gap-1 text-[13px] font-semibold", high ? "text-amber-ink" : "text-ink")}>
        {high && <AlertTriangle className="size-3.5 shrink-0" aria-label="Well above the fleet" />}
        {Math.round(pct)}%
      </span>
      <span className={clsx("relative h-1.5 w-12 overflow-visible rounded-full", high ? "bg-amber-bg" : "bg-tint")} aria-hidden>
        <span
          className={clsx("absolute inset-y-0 left-0 rounded-full", high ? "bg-st-idle" : "bg-navy")}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
        {fleetPct != null && <span className="absolute -top-1 -bottom-1 w-0.5 rounded bg-ink-2" style={{ left: `calc(${Math.min(100, fleetPct)}% - 1px)` }} />}
      </span>
    </span>
  );
}

// ── Sparkline: moving hours per day ───────────────────────────────────────────
export function Sparkline({ values, daysOut, className }: { values: (number | null)[]; daysOut: number; className?: string }) {
  const w = 5;
  const gap = 2;
  const h = 22;
  const max = Math.max(6, ...values.map((v) => v ?? 0));
  const width = values.length * (w + gap) - gap;
  return (
    <svg
      width={width}
      height={h}
      viewBox={`0 0 ${width} ${h}`}
      role="img"
      aria-label={`Out ${daysOut} of ${values.length} days`}
      className={clsx("shrink-0", className)}
    >
      <title>{`Moving hours per day, last ${values.length} days`}</title>
      {values.map((v, i) => {
        const x = i * (w + gap);
        if (v == null) return <rect key={i} x={x + 1.5} y={h - 2} width={2} height={2} rx={1} fill="#cfc8b8" />;
        if (v <= 0.05) return <rect key={i} x={x} y={h - 1.5} width={w} height={1.5} rx={0.75} fill="#cfc8b8" />;
        const bh = Math.max(3, (v / max) * h);
        return <path key={i} d={roundedTop(x, h - bh, w, bh, 1.5)} fill="#061b47" />;
      })}
    </svg>
  );
}

/** A bar with rounded top corners and a square base (anchored to the baseline). */
export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

// ── Sheet: a right-hand drawer on desktop, a bottom sheet on phones ──────────
export function Sheet({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <SharedSheet open={open} onClose={onClose} title={title} sub={sub} footer={footer} width={wide ? 520 : 440}>
      {children}
    </SharedSheet>
  );
}

// ── Radio cards ───────────────────────────────────────────────────────────────
export function RadioCard({
  name,
  checked,
  onChange,
  children,
  tone,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
  tone?: "red";
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
        checked
          ? "border-navy bg-tint-2 ring-1 ring-navy"
          : tone === "red"
            ? "border-red-line bg-red-bg hover:border-red-ink"
            : "border-rule bg-white hover:border-line",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="size-4 shrink-0 accent-[#061b47]" />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}
