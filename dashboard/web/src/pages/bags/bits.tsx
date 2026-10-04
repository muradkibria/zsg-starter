// Small pieces shared by the bags register and the bag page.

import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { AlertTriangle, Archive, FlaskConical, MapPinOff, OctagonAlert, Wrench } from "lucide-react";
import { BAG_LIFECYCLE_LABEL, bagSeenLabel, type BagIssueKind, type BagSummary, type CommandSummary, type Lifecycle } from "@digilite/shared";
import { Card, CardHeader, Pill, StatusIcon, type Tone } from "@/components/ui";

export const hasIssue = (b: Pick<BagSummary, "issues">, kind: BagIssueKind) => b.issues.some((i) => i.kind === kind);

/** True while the viewport matches the query (e.g. "(min-width: 768px)"). */
export function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setOn(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return on;
}

/** A bag-page section: the kit's Card + CardHeader with consistent spacing. `sub` must be inline content. */
export function Section({
  title,
  sub,
  action,
  className,
  children,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card aria-label={title} className={clsx("flex min-w-0 flex-col gap-3.5 p-4 md:p-5", className)}>
      <CardHeader title={title} sub={sub} action={action} />
      {children}
    </Card>
  );
}

export const COMMAND_STATUS_LABEL: Record<CommandSummary["status"], string> = {
  dry_run: "Dry run",
  blocked: "Blocked",
  sent: "Sent",
  confirmed: "Confirmed",
  failed: "Failed",
};

const COMMAND_STATUS_TONE: Record<CommandSummary["status"], Tone> = {
  dry_run: "neutral",
  blocked: "amber",
  sent: "info",
  confirmed: "green",
  failed: "red",
};

export function CommandStatusPill({ status, className }: { status: CommandSummary["status"]; className?: string }) {
  return (
    <Pill tone={COMMAND_STATUS_TONE[status]} className={className}>
      {COMMAND_STATUS_LABEL[status]}
    </Pill>
  );
}

/** Natural name order: Bag 2 before Bag 10. */
export const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en-GB", { numeric: true });

/** Out now first (by name), then most recently seen, never-seen last. */
export function bySeen(a: BagSummary, b: BagSummary): number {
  if (a.status === "now" || b.status === "now") {
    if (a.status === b.status) return byName(a, b);
    return a.status === "now" ? -1 : 1;
  }
  const ta = a.lastReportAt ? Date.parse(a.lastReportAt) : 0;
  const tb = b.lastReportAt ? Date.parse(b.lastReportAt) : 0;
  return tb - ta || byName(a, b);
}

/** "Out now" / "Seen 4 h ago" / "Not seen for 48 days", with status shape and colour. */
export function SeenText({ bag, className, iconSize = 16 }: { bag: BagSummary; className?: string; iconSize?: number }) {
  const label = bagSeenLabel(bag.status, bag.lastReportAt);
  const expectedAway = bag.lifecycle !== "active";
  return (
    <span
      className={clsx(
        "inline-flex min-w-0 items-center gap-1.5",
        bag.status === "now" && "font-semibold text-green-ink",
        bag.status === "gone" && (expectedAway ? "text-muted" : "font-medium text-red-ink"),
        (bag.status === "day" || bag.status === "idle") && "text-ink-2",
        className,
      )}
    >
      <StatusIcon status={bag.status} size={iconSize} />
      <span className="truncate">{label}</span>
    </span>
  );
}

const LIFECYCLE_ICON: Record<Exclude<Lifecycle, "active">, typeof Archive> = {
  storage: Archive,
  repair: Wrench,
  lost: MapPinOff,
  retired: Archive,
};

export function LifecyclePill({ lifecycle, className }: { lifecycle: Lifecycle; className?: string }) {
  if (lifecycle === "active") return null;
  const Icon = LIFECYCLE_ICON[lifecycle];
  const tone = lifecycle === "lost" ? "red" : lifecycle === "repair" ? "amber" : lifecycle === "storage" ? "info" : "neutral";
  return (
    <Pill tone={tone} className={className}>
      <Icon className="size-3" aria-hidden="true" />
      {BAG_LIFECYCLE_LABEL[lifecycle]}
    </Pill>
  );
}

export function TestBagPill({ className }: { className?: string }) {
  return (
    <Pill tone="info" className={clsx("border border-[#c9d3ea]", className)}>
      <FlaskConical className="size-3" aria-hidden="true" />
      Test bag
    </Pill>
  );
}

/**
 * A value that differs from the rest of the fleet: amber or red text plus an
 * icon, with the reason as a tooltip and for screen readers. Never colour alone.
 */
export function Differs({ tone = "amber", note, children, className }: { tone?: "amber" | "red"; note: string; children: ReactNode; className?: string }) {
  const Icon = tone === "red" ? OctagonAlert : AlertTriangle;
  return (
    <span title={note} className={clsx("inline-flex min-w-0 items-center gap-1 font-semibold", tone === "red" ? "text-red-ink" : "text-amber-ink", className)}>
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
      <span className="sr-only"> ({note})</span>
    </span>
  );
}

/** Rider name (link when allowed), or what having no rider means for this bag. */
export function RiderText({ bag, canView, className }: { bag: BagSummary; canView: boolean; className?: string }) {
  if (bag.rider) {
    const name = (
      <>
        {bag.rider.name}
        {bag.rider.demo && <span className="ml-1 text-[11px] font-medium text-caption">(demo)</span>}
      </>
    );
    return canView ? (
      <Link to={`/riders/${bag.rider.id}`} className={clsx("truncate font-medium text-ink no-underline hover:text-accent hover:underline", className)}>
        {name}
      </Link>
    ) : (
      <span className={clsx("truncate text-ink", className)}>{name}</span>
    );
  }
  if (bag.isTestBag) return <span className={clsx("truncate text-muted", className)}>Kept for testing</span>;
  if (bag.lifecycle !== "active") return <span className={clsx("truncate text-muted", className)}>No rider</span>;
  if (hasIssue(bag, "no_rider")) {
    return (
      <Differs note="Out without a rider: its hours can't be credited to anyone" className={className}>
        No rider
      </Differs>
    );
  }
  return <span className={clsx("truncate font-medium text-amber-ink", className)}>No rider</span>;
}

/** Loop on screen — amber with an icon when it isn't the fleet loop. */
export function LoopText({ bag, fleetLoop, className }: { bag: BagSummary; fleetLoop: string | null | undefined; className?: string }) {
  if (!bag.playing) return <span className={clsx("text-muted", className)}>Not reported</span>;
  if (hasIssue(bag, "old_loop")) {
    return (
      <Differs note={fleetLoop ? `Not the fleet loop (${fleetLoop})` : "Not the fleet loop"} className={className}>
        {bag.playing}
      </Differs>
    );
  }
  return <span className={clsx("truncate text-ink", className)}>{bag.playing}</span>;
}

export function BrightnessText({ bag, target, className }: { bag: BagSummary; target: number | undefined; className?: string }) {
  if (bag.brightnessPct == null) return <span className={clsx("text-muted", className)}>—</span>;
  if (hasIssue(bag, "brightness")) {
    return (
      <Differs note={target != null ? `Fleet brightness is ${target}%` : "Different from the fleet"} className={clsx("num", className)}>
        {bag.brightnessPct}%
      </Differs>
    );
  }
  return <span className={clsx("num text-ink", className)}>{bag.brightnessPct}%</span>;
}

export function SoftwareText({ bag, className }: { bag: BagSummary; className?: string }) {
  if (!bag.firmware) return <span className={clsx("text-muted", className)}>—</span>;
  if (hasIssue(bag, "software")) {
    return (
      <Differs note="Older than the rest of the fleet" className={clsx("num", className)}>
        {bag.firmware}
      </Differs>
    );
  }
  return <span className={clsx("num text-ink", className)}>{bag.firmware}</span>;
}

export function ClockText({ bag, className }: { bag: BagSummary; className?: string }) {
  if (bag.clock.ok === false) {
    return (
      <Differs tone="red" note="Not on London time: schedules would run at the wrong time" className={className}>
        {bag.clock.label}
      </Differs>
    );
  }
  if (bag.clock.ok == null) return <span className={clsx("text-muted", className)}>Unknown</span>;
  return <span className={clsx("text-ink", className)}>{bag.clock.label}</span>;
}
