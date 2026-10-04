// Vector basemap (OpenFreeMap "Positron", OpenStreetMap data) recoloured to
// the Ledger palette: warm paper, white roads, soft blue water, green parks.

import type { StyleSpecification, LayerSpecification } from "maplibre-gl";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

export const MAP_COLORS = {
  bg: "#f1ede4",
  water: "#c6d6ea",
  waterLabel: "#6f86ab",
  park: "#dde6d2",
  building: "#e7e1d4",
  buildingLine: "#ddd6c7",
  minor: "#ffffff",
  majorCasing: "#e4ddcf",
  major: "#ffffff",
  motorwayCasing: "#dfd4c0",
  motorway: "#fff8ea",
  rail: "#d6cfbf",
  label: "#8e8778",
  labelStrong: "#5e6472",
  halo: "#f1ede4",
};

function paint(layer: LayerSpecification, props: Record<string, unknown>) {
  (layer as { paint?: Record<string, unknown> }).paint = { ...(layer as { paint?: Record<string, unknown> }).paint, ...props };
}
function hide(layer: LayerSpecification) {
  (layer as { layout?: Record<string, unknown> }).layout = { ...(layer as { layout?: Record<string, unknown> }).layout, visibility: "none" };
}

export function recolour(style: StyleSpecification): StyleSpecification {
  const C = MAP_COLORS;
  for (const layer of style.layers) {
    const id = layer.id;
    if (id === "background") paint(layer, { "background-color": C.bg });
    else if (id === "park") paint(layer, { "fill-color": C.park, "fill-opacity": 0.95 });
    else if (id === "landcover_wood") paint(layer, { "fill-color": C.park, "fill-opacity": 0.6 });
    else if (id === "water") paint(layer, { "fill-color": C.water });
    else if (id === "waterway") paint(layer, { "line-color": C.water });
    else if (id === "landuse_residential" || id.startsWith("landcover_ice") || id === "landcover_glacier") hide(layer);
    else if (id === "building") paint(layer, { "fill-color": C.building, "fill-outline-color": C.buildingLine, "fill-opacity": 0.8 });
    else if (id === "highway_minor" || id === "highway_path" || id === "road_pier") paint(layer, { "line-color": C.minor, "line-opacity": 1 });
    else if (id === "highway_major_casing") paint(layer, { "line-color": C.majorCasing });
    else if (id === "highway_major_inner" || id === "highway_major_subtle") paint(layer, { "line-color": C.major });
    else if (id.includes("motorway") && id.includes("casing")) paint(layer, { "line-color": C.motorwayCasing });
    else if (id.includes("motorway")) paint(layer, { "line-color": C.motorway });
    else if (id.startsWith("railway")) paint(layer, { "line-color": C.rail });
    else if (id.startsWith("boundary") || id.startsWith("aeroway") || id.startsWith("highway-shield") || id === "road_shield_us") hide(layer);
    else if (layer.type === "symbol") {
      const isWater = id.startsWith("water");
      paint(layer, {
        "text-color": isWater ? C.waterLabel : id.startsWith("label_city") ? C.labelStrong : C.label,
        "text-halo-color": C.halo,
        "text-halo-width": 1.4,
      });
    }
  }
  return style;
}

let cached: Promise<StyleSpecification> | null = null;

export function loadBasemap(): Promise<StyleSpecification> {
  cached ??= fetch(STYLE_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`Basemap unavailable (${r.status})`);
      return r.json() as Promise<StyleSpecification>;
    })
    .then(recolour)
    .catch((err) => {
      cached = null;
      throw err;
    });
  return cached;
}

/** Plain fallback if the vector tiles can't be reached. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": MAP_COLORS.bg } },
    { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.7, "raster-opacity": 0.85 } },
  ],
};
