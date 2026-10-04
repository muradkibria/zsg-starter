// Controls: restart, screen off, screen on. Each asks first and says what
// will happen, including when the change will only be recorded (dry run or
// blocked by the test-bag rule).

import type { ReactNode } from "react";
import { Power, PowerOff, RotateCcw } from "lucide-react";
import type { BagDetail, FleetOverview } from "@digilite/shared";
import { useFeedback } from "@/components/feedback";
import { Button, Pill } from "@/components/ui";
import { when } from "@/lib/format";
import { expectedOutcome, useRunCommand } from "../api";
import { Section } from "../bits";

type ControlType = "reboot" | "sleep" | "wakeup";

export function ControlsSection({ bag, fleet, className }: { bag: BagDetail; fleet: FleetOverview | undefined; className?: string }) {
  const { run, pending } = useRunCommand(bag.id);
  const { confirm } = useFeedback();
  const outcome = expectedOutcome(fleet, bag.isTestBag);
  const outcomeNote =
    outcome === "dry_run"
      ? "Changes are off, so this is recorded as a dry run and nothing is sent to the bag."
      : outcome === "block"
        ? "Only the test bag can be changed right now, so this will be recorded as blocked."
        : bag.status === "idle" || bag.status === "gone"
          ? `${bag.name} isn't reporting right now, so it happens when the bag next checks in.`
          : null;

  const controls: { type: ControlType; icon: typeof Power; title: string; hint: string; button: string; ask: { title: string; body: ReactNode; confirm: string; danger?: boolean } }[] = [
    {
      type: "reboot",
      icon: RotateCcw,
      title: "Restart",
      hint: "Screen goes dark for about a minute, then the loop carries on.",
      button: "Restart",
      ask: {
        title: `Restart ${bag.name}?`,
        body: "The bag restarts. Its screen goes dark for about a minute, then it picks up its loop again. Its location may drop out briefly.",
        confirm: "Restart",
      },
    },
    {
      type: "sleep",
      icon: PowerOff,
      title: "Screen off",
      hint: "Stops showing ads. It stays connected and keeps reporting where it is.",
      button: "Turn off",
      ask: {
        title: `Turn ${bag.name}'s screen off?`,
        body: `The screen stops showing ads until someone turns it back on. The bag stays connected and keeps reporting its location.${
          bag.status === "now" ? " It's out right now, so its rider will be carrying a dark screen." : ""
        }`,
        confirm: "Turn screen off",
        danger: true,
      },
    },
    {
      type: "wakeup",
      icon: Power,
      title: "Screen on",
      hint: "Starts playing its loop again.",
      button: "Turn on",
      ask: { title: `Turn ${bag.name}'s screen on?`, body: "The screen starts playing its loop again.", confirm: "Turn screen on" },
    },
  ];

  async function go(c: (typeof controls)[number]) {
    const ok = await confirm({
      title: c.ask.title,
      body: (
        <>
          <p className="m-0">{c.ask.body}</p>
          {outcomeNote && <p className="m-0 mt-2 font-medium text-ink-2">{outcomeNote}</p>}
        </>
      ),
      confirm: c.ask.confirm,
      danger: c.ask.danger,
    });
    if (ok) await run({ type: c.type });
  }

  const power = bag.device.powerOn;
  const reporting = bag.status === "now" || bag.status === "day";
  return (
    <Section
      title="Controls"
      sub={`Screen state as of the last report, ${when(bag.lastReportAt)}`}
      action={
        power == null ? undefined : (
          // A bag that isn't reporting only has a last-known state: shown neutral, not green.
          <Pill tone={!reporting ? "neutral" : power ? "green" : "amber"}>
            {power ? <Power className="size-3" aria-hidden="true" /> : <PowerOff className="size-3" aria-hidden="true" />}
            Screen {power ? "on" : "off"}
          </Pill>
        )
      }
      className={className}
    >
      <ul className="m-0 flex list-none flex-col p-0">
        {controls.map((c) => (
          <li key={c.type} className="flex items-center gap-3 border-t border-rule-soft py-3 first:border-t-0 first:pt-0 last:pb-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-paper-2 text-ink-2" aria-hidden="true">
              <c.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{c.title}</span>
              <span className="block text-xs text-muted">{c.hint}</span>
            </span>
            <Button
              variant={c.ask.danger ? "danger" : "secondary"}
              loading={pending === c.type}
              onClick={() => void go(c)}
              className="min-h-11 shrink-0 md:min-h-0"
            >
              {c.button}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
