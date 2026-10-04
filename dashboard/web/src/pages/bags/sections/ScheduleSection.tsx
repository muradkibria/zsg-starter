// Schedule on the bag: what the bag itself has been told to play and when,
// in plain English. Rules we can't read are counted, never guessed.

import { Link } from "react-router";
import { CalendarClock, OctagonAlert, Power, PowerOff, RotateCcw, Sun } from "lucide-react";
import { describeBagSchedule, type BagDetail, type BagScheduleLine } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { Notice } from "@/components/ui";
import { Section } from "../bits";

const ICON: Record<BagScheduleLine["kind"], typeof Sun> = {
  loop: CalendarClock,
  brightness: Sun,
  screen_off: PowerOff,
  screen_on: Power,
  restart: RotateCcw,
  other: CalendarClock,
};

export function ScheduleSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const { can } = useAuth();
  const summary = describeBagSchedule(bag.deviceSchedule);
  const clockWrong = bag.clock.ok === false;
  const schedulesLink = can("schedules.edit") ? (
    <Link to={`/schedules?bag=${bag.id}`} className="text-[13px] font-semibold no-underline hover:underline">
      Edit its schedule
    </Link>
  ) : undefined;

  if (summary.state === "none") {
    return (
      <Section title="Schedule on the bag" action={schedulesLink} className={className}>
        <p className="m-0 text-sm">
          <span className="font-semibold">No schedule on this bag yet.</span>{" "}
          <span className="text-ink-2">
            Without one it plays {bag.playing ? `“${bag.playing}”` : "its current loop"} whenever it's on, at a fixed brightness.
          </span>
        </p>
        {clockWrong && (
          <Notice tone="red" icon={<OctagonAlert className="size-4" />}>
            Its clock is set to {bag.clock.label}, not London time. Fix that before giving it a schedule, or the times will be off.
          </Notice>
        )}
      </Section>
    );
  }

  return (
    <Section title="Schedule on the bag" sub="As the bag reports it, highest priority first" action={schedulesLink} className={className}>
      {clockWrong && (
        <Notice tone="red" icon={<OctagonAlert className="size-4" />}>
          Its clock is set to {bag.clock.label}, not London time, so these run at the wrong time.
        </Notice>
      )}
      {summary.lines.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {summary.lines.map((l, i) => {
            const Icon = ICON[l.kind];
            return (
              <li key={i} className="flex items-start gap-3 rounded-xl border border-rule-soft p-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-tint text-navy" aria-hidden="true">
                  {l.priority != null ? <span className="num text-xs font-bold">{l.priority}</span> : <Icon className="size-4" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{l.title}</span>
                  <span className="block text-xs text-muted">{l.when}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {summary.unreadable > 0 && (
        <p className="m-0 text-[13px] text-ink-2">
          {summary.lines.length ? `Plus ${summary.unreadable} ${summary.unreadable === 1 ? "rule" : "rules"}` : `This bag has ${summary.unreadable === 1 ? "a schedule" : `${summary.unreadable} schedule rules`}`}{" "}
          we can't describe yet.
        </p>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold text-ink-2 select-none">What the bag reported</summary>
        <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-paper p-3 text-[11px] leading-relaxed text-ink-2">
          {JSON.stringify(bag.deviceSchedule, null, 2)}
        </pre>
      </details>
    </Section>
  );
}
