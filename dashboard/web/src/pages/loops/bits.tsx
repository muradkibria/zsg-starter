// Small building blocks shared by the Ads & loops screens.

import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Ban, CheckCircle2, Clock3, Download, FlaskConical, Minus, Send, TriangleAlert } from "lucide-react";
import type {
  LoopDeliveryRow,
  LoopDeliveryState,
  LoopDeployment,
  LoopDeploymentStatus,
  LoopDeploymentTarget,
  LoopStatus,
} from "@digilite/shared";
import { FLEET_LOOP_STALE_DAYS, loopAgeLabel } from "@digilite/shared";
import { Pill, ScreenFrame, StatusIcon } from "@/components/ui";
import { Sheet as SharedSheet } from "@/components/overlay";

// ── Formatting ────────────────────────────────────────────────────────────────

/** "10 s", "54 s", "2 min 55 s" */
export function secs(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = Math.round(n * 10) / 10;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

// ── Thumbnails ────────────────────────────────────────────────────────────────

/** A creative's thumbnail on a dark 4:3 bag screen, with an optional length badge. */
export function Thumb({
  src,
  alt = "",
  badge,
  className,
  children,
}: {
  src: string | null | undefined;
  alt?: string;
  badge?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={clsx("relative", className)}>
      <ScreenFrame src={src ?? null} alt={alt}>
        <span className="px-1 text-center text-[10px] font-semibold text-white/50">No preview</span>
      </ScreenFrame>
      {badge != null && (
        <span className="num absolute top-[9%] right-[8%] rounded-[5px] bg-ink/75 px-1.5 py-px text-[10px] font-semibold text-white">{badge}</span>
      )}
      {children}
    </div>
  );
}

/** A fixed row of slots with each ad's thumbnail, like the bag's playlist. */
export function ThumbStrip({ items, slots = 6 }: { items: { thumbUrl: string | null; name: string }[]; slots?: number }) {
  const overflow = items.length > slots;
  const shown = overflow ? items.slice(0, slots - 1) : items;
  const empty = overflow ? 0 : slots - items.length;
  return (
    <div className="flex gap-[3px] rounded-md bg-ink p-[3px]" aria-hidden="true">
      {shown.map((it, i) => (
        <div key={i} className="aspect-[4/3] min-w-0 flex-1 overflow-hidden rounded-[2px] bg-[#1d2436]">
          {it.thumbUrl && <img src={it.thumbUrl} alt="" loading="lazy" className="size-full object-cover" />}
        </div>
      ))}
      {overflow && (
        <div className="flex aspect-[4/3] min-w-0 flex-1 items-center justify-center rounded-[2px] bg-[#1d2436] text-[11px] font-semibold text-white/80">
          +{items.length - shown.length}
        </div>
      )}
      {Array.from({ length: empty }, (_, i) => (
        <div key={`e${i}`} className="aspect-[4/3] min-w-0 flex-1 rounded-[2px] border border-dashed border-white/15" />
      ))}
    </div>
  );
}

// ── Pills ─────────────────────────────────────────────────────────────────────

export function LoopStatusPill({ status, onBags }: { status: LoopStatus; onBags?: number }) {
  if (status === "draft") {
    return (
      <Pill className="border border-dashed border-line bg-paper-2 text-muted">{onBags ? "Draft" : "Draft · not on any bag"}</Pill>
    );
  }
  if (status === "imported") return <Pill tone="neutral">From Colorlight</Pill>;
  if (status === "published") return <Pill tone="green">Sent from the Hub</Pill>;
  return <Pill tone="neutral">Archived</Pill>;
}

export function FleetPill() {
  return <Pill tone="navy">Fleet loop</Pill>;
}

/** "3 months old" — amber when the fleet loop has gone stale. */
export function AgePill({ ageDays, fleet }: { ageDays: number | null; fleet: boolean }) {
  const label = loopAgeLabel(ageDays);
  if (!label) return null;
  const stale = fleet && ageDays != null && ageDays > FLEET_LOOP_STALE_DAYS;
  return (
    <Pill tone={stale ? "amber" : "neutral"}>
      {stale && <Clock3 className="size-3" aria-hidden="true" />}
      {label}
    </Pill>
  );
}

const DEPLOY_LABEL: Record<LoopDeploymentStatus, string> = {
  dry_run: "Dry run",
  blocked: "Blocked",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  confirmed: "Confirmed",
  partial: "Partly sent",
};

export function DeploymentPill({ status }: { status: LoopDeploymentStatus }) {
  const tone = status === "sent" || status === "confirmed" ? "green" : status === "dry_run" ? "info" : status === "partial" ? "amber" : status === "sending" ? "neutral" : "red";
  const Icon = status === "dry_run" ? FlaskConical : status === "blocked" ? Ban : status === "failed" ? TriangleAlert : status === "partial" ? TriangleAlert : Send;
  return (
    <Pill tone={tone}>
      <Icon className="size-3" aria-hidden="true" />
      {DEPLOY_LABEL[status]}
    </Pill>
  );
}

export function targetText(target: LoopDeploymentTarget, d: Pick<LoopDeployment, "bagCount" | "delivery">): string {
  if (target === "test_bag") {
    const t = d.delivery.find((r) => r.isTestBag);
    return t ? `the test bag (${t.bagName})` : "the test bag";
  }
  if (target === "fleet") return `the whole fleet (${d.bagCount} bags)`;
  return d.bagCount === 1 && d.delivery[0] ? d.delivery[0].bagName : `${d.bagCount} bags`;
}

// ── Delivery ──────────────────────────────────────────────────────────────────

const STATE_STYLE: Record<LoopDeliveryState, { icon: typeof Send; cls: string }> = {
  playing: { icon: CheckCircle2, cls: "text-green-ink" },
  downloaded: { icon: Download, cls: "text-info-ink" },
  waiting_offline: { icon: Clock3, cls: "text-amber-ink" },
  sent: { icon: Send, cls: "text-navy" },
  dry_run: { icon: FlaskConical, cls: "text-muted" },
  blocked: { icon: Ban, cls: "text-red-ink" },
  failed: { icon: TriangleAlert, cls: "text-red-ink" },
};

export function DeliveryIcon({ state }: { state: LoopDeliveryState }) {
  const s = STATE_STYLE[state];
  return <s.icon className={clsx("size-4 shrink-0", s.cls)} aria-hidden="true" />;
}

/** One line summing up where a send has got to. */
export function deliverySummary(d: LoopDeployment): string {
  const c = d.counts;
  const parts: string[] = [];
  if (c.playing) parts.push(`playing on ${c.playing}`);
  if (c.downloaded) parts.push(`downloaded on ${c.downloaded}`);
  if (c.sent) parts.push(`waiting for ${c.sent} to download`);
  if (c.waiting_offline) parts.push(`${c.waiting_offline} offline, sends when ${c.waiting_offline === 1 ? "it connects" : "they connect"}`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (!parts.length) return "";
  const s = parts.join(" · ");
  return s[0].toUpperCase() + s.slice(1);
}

export function DeliveryList({ rows, limit = 8 }: { rows: LoopDeliveryRow[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  return (
    <div>
      <ul className="m-0 flex list-none flex-col p-0">
        {shown.map((r) => (
          <li key={r.bagId} className="flex items-start gap-2.5 border-t border-rule-soft py-2 first:border-t-0">
            <span className="mt-0.5">
              <StatusIcon status={r.bagStatus} size={14} />
            </span>
            <div className="w-[76px] shrink-0">
              <div className="text-[13px] font-bold">{r.bagName}</div>
              {r.isTestBag && <div className="text-[11px] text-caption">Test bag</div>}
            </div>
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <DeliveryIcon state={r.state} />
              <div className="min-w-0">
                <div className={clsx("text-[12px] font-semibold", STATE_STYLE[r.state].cls)}>{r.label}</div>
                {r.note && <div className="text-[11px] text-muted">{r.note}</div>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 h-9 text-[13px] font-semibold text-accent">
          {all ? "Show fewer" : `Show all ${rows.length} bags`}
        </button>
      )}
    </div>
  );
}

// ── Sheet (side panel on desktop, bottom sheet on phones) ─────────────────────
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <SharedSheet open={open} onClose={onClose} title={title} footer={footer} width={width}>
      {children}
    </SharedSheet>
  );
}

/** A quiet list-row placeholder for empty spots. */
export function Dash() {
  return <Minus className="size-3.5 text-caption" aria-hidden="true" />;
}
