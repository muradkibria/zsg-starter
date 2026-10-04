// The zones map: every zone, the one being edited, and a heat layer of where
// bags spent time. Everything is drawn with sources and layers; the only DOM
// markers are the few editing handles (a circle's centre and edge, or an
// outline's points).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Marker, type Map as MLMap, type MapMouseEvent } from "maplibre-gl";
import clsx from "clsx";
import { ringCentroid, type ZoneDto, type ZoneHeatResponse } from "@digilite/shared";
import { MapView, boundsOf, EMPTY, ensureLayer, setSource, setVisible } from "@/components/map/MapView";
import { drawZones, zoneFeatures } from "@/components/map/layers";
import { drawRing, edgePoint, insertPoint, midpoints, nudge, radiusTo, shapeOfZone, type Draft, type ShapeState } from "./draft";

const ACCENT = "#043DAE";
const NAVY = "#061b47";
const FONT = ["Noto Sans Bold"];

export interface ZonesMapProps {
  zones: ZoneDto[];
  /** Map label per zone id (name and hours) */
  labels: Map<string, string>;
  /** The selected zone, as edited so far */
  draft: Draft | null;
  draftLabel: string | null;
  /** The saved shape, drawn dashed while it's being changed */
  saved: ShapeState | null;
  editable: boolean;
  selectedVertex: number | null;
  heat: ZoneHeatResponse | null;
  showHeat: boolean;
  /** Fit the map to this outline whenever the key changes */
  fitTo: { key: string; ring: [number, number][] } | null;
  onReady?: (map: MLMap) => void;
  onSelectZone: (id: string) => void;
  onBeginChange: () => void;
  onShape: (next: ShapeState) => void;
  onSelectVertex: (i: number | null) => void;
  onRemoveVertex: (i: number) => void;
  className?: string;
  children?: ReactNode;
}

function padding() {
  return window.innerWidth < 768 ? { top: 80, bottom: 56, left: 24, right: 24 } : { top: 90, bottom: 64, left: 48, right: 64 };
}

// ── Handles ───────────────────────────────────────────────────────────────────
type HandleKind = "centre" | "edge" | "vertex";

function handleElement(kind: HandleKind, label: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "zone-handle";
  el.setAttribute("aria-label", label);
  Object.assign(el.style, {
    width: "44px",
    height: "44px",
    padding: "0",
    border: "0",
    background: "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: kind === "edge" ? "ew-resize" : "move",
    touchAction: "none",
  });
  const dot = document.createElement("span");
  Object.assign(dot.style, {
    display: "block",
    boxSizing: "border-box",
    borderRadius: "999px",
    boxShadow: "0 1px 4px rgba(16,24,43,.35)",
    pointerEvents: "none",
    transition: "width .1s, height .1s",
  });
  if (kind === "centre") Object.assign(dot.style, { width: "24px", height: "24px", background: ACCENT, border: "3px solid #fff" });
  else Object.assign(dot.style, { width: "16px", height: "16px", background: "#fff", border: `3px solid ${ACCENT}` });
  el.appendChild(dot);
  return el;
}

function styleVertex(el: HTMLElement, selected: boolean) {
  const dot = el.firstElementChild as HTMLElement | null;
  if (!dot) return;
  dot.style.background = selected ? ACCENT : "#fff";
  dot.style.borderColor = selected ? "#fff" : ACCENT;
  dot.style.width = dot.style.height = selected ? "22px" : "16px";
  el.setAttribute("aria-pressed", String(selected));
}

/** Where a zone's label goes: a circle's centre, or the middle of an outline. */
function labelPoint(sh: ShapeState): [number, number] | null {
  if (sh.kind === "circle") return sh.center;
  return sh.ring.length >= 3 ? ringCentroid(sh.ring) : null;
}

// ── Layers for the zone being edited ──────────────────────────────────────────
function renderDraft(map: MLMap, draft: Draft | null, label: string | null, saved: ShapeState | null) {
  const ring = draft ? drawRing(draft) : [];
  const shape: GeoJSON.Feature | null =
    ring.length >= 4
      ? { type: "Feature", properties: { label: label ?? "" }, geometry: { type: "Polygon", coordinates: [ring] } }
      : ring.length >= 2
        ? { type: "Feature", properties: { label: label ?? "" }, geometry: { type: "LineString", coordinates: ring } }
        : null;
  setSource(map, "zone-draft", { type: "FeatureCollection", features: shape ? [shape] : [] });
  // Labels come from a single point (a polygon's own label repeats on every map tile it crosses).
  const at = draft ? labelPoint(draft) : null;
  setSource(map, "zone-draft-label", {
    type: "FeatureCollection",
    features: at && label ? [{ type: "Feature", properties: { label }, geometry: { type: "Point", coordinates: at } }] : [],
  });
  setSource(map, "zone-draft-mid", {
    type: "FeatureCollection",
    features:
      draft?.kind === "polygon"
        ? midpoints(draft.ring).map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }))
        : [],
  });
  const savedRing = saved ? drawRing(saved) : [];
  setSource(
    map,
    "zone-saved",
    savedRing.length >= 4 ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [savedRing] } }] } : EMPTY,
  );
  ensureLayer(map, {
    id: "zd-saved",
    type: "line",
    source: "zone-saved",
    paint: { "line-color": "#5e6472", "line-width": 1.6, "line-dasharray": [2, 2], "line-opacity": 0.8 },
  });
  ensureLayer(map, { id: "zd-fill", type: "fill", source: "zone-draft", paint: { "fill-color": ACCENT, "fill-opacity": 0.13 } });
  ensureLayer(map, {
    id: "zd-casing",
    type: "line",
    source: "zone-draft",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 },
  });
  ensureLayer(map, {
    id: "zd-line",
    type: "line",
    source: "zone-draft",
    layout: { "line-join": "round", "line-cap": "round" },
    paint: { "line-color": ACCENT, "line-width": 2.6 },
  });
  ensureLayer(map, {
    id: "zd-mid",
    type: "circle",
    source: "zone-draft-mid",
    paint: { "circle-radius": 4.5, "circle-color": "#ffffff", "circle-stroke-color": ACCENT, "circle-stroke-width": 1.6, "circle-stroke-opacity": 0.7 },
  });
  ensureLayer(map, {
    id: "zd-label",
    type: "symbol",
    source: "zone-draft-label",
    // Sits just above the centre, clear of the centre handle.
    layout: {
      "text-field": ["get", "label"],
      "text-font": FONT,
      "text-size": 12.5,
      "symbol-placement": "point",
      "text-allow-overlap": true,
      "text-anchor": "bottom",
      "text-offset": [0, -1.6],
      "text-max-width": 20,
    },
    paint: { "text-color": NAVY, "text-halo-color": "#ffffff", "text-halo-width": 2.4 },
  });
}

export function ZonesMap(props: ZonesMapProps) {
  const [map, setMap] = useState<MLMap | null>(null);
  const ref = useRef(props);
  ref.current = props;
  const fittedAll = useRef(false);
  const lastFit = useRef<string | null>(null);
  const handles = useRef<{ centre: Marker | null; edge: Marker | null; vertices: Marker[] }>({ centre: null, edge: null, vertices: [] });
  const edgeAngle = useRef(0);
  const dragging = useRef(false);

  // Every other zone (the selected one is drawn by the editor layers).
  useEffect(() => {
    if (!map) return;
    const others = props.zones.filter((z) => z.id !== props.draft?.id);
    const labels = new Map(others.map((z) => [z.id, props.labels.get(z.id) ?? z.name]));
    drawZones(map, zoneFeatures(others, labels), true);
    setVisible(map, ["zones-label"], false);
    setSource(map, "zone-labels", {
      type: "FeatureCollection",
      features: others
        .filter((z) => z.active)
        .flatMap((z) => {
          const at = labelPoint(shapeOfZone(z));
          return at ? [{ type: "Feature" as const, properties: { label: labels.get(z.id) ?? z.name }, geometry: { type: "Point" as const, coordinates: at } }] : [];
        }),
    });
    ensureLayer(map, {
      id: "zone-labels",
      type: "symbol",
      source: "zone-labels",
      layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11.5, "text-max-width": 9 },
      paint: { "text-color": "#243458", "text-halo-color": "#ffffff", "text-halo-width": 2.2 },
    });
    const off = others.filter((z) => !z.active);
    setSource(map, "zones-off", zoneFeatures(off.map((z) => ({ ...z, active: true })), new Map(off.map((z) => [z.id, z.name]))));
    setSource(map, "zones-off-labels", {
      type: "FeatureCollection",
      features: off.flatMap((z) => {
        const at = labelPoint(shapeOfZone(z));
        return at ? [{ type: "Feature" as const, properties: { label: `${z.name}\nnot counted` }, geometry: { type: "Point" as const, coordinates: at } }] : [];
      }),
    });
    ensureLayer(map, {
      id: "zones-off-line",
      type: "line",
      source: "zones-off",
      paint: { "line-color": "#8e8778", "line-width": 1.4, "line-dasharray": [1, 2] },
    });
    ensureLayer(map, {
      id: "zones-off-label",
      type: "symbol",
      source: "zones-off-labels",
      layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11 },
      paint: { "text-color": "#8e8778", "text-halo-color": "#ffffff", "text-halo-width": 2 },
    });
  }, [map, props.zones, props.labels, props.draft?.id]);

  // Fit to all zones once.
  useEffect(() => {
    if (!map || fittedAll.current || !props.zones.length) return;
    const b = boundsOf(props.zones.flatMap((z) => drawRing(shapeOfZone(z))));
    if (b) map.fitBounds(b, { padding: padding(), duration: 0, maxZoom: 14 });
    fittedAll.current = true;
  }, [map, props.zones]);

  // Fit to the selected zone when the selection changes.
  useEffect(() => {
    if (!map || !props.fitTo || lastFit.current === props.fitTo.key) return;
    lastFit.current = props.fitTo.key;
    const b = boundsOf(props.fitTo.ring);
    if (b) map.fitBounds(b, { padding: padding(), maxZoom: 15, duration: 600 });
  }, [map, props.fitTo]);

  // The selected zone.
  useEffect(() => {
    if (map) renderDraft(map, props.draft, props.draftLabel, props.saved);
  }, [map, props.draft, props.draftLabel, props.saved]);

  // Where bags spent time.
  useEffect(() => {
    if (!map) return;
    const cells = props.heat?.cells ?? [];
    // Scale against the busiest 5% of cells, so one spot where bags wait
    // (a base, a charging point) doesn't wash everything else out.
    const ref = cells.length ? Math.max(1, cells[Math.floor(cells.length * 0.03)][2]) : 1;
    setSource(map, "zone-heat", {
      type: "FeatureCollection",
      features: cells.map(([lng, lat, s]) => ({
        type: "Feature",
        properties: { w: Math.min(1, s / ref) },
        geometry: { type: "Point", coordinates: [lng, lat] },
      })),
    });
    ensureLayer(
      map,
      {
        id: "zone-heat",
        type: "heatmap",
        source: "zone-heat",
        paint: {
          "heatmap-weight": ["get", "w"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 10, 0.8, 15, 1.4],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 7, 13, 16, 16, 42],
          "heatmap-opacity": 0.7,
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(62,111,216,0)",
            0.12,
            "rgba(62,111,216,0.22)",
            0.35,
            "rgba(62,111,216,0.42)",
            0.65,
            "rgba(4,61,174,0.6)",
            1,
            "rgba(6,27,71,0.78)",
          ],
        },
      },
      "zones-fill",
    );
    setVisible(map, ["zone-heat"], props.showHeat);
  }, [map, props.heat, props.showHeat]);

  // Clicks: pick a zone, or add a point to the outline being drawn.
  useEffect(() => {
    if (!map) return;
    const onClick = (e: MapMouseEvent) => {
      const p = ref.current;
      if ((e.originalEvent.target as Element | null)?.closest?.(".zone-handle")) return;
      if (p.editable && p.draft?.kind === "polygon") {
        p.onBeginChange();
        const { ring, index } = insertPoint(p.draft.ring, [e.lngLat.lng, e.lngLat.lat]);
        p.onShape({ ...p.draft, ring });
        p.onSelectVertex(index);
        return;
      }
      if (!map.getLayer("zones-fill")) return;
      const id = map.queryRenderedFeatures(e.point, { layers: ["zones-fill"] })[0]?.properties?.id as string | undefined;
      if (id) p.onSelectZone(id);
    };
    const onMove = (e: MapMouseEvent) => {
      const p = ref.current;
      if (p.editable && p.draft?.kind === "polygon") {
        map.getCanvas().style.cursor = "crosshair";
        return;
      }
      const hit = map.getLayer("zones-fill") && map.queryRenderedFeatures(e.point, { layers: ["zones-fill"] }).length > 0;
      map.getCanvas().style.cursor = hit ? "pointer" : "";
    };
    map.on("click", onClick);
    map.on("mousemove", onMove);
    return () => {
      map.off("click", onClick);
      map.off("mousemove", onMove);
    };
  }, [map]);

  // Editing handles.
  useEffect(() => {
    if (!map) return;
    const h = handles.current;
    const d = props.editable ? props.draft : null;

    if (d?.kind === "circle") {
      if (!h.centre) {
        const el = handleElement("centre", "Centre of the zone. Drag it, or use the arrow keys, to move the zone.");
        const m = new Marker({ element: el, draggable: true }).setLngLat(d.center).addTo(map);
        m.on("dragstart", () => {
          dragging.current = true;
          ref.current.onBeginChange();
        });
        m.on("drag", () => {
          const cur = ref.current.draft;
          const p = m.getLngLat();
          if (cur) ref.current.onShape({ ...cur, center: [p.lng, p.lat] });
        });
        m.on("dragend", () => setTimeout(() => (dragging.current = false), 0));
        el.addEventListener("keydown", (e) => {
          const cur = ref.current.draft;
          const next = cur ? nudge(cur.center, e.key, e.shiftKey ? 100 : 10) : null;
          if (!cur || !next) return;
          e.preventDefault();
          ref.current.onBeginChange();
          ref.current.onShape({ ...cur, center: next });
        });
        h.centre = m;
      }
      if (!h.edge) {
        const el = handleElement("edge", "Edge of the zone. Drag it, or use the arrow keys, to change the size.");
        const m = new Marker({ element: el, draggable: true }).setLngLat(edgePoint(d, edgeAngle.current)).addTo(map);
        m.on("dragstart", () => {
          dragging.current = true;
          ref.current.onBeginChange();
        });
        m.on("drag", () => {
          const cur = ref.current.draft;
          if (!cur) return;
          const p = m.getLngLat();
          const { radiusM, angle } = radiusTo(cur, [p.lng, p.lat]);
          edgeAngle.current = angle;
          ref.current.onShape({ ...cur, radiusM });
        });
        m.on("dragend", () => {
          setTimeout(() => (dragging.current = false), 0);
          const cur = ref.current.draft;
          if (cur) m.setLngLat(edgePoint(cur, edgeAngle.current));
        });
        el.addEventListener("keydown", (e) => {
          const cur = ref.current.draft;
          const step = e.shiftKey ? 100 : 10;
          const delta = e.key === "ArrowRight" || e.key === "ArrowUp" ? step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : 0;
          if (!cur || !delta) return;
          e.preventDefault();
          ref.current.onBeginChange();
          ref.current.onShape({ ...cur, radiusM: Math.min(5000, Math.max(50, cur.radiusM + delta)) });
        });
        h.edge = m;
      }
      h.centre.setLngLat(d.center);
      h.edge.setLngLat(edgePoint(d, edgeAngle.current));
    } else {
      h.centre?.remove();
      h.edge?.remove();
      h.centre = h.edge = null;
    }

    const ring = d?.kind === "polygon" ? d.ring : [];
    while (h.vertices.length > ring.length) h.vertices.pop()!.remove();
    while (h.vertices.length < ring.length) {
      const el = handleElement("vertex", "Point");
      const m = new Marker({ element: el, draggable: true }).setLngLat(ring[h.vertices.length]).addTo(map);
      const index = () => Number(el.dataset.index);
      m.on("dragstart", () => {
        dragging.current = true;
        ref.current.onBeginChange();
      });
      m.on("drag", () => {
        const cur = ref.current.draft;
        if (!cur) return;
        const p = m.getLngLat();
        const next = cur.ring.slice();
        next[index()] = [p.lng, p.lat];
        ref.current.onShape({ ...cur, ring: next });
      });
      m.on("dragend", () => {
        setTimeout(() => (dragging.current = false), 0);
        ref.current.onSelectVertex(index());
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!dragging.current) ref.current.onSelectVertex(index());
      });
      el.addEventListener("keydown", (e) => {
        const cur = ref.current.draft;
        if (!cur) return;
        const i = index();
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          ref.current.onRemoveVertex(i);
          return;
        }
        const next = nudge(cur.ring[i], e.key, e.shiftKey ? 100 : 10);
        if (!next) return;
        e.preventDefault();
        ref.current.onBeginChange();
        const r = cur.ring.slice();
        r[i] = next;
        ref.current.onShape({ ...cur, ring: r });
        ref.current.onSelectVertex(i);
      });
      h.vertices.push(m);
    }
    ring.forEach((p, i) => {
      const m = h.vertices[i];
      m.setLngLat(p);
      const el = m.getElement();
      el.dataset.index = String(i);
      el.setAttribute("aria-label", `Point ${i + 1} of ${ring.length}. Drag it or use the arrow keys to move it; Delete removes it.`);
      styleVertex(el, i === props.selectedVertex);
    });
  }, [map, props.draft, props.editable, props.selectedVertex]);

  // Remove the handles when the map goes away.
  useEffect(
    () => () => {
      const h = handles.current;
      h.centre?.remove();
      h.edge?.remove();
      h.vertices.forEach((m) => m.remove());
      h.centre = h.edge = null;
      h.vertices = [];
    },
    [],
  );

  return (
    <div className={clsx("relative overflow-hidden", props.className)}>
      <MapView
        onReady={(m) => {
          setMap(m);
          props.onReady?.(m);
        }}
        className="absolute inset-0"
        ariaLabel="Map of zones"
      />
      {props.children}
    </div>
  );
}
