// A report's heat map: where the ad was on screen, as a soft, see-through heat
// layer (one blue, light to dark) over the streets. Hands back a still image of itself for print
// (WebGL canvases don't print reliably).

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import type { ReportHex } from "@digilite/shared";
import { MapView, boundsOf, ensureLayer, setSource } from "@/components/map/MapView";

/** The central 94% of the cells, weighted by time, so one long trip doesn't shrink the busy area to a speck. */
function coreOf(hexes: ReportHex[]): [number, number][] {
  if (hexes.length < 12) return hexes.map((h) => [h.lng, h.lat]);
  const total = hexes.reduce((s, h) => s + h.seconds, 0);
  const q = (vals: { v: number; w: number }[], p: number) => {
    const sorted = [...vals].sort((a, b) => a.v - b.v);
    let acc = 0;
    for (const x of sorted) {
      acc += x.w;
      if (acc >= p * total) return x.v;
    }
    return sorted[sorted.length - 1].v;
  };
  const xs = hexes.map((h) => ({ v: h.lng, w: h.seconds }));
  const ys = hexes.map((h) => ({ v: h.lat, w: h.seconds }));
  return [
    [q(xs, 0.03), q(ys, 0.03)],
    [q(xs, 0.97), q(ys, 0.97)],
  ];
}

export function HeatMap({
  hexes,
  label,
  className,
  onSnapshot,
}: {
  hexes: ReportHex[];
  /** What the map shows, for screen readers */
  label: string;
  className?: string;
  onSnapshot?: (dataUrl: string) => void;
}) {
  const [map, setMap] = useState<MLMap | null>(null);
  const snapRef = useRef(onSnapshot);
  snapRef.current = onSnapshot;

  useEffect(() => {
    if (!map) return;
    // A smooth heat layer (time on screen, weighted to the 95th percentile so a few
    // very busy spots don't wash out the rest), see-through so the streets show.
    const sorted = hexes.map((h) => h.seconds).sort((a, b) => a - b);
    const p95 = Math.max(1, sorted[Math.floor(sorted.length * 0.95)] ?? 1);
    setSource(map, "heat", {
      type: "FeatureCollection",
      features: hexes.map((h) => ({
        type: "Feature",
        properties: { w: Math.min(1, h.seconds / p95) },
        geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      })),
    });
    ensureLayer(map, {
      id: "heat",
      type: "heatmap",
      source: "heat",
      paint: {
        "heatmap-weight": ["get", "w"],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 1.8, 14, 3.2],
        "heatmap-radius": ["interpolate", ["exponential", 2], ["zoom"], 10, 6, 12, 16, 14, 48],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0, "rgba(127,161,230,0)",
          0.08, "rgba(127,161,230,0.28)",
          0.3, "rgba(62,111,216,0.48)",
          0.6, "rgba(11,69,201,0.62)",
          1, "rgba(6,27,71,0.75)",
        ],
        "heatmap-opacity": 0.85,
      },
    });
    const b = boundsOf(coreOf(hexes));
    if (b) map.fitBounds(b, { padding: 26, duration: 0, maxZoom: 14.5 });

    if (!snapRef.current) return;
    let cancelled = false;
    map.once("idle", () => {
      if (cancelled) return;
      map.once("render", () => {
        try {
          snapRef.current?.(map.getCanvas().toDataURL("image/png"));
        } catch {
          /* the canvas can't be read — the live map prints instead */
        }
      });
      map.triggerRepaint();
    });
    return () => {
      cancelled = true;
    };
  }, [map, hexes]);

  return <MapView onReady={setMap} className={className} interactive={false} controls={false} ariaLabel={label} />;
}
