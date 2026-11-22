/**
 * The runtime area assembler — the system of record.
 * Everything is fetched in parallel: three Overpass shards on three mirrors,
 * photographs, stories, pulse — the routes pick their destinations as soon
 * as the places land. Every stage streams live counts so the traveller
 * watches the place being built, not a spinner.
 */
import { cached, savePack } from "./cache";
import { fetchPlacesSharded, type ShardProgress } from "./overpass";
import { storiesNear } from "./wikipedia";
import { photosNear as panoramaxNear } from "./panoramax";
import { walkingRoute } from "./walkingRoutes";
import { newsForArea } from "./gdelt";
import { mastodonRecent } from "./social";
import { weatherFor } from "./weather";
import { areaTimezone, computePrayer } from "./prayer";
import { BASE_URL } from "../config/endpoints";
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

async function optional<T>(run: (signal?: AbortSignal) => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch {
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

/** Commons geosearch WITH file positions (the API returns coordinates per file). */
interface AnchoredPhoto {
  photo: Photo;
  lat: number;
  lon: number;
}

async function commonsAnchoredPhotos(meta: AreaMeta, signal?: AbortSignal): Promise<AnchoredPhoto[]> {
  return cached(
    `commons-pos:${meta.lat.toFixed(4)},${meta.lon.toFixed(4)},${meta.radiusM}`,
    7 * 24 * 3600_000,
    async () => {
      const params = new URLSearchParams({
        action: "query",
        format: "json",
        origin: "*",
        generator: "geosearch",
        ggscoord: `${meta.lat}|${meta.lon}`,
        ggsradius: String(Math.min(meta.radiusM, 10000)),
        ggslimit: "120",
        gsnamespace: "6",
        prop: "coordinates|imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "640",
      });
      const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { signal });
      if (!res.ok) throw new Error(`commons ${res.status}`);
      const json = (await res.json()) as {
        query?: {
          pages?: Record<
            string,
            {
              title: string;
              coordinates?: { lat: number; lon: number }[];
              imageinfo?: {
                url: string;
                thumburl?: string;
                extmetadata?: { Artist?: { value: string }; LicenseShortName?: { value: string } };
              }[];
            }
          >;
        };
      };
      const out: AnchoredPhoto[] = [];
      for (const page of Object.values(json.query?.pages ?? {})) {
        const info = page.imageinfo?.[0];
        const coord = page.coordinates?.[0];
        if (!info?.url || !coord) continue;
        if (!/\.(jpe?g|png|webp)$/i.test(info.url.split("?")[0] ?? "")) continue;
        const strip = (s: string | undefined): string | undefined => {
          const text = s?.replace(/<[^>]*>/g, "").trim();
          return text || undefined;
        };
        out.push({
          photo: {
            url: info.url,
            thumbUrl: info.thumburl ?? info.url,
            attribution: strip(info.extmetadata?.Artist?.value) ?? page.title,
            license: strip(info.extmetadata?.LicenseShortName?.value),
            source: "commons" as const,
          },
          lat: coord.lat,
          lon: coord.lon,
        });
      }
      return out;
    }
  );
}

/** Optional per-area promotional placements — data files, never code. */
async function promotionsFor(meta: AreaMeta, signal?: AbortSignal): Promise<PulseItem[]> {
  return optional(async () => {
    const res = await fetch(`${BASE_URL}promotions.json`, { cache: "no-cache", signal });
    if (!res.ok) return [];
    const json = (await res.json()) as { placements?: (PulseItem & { areaId?: string })[] };
    return (json.placements ?? [])
      .filter((p) => !p.areaId || p.areaId === meta.id)
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

function matchByTitle(title: string, places: Place[]): Place | undefined {
  const lowered = title.toLowerCase();
  let best: Place | undefined;
  let bestScore = 0;
  for (const p of places) {
    const name = (p.nameEn ?? p.name).toLowerCase();
    let score = 0;
    if (name === lowered) score = 3;
    else if (name.includes(lowered) || lowered.includes(name)) score = 2;
    else if (name.split(/\s+/).some((w) => w.length > 3 && lowered.includes(w))) score = 1;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return bestScore >= 2 ? best : undefined;
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
    const places = await fetchPlacesSharded(bbox, (progress: ShardProgress) => {
      onStage({
        key: "places",
        state: "active",
        detail: `${progress.shard} shard: ${progress.count} places`,
      });
    }, signal);
    counts.places = places.length;
    return places;
  }, [], () => `${counts.places} places`);

  const photosPromise = runStage("photos", onStage, async () => {
    const [commons, pano] = await Promise.all([
      optional(() => commonsAnchoredPhotos(meta, signal)),
      optional(() => panoramaxNear(meta.lat, meta.lon, meta.radiusM, 60, signal)),
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
    const [news, masto, promos, weatherDays, tz] = await Promise.all([
      optional(() => newsForArea(areaQueryName(meta), meta.feeds?.gdeltQuery, signal)),
      optional(() => mastodonRecent(meta, 10, signal)),
      promotionsFor(meta, signal),
      optional(() => weatherFor(meta.lat, meta.lon, signal)),
      optional(() => areaTimezone(meta.lat, meta.lon, signal)),
    ]);
    const prayerDays = computePrayer(meta.lat, meta.lon, meta.prayerMethod ?? "mwl", 7, tz ?? "UTC");
    attribution["Prayer times"] = "computed locally (adhan)";
    if (weatherDays?.length) {
      attribution[weatherDays[0].provider.split(" (")[0]] = weatherDays[0].provider.includes("CC BY")
        ? "CC BY 4.0"
        : "open-access";
    }
    const pulseItems: PulseItem[] = [
      ...(weatherDays?.length ? [weatherPulseItem(weatherDays[0], meta)] : []),
      ...(news ?? []),
      ...(masto ?? []),
      ...promos,
    ];
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
        landmark && { label: "Walk to", dest: landmark },
        practical && { label: "Everyday", dest: practical },
        green && green !== landmark && { label: "Outdoors", dest: green },
      ].filter(Boolean) as { label: string; dest: Place }[];
      counts.routes = picks.length;
      onStage({ key: "routes", state: "active", detail: `routing ${picks.length} walks` });
      const settled = await Promise.allSettled(
        picks.map(async (pick, i) => {
          const route = await walkingRoute(`${pick.label} ${pick.dest.name}`, [
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

  // ——— attach photographs to their nearest place; leftovers become hero candidates ———
  onStage({ key: "photos", state: "active", detail: "matching photographs to places" });
  const heroCandidates: Photo[] = [];
  for (const anchored of photoData.commons) {
    const owner = nearest(anchored.lat, anchored.lon, places, 150);
    if (owner && owner.photos.length < 4) owner.photos.push(anchored.photo);
    else heroCandidates.push(anchored.photo);
  }
  if (photoData.pano) {
    photoData.pano.frames.forEach((frame, i) => {
      const photo = photoData.pano!.photos[i];
      if (!photo) return;
      const owner = nearest(frame.lat, frame.lon, places, 150);
      if (owner && owner.photos.length < 4) owner.photos.push(photo);
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
  onStage({ key: "story", state: counts.stories > 0 ? "done" : stories.length ? "done" : "failed", detail: `${counts.stories} stories` });

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
