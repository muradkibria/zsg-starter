import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BagLiveState } from "@/hooks/use-live-bags";
import { ZoneLayer } from "./ZoneLayer";
import { applyBagFilter } from "./BagFilter";
import type { TimeRange } from "./TimeRangePicker";

function isoNoTz(ms: number): string {
  // ISO without 'Z' — Colorlight wants seconds-precision UTC strings
  return new Date(ms).toISOString().slice(0, 19);
}

// ── Custom markers ───────────────────────────────────────────────────────────

// Default leaflet icon paths (used by some popups)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const ACTIVE_COLOR = "#22c55e"; // green
const OFFLINE_COLOR = "#9ca3af"; // gray

function buildIcon(color: string, opacity: number, pulse: boolean) {
  const html = `
    <div style="position: relative; width: 24px; height: 24px;">
      ${pulse ? `<div style="
        position: absolute; inset: -6px;
        border-radius: 50%;
        background: ${color};
        opacity: 0.25;
        animation: pulse 1.6s ease-out infinite;
      "></div>` : ""}
      <div style="
        position: relative;
        width: 24px; height: 24px;
        background: ${color};
        opacity: ${opacity};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 1px 4px rgba(0,0,0,0.35);
      "></div>
    </div>
    <style>
      @keyframes pulse {
        0%   { transform: scale(0.8); opacity: 0.45; }
        100% { transform: scale(2.2); opacity: 0; }
      }
    </style>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

const activeIcon = buildIcon(ACTIVE_COLOR, 1, true);
const offlineIcon = buildIcon(OFFLINE_COLOR, 0.85, false);

// ── Route colours (cycled per active bag in route mode) ──────────────────────

const ROUTE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16", "#f43f5e"];

export type MapMode = "live" | "route" | "heatmap";

// ── User location button ─────────────────────────────────────────────────────

function LocateMe() {
  const map = useMap();
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    map.locate({ setView: true, maxZoom: 15 });
    const onLocation = (e: L.LocationEvent) => {
      L.circle(e.latlng, { radius: e.accuracy, color: "#3b82f6", fillOpacity: 0.15 }).addTo(map);
      L.circleMarker(e.latlng, { radius: 8, color: "#3b82f6", fillColor: "#3b82f6", fillOpacity: 1 })
        .bindPopup("Your location")
        .addTo(map)
        .openPopup();
      setActive(false);
    };
    map.on("locationfound", onLocation);
    return () => { map.off("locationfound", onLocation); };
  }, [active, map]);

  return (
    <div className="leaflet-top leaflet-right" style={{ marginTop: 10, marginRight: 10 }}>
      <div className="leaflet-control">
        <button
          onClick={() => setActive(true)}
          title="Show my location"
          style={{
            background: "#fff",
            border: "2px solid rgba(0,0,0,0.2)",
            borderRadius: 4,
            width: 30,
            height: 30,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
          }}
        >
          ⊕
        </button>
      </div>
    </div>
  );
}

// ── Status legend (bottom-left, away from zoom controls) ─────────────────────

function Legend({ activeCount, offlineCount }: { activeCount: number; offlineCount: number }) {
  return (
    <div
      className="leaflet-bottom leaflet-left"
      style={{ marginBottom: 22, marginLeft: 10, pointerEvents: "auto" }}
    >
      <div
        className="leaflet-control"
        style={{
          background: "white",
          padding: "6px 10px",
          borderRadius: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
          fontSize: 11,
          fontFamily: "system-ui, sans-serif",
          minWidth: 110,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{
            display: "inline-block", width: 9, height: 9,
            borderRadius: "50%", background: ACTIVE_COLOR, border: "1.5px solid white",
            boxShadow: "0 0 0 1px " + ACTIVE_COLOR,
          }} />
          <span><strong>{activeCount}</strong> active</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            display: "inline-block", width: 9, height: 9,
            borderRadius: "50%", background: OFFLINE_COLOR, border: "1.5px solid white",
            opacity: 0.85,
          }} />
          <span><strong>{offlineCount}</strong> offline</span>
        </div>
      </div>
    </div>
  );
}

// ── Bag marker (live mode) ───────────────────────────────────────────────────

function BagMarker({ bag }: { bag: BagLiveState }) {
  if (!bag.gps) return null;
  const isActive = bag.status === "active";
  return (
    <Marker
      position={[bag.gps.lat, bag.gps.lng]}
      icon={isActive ? activeIcon : offlineIcon}
    >
      <Popup>
        <div className="text-sm space-y-0.5 min-w-[160px]">
          <p className="font-medium">{bag.name}</p>
          <p
            className="text-xs"
            style={{ color: isActive ? "#15803d" : "#6b7280", fontWeight: 600 }}
          >
            {isActive ? "● Active now" : "○ Offline"}
          </p>
          {bag.rider && <p className="text-muted-foreground">Rider: {bag.rider.name}</p>}
          {bag.gps.speed != null && (
            <p className="text-muted-foreground">Speed: {bag.gps.speed.toFixed(1)} km/h</p>
          )}
          <p className="text-xs text-muted-foreground">
            {isActive ? "Last update: " : "Last seen: "}
            {new Date(bag.gps.recorded_at).toLocaleString()}
          </p>
        </div>
      </Popup>
    </Marker>
  );
}

// ── Route layer ──────────────────────────────────────────────────────────────

function RouteLayer({ bags, timeRange }: { bags: BagLiveState[]; timeRange: TimeRange }) {
  // Show routes for ALL bags with a known position (active or offline) — useful
  // for seeing where someone went today even if they're now offline.
  const eligible = bags.filter((b) => b.gps);

  return (
    <>
      {eligible.map((bag, idx) => (
        <BagRoute key={bag.id} bag={bag} color={ROUTE_COLORS[idx % ROUTE_COLORS.length]} timeRange={timeRange} />
      ))}
    </>
  );
}

function BagRoute({ bag, color, timeRange }: { bag: BagLiveState; color: string; timeRange: TimeRange }) {
  const startStr = isoNoTz(timeRange.startMs);
  const endStr = isoNoTz(timeRange.endMs);
  const { data: points = [] } = useQuery<{ lat: number; lng: number; timestamp: string }[]>({
    queryKey: ["bag-route", bag.id, startStr, endStr],
    queryFn: () =>
      api.get(`/bags/${bag.id}/route?startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`),
    staleTime: 60_000,
  });

  const positions = points
    .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
    .map((p) => [p.lat, p.lng] as [number, number]);

  if (positions.length < 2) return null;

  const isActive = bag.status === "active";

  return (
    <>
      <Polyline
        positions={positions}
        pathOptions={{ color, weight: 3, opacity: isActive ? 0.85 : 0.5, dashArray: isActive ? undefined : "6 6" }}
      />
      {bag.gps && (
        <Marker
          position={[bag.gps.lat, bag.gps.lng]}
          icon={isActive ? activeIcon : offlineIcon}
        >
          <Popup>
            <span className="font-medium">{bag.name}</span>
            <br />
            <span className="text-xs">{positions.length} GPS points · last 24h</span>
          </Popup>
        </Marker>
      )}
    </>
  );
}

// ── Heatmap layer ────────────────────────────────────────────────────────────

// Fleet-wide heatmap (server-aggregated cell density)
function FleetHeatmap({ timeRange }: { timeRange: TimeRange }) {
  const startStr = isoNoTz(timeRange.startMs);
  const endStr = isoNoTz(timeRange.endMs);
  const { data: points = [] } = useQuery<{ lat: number; lng: number }[]>({
    queryKey: ["fleet-heatmap", startStr, endStr],
    queryFn: () =>
      api.get(`/fleet/heatmap?startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`),
    staleTime: 120_000,
  });

  const sampled = points.filter((_, i) => i % 5 === 0);

  return (
    <>
      {sampled.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={8}
          pathOptions={{ color: "#f97316", fillColor: "#f97316", fillOpacity: 0.18, weight: 0 }}
        />
      ))}
    </>
  );
}

// Per-bag heatmap built from each selected bag's track (used when filtered)
function FilteredHeatmap({ bags, timeRange }: { bags: BagLiveState[]; timeRange: TimeRange }) {
  const startStr = isoNoTz(timeRange.startMs);
  const endStr = isoNoTz(timeRange.endMs);
  const queries = useQueries({
    queries: bags.map((bag) => ({
      queryKey: ["bag-route", bag.id, startStr, endStr],
      queryFn: () =>
        api.get<{ lat: number; lng: number; timestamp: string }[]>(
          `/bags/${bag.id}/route?startTime=${encodeURIComponent(startStr)}&endTime=${encodeURIComponent(endStr)}`
        ),
      staleTime: 60_000,
    })),
  });

  const allPoints = queries.flatMap((q) => q.data ?? []);
  // Sample to keep DOM manageable; 1 in every 3 points still gives a strong density signal
  const sampled = allPoints.filter((_, i) => i % 3 === 0);

  return (
    <>
      {sampled.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={6}
          pathOptions={{ color: "#f97316", fillColor: "#f97316", fillOpacity: 0.22, weight: 0 }}
        />
      ))}
    </>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

interface LiveMapProps {
  bags: BagLiveState[];
  mode: MapMode;
  showZones?: boolean;
  /**
   * Optional bag selection. Passed down from the filter dropdown.
   * - empty Set     → no filter (show all)
   * - has "__none__" → show none
   * - otherwise      → only those IDs
   */
  selectedBagIds?: Set<string>;
  /**
   * Time window for Route and Heatmap modes. Live mode ignores this.
   * If omitted, the server's default 24h window is used.
   */
  timeRange?: TimeRange;
}

export function LiveMap({ bags, mode, showZones = true, selectedBagIds, timeRange }: LiveMapProps) {
  const filterSet = selectedBagIds ?? new Set<string>();
  const visibleBags = applyBagFilter(bags, filterSet);

  const isFiltered =
    filterSet.size > 0 && (filterSet.has("__none__") || filterSet.size < bags.length);

  const bagsWithGps = visibleBags.filter((b) => b.gps != null);
  const activeCount = visibleBags.filter((b) => b.status === "active" && b.gps).length;
  const offlineCount = visibleBags.filter((b) => b.status !== "active" && b.gps).length;

  const defaultCenter: [number, number] =
    bagsWithGps.length > 0
      ? [bagsWithGps[0].gps!.lat, bagsWithGps[0].gps!.lng]
      : bags.find((b) => b.gps)?.gps
        ? [bags.find((b) => b.gps)!.gps!.lat, bags.find((b) => b.gps)!.gps!.lng]
        : [51.505, -0.09];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={13}
      className="h-full w-full z-0"
      style={{ minHeight: 400 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <LocateMe />
      {(mode === "live" || mode === "route") && (
        <Legend activeCount={activeCount} offlineCount={offlineCount} />
      )}
      {showZones && <ZoneLayer />}

      {mode === "live" && visibleBags.map((bag) => <BagMarker key={bag.id} bag={bag} />)}

      {mode === "route" && timeRange && <RouteLayer bags={visibleBags} timeRange={timeRange} />}

      {mode === "heatmap" && timeRange && (
        isFiltered
          ? <FilteredHeatmap bags={bagsWithGps} timeRange={timeRange} />
          : <FleetHeatmap timeRange={timeRange} />
      )}
    </MapContainer>
  );
}
