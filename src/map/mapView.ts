/**
 * Map facade — the Sete Colinas engine, Niyvaru edition.
 *
 * Positron base + role re-grade on style.load, our own fill-extrusion
 * buildings (hidden the default fill), terrain + hillshade from AWS
 * Terrarium, hour-driven palette applied per frame, city-bounded zoom
 * (like the reference site, zoom-out stays inside the assembled area).
 * Everything above talks to MapApi; nothing below knows about React.
 */
import * as maplibregl from "maplibre-gl";
import type { Map as MLMap, LngLatBoundsLike } from "maplibre-gl";
import { loadRegradedStyle, applyPalette, setLabelLanguage, type RegradedStyle } from "./style";
import { paletteAt } from "./palette";
import {
  addPlaceLayers,
  setPlaces,
  setKindFilter,
  addRouteLayers,
  showRoute,
  focusPlace,
  clearFocusMarker,
} from "./pois";
import { debugLog, debugTime } from "../debug";
import type { AreaMeta, AreaPack, Place, WalkRoute } from "../sources/types";

let protocolAdded = false;

export interface MapApi {
  map: MLMap;
  setPlaces(pack: AreaPack): void;
  focusPlace(place: Place, onMarkerClick?: () => void): void;
  clearFocus(): void;
  showRoute(route: WalkRoute | null, fit?: boolean): void;
  filterKinds(kinds: string[] | null): void;
  /** Continuous hour 0–24 — relights the whole city. */
  setHour(hour: number): void;
  labelLanguage(lang: string): void;
  onPlaceClick(cb: (place: Place) => void, lookup: (id: string) => Place | undefined): void;
  destroy(): void;
}

function deviceLowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 8;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  return coarsePointer && memoryGb < 6;
}

export async function initMap(
  container: HTMLElement,
  meta: AreaMeta,
  signal?: AbortSignal,
  initialHour = 18.5
): Promise<MapApi> {
  const done = debugTime("map", "initMap total");
  debugLog("map", "initMap start", { area: meta.id });
  const low = deviceLowPower();
  const width = container.clientWidth || window.innerWidth;
  const placeLimit = low ? 600 : 1200;

  void protocolAdded;

  debugLog("map", "constructing Map (positron + regrade)");
  // Use the returned object directly — setup() mutates its roles array on
  // style.load, so a copy would hold a stale empty reference forever.
  const regraded = await loadRegradedStyle(container, {
    maxPitch: 78,
    lowPower: low,
  });
  const map = regraded.map;
  const cleanup = (): void => {
    const globals = window as unknown as { __niyvaruMap?: MLMap; __niyvaruRegrade?: RegradedStyle };
    if (globals.__niyvaruMap === map) delete globals.__niyvaruMap;
    if (globals.__niyvaruRegrade === regraded) delete globals.__niyvaruRegrade;
    map.remove();
  };
  try {
    signal?.throwIfAborted();

    // City-bounded zoom — the tiles and pack cover this area only, so the
  // camera never wanders into the void. Bounds inflate ~40% beyond the pack.
  const dLat = (meta.radiusM * 1.9) / 111_320;
  const dLon = (meta.radiusM * 1.9) / (111_320 * Math.cos((meta.lat * Math.PI) / 180));
  const bounds: LngLatBoundsLike = [
    [meta.lon - dLon, meta.lat - dLat],
    [meta.lon + dLon, meta.lat + dLat],
  ];
  map.setMaxBounds(bounds);
  map.setMinZoom(11.5);
  map.jumpTo({
    center: [meta.lon, meta.lat],
    // zoom eases down on narrow screens, like the reference site
    zoom: Math.max(11.5, (meta.zoom ?? 15.2) + Math.max(-1.4, 0.75 * Math.log2(Math.max(320, width) / 1440))),
    pitch: 55,
    bearing: -15,
  });

  // Keep the latest source data so a fallback style replacement can restore
  // every custom layer instead of silently wiping the dossier map surface.
  let lastPlaces: Place[] = [];
  let lastRoute: WalkRoute | null = null;
  let activeKinds: string[] | null = null;
  let lastLang: string | null = null;
  let mountedEpoch = -1;
  let lastFocusedPlaceId: string | null = null;

  const restoreCustomLayers = (): void => {
    addPlaceLayers(map);
    addRouteLayers(map);
    setPlaces(map, lastPlaces, placeLimit);
    setKindFilter(map, activeKinds);
    if (lastRoute) showRoute(map, lastRoute, false);
    if (lastLang) setLabelLanguage(map, lastLang);
  };

  map.on("style.load", () => {
    if (mountedEpoch >= 0 && regraded.styleEpoch !== mountedEpoch) {
      mountedEpoch = regraded.styleEpoch;
      restoreCustomLayers();
    }
  });

  // style.load is the real readiness signal: MapLibre's `load` waits on every
  // DEM tile and can stall forever while the map itself is usable.
  await regraded.ready;
  done();
  debugLog("map", "style ready");
  signal?.throwIfAborted();

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: true }), "top-left");

  mountedEpoch = regraded.styleEpoch;
  restoreCustomLayers();

  // The hour follows the browser clock; the slider can override it at any time.
  let currentHour = initialHour;
  const paintNow = (hour: number): void => {
    currentHour = hour;
    applyPalette(regraded, hour);
  };
  paintNow(currentHour);

  let pendingHour: number | null = null;
  let raf = 0;
  const flush = (): void => {
    raf = 0;
    if (pendingHour != null) paintNow(pendingHour);
    pendingHour = null;
  };
  const setHour = (hour: number): void => {
    pendingHour = hour;
    if (!raf) raf = requestAnimationFrame(flush);
  };

  // Debug/testing handle — lets the browser tests inspect map state.
  (window as unknown as { __niyvaruMap?: MLMap }).__niyvaruMap = map;

  const api: MapApi = {
    map,
    setPlaces(pack: AreaPack) {
      lastPlaces = pack.places;
      setPlaces(map, pack.places, placeLimit);
    },
    focusPlace(place: Place, onMarkerClick?: () => void) {
      const el = focusPlace(map, place);
      if (onMarkerClick) {
        el.addEventListener("click", onMarkerClick);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") onMarkerClick();
        });
      }
      // First entry gets the long cinematic flight; repeat stepping stays quick.
      const focusZoom = Math.max(14.5, Math.min(16.8, 16.8 + Math.max(-1.6, 0.75 * Math.log2(Math.max(320, width) / 1440))));
      const repeat = lastFocusedPlaceId !== null;
      lastFocusedPlaceId = place.id;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        map.jumpTo({ center: [place.lon, place.lat], zoom: focusZoom, pitch: 60 });
        return;
      }
      map.stop();
      map.flyTo({
        center: [place.lon, place.lat],
        zoom: focusZoom,
        pitch: 60,
        duration: repeat ? 800 : 2600,
        curve: 1.25,
        essential: false,
      });
    },
    clearFocus() {
      clearFocusMarker();
    },
    showRoute(route: WalkRoute | null, fit = true) {
      lastRoute = route;
      showRoute(map, route, fit);
    },
    filterKinds(kinds: string[] | null) {
      activeKinds = kinds;
      setKindFilter(map, kinds);
    },
    setHour,
    labelLanguage(lang: string) {
      lastLang = lang;
      setLabelLanguage(map, lang);
    },
    onPlaceClick(cb, lookup) {
      map.on("click", "places-halo", (e) => {
        const id = e.features?.[0]?.properties?.poiId as string | undefined;
        const place = id ? lookup(id) : undefined;
        if (place) cb(place);
      });
      map.on("mouseenter", "places-halo", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "places-halo", () => (map.getCanvas().style.cursor = ""));
    },
    destroy() {
      clearFocusMarker();
      cancelAnimationFrame(raf);
      const globals = window as unknown as { __niyvaruMap?: MLMap; __niyvaruRegrade?: RegradedStyle };
      if (globals.__niyvaruMap === map) delete globals.__niyvaruMap;
      if (globals.__niyvaruRegrade === regraded) delete globals.__niyvaruRegrade;
      map.remove();
    },
  };
  return api;
  } catch (error) {
    cleanup();
    throw error;
  }
}

void protocolAdded;
