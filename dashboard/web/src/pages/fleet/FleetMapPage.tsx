// The home screen. The status counts are the map's controls ("Out now" on by
// default). Pick a bag and everything else hides: only its route, stops,
// signal gaps, zones and day timeline remain. One tap (×) goes back.

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { Map as MLMap, MapLayerMouseEvent } from "maplibre-gl";
import clsx from "clsx";
import { AlertTriangle, ChevronLeft, ChevronRight, X } from "lucide-react";
import { STATUS_LABEL, STATUS_ORDER, type BagStatus, type LiveBag } from "@digilite/shared";
import { useBag, useBagDays, useFleet, useLiveBags, useRoute, useZones } from "@/lib/queries";
import { MapView, boundsOf, setVisible } from "@/components/map/MapView";
import { clearRoute, drawBags, drawRoute, drawZones, routeCoords, zoneFeatures } from "@/components/map/layers";
import { RouteTimeline } from "@/components/route/RouteTimeline";
import { SearchBox } from "@/components/SearchBox";
import { Avatar, buttonClass, ErrorState, Pill, Spinner, StatusIcon } from "@/components/ui";
import { dayLabel, formatDuration, km, pct, time, when } from "@/lib/format";
import { ColorlightBadge } from "@/components/ColorlightStatus";

function useMapState() {
  const [params, setParams] = useSearchParams();
  const show = useMemo(() => {
    const raw = params.get("show");
    const list = (raw ?? "now").split(",").filter((s): s is BagStatus => (STATUS_ORDER as string[]).includes(s));
    return new Set<BagStatus>(raw === "" ? [] : list);
  }, [params]);
  const bagId = params.get("bag");
  const day = params.get("day");
  const zonesOn = params.get("zones") === "1";
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: false });
  };
  return {
    show,
    bagId,
    day,
    zonesOn,
    toggle: (s: BagStatus) => {
      const n = new Set(show);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      update({ show: [...n].join(",") });
    },
    select: (id: string | null) => update({ bag: id, day: null }),
    setDay: (d: string | null) => update({ day: d }),
    setZones: (on: boolean) => update({ zones: on ? "1" : null }),
  };
}

export default function FleetMapPage() {
  const s = useMapState();
  const nav = useNavigate();
  const onPick = (href: string) => {
    const m = href.match(/^\/map\?bag=(.+)$/);
    if (m) s.select(m[1]);
    else nav(href);
  };
  const fleet = useFleet();
  const live = useLiveBags();
  const zones = useZones();
  const route = useRoute(s.bagId, s.day);
  const [map, setMap] = useState<MLMap | null>(null);
  const bags = live.data?.bags ?? [];
  const selected = bags.find((b) => b.id === s.bagId) ?? null;
  const visible = useMemo(
    () => bags.filter((b) => s.show.has(b.status) && b.position).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
    [bags, s.show],
  );
  const handlers = useRef(false);
  const fittedFleet = useRef(false);
  const fittedRoute = useRef<string | null>(null);

  // Fleet layers
  useEffect(() => {
    if (!map) return;
    drawBags(map, visible);
    setVisible(map, ["bags", "trails"], !s.bagId);
    if (!handlers.current && map.getLayer("bags")) {
      handlers.current = true;
      map.on("click", "bags", (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) s.select(id);
      });
      map.on("mouseenter", "bags", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "bags", () => (map.getCanvas().style.cursor = ""));
    }
    if (!fittedFleet.current && !s.bagId && visible.length) {
      const b = boundsOf(visible.map((v) => [v.position!.lng, v.position!.lat]));
      if (b) map.fitBounds(b, { padding: { top: 80, bottom: 60, left: 340, right: 60 }, maxZoom: 13.5, duration: 0 });
      fittedFleet.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, visible, s.bagId]);

  // Zones: all zones when switched on; with a bag selected, only those it passed through.
  useEffect(() => {
    if (!map || !zones.data) return;
    if (s.bagId) {
      const passed = new Map((route.data?.zones ?? []).map((z) => [z.zoneId, `${z.name} · ${formatDuration(z.seconds)}`]));
      drawZones(map, zoneFeatures(zones.data, passed), true);
    } else {
      drawZones(map, zoneFeatures(zones.data), s.zonesOn);
    }
  }, [map, zones.data, s.bagId, s.zonesOn, route.data]);

  // Selected bag's route
  useEffect(() => {
    if (!map) return;
    if (!s.bagId) {
      clearRoute(map);
      fittedRoute.current = null;
      return;
    }
    drawRoute(map, route.data);
    const key = `${route.data?.bagId}:${route.data?.day}`;
    const b = boundsOf(routeCoords(route.data));
    if (route.data && b && fittedRoute.current !== key) {
      const mobile = window.innerWidth < 768;
      map.fitBounds(b, {
        padding: mobile ? { top: 90, bottom: 320, left: 30, right: 30 } : { top: 60, bottom: 40, left: 380, right: 70 },
        maxZoom: 15,
        duration: 700,
      });
      fittedRoute.current = key;
    }
  }, [map, s.bagId, route.data]);

  const counts = fleet.data?.counts;
  const attention = fleet.data?.attention.filter((a) => a.severity !== "info") ?? [];

  return (
    <div className="flex h-full flex-col">
      {/* Desktop header */}
      <header className="hidden h-16 shrink-0 items-center gap-4 border-b border-rule px-5 md:flex">
        <h1 className="m-0 font-display text-[22px] font-semibold">Fleet map</h1>
        {fleet.data && <ColorlightBadge sync={fleet.data.sync} />}
        <div className="flex-1" />
        <button
          aria-pressed={s.zonesOn}
          onClick={() => s.setZones(!s.zonesOn)}
          className={clsx(
            "h-8 rounded-full border px-3 text-xs font-semibold",
            s.zonesOn ? "border-navy bg-navy text-white" : "border-line bg-white text-ink",
          )}
        >
          Zones
        </button>
        <SearchBox className="w-[320px]" onPick={onPick} />
      </header>

      <div className="relative min-h-0 flex-1">
        <MapView onReady={setMap} className="absolute inset-0" ariaLabel="Map of the fleet" />

        {/* Mobile top overlay: search + status chips */}
        <div className="absolute inset-x-3 top-3 z-10 flex flex-col gap-2 md:hidden">
          <SearchBox onPick={onPick} />
          {!s.bagId && (
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {STATUS_ORDER.map((st) => (
                <button
                  key={st}
                  aria-pressed={s.show.has(st)}
                  onClick={() => s.toggle(st)}
                  className={clsx(
                    "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold shadow-sm",
                    s.show.has(st) ? "border-navy bg-navy text-white" : "border-line bg-white/95 text-ink",
                  )}
                >
                  <StatusIcon status={st} size={16} />
                  {STATUS_LABEL[st].replace("Out in the last day", "Last day").replace("Not seen for over a week", "Not seen").replace("Idle 1 – 7 days", "Idle")}
                  <span className="num opacity-80">{counts?.[st] ?? "–"}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Desktop floating card */}
        <div className="absolute top-4 left-4 z-10 hidden w-[310px] md:block">
          {s.bagId ? (
            <SelectedCard bag={selected} bagId={s.bagId} onClose={() => s.select(null)} />
          ) : (
            <section aria-label="Show on the map" className="rounded-2xl border border-rule bg-white/95 p-3.5 shadow-[var(--shadow-float)] backdrop-blur">
              <div className="flex items-baseline justify-between px-2 pb-2">
                <h2 className="m-0 font-display text-base font-semibold">Show on the map</h2>
                <span className="text-xs text-muted">{fleet.data?.total ?? "–"} bags</span>
              </div>
              {STATUS_ORDER.map((st) => (
                <ToggleRow key={st} status={st} on={s.show.has(st)} count={counts?.[st]} onClick={() => s.toggle(st)} />
              ))}
              {attention.length > 0 && (
                <>
                  <div className="my-2 h-px bg-rule" />
                  <Link
                    to="/alerts"
                    className="flex items-center gap-2 rounded-[10px] bg-amber-bg px-3 py-2 text-[13px] font-bold text-amber-ink no-underline"
                  >
                    <AlertTriangle className="size-4" />
                    {attention.length} {attention.length === 1 ? "thing needs" : "things need"} attention
                  </Link>
                </>
              )}
            </section>
          )}
        </div>

        {live.isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="rounded-xl bg-white/95 shadow">
              <Spinner label="Loading the fleet…" />
            </div>
          </div>
        )}
        {live.error && (
          <div className="absolute top-20 left-1/2 z-10 w-[min(92%,480px)] -translate-x-1/2">
            <ErrorState error={live.error} retry={() => void live.refetch()} />
          </div>
        )}

        {/* Mobile bottom sheet */}
        <div className="absolute inset-x-0 bottom-0 z-10 md:hidden">
          <div className="rounded-t-[20px] border-t border-rule bg-white px-4 pt-2 pb-3 shadow-[0_-8px_24px_rgb(16_24_43/0.08)]">
            <div className="mx-auto mb-2 h-1 w-9 rounded-full bg-line" />
            {s.bagId ? (
              <MobileSelected bag={selected} bagId={s.bagId} day={s.day} setDay={s.setDay} onClose={() => s.select(null)} />
            ) : (
              <BagStrip bags={visible} onPick={s.select} compact />
            )}
          </div>
        </div>
      </div>

      {/* Desktop bottom panel */}
      <section className="hidden shrink-0 border-t border-rule bg-white px-5 py-3.5 md:block" style={{ minHeight: 172 }}>
        {s.bagId ? (
          <SelectedPanel bagId={s.bagId} day={s.day} setDay={s.setDay} bag={selected} />
        ) : (
          <BagStrip bags={visible} onPick={s.select} />
        )}
      </section>
    </div>
  );
}

function ToggleRow({ status, on, count, onClick }: { status: BagStatus; on: boolean; count?: number; onClick: () => void }) {
  return (
    <button
      aria-pressed={on}
      onClick={onClick}
      className={clsx("flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left text-[13px]", on ? "bg-info-bg text-ink" : "text-muted hover:bg-paper")}
    >
      <span
        className={clsx(
          "flex size-[18px] shrink-0 items-center justify-center rounded-[5px]",
          on ? "bg-navy" : "border-2 border-line",
        )}
      >
        {on && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className={clsx(!on && "opacity-60")}>
        <StatusIcon status={status} />
      </span>
      <span className="flex-1 font-medium">{STATUS_LABEL[status]}</span>
      <span className={clsx("num font-display text-base font-semibold", on ? (status === "gone" ? "text-st-gone" : "text-ink") : "text-caption")}>
        {count ?? "–"}
      </span>
    </button>
  );
}

function BagStrip({ bags, onPick, compact }: { bags: LiveBag[]; onPick: (id: string) => void; compact?: boolean }) {
  const title = bags.length === 0 ? "No bags match the statuses you've switched on" : `${bags.length} ${bags.length === 1 ? "bag" : "bags"} on the map`;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="m-0 font-display text-base font-semibold">{title}</h2>
        {!compact && <span className="text-xs text-muted">Pick one to see only that bag, its route and its day</span>}
      </div>
      <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
        {bags.map((b) => (
          <button
            key={b.id}
            onClick={() => onPick(b.id)}
            className="flex w-[158px] shrink-0 flex-col gap-1 rounded-xl border border-rule bg-white px-3 py-2.5 text-left hover:border-navy"
          >
            <span className="flex items-center gap-1.5 text-sm font-bold">
              <StatusIcon status={b.status} size={14} />
              {b.name}
              {b.isTestBag && <Pill tone="info" className="ml-auto px-1.5 text-[10px]">Test</Pill>}
            </span>
            <span className="truncate text-xs text-ink-2">{b.rider?.name ?? "No rider"}</span>
            <span className="text-[11px] text-muted">
              {b.status === "now"
                ? !b.lastGpsAt || Date.now() - Date.parse(b.lastGpsAt) > 10 * 60_000
                  ? `on · no GPS fix since ${when(b.lastGpsAt)}`
                  : "out now"
                : `seen ${when(b.lastReportAt)}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SelectedCard({ bag, bagId, onClose }: { bag: LiveBag | null; bagId: string; onClose: () => void }) {
  const detail = useBag(bagId);
  const b = bag ?? detail.data ?? null;
  return (
    <section aria-label="Selected bag" className="overflow-hidden rounded-2xl border border-rule bg-white shadow-[var(--shadow-float)]">
      <div className="flex items-center gap-3 bg-navy px-3.5 py-3 text-white">
        <div className="flex h-[33px] w-[44px] shrink-0 items-center justify-center rounded-[5px] border border-[#3a4a6b] bg-ink p-1">
          <div className="size-full rounded-[1px] bg-[#3a5ba8]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-semibold">{b?.name ?? "Bag"}</div>
          <div className="truncate text-xs text-[#c9d3ea]">
            {b?.rider?.name ?? "No rider"} · {b?.status === "now" ? "out now" : `last seen ${when(b?.lastReportAt)}`}
          </div>
        </div>
        <button onClick={onClose} aria-label="Back to the fleet" className="flex size-8 items-center justify-center rounded-full bg-navy-2 hover:bg-[#2a3d66]">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        <div className="flex justify-between text-[13px]">
          <span className="text-muted">On screen</span>
          <strong>
            {b?.playing ?? "—"} · {pct(b?.brightnessPct)}
          </strong>
        </div>
        {b?.issues.length ? (
          <div className="flex flex-wrap gap-1.5">
            {b.issues.map((i) => (
              <Pill key={i.kind} tone={i.kind === "not_seen" || i.kind === "clock" ? "red" : "amber"}>
                {i.label}
              </Pill>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <Link to={`/bags/${bagId}`} className={buttonClass("primary", "sm", "flex-1")}>
            Open bag
          </Link>
          {b?.rider && (
            <Link to={`/riders/${b.rider.id}`} className={buttonClass("secondary", "sm", "flex-1")}>
              Rider
            </Link>
          )}
        </div>
        <button onClick={onClose} className="text-left text-xs font-semibold text-accent">
          ← Back to the fleet
        </button>
      </div>
    </section>
  );
}

function DayPicker({ bagId, day, setDay, current }: { bagId: string; day: string | null; setDay: (d: string | null) => void; current: string | null }) {
  const days = useBagDays(bagId);
  const active = (days.data ?? []).filter((d) => d.points > 0).map((d) => d.day).sort();
  const cur = current ?? day;
  const i = cur ? active.indexOf(cur) : -1;
  const prev = i > 0 ? active[i - 1] : null;
  const next = i >= 0 && i < active.length - 1 ? active[i + 1] : null;
  return (
    <div className="flex items-center gap-1">
      <button aria-label="Previous day out" disabled={!prev} onClick={() => prev && setDay(prev)} className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30">
        <ChevronLeft className="size-4" />
      </button>
      <label className="relative">
        <span className="text-sm font-semibold">{cur ? dayLabel(cur) : "—"}</span>
        <input
          type="date"
          aria-label="Pick a day"
          value={cur ?? ""}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="absolute inset-0 opacity-0"
        />
      </label>
      <button aria-label="Next day out" disabled={!next} onClick={() => next && setDay(next)} className="rounded-lg p-1.5 hover:bg-paper disabled:opacity-30">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function SelectedPanel({ bagId, day, setDay, bag }: { bagId: string; day: string | null; setDay: (d: string | null) => void; bag: LiveBag | null }) {
  const route = useRoute(bagId, day);
  const r = route.data;
  return (
    <div className="flex gap-6">
      <div className="flex w-[330px] shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Avatar name={bag?.rider?.name ?? bag?.name ?? "Bag"} size={34} />
            <div>
              <div className="font-display text-base font-semibold">{bag?.name}</div>
              <div className="text-xs text-muted">{bag?.rider ? `carried by ${bag.rider.name}` : "No rider on this bag"}</div>
            </div>
          </div>
          <DayPicker bagId={bagId} day={day} setDay={setDay} current={r?.day ?? null} />
        </div>
        {r && r.summary.first ? (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <MiniStat label="Out" value={`${time(r.summary.first)}–${time(r.summary.last)}`} />
              <MiniStat label="Ridden" value={km(r.summary.km)} />
              <MiniStat label="Stopped" value={formatDuration(r.summary.stoppedSeconds)} amber={r.summary.stoppedSeconds > 0} />
            </div>
            <div className="text-xs text-ink-2">
              {r.zones.length ? `Zones: ${r.zones.slice(0, 3).map((z) => `${z.name} ${formatDuration(z.seconds)}`).join(" · ")}` : "Didn't pass through a zone"}
              {r.gaps.length > 0 && ` · ${r.gaps.length} signal ${r.gaps.length === 1 ? "gap" : "gaps"}`}
            </div>
          </>
        ) : route.isLoading ? (
          <Spinner label="Loading the route…" />
        ) : (
          <p className="m-0 text-sm text-muted">No movement recorded for this day.</p>
        )}
      </div>
      <div className="min-w-0 flex-1 pt-1">{r && <RouteTimeline route={r} playing={bag?.playing} />}</div>
    </div>
  );
}

function MiniStat({ label, value, amber }: { label: string; value: string; amber?: boolean }) {
  return (
    <div className="rounded-lg bg-paper px-2 py-1.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={clsx("num font-display text-[15px] font-semibold whitespace-nowrap", amber && "text-amber-ink")}>{value}</div>
    </div>
  );
}

function MobileSelected({ bag, bagId, day, setDay, onClose }: { bag: LiveBag | null; bagId: string; day: string | null; setDay: (d: string | null) => void; onClose: () => void }) {
  const route = useRoute(bagId, day);
  const r = route.data;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-display text-lg font-semibold">
            {bag?.name} <span className="text-sm font-medium text-muted">· {bag?.rider?.name ?? "No rider"}</span>
          </div>
          <DayPicker bagId={bagId} day={day} setDay={setDay} current={r?.day ?? null} />
        </div>
        <button onClick={onClose} aria-label="Back to the fleet" className="flex size-10 items-center justify-center rounded-full bg-paper-2">
          <X className="size-5" />
        </button>
      </div>
      {r && r.summary.first && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <MiniStat label="Out" value={`${time(r.summary.first)}–${time(r.summary.last)}`} />
            <MiniStat label="Ridden" value={km(r.summary.km)} />
            <MiniStat label="Stopped" value={formatDuration(r.summary.stoppedSeconds)} amber={r.summary.stoppedSeconds > 0} />
          </div>
          <RouteTimeline route={r} compact />
        </>
      )}
      <div className="flex gap-2">
        <Link to={`/bags/${bagId}`} className={buttonClass("primary", "lg", "flex-1")}>
          Open bag
        </Link>
        {bag?.rider && (
          <Link to={`/riders/${bag.rider.id}`} className={buttonClass("secondary", "lg", "flex-1")}>
            Rider
          </Link>
        )}
      </div>
    </div>
  );
}
