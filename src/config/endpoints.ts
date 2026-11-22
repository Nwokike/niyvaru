/**
 * Every external endpoint in one swappable place. Nothing else in the app
 * hardcodes a URL, a key or a provider. Secrets come only from the
 * environment (never committed); public free endpoints carry documented
 * defaults that can be overridden per deployment.
 */

const env = import.meta.env as Record<string, string | undefined>;

const optional = (name: string): string | undefined => {
  const value = env[name];
  return value && value.trim() !== "" ? value : undefined;
};

/** Base path when the app is served under a sub-path (GitHub Pages etc.). */
export const BASE_URL = env.BASE_URL ?? "/";

export const API_BASE = (optional("VITE_API_BASE") ?? "").replace(/\/$/, "");
/** When true the optional Worker is reachable (proxy for no-CORS sources + UA-settable weather). */
export const WORKER_MODE = API_BASE !== "";

export const endpoints = {
  gateway: {
    url: (optional("VITE_GATEWAY_URL") ?? "https://api.kiri.ng").replace(/\/$/, ""),
    // The shared family app credential — the exact value Akili ships publicly.
    key: "mobile-v1",
    /** Ordered free-model roster with fallbacks (roster lives in the gateway; this pins intent). */
    taskType: "text" as const,
  },

  geocode: {
    /** Photon (Komoot) — keyless, CORS, built for search-as-you-type. */
    photon: "https://photon.komoot.io/api",
    /** Nominatim fallback — user-triggered searches only, 1 req/s ceiling (OSM policy). */
    nominatim: "https://nominatim.openstreetmap.org/search",
  },

  overpass: {
    /** Ordered free mirrors — most responsive first (measured 2026-11-22). */
    mirrors: [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.openstreetmap.fr/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ],
    /** Per-mirror ceiling; a hanging mirror must never stall the assembly. */
    timeoutMs: 25000,
  },

  tiles: {
    openFreeMapStyle: "https://tiles.openfreemap.org/styles/liberty",
    planetPmtiles: "https://tiles.openfreemap.org/planet",
  },

  terrain: {
    /** Mapterhorn — keyless global elevation (Terrarium PMTiles). */
    mapterhornTilejson: "https://tiles.mapterhorn.com/tilejson.json",
  },

  routing: {
    /** FOSSGIS OSRM pedestrian instance — the keyless walking router OSM itself uses. */
    foot: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
    /** Public demo fallback. */
    osrmDemo: "https://router.project-osrm.org/route/v1/foot",
  },

  commons: {
    api: "https://commons.wikimedia.org/w/api.php",
    thumbWidth: 640,
  },

  wikipedia: {
    /** Per-language endpoint built at call time: `${base}/${lang}/w/api.php`. */
    base: "https://{lang}.wikipedia.org/w/api.php",
  },

  panoramax: {
    /** Federated meta-catalog (keyless). Individual instances appear inside results. */
    instances: ["https://api.panoramax.xyz"],
  },

  mapillary: {
    api: "https://graph.mapillary.com",
    tiles: "https://tiles.mapillary.com",
    /** Free token from mapillary.com/dashboard/developers — optional; adapter degrades without it. */
    get token(): string | undefined {
      return optional("VITE_MAPILLARY_TOKEN");
    },
  },

  gdelt: {
    doc: "https://api.gdeltproject.org/api/v2/doc/doc",
  },

  social: {
    /** Bluesky Jetstream public relay — plain JSON over WebSocket, no auth. */
    jetstream: "wss://jetstream1.us-east.bsky.network/subscribe",
    /** Mastodon instances whose public timelines allow unauthenticated reads. */
    mastodon: ["https://mastodon.social", "https://mstdn.social"],
  },

  weather: {
    /** MET Norway — free incl. commercial (CC BY 4.0); requires an identifying User-Agent,
     *  which only the optional Worker mode can set from our stack. */
    metNo: "https://api.met.no/weatherapi/locationforecast/2.0/compact",
    /** Open-Meteo open-access fallback — free, but non-commercial terms; prototype-only. */
    openMeteo: "https://api.open-meteo.com/v1/forecast",
  },
};

export type Endpoints = typeof endpoints;
