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
  showUserLocation,
  clearUserLocation,
} from "./pois";
import { debugLog, debugTime } from "../debug";
import type { AreaMeta, AreaPack, Place, WalkRoute } from "../sources/types";

/** The cinematic view the app opens with; the compass toggles back to it. */
const SHOWCASE = { pitch: 55, bearing: -15 };

const COMPASS_SVG = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <circle cx="12" cy="12" r="9" fill="none" stroke="#96682f" stroke-width="1.6"/>
  <path d="M12 5.5 15 15l-3-2.2L9 15Z" fill="#96682f"/>
</svg>`;

/**
 * Two-state orientation control. Stock MapLibre compasses only reset to
 * north-up and flatten the map, after which the app's 3D view is lost.
 * This one toggles: showcase view ⇄ north-up, both recoverable.
 */
class OrientationControl implements maplibregl.IControl {
  private map?: MLMap;
  private button?: HTMLButtonElement;
  private readonly onClick = (): void => this.toggle();
  private readonly sync = (): void => this.syncState();

  constructor(
    private readonly showcase: { pitch: number; bearing: number },
    private readonly label = "Toggle 3D view"
  ) {}

  onAdd(map: MLMap): HTMLElement {
    this.map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl maplibregl-ctrl-group niyvaru-orientation";
    const button = document.createElement("button");
    button.type = "button";
    button.title = this.label;
    button.setAttribute("aria-label", this.label);
    button.innerHTML = COMPASS_SVG;
    button.addEventListener("click", this.onClick);
    container.appendChild(button);
    this.button = button;
    map.on("move", this.sync);
    this.syncState();
    return container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.onClick);
    this.map?.off("move", this.sync);
    this.map = undefined;
    this.button = undefined;
  }

  /** Visible state: `3d` when the showcase view is active, `flat` otherwise. */
  private syncState(): void {
    if (!this.button) return;
    const showcase = this.atShowcase();
    this.button.dataset.mode = showcase ? "3d" : "flat";
    this.button.setAttribute("aria-pressed", String(showcase));
  }

  private atShowcase(): boolean {
    const map = this.map;
    if (!map) return false;
    // Bearings are 0–360 (showcase −15 arrives as 345); compare the short arc.
    const bearingDelta = Math.abs(((map.getBearing() - this.showcase.bearing + 540) % 360) - 180);
    return Math.abs(map.getPitch() - this.showcase.pitch) < 3 && bearingDelta < 3;
  }

  private toggle(): void {
    const map = this.map;
    if (!map) return;
    const next = this.atShowcase()
      ? { pitch: 0, bearing: 0 }
      : { pitch: this.showcase.pitch, bearing: this.showcase.bearing };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.stop();
    if (reduced) map.jumpTo(next);
    else map.easeTo({ ...next, duration: 650 });
    this.syncState();
  }
}

export interface MapApi {
  map: MLMap;
  setPlaces(pack: AreaPack): void;
  focusPlace(place: Place, onMarkerClick?: () => void): void;
  clearFocus(): void;
  showRoute(route: WalkRoute | null, fit?: boolean): void;
  filterKinds(kinds: string[] | null): void;
  /** Continuous hour 0–24 — relights the whole city. */
  setHour(hour: number): void;
  /** Reserve visible map space above the surface dock (and beside the panel). */
  setViewportInset(bottom: number, right?: number): void;
  setUserLocation(lat: number, lon: number, label?: string): void;
  labelLanguage(lang: string): void;
  onPlaceClick(cb: (place: Place) => void, lookup: (id: string) => Place | undefined): void;
  destroy(): void;
}

function deviceLowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 8;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  // Phones commonly report 4 GB, so "<6" silently turned every phone into a
  // flat map. Only genuinely small devices lose the expensive layers, and
  // buildings themselves stay on (terrain is what gets dropped).
  return coarsePointer && memoryGb <= 3;
}

export async function initMap(
  container: HTMLElement,
  meta: AreaMeta,
  signal?: AbortSignal,
  initialHour = 18.5,
  labels?: { orientation?: string }
): Promise<MapApi> {
  const done = debugTime("map", "initMap total");
  debugLog("map", "initMap start", { area: meta.id });
  const low = deviceLowPower();
  const width = container.clientWidth || window.innerWidth;
  // Every rendered dot is browsable; this is only a drawing budget for the
  // cloud layer, never a cut on what the dossier can reach.
  const placeLimit = low ? 1200 : 3000;

  debugLog("map", "constructing Map (positron + regrade)");
  // Use the returned object directly — setup() mutates its roles array on
  // style.load, so a copy would hold a stale empty reference forever.
  const regraded = await loadRegradedStyle(container, {
    maxPitch: 78,
    lowPower: low,
    // A city-bounded app never needs the planet repeated around the antimeridian,
    // and phone GPUs must not hold a deep tile cache.
    renderWorldCopies: false,
    maxTileCacheSize: low ? 32 : 96,
    maxTileCacheZoomLevels: 3,
    fadeDuration: low ? 0 : 200,
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
    // zoom eases down on narrow screens, but never below the point where the
    // 3D massing reads — a flat-looking first view was the top complaint.
    zoom: Math.max(14.3, (meta.zoom ?? 15.2) + Math.max(-1.1, 0.75 * Math.log2(Math.max(320, width) / 1440))),
    pitch: 55,
    bearing: -15,  });

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

  // MapLibre disables the zoom buttons at the min/max limits itself; styles.css
  // paints that disabled state ash-grey like the reference map. The compass is
  // ours (below): a stock compass only flattens the map and cannot restore the
  // cinematic view, which is a dead end.
  map.addControl(
    new maplibregl.NavigationControl({
      showZoom: true,
      showCompass: false,
      visualizePitch: true,
      visualizeRoll: true,
    }),
    "bottom-right"
  );
  map.addControl(new OrientationControl(SHOWCASE, labels?.orientation), "bottom-right");

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
    setViewportInset(bottom: number, right = 0) {
      map.setPadding({ top: 0, right: Math.max(0, right), bottom: Math.max(0, bottom), left: 0 });
    },
    setUserLocation(lat: number, lon: number, label?: string) {
      showUserLocation(map, lat, lon, label);
      map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16), duration: 900 });
    },
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
      clearUserLocation();
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
