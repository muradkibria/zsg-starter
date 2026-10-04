// Small building blocks for the schedules screen: rule colours, the side/bottom
// sheet, a ticking clock and date labels.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import { londonHour, todayLondon } from "@digilite/shared";
import { Sheet as SharedSheet } from "@/components/overlay";

// ── Colours: one per priority, paired with the number and loop name everywhere ─
const RULE_COLOURS: { bg: string; fg: string }[] = [
  { bg: "#061B47", fg: "#FFFFFF" },
  { bg: "#DCE3F3", fg: "#061B47" },
  { bg: "#D3E4D2", fg: "#1F4A2F" },
  { bg: "#F1DDB6", fg: "#5A3B00" },
  { bg: "#EBD0D8", fg: "#5C2233" },
  { bg: "#DDD7EF", fg: "#342A5E" },
  { bg: "#CFE4E6", fg: "#1E4A50" },
  { bg: "#E9E1C9", fg: "#4A4020" },
];
export const DEFAULT_COLOUR = { bg: "#E6E0D2", fg: "#4F5563" };
export const GAP_PATTERN = "repeating-linear-gradient(45deg,#e3ded3 0 4px,#f6f4ef 4px 8px)";

export function ruleColour(priority: number | null | undefined): { bg: string; fg: string } {
  if (!priority || priority < 1) return DEFAULT_COLOUR;
  return RULE_COLOURS[(priority - 1) % RULE_COLOURS.length];
}

export function PriorityBadge({ priority, className }: { priority: number | null; className?: string }) {
  const c = ruleColour(priority);
  return (
    <span
      className={clsx("num inline-flex size-6 shrink-0 items-center justify-center rounded-[7px] text-xs font-bold", className)}
      style={{ background: c.bg, color: c.fg }}
      aria-label={priority ? `Priority ${priority}` : "Default loop"}
    >
      {priority ?? "—"}
    </span>
  );
}

// ── Brightness shading: stronger amber = brighter screen ───────────────────────
export function brightnessFill(pct: number | null): string {
  if (pct == null) return "transparent";
  const a = 0.14 + (Math.max(0, Math.min(100, pct)) / 100) * 0.5;
  return `rgba(194, 106, 0, ${a.toFixed(3)})`;
}

// ── Time ───────────────────────────────────────────────────────────────────────
/** London "now" that updates every minute. */
export function useNow(): { today: string; minute: number } {
  const read = () => {
    const d = new Date();
    return { today: todayLondon(d), minute: Math.floor(londonHour(d) * 60) };
  };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setNow(read()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const weekOfFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long" });
const weekOfYearFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
const dayHeadFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric" });

/** "5 October" (with the year if it isn't this year). */
export function weekOfLabel(monday: string, today: string): string {
  const d = new Date(`${monday}T12:00:00Z`);
  return monday.slice(0, 4) === today.slice(0, 4) ? weekOfFmt.format(d) : weekOfYearFmt.format(d);
}

/** "Mon 5" */
export function dayHead(day: string): string {
  return dayHeadFmt.format(new Date(`${day}T12:00:00Z`));
}

export const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

// ── Sheet: a side panel on desktop, a bottom sheet on phones ───────────────────
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <SharedSheet open={open} onClose={onClose} title={title} footer={footer} width={wide ? 520 : 440}>
      {children}
    </SharedSheet>
  );
}

/** A small popover anchored under its trigger; closes on outside click or Escape. */
export function Popover({
  open,
  onClose,
  children,
  className,
  anchor,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** The trigger: clicks on it are left to its own toggle. */
  anchor?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchor?.current?.contains(t)) return;
      if (ref.current && !ref.current.contains(t)) close.current();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    const t = setTimeout(() => document.addEventListener("mousedown", onDown));
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, anchor]);
  if (!open) return null;
  return (
    <div ref={ref} className={clsx("absolute z-30 mt-2 rounded-2xl border border-rule bg-white p-3 shadow-[var(--shadow-pop)]", className)}>
      {children}
    </div>
  );
}
