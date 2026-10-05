// Last route: the bag's most recent day out on a map, with the day's summary
// and timeline. The map is a preview; the fleet map has the full view.

import { Link } from "react-router";
import { ArrowUpRight, Route } from "lucide-react";
import { todayLondon, type BagDetail, type RouteResponse } from "@digilite/shared";
import { RouteMap } from "@/components/route/RouteMap";
import { RouteTimeline } from "@/components/route/RouteTimeline";
import { useReplay, type Replay } from "@/components/route/useReplay";
import { EmptyState, Spinner } from "@/components/ui";
import { dayLabel, formatDuration, km, longDay, time, when } from "@/lib/format";
import { useDayRoute } from "../api";
import { Section, useMediaQuery } from "../bits";

export function RouteSection({ bag, className }: { bag: BagDetail; className?: string }) {
  const day = bag.lastActiveDay;
  const isToday = day === todayLondon();
  const route = useDayRoute(bag.id, day, isToday);
  const r = route.data;
  const replay = useReplay(r);
  const wide = useMediaQuery("(min-width: 768px)");
  const inProgress = isToday && bag.status === "now";
  const mapHref = `/map?bag=${bag.id}${day ? `&day=${day}` : ""}`;

  if (!day) {
    return (
      <Section title="Last route" className={className}>
        <EmptyState
          icon={<Route className="size-7" />}
          title="No route on record"
          body={`${bag.name} hasn't sent a location in the days we hold routes for. It was last seen ${when(bag.lastReportAt)}.`}
        />
      </Section>
    );
  }

  const first = r?.summary.first ?? null;
  const last = r?.summary.last ?? null;
  const outLabel = first ? (inProgress ? `since ${time(first)}` : `${time(first)}–${time(last)}`) : null;

  return (
    <Section
      title="Last route"
      sub={isToday ? (inProgress ? "Today, so far" : "Today") : longDay(day)}
      action={
        <Link to={mapHref} className="inline-flex items-center gap-1 text-[13px] font-semibold no-underline hover:underline">
          See this day on the map
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      }
      className={className}
    >
      <div className="relative h-[240px] overflow-hidden rounded-xl border border-rule bg-paper-3 md:h-[300px]">
        <RouteMap route={r} interactive={false} replay={replay} className="absolute inset-0" />
        {/* The preview opens the full map for this day (a sibling overlay, so the map's own controls aren't nested in a link). */}
        <Link to={mapHref} aria-label={`Open ${bag.name}'s route for ${longDay(day)} on the fleet map`} className="absolute inset-0 z-[1] no-underline">
          {outLabel && r && (
            <span className="absolute top-2.5 left-2.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-info-ink shadow-sm">
              {dayLabel(day)} · {outLabel} · {km(r.summary.km)}
            </span>
          )}
          <span className="absolute right-2.5 bottom-7 inline-flex items-center gap-1 rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white shadow">
            Open on the map
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </span>
        </Link>
        {route.isLoading && (
          <div className="absolute inset-0 z-[2] flex items-center justify-center bg-white/40">
            <div className="rounded-xl bg-white shadow">
              <Spinner label="Loading the route…" />
            </div>
          </div>
        )}
      </div>

      {r && first ? <RouteSummary route={r} inProgress={inProgress} compact={!wide} replay={replay} /> : !route.isLoading && <p className="m-0 text-sm text-muted">No movement recorded for this day.</p>}
    </Section>
  );
}

function RouteSummary({ route: r, inProgress, compact, replay }: { route: RouteResponse; inProgress: boolean; compact: boolean; replay: Replay }) {
  const s = r.summary;
  const riders = [...new Set(r.shifts.map((x) => x.riderName).filter((n): n is string => !!n))];
  return (
    <>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat label={inProgress ? "Out since" : "Out"} value={inProgress ? time(s.first) : `${time(s.first)}–${time(s.last)}`} />
        <MiniStat label="Ridden" value={km(s.km)} />
        <MiniStat label="Stopped" value={s.stoppedSeconds > 0 ? formatDuration(s.stoppedSeconds) : "None"} />
        <MiniStat label="Signal gaps" value={r.gaps.length ? `${r.gaps.length} · ${formatDuration(s.gapSeconds)}` : "None"} />
      </dl>
      <div className="flex flex-col gap-1 text-[13px] text-ink-2">
        <p className="m-0">
          <span className="text-muted">Zones: </span>
          {r.zones.length
            ? r.zones
                .slice(0, 4)
                .map((z) => `${z.name} ${formatDuration(z.seconds)}`)
                .join(" · ")
            : "didn't pass through a zone"}
          {r.zones.length > 4 && ` · ${r.zones.length - 4} more`}
        </p>
        <p className="m-0">
          <span className="text-muted">Carried by: </span>
          {riders.length ? riders.join(", ") : "no rider on record for this day"}
        </p>
      </div>
      <div className="border-t border-rule-soft pt-3">
        <RouteTimeline route={r} compact={compact} replay={replay} />
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-paper px-3 py-2">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="num m-0 truncate font-display text-[15px] font-semibold whitespace-nowrap">{value}</dd>
    </div>
  );
}
