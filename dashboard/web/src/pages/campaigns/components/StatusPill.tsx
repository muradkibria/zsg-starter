// Campaign status: always text plus a shape, never colour alone.

import { AlertTriangle, CalendarClock, CircleDashed, Hourglass, Play, Square } from "lucide-react";
import clsx from "clsx";
import type { CampaignPhase, CampaignStatus } from "@digilite/shared";
import { Pill, type Tone } from "@/components/ui";

const ICON: Record<CampaignPhase, typeof Play> = {
  draft: CircleDashed,
  upcoming: CalendarClock,
  live: Play,
  ending: Hourglass,
  ended: Square,
  ended_on_screen: AlertTriangle,
};

export function StatusPill({ status, className }: { status: CampaignStatus; className?: string }) {
  const Icon = ICON[status.phase];
  return (
    <Pill tone={status.tone as Tone} className={clsx("gap-1.5", className)}>
      <Icon className="size-3" strokeWidth={2.4} aria-hidden="true" />
      {status.label}
    </Pill>
  );
}

export function StatusNote({ status, className }: { status: CampaignStatus; className?: string }) {
  if (!status.note) return null;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-xs",
        status.warn ? (status.phase === "ended_on_screen" ? "font-semibold text-red-ink" : "font-semibold text-amber-ink") : "text-muted",
        className,
      )}
    >
      {status.warn && <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />}
      {status.note}
    </span>
  );
}

export function DemoPill() {
  return (
    <Pill tone="neutral" className="border border-dashed border-line bg-white px-2 text-[11px] text-muted">
      Demo
    </Pill>
  );
}
