// On screen: the latest screenshot (taken only on request), the loop the bag
// reports playing, and how that compares with the fleet loop.

import { Link } from "react-router";
import { Camera, CircleCheck, FlaskConical } from "lucide-react";
import type { BagDetail, FleetOverview } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { Button, ScreenFrame } from "@/components/ui";
import { shortDate, time, when } from "@/lib/format";
import { useRunCommand } from "../api";
import { Differs, Section, hasIssue } from "../bits";

const DAY = 86400_000;

export function ScreenSection({ bag, fleet, className }: { bag: BagDetail; fleet: FleetOverview | undefined; className?: string }) {
  const { can } = useAuth();
  const { run, pending } = useRunCommand(bag.id);
  const shot = bag.screenshot;
  const age = shot ? Date.now() - Date.parse(shot.takenAt) : 0;
  const stored = bag.device.downloadedPrograms;
  const fleetLoop = fleet?.fleetLoop ?? null;
  const oddShape = !!bag.device.resolution && bag.device.resolution !== "160 × 120";
  const alt = shot ? `${bag.name}'s screen, ${shortDate(shot.takenAt)} ${time(shot.takenAt)}` : undefined;

  return (
    <Section title="On screen" sub="As the bag reports it" className={className}>
      <div className="flex gap-4 xl:flex-col">
        <figure className="m-0 w-36 shrink-0 sm:w-48 xl:w-full">
          {/* 160 × 120 fills the 4:3 frame; any other shape is shown whole rather than cropped. */}
          <ScreenFrame src={shot?.url} alt={alt} fit={oddShape ? "contain" : "cover"}>
            <span className="flex flex-col items-center gap-1.5 px-2 text-center text-[11px] text-[#b8c2d6]">
              <Camera className="size-5" aria-hidden="true" />
              No screenshot yet
            </span>
          </ScreenFrame>
          <figcaption className="mt-1.5 text-xs text-muted">
            {shot ? (
              <>
                Taken {age < 7 * DAY ? when(shot.takenAt) : `${shortDate(shot.takenAt)}, ${time(shot.takenAt)} (${when(shot.takenAt)})`}
                {age > DAY && <span className="block text-caption">Screenshots are only taken when asked for.</span>}
              </>
            ) : (
              "Screenshots are only taken when asked for."
            )}
          </figcaption>
        </figure>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xs text-muted">Current loop</span>
          <span className="text-[15px] font-semibold break-words">{bag.playing ?? "Not reported"}</span>
          {bag.playing && <LoopNote bag={bag} fleetLoop={fleetLoop} canLoops={can("loops.edit")} />}
        </div>
      </div>
      {can("bags.control") && (
        <Button
          icon={<Camera className="size-4" />}
          loading={pending === "screenshot"}
          onClick={() => void run({ type: "screenshot" }, { whenSent: "The new picture appears here within about 10 minutes." })}
          className="min-h-11 w-full sm:w-auto sm:self-start md:min-h-0 xl:w-full"
        >
          Take a screenshot
        </Button>
      )}

      {stored.length > 0 && (
        <details className="group border-t border-rule-soft pt-3 text-[13px]">
          <summary className="min-h-8 cursor-pointer font-semibold text-ink-2 select-none">
            {stored.length} {stored.length === 1 ? "loop" : "loops"} stored on the bag
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0 text-ink-2">
            {stored.map((name) => (
              <li key={name} className="flex items-center justify-between gap-2">
                <span className="truncate">{name}</span>
                {name === bag.playing && <span className="shrink-0 text-xs font-semibold text-green-ink">Playing</span>}
                {name !== bag.playing && name === fleetLoop && <span className="shrink-0 text-xs text-muted">Fleet loop</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

function LoopNote({ bag, fleetLoop, canLoops }: { bag: BagDetail; fleetLoop: string | null; canLoops: boolean }) {
  if (hasIssue(bag, "old_loop")) {
    return (
      <span className="flex flex-col gap-1 text-[13px]">
        <Differs note={fleetLoop ? `The fleet loop is “${fleetLoop}”` : "Not the fleet loop"}>Not the fleet loop</Differs>
        <span className="text-ink-2">
          The rest of the fleet plays “{fleetLoop}”.{" "}
          {canLoops && (
            <Link to="/loops" className="font-semibold">
              Change it in Ads &amp; loops
            </Link>
          )}
        </span>
      </span>
    );
  }
  if (bag.isTestBag && fleetLoop && bag.playing !== fleetLoop) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-info-ink">
        <FlaskConical className="size-3.5" aria-hidden="true" />
        Test bag, so it plays test loops
      </span>
    );
  }
  if (fleetLoop && bag.playing === fleetLoop) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-green-ink">
        <CircleCheck className="size-3.5" aria-hidden="true" />
        The fleet loop
      </span>
    );
  }
  return null;
}
