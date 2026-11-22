/**
 * Area store — the front door of "any city on Earth".
 * Featured areas come from a data manifest (public/areas.json, editable
 * without touching code); everything else arrives through search. Every area
 * — featured or searched — goes through the identical runtime assembler, then
 * lives in IndexedDB until a fresher assembly replaces it.
 */
import { cachedWithRefresh, loadPack, savePack } from "../sources/cache";
import { assembleArea, type OnStage } from "../sources/assemble";
import { searchCities } from "../sources/geocode";
import { BASE_URL } from "../config/endpoints";
import type { AreaMeta, AreaPack, GeocodeResult } from "../sources/types";

const FRESH_MS = 12 * 3600_000;

export async function featuredAreas(): Promise<AreaMeta[]> {
  const res = await fetch(`${BASE_URL}areas.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`areas manifest ${res.status}`);
  const json = (await res.json()) as { areas: AreaMeta[] };
  return json.areas;
}

export function areaFromGeocode(result: GeocodeResult): AreaMeta {
  const slug = `${result.name}-${result.lat.toFixed(2)}-${result.lon.toFixed(2)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return {
    id: `area-${slug}`,
    name: result.name,
    country: result.country,
    lat: result.lat,
    lon: result.lon,
    radiusM: 2000,
    zoom: 15.2,
    language: "en",
  };
}

export async function searchAreas(query: string, signal?: AbortSignal): Promise<AreaMeta[]> {
  const results = await searchCities(query, signal);
  return results.map(areaFromGeocode);
}

/**
 * Returns the pack for an area. Fresh cache answers instantly and reports all
 * stages done; a stale cache answers instantly too, then re-assembles in the
 * background and calls `onUpdate` with the fresh pack.
 */
export async function getOrAssembleArea(
  meta: AreaMeta,
  onStage: OnStage,
  onUpdate?: (pack: AreaPack) => void,
  signal?: AbortSignal
): Promise<AreaPack> {
  const cachedPack = (await loadPack(meta.id)) as AreaPack | undefined;
  if (cachedPack) {
    for (const key of ["places", "photos", "story", "routes", "pulse"] as const) {
      onStage({ key, state: "done" });
    }
    const fresh = Date.now() - new Date(cachedPack.version).getTime() < FRESH_MS;
    if (!fresh) {
      void assembleArea(meta, onStage, signal)
        .then((pack) => onUpdate?.(pack))
        .catch(() => {});
    }
    return cachedPack;
  }
  const pack = await assembleArea(meta, onStage, signal);
  await savePack(meta.id, pack);
  return pack;
}

/** Geocode-cache priming so the search field feels instant on repeat visits. */
export async function primeGeocodeCache(): Promise<void> {
  await cachedWithRefresh("geocode:prime", 24 * 3600_000, async () => true);
}
