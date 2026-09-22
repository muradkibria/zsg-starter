import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Bare, chrome-free render of a single bag's GPS route for a single day.
// Rendered outside <AppLayout> (no sidebar/header) so it screenshots cleanly.
// A headless browser (server/screenshots/capture.ts) navigates here and waits
// on the `snapshot-ready` marker below before taking the screenshot — this
// avoids ever capturing a half-loaded map or an empty tile grid.
// ─────────────────────────────────────────────────────────────────────────────

interface RoutePoint {
  lat: number;
  lng: number;
  timestamp: string;
}

const ROUTE_COLOR = "#3b82f6";

function FitToRoute({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 15);
      return;
    }
    map.fitBounds(positions, { padding: [24, 24] });
  }, [map, positions]);
  return null;
}

export function RouteSnapshotView() {
  const { bagId, date } = useParams<{ bagId: string; date: string }>();
  const [tilesLoaded, setTilesLoaded] = useState(false);

  const startTime = `${date}T00:00:00`;
  const endTime = `${date}T23:59:59`;

  const routeQ = useQuery<RoutePoint[]>({
    queryKey: ["snapshot-route", bagId, date],
    queryFn: () =>
      api.get(`/bags/${bagId}/route?startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}`),
    enabled: !!bagId && !!date,
  });

  const positions = useMemo(
    () =>
      (routeQ.data ?? [])
        .filter((p) => typeof p.lat === "number" && typeof p.lng === "number")
        .map((p) => [p.lat, p.lng] as [number, number]),
    [routeQ.data]
  );

  const defaultCenter: [number, number] = positions[0] ?? [51.505, -0.09];
  // Gate mounting the map until the route query has resolved, so the initial
  // center/fitBounds is already correct — avoids a race where tiles for a
  // provisional view finish loading (firing `load`) before fitBounds pans to
  // the real route, which would let the screenshot fire on the wrong view.
  const dataReady = routeQ.isSuccess || routeQ.isError;
  const ready = dataReady && tilesLoaded;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff" }}>
      {dataReady && (
        <MapContainer
          center={defaultCenter}
          zoom={13}
          style={{ height: "100%", width: "100%" }}
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            className="map-tiles-google-mimic"
            eventHandlers={{ load: () => setTilesLoaded(true) }}
          />
          {positions.length >= 2 && (
            <Polyline positions={positions} pathOptions={{ color: ROUTE_COLOR, weight: 4, opacity: 0.9 }} />
          )}
          {positions.length > 0 && (
            <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: "#16a34a", fillColor: "#16a34a", fillOpacity: 1 }} />
          )}
          {positions.length > 0 && (
            <CircleMarker
              center={positions[positions.length - 1]}
              radius={6}
              pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 1 }}
            />
          )}
          <FitToRoute positions={positions} />
        </MapContainer>
      )}

      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          background: "rgba(255,255,255,0.9)",
          padding: "4px 8px",
          borderRadius: 4,
          fontSize: 12,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        Bag {bagId} · {date} · {positions.length} GPS points
        {positions.length === 0 && dataReady && " (no data for this day)"}
      </div>

      {/* Playwright waits on this before capturing — only present once data has
          resolved (success or error) and, if there's a route to draw, the map
          tiles have initialised. */}
      {ready && <div data-testid="snapshot-ready" style={{ display: "none" }} />}
    </div>
  );
}
