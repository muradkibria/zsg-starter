// Reusable map. Creates one MapLibre map with the Ledger basemap and hands the
// instance to the parent once loaded. Use sources/layers for data (GPU), not
// DOM markers.

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike, type Map as MLMap, type StyleSpecification, type AddLayerObject } from "maplibre-gl";
import clsx from "clsx";
import { FALLBACK_STYLE, loadBasemap } from "./basemap";
import { addMapIcons } from "./icons";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

export const LONDON: [number, number] = [-0.085, 51.52];

export function MapView({
  onReady,
  className,
  center = LONDON,
  zoom = 12,
  bounds,
  interactive = true,
  controls = true,
  ariaLabel = "Map",
}: {
  onReady: (map: MLMap) => void;
  className?: string;
  center?: [number, number];
  zoom?: number;
  bounds?: LngLatBoundsLike | null;
  interactive?: boolean;
  controls?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  useEffect(() => {
    let map: MLMap | null = null;
    let cancelled = false;
    const create = (style: StyleSpecification) => {
      if (cancelled || !ref.current) return;
      const m = new MapLibreMap({
        container: ref.current,
        style,
        center,
        zoom,
        interactive,
        attributionControl: { compact: true },
        cooperativeGestures: false,
        fadeDuration: 150,
      });
      map = m;
      if (controls && interactive) m.addControl(new NavigationControl({ showCompass: false }), "bottom-right");
      if (bounds) m.fitBounds(bounds, { padding: 40, duration: 0 });
      m.on("load", () => {
        addMapIcons(m);
        readyRef.current(m);
      });
      m.on("error", (e) => {
        if (String(e.error?.message ?? "").includes("Failed to fetch")) setFailed(true);
      });
    };
    loadBasemap()
      .then(create)
      .catch(() => {
        setFailed(true);
        create(FALLBACK_STYLE);
      });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={clsx(!/\b(absolute|fixed)\b/.test(className ?? "") && "relative", className)}>
      {/* inline style: maplibre-gl.css sets .maplibregl-map { position: relative } outside Tailwind's layers */}
      <div ref={ref} style={{ position: "absolute", inset: 0 }} role="region" aria-label={ariaLabel} />
      {failed && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-xs text-muted shadow">
          Map tiles are slow to load — showing a simpler map
        </div>
      )}
    </div>
  );
}

/** Set (or create) a GeoJSON source. */
export function setSource(map: MLMap, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource(id) as GeoJSONSource | undefined;
  if (src) void src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

export function ensureLayer(map: MLMap, layer: AddLayerObject, before?: string) {
  if (!map.getLayer(layer.id)) map.addLayer(layer, before && map.getLayer(before) ? before : undefined);
}

export function setVisible(map: MLMap, ids: string[], visible: boolean) {
  for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
}

export const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function boundsOf(coords: [number, number][]): LngLatBoundsLike | null {
  if (!coords.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [
    [w, s],
    [e, n],
  ];
}
