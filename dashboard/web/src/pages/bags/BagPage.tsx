// The bag page: where it went, what's on its screen, controls, health, who
// carried it and its recent days. On a phone the controls come first; on a
// desktop the route and history take the wide column.

import { Link, useParams } from "react-router";
import { AlertTriangle, FlaskConical, Info, MapPin, OctagonAlert, UserRound } from "lucide-react";
import { bagSeenLabel, bagSpanLabel, type BagDetail, type FleetOverview } from "@digilite/shared";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBags, useFleet } from "@/lib/queries";
import { Avatar, EmptyState, ErrorState, LinkButton, Notice, Page, PageHeader, Pill, Spinner, StatusIcon, cx, type Tone } from "@/components/ui";
import { shortDate, time, when } from "@/lib/format";
import { useBagDetail } from "./api";
import { LifecyclePill, TestBagPill, hasIssue } from "./bits";
import { BrightnessSection } from "./sections/BrightnessSection";
import { ChangesSection } from "./sections/ChangesSection";
import { ControlsSection } from "./sections/ControlsSection";
import { DaysSection } from "./sections/DaysSection";
import { HealthSection } from "./sections/HealthSection";
import { LifecycleSection } from "./sections/LifecycleSection";
import { RouteSection } from "./sections/RouteSection";
import { ScheduleSection } from "./sections/ScheduleSection";
import { ScreenSection } from "./sections/ScreenSection";
import { StintsSection } from "./sections/StintsSection";

export default function BagPage() {
  const { id = "" } = useParams();
  const bagQ = useBagDetail(id);
  const fleetQ = useFleet();
  const { can } = useAuth();
  const bag = bagQ.data;
  const fleet = fleetQ.data;

  if (bagQ.isLoading) {
    return (
      <Page>
        <Spinner label="Loading the bag…" />
      </Page>
    );
  }
  if (bagQ.error || !bag) {
    const missing = bagQ.error instanceof ApiError && bagQ.error.status === 404;
    return (
      <Page>
        <PageHeader crumbs={[{ label: "Bags", to: "/bags" }]} title="Bag" />
        {missing ? (
          <div className="card">
            <EmptyState title="Bag not found" body="It may have been removed from Colorlight." action={<LinkButton to="/bags">All bags</LinkButton>} />
          </div>
        ) : (
          <ErrorState error={bagQ.error} retry={() => void bagQ.refetch()} />
        )}
      </Page>
    );
  }

  const canControl = can("bags.control");
  // Phone order is set with `order-*`; from xl the two columns take over.
  // Keyed by bag so slider, lifecycle and list state reset when moving between bags.
  return (
    <Page>
      <BagHeader bag={bag} />
      <WriteModeNotice bag={bag} fleet={fleet} />

      <div key={bag.id} className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] xl:items-start xl:gap-5">
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
          <RouteSection bag={bag} className="order-4 xl:order-none" />
          <DaysSection bag={bag} className="order-6 xl:order-none" />
          <ChangesSection bag={bag} className="order-7 xl:order-none" />
          <ScheduleSection bag={bag} className="order-10 xl:order-none" />
        </div>
        <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-5">
          <ScreenSection bag={bag} fleet={fleet} className="order-1 xl:order-none" />
          <BrightnessSection bag={bag} fleet={fleet} className="order-2 xl:order-none" />
          {canControl && <ControlsSection bag={bag} fleet={fleet} className="order-3 xl:order-none" />}
          <HealthSection bag={bag} className="order-5 xl:order-none" />
          <StintsSection bag={bag} className="order-8 xl:order-none" />
          <LifecycleSection bag={bag} className="order-9 xl:order-none" />
        </div>
      </div>
    </Page>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

const STATUS_TONE = { now: "green", day: "info", idle: "amber", gone: "red" } as const;

function BagHeader({ bag }: { bag: BagDetail }) {
  const d = bag.device;
  const noFix = bag.status === "now" && (!bag.lastGpsAt || Date.now() - Date.parse(bag.lastGpsAt) > 10 * 60_000);
  const tone: Tone = bag.status === "gone" && bag.lifecycle !== "active" ? "neutral" : STATUS_TONE[bag.status];
  const shownIssues = bag.issues.filter((i) => i.kind !== "not_seen" && i.kind !== "no_rider");
  const deviceBits = [d.model ? d.model.toUpperCase() : null, d.resolution, d.serial ? `Serial ${d.serial}` : null, `Colorlight ${bag.colorlightId}`].filter(Boolean);

  return (
    <PageHeader
      crumbs={[{ label: "Bags", to: "/bags" }, { label: bag.name }]}
      title={
        <span className="flex items-center gap-3">
          <span className="hidden h-[42px] w-14 shrink-0 rounded-md bg-ink p-[5px] sm:block" aria-hidden="true">
            <span className="block size-full rounded-[2px] bg-[#3a5ba8]" />
          </span>
          {bag.name}
        </span>
      }
      sub={
        <span className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={tone}>
              <StatusIcon status={bag.status} size={14} />
              {bagSeenLabel(bag.status, bag.lastReportAt)}
            </Pill>
            {noFix && (
              <Pill tone="amber">
                <AlertTriangle className="size-3" aria-hidden="true" />
                No location since {bag.lastGpsAt ? time(bag.lastGpsAt) : "it started"}
              </Pill>
            )}
            {bag.isTestBag && <TestBagPill />}
            <LifecyclePill lifecycle={bag.lifecycle} />
            {shownIssues.map((i) => (
              <Pill key={i.kind} tone={i.kind === "clock" ? "red" : "amber"}>
                {i.kind === "clock" ? <OctagonAlert className="size-3" aria-hidden="true" /> : <AlertTriangle className="size-3" aria-hidden="true" />}
                {i.label}
              </Pill>
            ))}
          </span>
          <span className="hidden text-[13px] text-muted sm:block">{deviceBits.join(" · ")}</span>
        </span>
      }
      actions={
        <>
          <RiderCard bag={bag} />
          <LinkButton to={`/map?bag=${bag.id}`} icon={<MapPin className="size-4" />} className="min-h-11 w-full sm:w-auto md:min-h-0">
            See on the map
          </LinkButton>
        </>
      }
    />
  );
}

function RiderCard({ bag }: { bag: BagDetail }) {
  const { can } = useAuth();
  const giveHref = `/riders?give=${bag.id}`;
  const canGive = can("riders.edit");
  const r = bag.rider;

  if (r) {
    return (
      <div className="card flex w-full items-center gap-3 px-3.5 py-2.5 sm:w-auto">
        <Avatar name={r.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted">Carried by</div>
          {can("riders.view") ? (
            <Link to={`/riders/${r.id}`} className="block truncate text-[15px] font-bold text-ink no-underline hover:text-accent hover:underline">
              {r.name}
            </Link>
          ) : (
            <span className="block truncate text-[15px] font-bold">{r.name}</span>
          )}
          <div className="text-xs text-muted">
            since {shortDate(r.since)} · {bagSpanLabel(r.since, null)}
            {r.demo && " · demo rider"}
          </div>
        </div>
        {canGive && (
          <LinkButton to={giveHref} size="sm" className="ml-1 min-h-11 md:min-h-0">
            Change rider
          </LinkButton>
        )}
      </div>
    );
  }

  const outWithout = hasIssue(bag, "no_rider");
  return (
    <div className={cx("card flex w-full items-center gap-3 px-3.5 py-2.5 sm:w-auto", outWithout && "border-amber-line bg-amber-bg")}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paper-2 text-muted" aria-hidden="true">
        <UserRound className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted">Carried by</div>
        {bag.isTestBag ? (
          <span className="block text-[15px] font-semibold text-ink-2">Nobody · kept for testing</span>
        ) : (
          <span className={cx("block text-[15px] font-bold", bag.lifecycle === "active" ? "text-amber-ink" : "text-ink-2")}>No rider</span>
        )}
        {outWithout && <div className="max-w-[260px] text-xs text-amber-ink">Out without a rider, so its hours can't be credited to anyone</div>}
      </div>
      {canGive && (
        <LinkButton to={giveHref} size="sm" variant={outWithout ? "primary" : "secondary"} className="ml-1 min-h-11 md:min-h-0">
          Give to a rider
        </LinkButton>
      )}
    </div>
  );
}

// ── Safety notice ─────────────────────────────────────────────────────────────

function WriteModeNotice({ bag, fleet }: { bag: BagDetail; fleet: FleetOverview | undefined }) {
  const { can } = useAuth();
  const bags = useBags();
  // Only relevant to people who can send changes to bags.
  if (!fleet || !can("bags.control")) return null;
  const testBagName = bags.data?.find((b) => b.isTestBag)?.name ?? "the test bag";
  const testOffline =
    bag.isTestBag && (bag.status === "gone" || bag.status === "idle")
      ? ` It was last seen ${when(bag.lastReportAt)}, so switch it on before trying a change.`
      : "";
  const settings = can("settings.view") ? (
    <Link to="/settings?section=changes" className="shrink-0 font-semibold">
      Settings
    </Link>
  ) : undefined;

  if (fleet.writeMode === "off") {
    return (
      <Notice tone="info" icon={<Info className="size-4" />} action={settings}>
        Changes are recorded as dry runs — nothing is sent to bags until changes are switched on in Settings.
        {bag.isTestBag && ` This is the test bag: once changes are on in test mode, it's the only bag cleared to receive them.${testOffline}`}
      </Notice>
    );
  }
  if (fleet.writeMode === "fleet" && fleet.fleetWritesEnabled) return null;
  if (bag.isTestBag) {
    return (
      <Notice tone="info" icon={<FlaskConical className="size-4" />}>
        This is the test bag, the only bag cleared for real changes in test mode. Changes you make here are sent to it.{testOffline}
      </Notice>
    );
  }
  return (
    <Notice tone="amber" icon={<FlaskConical className="size-4" />} action={settings}>
      Changes are limited to the test bag ({testBagName}) while we test. Anything you change here is recorded as blocked, not sent.
    </Notice>
  );
}
