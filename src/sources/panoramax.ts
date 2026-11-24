/**
 * Panoramax federation — open street-level imagery, keyless, CC-BY-SA.
 * The meta-catalog (api.panoramax.xyz) aggregates public instances worldwide;
 * coverage varies by city and the UI labels it honestly.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { Bbox, Frame, Photo, PulseItem } from "./types";

interface PanoramaxItem {
  id: string;
  bbox: [number, number, number, number];
  geometry?: { coordinates: [number, number] };
  assets?: { sd?: { href: string }; thumb?: { href: string }; hd?: { href: string } };
  properties?: {
    "view:azimuth"?: number;
    datetime?: string;
    datetimetz?: string;
    license?: string;
    "geovisio:producer"?: string;
  };
  links?: { rel: string; href: string }[];
}

function metaCatalogFetch(path: string, signal?: AbortSignal): Promise<Response> {
  return fetch(`${endpoints.panoramax.instances[0]}${path}`, {
    headers: { Accept: "application/geo+json" },
    signal,
  });
}

/** Street frames inside a bbox (walk player + flythrough). */
export async function framesInBbox(bbox: Bbox, limit = 500, signal?: AbortSignal): Promise<Frame[]> {
  const key = `panoramax:frames:${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`;
  return cached(key, 24 * 3600_000, async () => {
    const res = await metaCatalogFetch(
      `/api/search?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}&limit=${limit}`,
      signal
    );
    if (!res.ok) throw new Error(`panoramax ${res.status}`);
    const json = (await res.json()) as { features?: PanoramaxItem[] };
    return (json.features ?? [])
      .filter((f) => f.geometry?.coordinates)
      .map<Frame>((f) => ({
        id: `panoramax/${f.id}`,
        url: f.assets?.sd?.href ?? f.assets?.hd?.href ?? "",
        thumbUrl: f.assets?.thumb?.href ?? f.assets?.sd?.href ?? "",
        lat: f.geometry!.coordinates[1],
        lon: f.geometry!.coordinates[0],
        heading: f.properties?.["view:azimuth"] ?? 0,
        capturedAt: f.properties?.datetime ?? f.properties?.datetimetz ?? "",
        source: "panoramax",
      }))
      .filter((f) => f.url !== "");
  });
}

/**
 * Street imagery near the area. Captures inside the recent window lead and are
 * dated; a city whose newest pass is older still shows that imagery, undated,
 * rather than an empty feed.
 */
export async function panoramaxRecentPulse(bbox: Bbox, signal?: AbortSignal): Promise<PulseItem[]> {
  const frames = await framesInBbox(bbox, 200, signal);
  const cutoff = Date.now() - 90 * 24 * 3600_000;
  const dated = frames
    .filter((f) => f.capturedAt)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const fresh = dated.filter((f) => new Date(f.capturedAt).getTime() >= cutoff);
  const chosen = fresh.length ? fresh : dated;
  return chosen.slice(0, 8).map<PulseItem>((f) => ({
    // Frame ids are already namespaced by framesInBbox.
    id: f.id,
    source: "panoramax",
    kind: "organic",
    title: fresh.length ? "Recently captured street imagery near this area" : "Street imagery near this area",
    at: fresh.length ? f.capturedAt : undefined,
    lat: f.lat,
    lon: f.lon,
    image: {
      url: f.url,
      thumbUrl: f.thumbUrl,
      credit: f.credit ?? "Panoramax contributors",
      license: f.license ?? "CC-BY-SA-4.0",
    },
  }));
}

/** Photos usable on a place card (same catalog, matched by proximity in the assembler). */
export async function photosNear(
  lat: number,
  lon: number,
  radiusM: number,
  limit = 50,
  signal?: AbortSignal
): Promise<{ photos: Photo[]; frames: Frame[] }> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox: Bbox = { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
  const frames = await framesInBbox(bbox, limit, signal);
  const photos: Photo[] = frames.slice(0, 8).map((f) => ({
    url: f.url,
    thumbUrl: f.thumbUrl,
    attribution: "Panoramax contributors (CC-BY-SA 4.0)",
    license: "CC-BY-SA-4.0",
    source: "panoramax" as const,
  }));
  return { photos, frames };
}
