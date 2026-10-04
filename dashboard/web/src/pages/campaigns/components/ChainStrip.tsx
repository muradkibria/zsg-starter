// How a campaign reaches the street: creatives → the loops holding them →
// the bags playing those loops → the riders carrying them and their routes.

import type { ReactNode } from "react";
import { Link } from "react-router";
import clsx from "clsx";
import { ArrowDown, ArrowRight } from "lucide-react";
import type { CampaignDetail } from "@digilite/shared";
import { Avatar } from "@/components/ui";
import { CreativeThumb } from "./CreativeThumb";
import { kmText, n, plural } from "../format";

function Step({ label, children, action, tone }: { label: string; children: ReactNode; action?: ReactNode; tone?: "amber" }) {
  return (
    <div className={clsx("card flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-3.5", tone === "amber" && "border-amber-line")}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex shrink-0 items-center justify-center text-caption" aria-hidden="true">
      <ArrowRight className="hidden size-4 lg:block" />
      <ArrowDown className="size-4 lg:hidden" />
    </div>
  );
}

export function ChainStrip({ c, onLink, canEdit }: { c: CampaignDetail; onLink: () => void; canEdit: boolean }) {
  const { files, loops, bags, riders } = c.chain;
  const seconds = files.reduce((s, f) => s + (f.durationS ?? 0), 0);
  const main = loops[0] ?? null;
  const playingLoops = loops.filter((l) => l.bagsPlaying > 0);
  const short = bags.contracted > 0 && bags.carrying < bags.contracted;
  return (
    <section aria-label="How the campaign reaches the street" className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
      <Step
        label="Creatives"
        action={
          canEdit ? (
            <button type="button" onClick={onLink} className="min-h-8 text-xs font-semibold text-accent">
              {files.length ? "Change" : "Link"}
            </button>
          ) : undefined
        }
        tone={files.length ? undefined : "amber"}
      >
        {files.length ? (
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 -space-x-3">
              {files.slice(0, 3).map((f) => (
                <CreativeThumb key={f.key} id={f.thumbId} name={f.name} size="sm" className="ring-2 ring-white" />
              ))}
            </div>
            <div className="min-w-0">
              <div className="font-display text-[17px] font-semibold">
                {plural(files.length, "ad")}
                {seconds > 0 && <span className="font-normal text-muted"> · {files.length === 1 ? `${seconds} s` : `${seconds} s in all`}</span>}
              </div>
              <div className="truncate text-xs text-muted">{files.map((f) => f.name).join(", ")}</div>
            </div>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-amber-ink">No creatives linked yet, so no plays can be counted.</p>
        )}
      </Step>
      <Arrow />
      <Step
        label="Loop"
        action={main && <Link to={`/loops/${main.id}`} className="text-xs font-semibold">{main.name}</Link>}
        tone={files.length && !playingLoops.length ? "amber" : undefined}
      >
        {main ? (
          <>
            <div className="flex flex-wrap gap-1" aria-label={`Slots in ${main.name}`}>
              {Array.from({ length: main.slots }, (_, i) => {
                const mine = main.positions.includes(i + 1);
                return (
                  <span
                    key={i}
                    className={clsx("num flex size-6 items-center justify-center rounded-md text-[11px] font-bold", mine ? "bg-navy text-white" : "bg-paper-2 text-caption")}
                    title={mine ? `Slot ${i + 1}: this campaign` : `Slot ${i + 1}`}
                  >
                    {i + 1}
                  </span>
                );
              })}
            </div>
            <span className="text-xs text-muted">
              {main.positions.length === 1 ? `Slot ${main.positions[0]} of ${main.slots}` : `${main.positions.length} of ${main.slots} slots`} · {main.loopSeconds} s loop ·{" "}
              {main.bagsPlaying ? `playing on ${plural(main.bagsPlaying, "bag")}` : "no bag is playing it"}
            </span>
            {loops.length > 1 && (
              <span className="text-[11px] text-muted">
                Also in {loops.slice(1, 4).map((l) => l.name).join(", ")}
                {loops.length > 4 ? ` and ${loops.length - 4} more` : ""}
              </span>
            )}
          </>
        ) : (
          <p className="m-0 text-[13px] text-muted">{files.length ? "Not in any loop yet." : "—"}</p>
        )}
      </Step>
      <Arrow />
      <Step label="Bags" tone={short ? "amber" : undefined}>
        <div className="text-[15px]">
          <strong className="num font-display text-[22px]">{n(bags.carrying)}</strong> carrying it
          <span className="text-muted"> · {n(bags.contracted)} contracted</span>
        </div>
        <span className={clsx("text-xs", short ? "font-semibold text-amber-ink" : "text-muted")}>
          {short ? `${n(bags.contracted - bags.carrying)} short of the contract · ` : ""}
          playing its loop: {n(bags.playingLoop)} · loaded on {n(bags.loadedOn)}
        </span>
      </Step>
      <Arrow />
      <Step label="Riders & routes" action={bags.carrying > 0 ? <a href="#where-it-played" className="text-xs font-semibold">Map</a> : undefined}>
        {riders.initials && riders.initials.length > 0 && (
          <div className="flex -space-x-1" aria-hidden="true">
            {riders.initials.slice(0, 5).map((i, k) => (
              <Avatar key={k} name={i.split("").join(" ")} size={30} className="ring-2 ring-white" />
            ))}
            {riders.initials.length > 5 && (
              <span className="num flex size-[30px] items-center justify-center rounded-full bg-paper-2 text-[11px] font-bold text-muted ring-2 ring-white">+{riders.initials.length - 5}</span>
            )}
          </div>
        )}
        <span className="text-[13px] text-ink-2">
          {bags.carrying > 0
            ? `${plural(riders.count, "rider")} on those bags now · ${kmText(riders.km)} ridden while it played this week`
            : "No bag has carried it in the last 7 days."}
        </span>
      </Step>
    </section>
  );
}
