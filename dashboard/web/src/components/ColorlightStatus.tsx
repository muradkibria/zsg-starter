// Colorlight is where every bag's data comes from (the only source for now), so
// its connection is shown wherever that data is: the map header, the sidebar,
// and the More page on phones.

import { Link } from "react-router";
import clsx from "clsx";
import { Radio } from "lucide-react";
import type { SyncHealth } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";

type Tone = "green" | "amber" | "neutral";

export function colorlightState(sync: SyncHealth | undefined): { tone: Tone; label: string; detail: string } {
  if (!sync) return { tone: "neutral", label: "Colorlight", detail: "Checking…" };
  const last = sync.lastGpsSync ?? sync.lastStatusSync;
  if (sync.enabled === false) return { tone: "neutral", label: "Colorlight sync off", detail: "Showing the Hub's records" };
  if (sync.error && !sync.colorlightOk) {
    return { tone: "amber", label: "Colorlight not reachable", detail: last ? `Last update ${when(last)}` : "No updates yet" };
  }
  return { tone: "green", label: "Colorlight live", detail: last ? `Updated ${when(last)}` : "Connecting" };
}

const dot: Record<Tone, string> = { green: "bg-st-now", amber: "bg-st-idle", neutral: "bg-line" };

/** The pill in the map header. */
export function ColorlightBadge({ sync }: { sync: SyncHealth | undefined }) {
  const s = colorlightState(sync);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        s.tone === "green" ? "bg-green-bg text-green-ink" : s.tone === "amber" ? "bg-amber-bg text-amber-ink" : "bg-paper-2 text-ink-2",
      )}
    >
      <Radio className="size-3.5" aria-hidden="true" />
      {s.label} · {s.detail.charAt(0).toLowerCase() + s.detail.slice(1)}
    </span>
  );
}

/** A compact row for the sidebar and the More page; opens Settings → Colorlight connection. */
export function ColorlightStatusRow({ sync, className }: { sync: SyncHealth | undefined; className?: string }) {
  const { can } = useAuth();
  const s = colorlightState(sync);
  const body = (
    <>
      <span className={clsx("size-2 shrink-0 rounded-full", dot[s.tone])} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink">{s.label}</span>
        <span className="block truncate text-muted">{s.detail}</span>
      </span>
    </>
  );
  const cls = clsx("flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[12px] leading-tight no-underline", className);
  return can("settings.view") ? (
    <Link to="/settings?section=colorlight" className={clsx(cls, "hover:bg-paper-2")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
