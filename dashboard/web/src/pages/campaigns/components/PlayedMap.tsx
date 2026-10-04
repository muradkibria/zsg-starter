// "Where it played": the routes of the bags carrying a campaign, only for the
// hours they played it, on the most recent days with plays — with the zones.
// Can hand back a still image of itself for printing (WebGL canvases don't
// print reliably).

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import type { CampaignStats, ZoneTime } from "@digilite/shared";
import { useZones } from "@/lib/queries";
import { MapView, boundsOf, ensureLayer, setSource } from "@/components/map/MapView";
import { drawZones, zoneFeatures } from "@/components/map/layers";
import { screenHours } from "../format";

/** The central 96% of points, so one long trip doesn't shrink the busy area to a speck. */
function coreOf(coords: [number, number][]): [number, number][] {
  if (coords.length < 50) return coords;
  const xs = coords.map((c) => c[0]).sort((a, b) => a - b);
  const ys = coords.map((c) => c[1]).sort((a, b) => a - b);
  const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))];
  return [
    [q(xs, 0.02), q(ys, 0.02)],
    [q(xs, 0.98), q(ys, 0.98)],
  ];
}

export function PlayedMap({
  map: data,
  zones: zoneTimes,
  className,
  interactive = true,
  onSnapshot,
}: {
  map: CampaignStats["map"] | undefined;
  zones: ZoneTime[] | undefined;
  className?: string;
  interactive?: boolean;
  /** Called with a PNG data URL once the map has settled (for print). */
  onSnapshot?: (dataUrl: string) => void;
}) {
  const [map, setMap] = useState<MLMap | null>(null);
  const zones = useZones();
  const fitted = useRef<string | null>(null);
  const snapRef = useRef(onSnapshot);
  snapRef.current = onSnapshot;

  useEffect(() => {
    if (!map || !zones.data) return;
    const times = new Map((zoneTimes ?? []).map((z) => [z.zoneId, z.seconds]));
    const labels = new Map(zones.data.filter((z) => z.active).map((z) => [z.id, times.get(z.id) ? `${z.name} · ${screenHours(times.get(z.id)!)}` : z.name]));
    drawZones(map, zoneFeatures(zones.data, labels), true);

    const lines: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: (data?.lines ?? []).map((l) => ({
        type: "Feature",
        properties: { bag: l.bagName, day: l.day },
        geometry: { type: "MultiLineString", coordinates: l.coords },
      })),
    };
    setSource(map, "played", lines);
    ensureLayer(map, {
      id: "played-casing",
      type: "line",
      source: "played",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-opacity": 0.5, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 7] },
    });
    ensureLayer(map, {
      id: "played-line",
      type: "line",
      source: "played",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#061b47", "line-opacity": 0.42, "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.4, 15, 3.4] },
    });
    // Zone names stay readable above the routes.
    if (map.getLayer("zones-label")) map.moveLayer("zones-label");

    const coords = (data?.lines ?? []).flatMap((l) => l.coords.flat());
    const zoneCoords = zoneFeatures(zones.data).features.flatMap((f) => (f.geometry as GeoJSON.Polygon).coordinates[0] as [number, number][]);
    const b = boundsOf(coords.length ? coreOf(coords) : zoneCoords);
    const key = `${data?.days.join(",")}:${coords.length}`;
    if (b && fitted.current !== key) {
      map.fitBounds(b, { padding: 28, duration: 0, maxZoom: 14.5 });
      fitted.current = key;
    }

    if (snapRef.current) {
      let cancelled = false;
      map.once("idle", () => {
        if (cancelled) return;
        map.once("render", () => {
          try {
            snapRef.current?.(map.getCanvas().toDataURL("image/png"));
          } catch {
            /* the canvas can't be read (tiles without CORS) — the live map prints instead */
          }
        });
        map.triggerRepaint();
      });
      return () => {
        cancelled = true;
      };
    }
  }, [map, zones.data, data, zoneTimes]);

  return <MapView onReady={setMap} className={className} interactive={interactive} controls={interactive} ariaLabel="Map of where the campaign played" />;
}
