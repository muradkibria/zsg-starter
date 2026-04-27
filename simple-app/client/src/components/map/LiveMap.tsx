import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { BagLiveState } from "@/hooks/use-live-bags";
import { ZoneLayer } from "./ZoneLayer";

// Fix Leaflet default icon paths broken by Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const offlineIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [20, 33],
  iconAnchor: [10, 33],
  className: "grayscale opacity-60",
});

const ROUTE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#8b5cf6"];

export type MapMode = "live" | "route" | "heatmap";

// Component to locate the user
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

// Route layer — fetches GPS history per bag and draws polylines
function RouteLayer({ bags }: { bags: BagLiveState[] }) {
  const activeBags = bags.filter((b) => b.status === "active" && b.gps);

  return (
    <>
      {activeBags.map((bag, idx) => (
        <BagRoute key={bag.id} bag={bag} color={ROUTE_COLORS[idx % ROUTE_COLORS.length]} />
      ))}
    </>
  );
}

function BagRoute({ bag, color }: { bag: BagLiveState; color: string }) {
  const { data: points = [] } = useQuery<{ lat: number; lng: number; timestamp: string }[]>({
    queryKey: ["bag-route", bag.id],
    queryFn: () => api.get(`/bags/${bag.id}/route`),
    staleTime: 60_000,
  });

  const positions = points.map((p) => [p.lat, p.lng] as [number, number]);

  if (positions.length < 2) return null;

  return (
    <>
      <Polyline positions={positions} pathOptions={{ color, weight: 3, opacity: 0.75 }} />
      {bag.gps && (
        <Marker position={[bag.gps.lat, bag.gps.lng]}>
          <Popup>
            <span className="font-medium">{bag.name}</span>
            {bag.rider && <><br />{bag.rider.name}</>}
          </Popup>
        </Marker>
      )}
    </>
  );
}

// Heatmap layer — fetches all GPS points and renders dense transparent circles
function HeatmapLayer() {
  const { data: points = [] } = useQuery<{ lat: number; lng: number }[]>({
    queryKey: ["fleet-heatmap"],
    queryFn: () => api.get("/fleet/heatmap"),
    staleTime: 120_000,
  });

  // Sample every 5th point to keep DOM manageable (~400 circles from 2000 points)
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

interface LiveMapProps {
  bags: BagLiveState[];
  mode: MapMode;
  showZones?: boolean;
}

export function LiveMap({ bags, mode, showZones = true }: LiveMapProps) {
  const bagsWithGps = bags.filter((b) => b.gps != null);
  const defaultCenter: [number, number] =
    bagsWithGps.length > 0
      ? [bagsWithGps[0].gps!.lat, bagsWithGps[0].gps!.lng]
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
      {showZones && <ZoneLayer />}

      {mode === "live" && bags.map((bag) => {
        if (!bag.gps) return null;
        return (
          <Marker
            key={bag.id}
            position={[bag.gps.lat, bag.gps.lng]}
            icon={bag.status === "active" ? new L.Icon.Default() : offlineIcon}
          >
            <Popup>
              <div className="text-sm space-y-0.5 min-w-[140px]">
                <p className="font-medium">{bag.name}</p>
                {bag.rider && <p className="text-muted-foreground">Rider: {bag.rider.name}</p>}
                <p className="text-muted-foreground capitalize">Status: {bag.status}</p>
                {bag.gps.speed != null && (
                  <p className="text-muted-foreground">{bag.gps.speed.toFixed(1)} km/h</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Date(bag.gps.recorded_at).toLocaleTimeString()}
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}

      {mode === "route" && <RouteLayer bags={bags} />}
      {mode === "heatmap" && <HeatmapLayer />}
    </MapContainer>
  );
}
