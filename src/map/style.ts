/**
 * Style engine — the Sete Colinas architecture, faithfully applied to Niyvaru.
 *
 * Base style: OpenFreeMap Positron (minimal, flat). On style.load, every
 * basemap layer gets a role (land, park, water, road, major, rail, label)
 * and the colors for that role are pushed in whenever the hour changes.
 * Everything decorative (POIs, shields, borders, the default building fill)
 * is hidden — buildings come from our own fill-extrusion layer instead.
 * Minor labels are hidden; only water names, settlements and major road
 * names stay. If the street style fails, a bare background style with the
 * land color replaces it and the caller is told.
 */
import * as maplibregl from "maplibre-gl";
import type { MapOptions, Map as MaplibreMap, StyleSpecification } from "maplibre-gl";
import { debugLog, debugError } from "../debug";
import { endpoints } from "../config/endpoints";
import { paletteAt, type HourPalette } from "./palette";

type Role =
  | "land"
  | "landAlt"
  | "park"
  | "water"
  | "road"
  | "roadMajor"
  | "rail"
  | "label"
  | "halo";

interface RoleRef {
  id: string;
  prop: string;
  key: Role;
}

export interface RegradedStyle {
  map: MaplibreMap;
  roles: RoleRef[];
  lastHour: number | null;
  lowPower: boolean;
  /** Increments on every style load, including fallback replacements. */
  styleEpoch: number;
  /** Resolves on style.load — do not wait for MapLibre's `load`, which can
   *  stall indefinitely behind DEM tiles on slow connections. */
  ready: Promise<void>;
}

export type RegradeOptions = Partial<MapOptions> & { lowPower?: boolean };

const TERRAIN_SOURCE = "niyvaru-terrain-dem";
const HILLSHADE_SOURCE = "niyvaru-hillshade-dem";
const BUILDINGS_LAYER = "niyvaru-buildings";

export const TERRAIN_SOURCES = { terrain: TERRAIN_SOURCE, hillshade: HILLSHADE_SOURCE };

export async function loadRegradedStyle(
  container: HTMLElement,
  options?: RegradeOptions
): Promise<RegradedStyle> {
  debugLog("map", "constructing Map with positron URL — maplibre fetches the style itself");
  const { lowPower = false, ...mapOptions } = options ?? {};
  const map = new maplibregl.Map({
    container,
    style: endpoints.tiles.openFreeMapStyle,
    attributionControl: { compact: true, customAttribution: endpoints.tiles.attributionHtml },
    ...mapOptions,
  });
  let markReady: () => void = () => {};
  let fallbackApplied = false;
  const ready = new Promise<void>((resolve) => { markReady = resolve; });
  const regraded: RegradedStyle = { map, roles: [], lastHour: null, lowPower, styleEpoch: 0, ready };
  map.on("style.load", () => {
    debugLog("map", "style.load — classifying layers, adding terrain");
    regraded.styleEpoch += 1;
    setup(regraded);
    if (regraded.lastHour != null) applyPalette(regraded, regraded.lastHour);
    markReady();
  });
  (window as unknown as { __niyvaruRegrade?: RegradedStyle }).__niyvaruRegrade = regraded;
  map.on("error", (e: unknown) => {
    const message = String((e as { error?: { message?: string } })?.error?.message ?? "");
    // terrain/hillshade tile failures just go flat — never fatal
    if (message.includes("niyvaru-terrain") || message.includes("niyvaru-hillshade")) {
      debugLog("map", "dem tiles unavailable — going flat");
      map.setTerrain(null);
      return;
    }
    if (!fallbackApplied && (!map.isStyleLoaded() || (e as { sourceId?: string }).sourceId)) {
      fallbackApplied = true;
      debugError("map", "basemap error — falling back to bare terrain", message);
      map.setStyle({
        version: 8,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": paletteAt(regraded.lastHour ?? 13).land } }],
      });
    }
  });
  return regraded;
}

/** Role classification — verbatim Sete Colinas rules, on Positron layer ids. */
function setup(regraded: RegradedStyle): void {
  const map = regraded.map;
  const lowPower = regraded.lowPower;
  const style = map.getStyle();
  const vectorSource = Object.entries(style.sources ?? {}).find(([, s]) => (s as { type: string }).type === "vector")?.[0];

  regraded.roles = [];
  for (const layer of style.layers ?? []) {
    const id = layer.id;
    const hide = (): void => void map.setLayoutProperty(id, "visibility", "none");
    const push = (prop: string, key: Role): void => void regraded.roles.push({ id, prop, key });
    try {
      if (layer.type === "background") push("background-color", "land");
      else if (layer.type === "raster") hide();
      else if (layer.type === "fill") {
        if (id === "building") hide();
        else if (/water/.test(id)) push("fill-color", "water");
        else if (/park|wood|grass/.test(id)) push("fill-color", "park");
        else if (/pier/.test(id)) push("fill-color", "road");
        else if (/ice|glacier/.test(id)) hide();
        else push("fill-color", "landAlt");
      } else if (layer.type === "line") {
        if (/boundary|casing|dashline|aeroway/.test(id)) hide();
        else push("line-color", /waterway/.test(id) ? "water" : /railway/.test(id) ? "rail" : /major|motorway/.test(id) ? "roadMajor" : "road");
      } else if (layer.type === "symbol") {
        if (/water_name|label_city|label_town|label_village|label_other|highway-name/.test(id)) {
          push("text-color", "label");
          push("text-halo-color", "halo");
          map.setPaintProperty(id, "text-halo-width", 1.4 as never, { validate: false });
        } else hide();
      } else hide();
    } catch (e) {
      debugError("map", `classify failed on ${id}`, e);
    }
  }
  debugLog("map", `roles assigned: ${regraded.roles.length} of ${style.layers?.length ?? 0} layers painted`);

  // Our own extrusion — the default building fill was hidden above. Buildings
  // are the product's signature 3D; they stay on every device that can render
  // WebGL2. Only the DEM stack (terrain + hillshade) is quality-gated below.
  const firstLineId = style.layers?.find((l) => l.type === "line")?.id;
  if (vectorSource && !map.getLayer(BUILDINGS_LAYER)) {
    map.addLayer(
      {
        id: BUILDINGS_LAYER,
        type: "fill-extrusion",
        source: vectorSource,
        "source-layer": "building",
        minzoom: 13,
        filter: ["!=", ["get", "hide_3d"], true],
        paint: {
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 13.6, ["coalesce", ["get", "render_height"], 8]],
          "fill-extrusion-base": ["interpolate", ["linear"], ["zoom"], 13, 0, 13.6, ["coalesce", ["get", "render_min_height"], 0]],
          "fill-extrusion-opacity": 0.94,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      firstLineId
    );
  }

  // Low-power mobile devices keep the flat brand palette and skip the
  // expensive DEM work; the map is still readable and still has buildings.
  if (lowPower) {
    map.setTerrain(null);
    return;
  }

  // Terrain + hillshade: two sources of the same AWS Terrarium tiles
  // (MapLibre advises against sharing one source between both).
  if (!map.getSource(TERRAIN_SOURCE)) {
    map.addSource(TERRAIN_SOURCE, { type: "raster-dem", tiles: [endpoints.terrain.terrariumTiles], encoding: "terrarium", tileSize: 256, maxzoom: 14 });
  }
  if (!map.getSource(HILLSHADE_SOURCE)) {
    map.addSource(HILLSHADE_SOURCE, { type: "raster-dem", tiles: [endpoints.terrain.terrariumTiles], encoding: "terrarium", tileSize: 256, maxzoom: 14 });
  }
  if (!map.getLayer(HILLSHADE_SOURCE)) {
    map.addLayer(
      {
        id: HILLSHADE_SOURCE,
        type: "hillshade",
        source: HILLSHADE_SOURCE,
        paint: { "hillshade-exaggeration": 0.55, "hillshade-illumination-anchor": "map" },
      },
      firstLineId
    );
  }
  map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: endpoints.terrain.exaggeration });
}

function buildingColor(p: HourPalette): unknown {
  // low buildings stay quiet; tall ones read as lit towers at night
  return ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 8], 0, p.buildingLow, 18, p.buildingLow, 60, p.buildingHigh];
}

/** Push the palette into every role. Cheap — one pass of setPaintProperty. */
export function applyPalette(regraded: RegradedStyle, hour: number): void {
  const map = regraded.map;
  if (regraded.roles.length === 0) return;
  regraded.lastHour = hour;
  const p = paletteAt(hour);
  for (const role of regraded.roles) {
    try {
      map.setPaintProperty(role.id, role.prop as never, String(p[role.key]) as never, { validate: false });
    } catch {
      /* role layer removed — skip */
    }
  }
  if (map.getLayer(BUILDINGS_LAYER)) {
    try {
      map.setPaintProperty(BUILDINGS_LAYER, "fill-extrusion-color", buildingColor(p) as never, { validate: false });
    } catch {
      /* buildings layer removed — skip */
    }
  }
  if (map.getLayer(HILLSHADE_SOURCE)) {
    map.setPaintProperty(HILLSHADE_SOURCE, "hillshade-shadow-color", p.shade, { validate: false });
    map.setPaintProperty(HILLSHADE_SOURCE, "hillshade-highlight-color", p.highlight, { validate: false });
    map.setPaintProperty(HILLSHADE_SOURCE, "hillshade-accent-color", p.shade, { validate: false });
    map.setPaintProperty(HILLSHADE_SOURCE, "hillshade-illumination-direction", lightDirection(hour), { validate: false });
  }
  map.setSky(
    {
      "sky-color": p.sky,
      "horizon-color": p.horizon,
      "fog-color": p.fog,
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.5,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": 0,
    } as never,
    { validate: false }
  );
  map.setLight(
    { anchor: "map", color: p.light, intensity: p.lightIntensity, position: lightPosition(hour) } as never,
    { validate: false }
  );
  // the page around the map shares the land color, like the reference site
  map.getContainer().style.backgroundColor = p.land;
}

/** Light position [radial, azimuthal, polar] — rough sun path: east morning,
 * south midday, west evening, a high moon at night. */
function lightPosition(hour: number): [number, number, number] {
  const wrapped = ((hour % 24) + 24) % 24;
  const azimuth = wrapped * 15 - 90; // ~east at 6, south at 13, west at 20
  const polar = wrapped < 6 || wrapped > 21 ? 55 : Math.max(20, 80 - Math.abs(wrapped - 13) * 8);
  return [1.15, azimuth, polar];
}

function lightDirection(hour: number): number {
  return ((hour % 24) * 15 - 90 + 360) % 360;
}

/** Label language switch with a graceful fallback chain. */
export function setLabelLanguage(map: MaplibreMap, lang: string): void {
  if (!map.isStyleLoaded()) return;
  const field =
    lang === "ar"
      ? ["coalesce", ["get", "name:ar"], ["get", "name:latin"], ["get", "name"]]
      : ["coalesce", ["get", "name:latin"], ["get", "name"]];
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol" || layer.id === "places-label") continue;
    try {
      map.setLayoutProperty(layer.id, "text-field", field as never);
    } catch {
      /* skip layers without text-field */
    }
  }
}
