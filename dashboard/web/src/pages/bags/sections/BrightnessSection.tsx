// Brightness: what the bag reports, the fleet target, and a slider to set a
// new value (5–100%). Applying sends a brightness command through the gate.

import { useEffect, useState } from "react";
import { CircleCheck, Sun, SunDim } from "lucide-react";
import type { BagDetail, FleetOverview } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { when } from "@/lib/format";
import { useRunCommand } from "../api";
import { COMMAND_STATUS_LABEL, Differs, Section, hasIssue } from "../bits";

const MIN = 5;
const MAX = 100;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));
/** Centre of a value along the track (CSS), matching the 28px thumb. */
const along = (v: number) => `calc(14px + ${(clamp(v) - MIN) / (MAX - MIN)} * (100% - 28px))`;

export function BrightnessSection({ bag, fleet, className }: { bag: BagDetail; fleet: FleetOverview | undefined; className?: string }) {
  const { can } = useAuth();
  const canControl = can("bags.control");
  const { run, pending } = useRunCommand(bag.id);
  const target = fleet?.brightnessTargetPct ?? null;
  const current = bag.brightnessPct;
  const [value, setValue] = useState(() => clamp(current ?? target ?? 70));
  const [touched, setTouched] = useState(false);

  // Follow the bag's reported value until someone moves the slider.
  useEffect(() => {
    if (!touched && current != null) setValue(clamp(current));
  }, [current, touched]);

  const pick = (v: number) => {
    setTouched(true);
    setValue(clamp(v));
  };

  const last = bag.commands.find((c) => c.type === "brightness");
  const lastPct = (last?.value as { pct?: number } | null)?.pct;
  const offline = bag.status === "idle" || bag.status === "gone";

  return (
    <Section title="Brightness" className={className}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-[40px] leading-none font-semibold tracking-[-0.02em]">{current != null ? `${current}%` : "—"}</span>
        <span className="text-[13px]">
          <Comparison bag={bag} current={current} target={target} />
        </span>
      </div>

      {canControl ? (
        <>
          <div className="flex items-start gap-2.5">
            <SunDim className="mt-3.5 size-4 shrink-0 text-caption" aria-hidden="true" />
            <div className="relative h-[62px] flex-1">
              <input
                type="range"
                min={MIN}
                max={MAX}
                step={1}
                value={value}
                onChange={(e) => pick(Number(e.target.value))}
                aria-label={`New brightness for ${bag.name}`}
                aria-valuetext={`${value}%`}
                className="peer absolute inset-x-0 top-0 z-10 m-0 h-11 w-full cursor-pointer appearance-none opacity-0 [&::-moz-range-thumb]:size-7 [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none"
              />
              <div className="absolute inset-x-0 top-[17px] h-2.5 rounded-full bg-paper-2" aria-hidden="true" />
              <div className="absolute top-[17px] left-0 h-2.5 rounded-full bg-navy" style={{ width: along(value) }} aria-hidden="true" />
              {target != null && (
                <>
                  <div className="absolute top-[10px] h-6 w-0.5 -translate-x-1/2 rounded-full bg-caption" style={{ left: along(target) }} aria-hidden="true" />
                  <span className="absolute top-[42px] -translate-x-1/2 text-[11px] whitespace-nowrap text-muted" style={{ left: along(target) }} aria-hidden="true">
                    Fleet {target}%
                  </span>
                </>
              )}
              <div
                className="pointer-events-none absolute top-2 size-7 -translate-x-1/2 rounded-full border-2 border-navy bg-white shadow-[0_2px_8px_rgb(6_27_71/0.25)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-logo"
                style={{ left: along(value) }}
                aria-hidden="true"
              />
            </div>
            <Sun className="mt-3 size-5 shrink-0 text-ink" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {target != null && (
              <Button variant="quiet" onClick={() => pick(target)} disabled={value === target} className="min-h-11 md:min-h-0">
                Match fleet
              </Button>
            )}
            <Button
              variant="primary"
              loading={pending === "brightness"}
              disabled={!touched && current != null && value === current}
              onClick={() => void run({ type: "brightness", value })}
              className="ml-auto min-h-11 md:min-h-0"
            >
              Set to {value}%
            </Button>
          </div>
          {offline && <p className="m-0 text-xs text-muted">{bag.name} isn't reporting right now, so a change waits until it next checks in.</p>}
        </>
      ) : (
        target != null && <p className="m-0 text-[13px] text-muted">Fleet brightness is {target}%.</p>
      )}

      {last && (
        <p className="m-0 border-t border-rule-soft pt-3 text-xs text-muted">
          Last change: {lastPct != null ? `${lastPct}%` : "brightness"} · {COMMAND_STATUS_LABEL[last.status]} · {when(last.createdAt)}
          {last.requestedBy && ` by ${last.requestedBy}`}
        </p>
      )}
    </Section>
  );
}

function Comparison({ bag, current, target }: { bag: BagDetail; current: number | null; target: number | null }) {
  if (current == null) return <span className="text-muted">Not reported</span>;
  if (target == null) return null;
  if (hasIssue(bag, "brightness")) {
    const word = current > target ? "Brighter" : "Dimmer";
    return (
      <Differs note={`${word} than the fleet brightness of ${target}%`}>
        {word} than the fleet ({target}%)
      </Differs>
    );
  }
  if (bag.isTestBag && current !== target) return <span className="text-muted">Fleet {target}% · test bag</span>;
  return (
    <span className="inline-flex items-center gap-1 font-semibold text-green-ink">
      <CircleCheck className="size-3.5" aria-hidden="true" />
      {current === target ? "Matches the fleet" : `In line with the fleet (${target}%)`}
    </span>
  );
}
