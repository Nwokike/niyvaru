import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { Feature } from "geojson";
import type { Poi, WalkRoute } from "./types";
import "maplibre-gl/dist/maplibre-gl.css";

const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const PLANET_PMTILES = "https://tiles.openfreemap.org/planet";

const KIND_COLORS: Record<string, string> = {
  hotel: "#7c5cff",
  pharmacy: "#00b894",
  shop: "#e8a33d",
  restaurant: "#e17055",
  cafe: "#b88a5b",
  mosque: "#0984e3",
  atm: "#6c5ce7",
  hospital: "#d63031",
  clinic: "#ff7675",
  supermarket: "#00cec9",
  bank: "#2d3436",
  police: "#0984e3",
  place_of_worship: "#0984e3",
  toilets: "#636e72",
  parking: "#636e72",
};

let protocolAdded = false;

export async function initMap(container: HTMLElement): Promise<maplibregl.Map> {
  if (!protocolAdded) {
    const protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    protocolAdded = true;
  }
  const styleRes = await fetch(STYLE_URL);
  const style = await styleRes.json();
  if (style.sources?.openmaptiles) {
    style.sources.openmaptiles.url = `pmtiles://${PLANET_PMTILES}`;
  }

  const map = new maplibregl.Map({
    container,
    style,
    center: [39.8262, 21.4225],
    zoom: 15.2,
    pitch: 35,
    bearing: -12,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
  map.on("load", () => {
    addPoiLayers(map);
    addRouteLayers(map);
  });
  return map;
}

function addPoiLayers(map: maplibregl.Map) {
  map.addSource("pois", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "pois-circle",
    type: "circle",
    source: "pois",
    paint: {
      "circle-radius": 6,
      "circle-color": [
        "match",
        ["get", "kind"],
        ...Object.entries(KIND_COLORS).flat(),
        "#636e72",
      ] as any,
      "circle-stroke-color": "#0b1020",
      "circle-stroke-width": 1.2,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "pois-label",
    type: "symbol",
    source: "pois",
    minzoom: 15.4,
    layout: {
      "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-font": ["Noto Sans Regular"],
    },
    paint: { "text-color": "#e6e8ef", "text-halo-color": "#0b1020", "text-halo-width": 1.2 },
  });
}

function addRouteLayers(map: maplibregl.Map) {
  map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "routes-line",
    type: "line",
    source: "routes",
    paint: {
      "line-color": "#4fd1c5",
      "line-width": 4,
      "line-opacity": 0.85,
    },
  });
}

function poiFeature(p: Poi): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    properties: { ...p.tags, kind: p.kind, name: p.name, name_en: p.name_en ?? p.name, poi_id: p.id },
  };
}

function routeFeature(r: WalkRoute): Feature {
  return {
    type: "Feature",
    geometry: r.geometry,
    properties: { route_id: r.id, name: r.name, wheelchair: r.wheelchair ? 1 : 0 },
  };
}

export function setPois(map: maplibregl.Map, pois: Poi[]) {
  const src = map.getSource("pois") as maplibregl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: pois.map(poiFeature) });
}

export function setRoutes(map: maplibregl.Map, routes: WalkRoute[]) {
  const src = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
  src?.setData({ type: "FeatureCollection", features: routes.map(routeFeature) });
}

export function focusPoi(map: maplibregl.Map, poi: Poi) {
  map.flyTo({ center: [poi.lon, poi.lat], zoom: 17, pitch: 60, duration: 900 });
  const el = document.createElement("div");
  el.style.cssText = "width:16px;height:16px;border-radius:50%;background:#4fd1c5;border:3px solid #0b1020";
  const marker = new maplibregl.Marker({ element: el }).setLngLat([poi.lon, poi.lat]).addTo(map);
  setTimeout(() => marker.remove(), 4000);
}

export function highlightKind(map: maplibregl.Map, kind: string | null) {
  const filter = kind ? ["match", ["get", "kind"], [kind], true, false] : true;
  map.setFilter("pois-circle", filter as maplibregl.FilterSpecification);
  map.setFilter("pois-label", filter as maplibregl.FilterSpecification);
}

export function showRoute(map: maplibregl.Map, route: WalkRoute | null) {
  const src = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
  if (!route) {
    src?.setData({ type: "FeatureCollection", features: [] });
    return;
  }
  src?.setData({ type: "FeatureCollection", features: [routeFeature(route)] });
  const coords = route.geometry.coordinates;
  if (coords.length > 1) {
    map.fitBounds(
      [coords[0], coords[coords.length - 1]],
      { padding: 80, duration: 800, pitch: 50 }
    );
  }
}

export function onPoiClick(map: maplibregl.Map, cb: (poi: Poi) => void, lookup: (id: string) => Poi | undefined) {
  map.on("click", "pois-circle", (e: any) => {
    const f = e.features?.[0];
    const id = f?.properties?.poi_id as string | undefined;
    if (!id) return;
    const poi = lookup(id);
    if (poi) cb(poi);
  });
  map.on("mouseenter", "pois-circle", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "pois-circle", () => (map.getCanvas().style.cursor = ""));
}
