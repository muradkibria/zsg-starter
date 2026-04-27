import { Circle, Polygon, Popup } from "react-leaflet";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

interface Zone {
  id: string;
  name: string;
  type: "radius" | "polygon";
  centerLat: number | null;
  centerLng: number | null;
  radiusMeters: number | null;
  polygonGeojson: { coordinates: [number, number][][] } | null;
}

export function ZoneLayer() {
  const { data: zones = [] } = useQuery<Zone[]>({
    queryKey: ["zones"],
    queryFn: () => api.get<Zone[]>("/zones"),
  });

  return (
    <>
      {zones.map((zone) => {
        if (zone.type === "radius" && zone.centerLat != null && zone.centerLng != null && zone.radiusMeters) {
          return (
            <Circle
              key={zone.id}
              center={[zone.centerLat, zone.centerLng]}
              radius={zone.radiusMeters}
              pathOptions={{ color: "#6366f1", fillOpacity: 0.12, weight: 1.5 }}
            >
              <Popup>{zone.name}</Popup>
            </Circle>
          );
        }

        if (zone.type === "polygon" && zone.polygonGeojson?.coordinates?.[0]) {
          const positions = zone.polygonGeojson.coordinates[0].map(
            ([lng, lat]) => [lat, lng] as [number, number]
          );
          return (
            <Polygon
              key={zone.id}
              positions={positions}
              pathOptions={{ color: "#f59e0b", fillOpacity: 0.12, weight: 1.5 }}
            >
              <Popup>{zone.name}</Popup>
            </Polygon>
          );
        }

        return null;
      })}
    </>
  );
}
