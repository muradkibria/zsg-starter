// Recent changes: every change sent (or recorded) for this bag, newest first,
// with its outcome, who asked for it and when.

import { Camera, CalendarClock, LayoutGrid, Power, PowerOff, RotateCcw, Sun } from "lucide-react";
import type { BagDetail, CommandSummary } from "@digilite/shared";
import { when } from "@/lib/format";
import { COMMAND_LABEL } from "../api";
import { CommandStatusPill, Section } from "../bits";

const ICON: Record<CommandSummary["type"], typeof Sun> = {
  brightness: Sun,
  reboot: RotateCcw,
  screenshot: Camera,
  sleep: PowerOff,
  wakeup: Power,
  schedule: CalendarClock,
  publish: LayoutGrid,
};

function describe(c: CommandSummary): string {
  const v = (c.value ?? null) as Record<string, unknown> | null;
  if (c.type === "brightness" && typeof v?.pct === "number") return `Brightness to ${v.pct}%`;
  if (c.type === "publish") {
    const name = v && (typeof v.loopName === "string" ? v.loopName : typeof v.name === "string" ? v.name : null);
    return name ? `Loop “${name}” sent` : COMMAND_LABEL.publish;
  }
  return COMMAND_LABEL[c.type];
}

export function ChangesSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const list = bag.commands;
  return (
    <Section title="Recent changes" sub={list.length ? "Everything sent to this bag, newest first" : undefined} className={className}>
      {list.length === 0 ? (
        <p className="m-0 text-sm text-muted">No changes yet. Brightness, restarts, screenshots and screen on or off will show here.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {list.map((c) => {
            const Icon = ICON[c.type] ?? Sun;
            return (
              <li key={c.id} className="flex items-start gap-3 border-t border-rule-soft py-2.5 first:border-t-0 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-2" aria-hidden="true">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-semibold">{describe(c)}</span>
                    <CommandStatusPill status={c.status} />
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {c.requestedBy ?? "Someone"} · {when(c.createdAt)}
                  </span>
                  {c.error && c.status !== "dry_run" && <span className="mt-1 block text-xs text-ink-2">{c.error}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {list.length >= 10 && <p className="m-0 text-xs text-muted">Showing the latest 10. Every change is also in the audit log.</p>}
    </Section>
  );
}
