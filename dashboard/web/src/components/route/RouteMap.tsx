// A self-contained map of one route (bag page, rider page, exports, reports).

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap } from "maplibre-gl";
import type { RouteResponse } from "@digilite/shared";
import { useZones } from "@/lib/queries";
import { MapView, boundsOf } from "../map/MapView";
import { drawRoute, drawZones, routeCoords, zoneFeatures } from "../map/layers";
import { useReplayOnMap, type Replay } from "./useReplay";

export function RouteMap({
  route,
  className,
  showZones = true,
  interactive = true,
  extraLines,
  replay,
}: {
  route: RouteResponse | null | undefined;
  className?: string;
  showZones?: boolean;
  interactive?: boolean;
  /** Extra faint lines (e.g. other days) as [lng, lat][][] */
  extraLines?: [number, number][][];
  /** Draw this replay of `route` (from useReplay), following the bag while it plays */
  replay?: Replay;
}) {
  const [map, setMap] = useState<MLMap | null>(null);
  const zones = useZones();
  const fitted = useRef<string | null>(null);

  useEffect(() => {
    if (!map) return;
    if (extraLines) {
      const src = map.getSource("extra") as GeoJSONSource | undefined;
      const data: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: extraLines } }],
      };
      if (src) void src.setData(data);
      else {
        map.addSource("extra", { type: "geojson", data });
        map.addLayer({ id: "extra", type: "line", source: "extra", paint: { "line-color": "#061b47", "line-opacity": 0.16, "line-width": 2.2 } });
      }
    }
    const passed = new Map((route?.zones ?? []).map((z) => [z.zoneId, `${z.name} · ${Math.round(z.seconds / 60)} min`]));
    if (zones.data && showZones) drawZones(map, zoneFeatures(zones.data, extraLines ? undefined : passed), true);
    drawRoute(map, route);
    const coords = [...routeCoords(route), ...(extraLines?.flat() ?? [])];
    const key = `${route?.bagId}:${route?.from}:${coords.length}`;
    const b = boundsOf(coords);
    if (b && fitted.current !== key) {
      map.fitBounds(b, { padding: 36, duration: fitted.current ? 600 : 0, maxZoom: 15 });
      fitted.current = key;
    }
  }, [map, route, zones.data, showZones, extraLines]);

  useReplayOnMap(map, replay, () => ({ top: 24, bottom: 24, left: 24, right: 24 }));

  return <MapView onReady={setMap} className={className} interactive={interactive} ariaLabel="Route map" />;
}
