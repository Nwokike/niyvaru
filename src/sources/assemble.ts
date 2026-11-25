/**
 * The runtime area assembler — the system of record.
 * Everything is fetched in parallel: three Overpass shards on three mirrors,
 * photographs, stories, pulse — the routes pick their destinations as soon
 * as the places land. Every stage streams live counts so the traveller
 * watches the place being built, not a spinner.
 */
import { savePack } from "./cache";
import { anchoredPhotosNear } from "./commons";
import { matchByTitle, matchByTitleScore } from "./photoMatch";
import { fetchPlacesSharded, type ShardProgress } from "./overpass";
import { fetchPlacesFromOsmMap } from "./osmMap";
import { storiesNear } from "./wikipedia";
import { photosNear as panoramaxNear, panoramaxRecentPulse } from "./panoramax";
import { commonsRecentPulse } from "./commons";
import { aerialPulse } from "./openaerialmap";
import { walkingRoute } from "./walkingRoutes";
import { newsForArea } from "./gdelt";
import { mastodonRecent } from "./social";
import { weatherFor } from "./weather";
import { areaTimezone, computePrayer } from "./prayer";
import { BASE_URL } from "../config/endpoints";
import { debugError } from "../debug";
import type {
  AreaMeta,
  AreaPack,
  Bbox,
  Photo,
  Place,
  PulseItem,
  WalkRoute,
} from "./types";

export type StageKey = "places" | "photos" | "story" | "routes" | "pulse";
export type StageState = "pending" | "active" | "done" | "failed";

export interface StageUpdate {
  key: StageKey;
  state: StageState;
  /** Live detail line, e.g. "1,204 places · shops shard done". */
  detail?: string;
}

export type OnStage = (update: StageUpdate) => void;

/** Live counters the loader shows ticking up. */
export interface AssemblyCounts {
  places: number;
  photos: number;
  stories: number;
  routes: number;
  pulse: number;
}

export function bboxOf(meta: AreaMeta): Bbox {
  const dLat = meta.radiusM / 111_320;
  const dLon = meta.radiusM / (111_320 * Math.cos((meta.lat * Math.PI) / 180));
  return {
    south: meta.lat - dLat,
    north: meta.lat + dLat,
    west: meta.lon - dLon,
    east: meta.lon + dLon,
  };
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distance from area centre, nearest first — the universal sort for place lists. */
export function withDistances(places: Place[], meta: AreaMeta): Place[] {
  return places
    .map((p) => ({ ...p, distanceM: Math.round(haversineM(meta.lat, meta.lon, p.lat, p.lon)) }))
    .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

function nearest(lat: number, lon: number, places: Place[], withinM: number): Place | undefined {
  let best: Place | undefined;
  let bestD = withinM;
  for (const p of places) {
    const d = haversineM(lat, lon, p.lat, p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** A Commons photo can sit a few hundred metres from the OSM node that names it. */
const PHOTO_MATCH_RADIUS_M = 300;
/** Bounded galleries: keep the strongest photos only, never unbounded lists. */
const MAX_PHOTOS_PER_PLACE = 6;
/** Below this, Overpass coverage is too thin to trust; fill from the OSM map API. */
const MIN_PLACES_FROM_OVERPASS = 12;
/** The fallback must never hold the whole assembly hostage on a slow network. */
const OSM_FALLBACK_TIMEOUT_MS = 20_000;

async function optional<T>(label: string, run: (signal?: AbortSignal) => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    debugError("assemble", `${label} failed`, String((e as Error).message ?? e));
    return undefined;
  }
}

async function runStage<T>(
  key: StageKey,
  onStage: OnStage,
  run: () => Promise<T>,
  fallback: T,
  detail?: (value: T) => string | undefined
): Promise<T> {
  onStage({ key, state: "active" });
  try {
    const value = await run();
    onStage({ key, state: "done", detail: detail?.(value) });
    return value;
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    onStage({ key, state: "failed" });
    return fallback;
  }
}

/** Optional per-area promotional placements — data files, never code. */
async function promotionsFor(meta: AreaMeta, signal?: AbortSignal): Promise<PulseItem[]> {
  return optional("Promotions", async () => {
    const res = await fetch(`${BASE_URL}promotions.json`, { cache: "no-cache", signal });
    if (!res.ok) return [];
    // Static hosts answer unknown files with the SPA index.html and HTTP 200.
    // Only accept a real JSON body so a missing feed stays empty, not an error.
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("json")) return [];
    let json: { placements?: (PulseItem & { areaId?: string })[] };
    try {
      json = (await res.json()) as { placements?: (PulseItem & { areaId?: string })[] };
    } catch {
      return [];
    }
    return (json.placements ?? [])
      .filter((p) => p && typeof p.id === "string" && (!p.areaId || p.areaId === meta.id))
      .map(({ areaId: _areaId, ...item }) => ({ ...item, kind: "promoted" as const }));
  }).then((v) => v ?? []);
}

function areaQueryName(meta: AreaMeta): string {
  return meta.name.split("—")[0].trim();
}

function weatherPulseItem(day: AreaPack["weather"][number], meta: AreaMeta): PulseItem {
  return {
    id: `weather/${meta.id}/${day.date}`,
    source: "weather",
    kind: "organic",
    title: `${day.tempMaxC}° / ${day.tempMinC}° today — ${day.provider.split(" (")[0]}`,
    text: `${day.precipitationMm} mm precipitation, wind up to ${day.windMaxKmh} km/h.`,
    at: new Date().toISOString(),
  };
}

export async function assembleArea(
  meta: AreaMeta,
  onStage: OnStage,
  signal?: AbortSignal
): Promise<AreaPack> {
  const bbox = bboxOf(meta);
  const attribution: Record<string, string> = {
    "© OpenStreetMap contributors": "ODbL",
    "Photographs: Wikimedia Commons contributors": "per-photo licences",
  };
  const counts: AssemblyCounts = { places: 0, photos: 0, stories: 0, routes: 0, pulse: 0 };

  // ——— everything launches in parallel ———
  const placesPromise = runStage("places", onStage, async () => {
    const { places, failedShards } = await fetchPlacesSharded(bbox, (progress: ShardProgress) => {
      onStage({
        key: "places",
        state: "active",
        detail: progress.failed
          ? `${progress.shard} shard unavailable`
          : `${progress.shard} shard: ${progress.count} places`,
      });
    }, signal);
    let result = places;
    // Public Overpass mirrors saturate. Too few results, or a shard whose
    // mirrors all failed, is not coverage — fill the gaps from the raw OSM map
    // API so any city still assembles into a usable place set.
    if (places.length < MIN_PLACES_FROM_OVERPASS || failedShards.length > 0) {
      onStage({
        key: "places",
        state: "active",
        detail: places.length
          ? `overpass returned ${places.length} — filling from OpenStreetMap`
          : "overpass unavailable — reading OpenStreetMap directly",
      });
      // The supplement is best-effort: if it times out or fails, whatever
      // Overpass already produced still ships.
      let filled: Place[] = [];
      try {
        const deadline = AbortSignal.timeout(OSM_FALLBACK_TIMEOUT_MS);
        filled = await fetchPlacesFromOsmMap(bbox, signal ? AbortSignal.any([signal, deadline]) : deadline);
      } catch (e) {
        if ((e as Error)?.name === "AbortError" && signal?.aborted) throw e;
        debugError("assemble", "OpenStreetMap fill failed", String((e as Error).message ?? e));
      }
      const known = new Set(places.map((p) => p.id));
      const extra = filled.filter((p) => !known.has(p.id));
      result = [...places, ...extra];
      onStage({
        key: "places",
        state: "active",
        detail: `${result.length} places (${places.length} overpass + ${extra.length} open street map)`,
      });
    }
    counts.places = result.length;
    return result;
  }, [], () => `${counts.places} places`);

  const photosPromise = runStage("photos", onStage, async () => {
    const [commons, pano] = await Promise.all([
      optional("Commons photos", () => anchoredPhotosNear(meta.lat, meta.lon, meta.radiusM, 120, signal)),
      optional("Panoramax photos", () => panoramaxNear(meta.lat, meta.lon, meta.radiusM, 60, signal)),
    ]);
    if (pano) attribution["Panoramax contributors"] = "CC-BY-SA 4.0";
    const value = { commons: commons ?? [], pano };
    counts.photos = value.commons.length + (value.pano?.photos.length ?? 0);
    onStage({ key: "photos", state: "active", detail: `${counts.photos} photographs` });
    return value;
  }, { commons: [], pano: undefined }, (v) => `${v.commons.length + (v.pano?.photos.length ?? 0)} photographs`);

  const storyPromise = runStage("story", onStage, async () => {
    const stories = await storiesNear(meta.lat, meta.lon, meta.language ?? "en", meta.radiusM, 15, signal);
    counts.stories = stories.length;
    return stories;
  }, [], () => `${counts.stories} stories`);

  const pulsePromise = runStage("pulse", onStage, async () => {
    const bbox = bboxOf(meta);
    const [news, masto, promos, weatherDays, tz, commonsPulse, panoPulse, aerial] = await Promise.all([
      optional("GDELT news", () => newsForArea(areaQueryName(meta), meta.feeds?.gdeltQuery, signal)),
      optional("Mastodon", () => mastodonRecent(meta, 6, signal)),
      promotionsFor(meta, signal),
      optional("Weather", () => weatherFor(meta.lat, meta.lon, signal)),
      optional("Timezone", () => areaTimezone(meta.lat, meta.lon, signal)),
      optional("Commons pulse", () => commonsRecentPulse(meta.lat, meta.lon, meta.radiusM, signal)),
      optional("Panoramax pulse", () => panoramaxRecentPulse(bbox, signal)),
      optional("Aerial pulse", () => aerialPulse(bbox, signal)),
    ]);
    attribution["Wikimedia Commons contributors"] = "per-photo licences";
    attribution["Panoramax contributors"] = "CC-BY-SA 4.0";
    attribution["OpenAerialMap contributors"] = "CC BY 4.0";
    const prayerDays = computePrayer(meta.lat, meta.lon, meta.prayerMethod ?? "mwl", 7, tz ?? "UTC");
    attribution["Prayer times"] = "computed locally (adhan)";
    if (weatherDays?.length) {
      attribution[weatherDays[0].provider.split(" (")[0]] = weatherDays[0].provider.includes("CC BY")
        ? "CC BY 4.0"
        : "open-access";
    }
    // Per-source caps keep one noisy hashtag timeline from crowding out the
    // photographs, news and weather the traveller came for.
    const pulseItems: PulseItem[] = [
      ...(weatherDays?.length ? [weatherPulseItem(weatherDays[0], meta)] : []),
      ...(news ?? []).slice(0, 8),
      ...(commonsPulse ?? []).slice(0, 8),
      ...(panoPulse ?? []).slice(0, 8),
      ...(aerial ?? []).slice(0, 4),
      ...(masto ?? []).slice(0, 8),
      ...promos.slice(0, 4),
    ].slice(0, 40);
    counts.pulse = pulseItems.length;
      return { pulse: pulseItems, weather: weatherDays ?? [], prayer: prayerDays };
  }, { pulse: [], weather: [], prayer: [] }, (v) => `${v.pulse.length} updates`);

  // Routes need the places to pick destinations — they start the moment
  // the shards land and run alongside the remaining stages.
  const routesPromise = placesPromise.then((places) =>
    runStage("routes", onStage, async () => {
      const ranked = withDistances(places, meta);
      const heritageOrWorship = ranked.filter((p) => p.kind === "heritage" || p.kind === "worship");
      const landmark =
        heritageOrWorship.find((p) => p.story) ??
        heritageOrWorship.find((p) => p.photos.length > 0) ??
        heritageOrWorship[0];
      const practical = ranked.find((p) => p.kind === "pharmacy") ?? ranked.find((p) => p.kind === "shop");
      const green = ranked.find((p) => p.kind === "green");
      const picks = [
        landmark && { dest: landmark },
        practical && { dest: practical },
        green && green !== landmark && { dest: green },
      ].filter(Boolean) as { dest: Place }[];
      counts.routes = picks.length;
      onStage({ key: "routes", state: "active", detail: `routing ${picks.length} walks` });
      const settled = await Promise.allSettled(
        picks.map(async (pick, i) => {
          // The route is named after its real destination — place names are
          // data, not translatable UI copy, so no label leaks in one language.
          const route = await walkingRoute(pick.dest.nameEn ?? pick.dest.name, [
            [meta.lat, meta.lon],
            [pick.dest.lat, pick.dest.lon],
          ], signal);
          return { ...route, id: `route-${i}` } satisfies WalkRoute;
        })
      );
      const routes = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      counts.routes = routes.length;
      return routes;
    }, [] as WalkRoute[], (r) => `${r.length} walks`)
  ).catch(() => [] as WalkRoute[]);

  const [places, photoData, stories, pulseData, routes] = await Promise.all([
    placesPromise,
    photosPromise,
    storyPromise,
    pulsePromise,
    routesPromise,
  ]);

  // ——— attach photographs by position, with a file-name fallback ———
  onStage({ key: "photos", state: "active", detail: "matching photographs to places" });
  const placesById = new Map(places.map((p) => [p.id, p]));
  interface PhotoAssignment {
    placeId: string;
    photo: Photo;
    score: number;
  }
  const assignments: PhotoAssignment[] = [];
  for (const anchored of photoData.commons) {
    const titleMatch =
      (anchored.objectName ? matchByTitleScore(anchored.objectName, places) : undefined) ??
      matchByTitleScore(anchored.title, places);
    let geo: { place: Place; distanceM: number } | undefined;
    let bestD = PHOTO_MATCH_RADIUS_M;
    for (const place of places) {
      const d = haversineM(anchored.lat, anchored.lon, place.lat, place.lon);
      if (d < bestD) {
        bestD = d;
        geo = { place, distanceM: d };
      }
    }
    // Coordinates decide the primary owner; a matching name is a tie-breaker.
    if (geo) {
      assignments.push({
        placeId: geo.place.id,
        photo: anchored.photo,
        score: 1000 - geo.distanceM + (titleMatch?.place.id === geo.place.id ? titleMatch.score * 20 : 0),
      });
    }
    // Named-but-unplaced files still belong somewhere — the name is the fallback.
    if (titleMatch && titleMatch.place.id !== geo?.place.id) {
      assignments.push({
        placeId: titleMatch.place.id,
        photo: anchored.photo,
        score: 400 + titleMatch.score * 50,
      });
    }
  }
  // Strongest matches claim bounded slots first; one photo never lands twice.
  assignments.sort((a, b) => b.score - a.score);
  const used = new Set<Photo>();
  for (const a of assignments) {
    const place = placesById.get(a.placeId);
    if (!place || used.has(a.photo) || place.photos.length >= MAX_PHOTOS_PER_PLACE) continue;
    place.photos.push(a.photo);
    used.add(a.photo);
  }
  const heroCandidates = photoData.commons.filter((a) => !used.has(a.photo)).map((a) => a.photo);
  if (photoData.pano) {
    photoData.pano.frames.forEach((frame, i) => {
      const photo = photoData.pano!.photos[i];
      if (!photo || used.has(photo)) return;
      const owner = nearest(frame.lat, frame.lon, places, PHOTO_MATCH_RADIUS_M);
      if (owner && owner.photos.length < MAX_PHOTOS_PER_PLACE) {
        owner.photos.push(photo);
        used.add(photo);
      }
    });
  }
  counts.photos = photoData.commons.length + (photoData.pano?.photos.length ?? 0);
  onStage({
    key: "photos",
    state: counts.photos > 0 ? "done" : "failed",
    detail: `${counts.photos} photographs`,
  });
  // Hero fallback: if every Commons photo attached to a place, the first
  // scenic photo still introduces the area — the hero must never be empty
  // when photographs exist.
  const heroPhoto = heroCandidates[0] ?? photoData.commons[0]?.photo;

  // ——— attach stories ———
  for (const story of stories) {
    const owner = matchByTitle(story.title, places);
    if (owner && !owner.story) owner.story = story;
  }

  onStage({ key: "places", state: "done", detail: `${counts.places} places` });
  onStage({ key: "story", state: stories.length ? "done" : "failed", detail: `${counts.stories} stories` });

  const pack: AreaPack = {
    id: meta.id,
    name: meta.name,
    country: meta.country,
    version: new Date().toISOString(),
    center: [meta.lat, meta.lon],
    radiusM: meta.radiusM,
    zoom: meta.zoom ?? 15.2,
    language: meta.language ?? "en",
    places: withDistances(places, meta),
    routes,
    prayer: pulseData.prayer,
    weather: pulseData.weather,
    pulse: pulseData.pulse,
    heroPhoto,
    attribution,
    feeds: meta.feeds,
    prayerMethod: meta.prayerMethod,
  };
  await savePack(meta.id, pack);
  return pack;
}
