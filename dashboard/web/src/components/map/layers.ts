// Shared map layers: zones, a bag's route (with stops and signal gaps), fleet bags.

import type { Map as MLMap } from "maplibre-gl";
import { circleRing, type LiveBag, type RouteResponse, type ZoneDto } from "@digilite/shared";
import { formatDuration } from "@digilite/shared";
import { shortName } from "@/lib/format";
import { EMPTY, ensureLayer, setSource, setVisible } from "./MapView";

const FONT = ["Noto Sans Bold"];

// ── Zones ─────────────────────────────────────────────────────────────────────
export function zoneFeatures(zones: ZoneDto[], labels?: Map<string, string>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const z of zones) {
    if (!z.active) continue;
    const ring =
      z.kind === "circle" && z.centerLat != null && z.centerLng != null && z.radiusM
        ? circleRing(z.centerLat, z.centerLng, z.radiusM)
        : z.polygon && z.polygon.length >= 3
          ? [...z.polygon, z.polygon[0]]
          : null;
    if (!ring) continue;
    const label = labels ? labels.get(z.id) : z.name;
    if (labels && !label) continue;
    features.push({ type: "Feature", properties: { id: z.id, label: label ?? z.name }, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  return { type: "FeatureCollection", features };
}

/** One label point per zone (a polygon's own labels repeat on every map tile when zoomed in). */
function zoneLabelPoints(data: GeoJSON.FeatureCollection): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const f of data.features) {
    if (f.geometry.type !== "Polygon") continue;
    const ring = f.geometry.coordinates[0].slice(0, -1);
    if (!ring.length) continue;
    const lng = ring.reduce((n, p) => n + p[0], 0) / ring.length;
    const lat = ring.reduce((n, p) => n + p[1], 0) / ring.length;
    features.push({ type: "Feature", properties: f.properties, geometry: { type: "Point", coordinates: [lng, lat] } });
  }
  return { type: "FeatureCollection", features };
}

export function drawZones(map: MLMap, data: GeoJSON.FeatureCollection, visible = true) {
  setSource(map, "zones", data);
  setSource(map, "zones-labels", zoneLabelPoints(data));
  ensureLayer(map, { id: "zones-fill", type: "fill", source: "zones", paint: { "fill-color": "#3e6fd8", "fill-opacity": 0.07 } });
  ensureLayer(map, {
    id: "zones-line",
    type: "line",
    source: "zones",
    paint: { "line-color": "#061b47", "line-opacity": 0.45, "line-width": 1.6, "line-dasharray": [3, 3] },
  });
  ensureLayer(map, {
    id: "zones-label",
    type: "symbol",
    source: "zones-labels",
    layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 11.5, "symbol-placement": "point", "text-allow-overlap": false },
    paint: { "text-color": "#243458", "text-halo-color": "#ffffff", "text-halo-width": 2.2 },
  });
  setVisible(map, ["zones-fill", "zones-line", "zones-label"], visible);
}

// ── A bag's route ─────────────────────────────────────────────────────────────
export function drawRoute(map: MLMap, route: RouteResponse | null | undefined) {
  const lines: GeoJSON.FeatureCollection = route
    ? { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: route.segments } }] }
    : EMPTY;
  const gaps: GeoJSON.FeatureCollection = route
    ? {
        type: "FeatureCollection",
        features: route.gaps.map((g) => ({ type: "Feature", properties: { mins: Math.round(g.seconds / 60) }, geometry: { type: "LineString", coordinates: [g.from, g.to] } })),
      }
    : EMPTY;
  const stops: GeoJSON.FeatureCollection = route
    ? {
        type: "FeatureCollection",
        features: route.stops.map((s) => ({
          type: "Feature",
          properties: { label: `${formatDuration(s.seconds)} stop` },
          geometry: { type: "Point", coordinates: [s.lng, s.lat] },
        })),
      }
    : EMPTY;
  const first = route?.segments[0]?.[0];
  const lastSeg = route?.segments[route.segments.length - 1];
  const last = lastSeg?.[lastSeg.length - 1];
  const ends: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      ...(first ? [{ type: "Feature" as const, properties: { icon: "start" }, geometry: { type: "Point" as const, coordinates: first } }] : []),
      ...(last ? [{ type: "Feature" as const, properties: { icon: "selected" }, geometry: { type: "Point" as const, coordinates: last } }] : []),
    ],
  };
  setSource(map, "route", lines);
  setSource(map, "route-gaps", gaps);
  setSource(map, "route-stops", stops);
  setSource(map, "route-ends", ends);
  ensureLayer(map, {
    id: "route-casing",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 16, 11] },
  });
  ensureLayer(map, {
    id: "route-line",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#061b47", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 2.6, 16, 6] },
  });
  ensureLayer(map, {
    id: "route-gaps",
    type: "line",
    source: "route-gaps",
    layout: { "line-cap": "round" },
    paint: { "line-color": "#8e8778", "line-width": 3, "line-dasharray": [0.5, 2.2] },
  });
  ensureLayer(map, {
    id: "route-stops",
    type: "symbol",
    source: "route-stops",
    layout: {
      "icon-image": "stop",
      "icon-allow-overlap": true,
      "text-field": ["get", "label"],
      "text-font": FONT,
      "text-size": 12,
      "text-offset": [0, 1.8],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: { "text-color": "#7a4300", "text-halo-color": "#ffffff", "text-halo-width": 2.2 },
  });
  ensureLayer(map, {
    id: "route-ends",
    type: "symbol",
    source: "route-ends",
    layout: { "icon-image": ["get", "icon"], "icon-allow-overlap": true },
  });
}

export function clearRoute(map: MLMap) {
  for (const id of ["route", "route-gaps", "route-stops", "route-ends"]) setSource(map, id, EMPTY);
}

export function routeCoords(route: RouteResponse | null | undefined): [number, number][] {
  return route ? route.segments.flat() : [];
}

// ── Fleet bags ────────────────────────────────────────────────────────────────
export function bagFeatures(bags: LiveBag[]): { points: GeoJSON.FeatureCollection; trails: GeoJSON.FeatureCollection } {
  const points: GeoJSON.Feature[] = [];
  const trails: GeoJSON.Feature[] = [];
  for (const b of bags) {
    if (!b.position) continue;
    // "On" but no fresh GPS fix: keep the marker, but faded and labelled honestly.
    const stale = b.status === "now" && (!b.lastGpsAt || Date.now() - Date.parse(b.lastGpsAt) > 10 * 60_000);
    points.push({
      type: "Feature",
      id: b.colorlightId,
      properties: {
        id: b.id,
        status: b.status,
        icon: `st-${b.status}`,
        label: b.status === "now" ? `${b.rider ? `${b.name} · ${shortName(b.rider.name)}` : b.name}${stale ? " · no GPS fix" : ""}` : "",
        sort: { now: 4, day: 3, idle: 2, gone: 1 }[b.status],
        opacity: stale ? 0.45 : 1,
      },
      geometry: { type: "Point", coordinates: [b.position.lng, b.position.lat] },
    });
    if (b.status === "now" && b.trail.length > 1) {
      trails.push({ type: "Feature", properties: { id: b.id }, geometry: { type: "LineString", coordinates: b.trail } });
    }
  }
  return { points: { type: "FeatureCollection", features: points }, trails: { type: "FeatureCollection", features: trails } };
}

export function drawBags(map: MLMap, bags: LiveBag[]) {
  const { points, trails } = bagFeatures(bags);
  setSource(map, "trails", trails);
  setSource(map, "bags", points);
  ensureLayer(map, {
    id: "trails",
    type: "line",
    source: "trails",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#1f8a55", "line-opacity": 0.55, "line-width": 3.5 },
  });
  ensureLayer(map, {
    id: "bags",
    type: "symbol",
    source: "bags",
    layout: {
      "icon-image": ["get", "icon"],
      "icon-allow-overlap": true,
      "symbol-sort-key": ["get", "sort"],
      "text-field": ["get", "label"],
      "text-font": FONT,
      "text-size": 12.5,
      "text-anchor": "left",
      "text-offset": [1.1, -0.9],
      "text-optional": true,
    },
    paint: {
      "text-color": "#10182b",
      "text-halo-color": "#ffffff",
      "text-halo-width": 2.4,
      "icon-opacity": ["get", "opacity"],
      "text-opacity": ["get", "opacity"],
    },
  });
}
