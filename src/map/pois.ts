/**
 * Place layers — the assembled area's real places on the map, kind-coloured
 * from brand tokens, filterable, with a brand DOM marker for the focused
 * place (DOM keeps the focused element accessible; the cloud stays on GPU).
 */
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, FilterSpecification } from "maplibre-gl";
import type { Feature } from "geojson";
import { KIND_COLORS, KIND_FALLBACK_COLOR } from "../brand/tokens";
import type { Place, WalkRoute } from "../sources/types";

const KIND_MATCH = [
  "match",
  ["get", "kind"],
  ...Object.entries(KIND_COLORS).flat(),
  KIND_FALLBACK_COLOR,
] as unknown as string;

const PIN_SVG = `<svg viewBox="0 0 24 32" width="24" height="32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0Z" fill="#96682f"/>
  <path d="M7 17c0-4 2.2-7 5-7s5 3 5 7h-3.2c0-2.3-1-4-1.8-4s-1.8 1.7-1.8 4H7Z" fill="#fbf7f1"/>
</svg>`;

function placeFeature(place: Place): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [place.lon, place.lat] },
    properties: {
      poiId: place.id,
      kind: place.kind,
      name: place.name,
      nameEn: place.nameEn ?? place.name,
      photoCount: place.photos.length,
      hasStory: place.story ? 1 : 0,
    },
  };
}

export function addPlaceLayers(map: MLMap): void {
  map.addSource("places", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "places-halo",
    type: "circle",
    source: "places",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 5, 16, 9, 18, 13],
      "circle-color": KIND_MATCH as never,
      "circle-stroke-color": "#fbf7f1",
      "circle-stroke-width": 1.4,
      "circle-opacity": 0.94,
      "circle-pitch-scale": "map",
    },
    minzoom: 12.5,
  });
  map.addLayer({
    id: "places-label",
    type: "symbol",
    source: "places",
    minzoom: 16,
    layout: {
      "text-field": ["coalesce", ["get", "nameEn"], ["get", "name"]],
      "text-size": 11,
      "text-offset": [0, 1.15],
      "text-font": ["Noto Sans Regular"],
      "text-variable-anchor": ["top"],
      "text-radial-offset": 0.4,
    },
    paint: { "text-color": "#191512", "text-halo-color": "#fbf7f1", "text-halo-width": 1.4 },
  });
}

export function setPlaces(map: MLMap, places: Place[]): void {
  const source = map.getSource("places") as maplibregl.GeoJSONSource | undefined;
  source?.setData({
    type: "FeatureCollection",
    features: places.map(placeFeature),
  });
}

export function setKindFilter(map: MLMap, kinds: string[] | null): void {
  const filter: FilterSpecification | null =
    kinds && kinds.length ? ["in", ["get", "kind"], ["literal", kinds]] : null;
  for (const id of ["places-halo", "places-label"]) {
    try {
      map.setFilter(id, filter);
    } catch {
      /* not ready yet */
    }
  }
}

export function addRouteLayers(map: MLMap): void {
  // lineMetrics enables line-gradient along the walked distance
  map.addSource("route", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    lineMetrics: true,
  } as never);
  map.addLayer({
    id: "route-glow",
    type: "line",
    source: "route",
    paint: {
      "line-color": "#96682f",
      "line-width": 11,
      "line-opacity": 0.2,
      "line-blur": 4,
      "line-layer-blend": "plus-lighter",
    } as never,
    layout: { "line-cap": "round", "line-join": "round" },
  });
  map.addLayer({
    id: "route-core",
    type: "line",
    source: "route",
    paint: {
      // the route warms as you walk it — start sand, finish bronze
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        "#c39a5e",
        1,
        "#96682f",
      ],
      "line-width": ["interpolate", ["linear"], ["zoom"], 12, 2.5, 16, 4.5],
      "line-opacity": 0.96,
    } as never,
    layout: { "line-cap": "round", "line-join": "round" },
  });
}

export function showRoute(map: MLMap, route: WalkRoute | null, fit = true): void {
  const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  if (!route) {
    source.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: route.coordinates },
        properties: { routeId: route.id, name: route.name },
      },
    ],
  });
  if (fit && route.coordinates.length > 1) {
    const lons = route.coordinates.map((c) => c[0]);
    const lats = route.coordinates.map((c) => c[1]);
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)],
      ],
      { padding: { top: 80, bottom: 340, left: 80, right: 400 }, duration: 900, pitch: 45, maxZoom: 17 }
    );
  }
}

// ---------- focused-place marker (real DOM, keyboard reachable) ----------

let marker: maplibregl.Marker | null = null;

/** The focused place gets the brand arch pin as a real, keyboard-reachable DOM element. */
export function focusPlace(map: MLMap, place: Place): HTMLElement {
  if (marker) marker.remove();
  const el = document.createElement("div");
  el.className = "poi-marker";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", place.name);
  el.innerHTML = PIN_SVG;
  marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([place.lon, place.lat])
    .addTo(map);
  return el;
}

export function clearFocusMarker(): void {
  marker?.remove();
  marker = null;
}
