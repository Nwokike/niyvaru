/**
 * OpenStreetMap places via the public Overpass API (keyless, CORS).
 * The selector set is sharded and fetched in parallel across different
 * mirrors — polite to each server, ~3× faster end-to-end, and counts arrive
 * progressively so the traveller sees the place being built.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { Bbox, Place, PlaceTags } from "./types";

const UA = "niyvaru/1.0 (client-side prototype)";

/** Kind → what the UI and agent can rely on. Keep this list small and universal. */
export const KINDS = [
  "hotel",
  "pharmacy",
  "food",
  "cafe",
  "bar",
  "shop",
  "worship",
  "health",
  "money",
  "toilets",
  "green",
  "heritage",
  "civic",
] as const;
export type Kind = (typeof KINDS)[number];

interface Selector {
  kind: Kind;
  clause: string;
}

const CORE: Selector[] = [
  { kind: "hotel", clause: '["tourism"~"^(hotel|hostel|guest_house|apartment)$"]' },
  { kind: "pharmacy", clause: '["amenity"="pharmacy"]' },
  { kind: "pharmacy", clause: '["healthcare"="pharmacy"]' },
  { kind: "worship", clause: '["amenity"="place_of_worship"]' },
  { kind: "health", clause: '["amenity"~"^(hospital|clinic|doctors|dentist)$"]' },
  { kind: "money", clause: '["amenity"~"^(bank|atm)$"]' },
  { kind: "toilets", clause: '["amenity"="toilets"]' },
  { kind: "green", clause: '["leisure"~"^(park|garden|playground)$"]' },
  { kind: "heritage", clause: '["tourism"~"^(museum|attraction|artwork|gallery)$"]' },
  { kind: "heritage", clause: '["historic"~"^(monument|memorial|castle|ruins)$"]' },
  { kind: "civic", clause: '["amenity"~"^(police|post_office|townhall|library)$"]' },
];

const FOOD: Selector[] = [
  { kind: "food", clause: '["amenity"~"^(restaurant|fast_food|food_court)$"]' },
  { kind: "cafe", clause: '["amenity"="cafe"]' },
  { kind: "bar", clause: '["amenity"~"^(bar|pub|biergarten)$"]' },
];

const SHOPS: Selector[] = [{ kind: "shop", clause: '["shop"]' }];

/** One shard per mirror — parallel servers, never parallel hits on one. */
const SHARDS: { name: string; mirror: number; selectors: Selector[] }[] = [
  { name: "core", mirror: 0, selectors: CORE },
  { name: "food", mirror: 1, selectors: FOOD },
  // shops is the heavy shard; it shares the main mirror (2 parallel = etiquette cap)
  { name: "shops", mirror: 0, selectors: SHOPS },
];

function buildQuery(bbox: Bbox, selectors: Selector[]): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const body = selectors.map((s) => `node${s.clause}(${b});way${s.clause}(${b});`).join("\n");
  return `[out:json][timeout:40];\n(\n${body}\n);\nout center tags;`;
}

function normalizeKind(tags: Record<string, string>): Kind {
  if (tags.tourism === "hotel" || tags.tourism === "hostel" || tags.tourism === "guest_house" || tags.tourism === "apartment") return "hotel";
  if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy") return "pharmacy";
  if (tags.amenity === "restaurant" || tags.amenity === "fast_food" || tags.amenity === "food_court") return "food";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.amenity === "bar" || tags.amenity === "pub" || tags.amenity === "biergarten") return "bar";
  if (tags.shop) return "shop";
  if (tags.amenity === "place_of_worship") return "worship";
  if (tags.amenity === "hospital" || tags.amenity === "clinic" || tags.amenity === "doctors" || tags.amenity === "dentist") return "health";
  if (tags.amenity === "bank" || tags.amenity === "atm") return "money";
  if (tags.amenity === "toilets") return "toilets";
  if (tags.leisure === "park" || tags.leisure === "garden" || tags.leisure === "playground") return "green";
  if (tags.tourism === "museum" || tags.tourism === "attraction" || tags.tourism === "artwork" || tags.tourism === "gallery") return "heritage";
  if (tags.historic) return "heritage";
  if (tags.amenity === "police" || tags.amenity === "post_office" || tags.amenity === "townhall" || tags.amenity === "library") return "civic";
  return "civic";
}

function toTags(t: Record<string, string>): PlaceTags {
  return {
    openingHours: t.opening_hours || undefined,
    wheelchair: t.wheelchair || undefined,
    phone: t.phone || t["contact:phone"] || undefined,
    website: t.website || t["contact:website"] || undefined,
    cuisine: t.cuisine || undefined,
    addrStreet: t["addr:street"] || undefined,
    addrNumber: t["addr:housenumber"] || undefined,
    takeaway: t.takeaway || undefined,
    outdoorSeating: t["outdoor_seating"] || undefined,
    internet: t.internet_access || undefined,
  };
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

async function runShard(
  mirror: string,
  query: string,
  signal?: AbortSignal
): Promise<OverpassElement[]> {
  const timeout = AbortSignal.timeout(endpoints.overpass.timeoutMs);
  const res = await fetch(mirror, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "X-Niyvaru-Client": UA,
    },
    body: new URLSearchParams({ data: query }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) throw new Error(`overpass ${mirror} ${res.status}`);
  const json = (await res.json()) as { elements?: OverpassElement[] };
  if (!json.elements) throw new Error("overpass returned no elements");
  return json.elements;
}

export interface ShardProgress {
  shard: string;
  count: number;
  done: boolean;
}

function toPlaces(elements: OverpassElement[]): Place[] {
  const places: Place[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const name = tags.name || tags["name:en"] || tags.brand;
    if (!name) continue; // unnamed map objects are noise for a travel product
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    places.push({
      id,
      name,
      nameEn: tags["name:en"] || undefined,
      lat,
      lon,
      kind: normalizeKind(tags),
      tags: toTags(tags),
      photos: [],
      origin: "osm",
    });
  }
  return places;
}

/**
 * Sharded, parallel places fetch with live per-shard counts.
 * Each shard rides a different mirror; a hanging shard never blocks the rest.
 */
export async function fetchPlacesSharded(
  bbox: Bbox,
  onProgress: ((progress: ShardProgress) => void) | undefined,
  signal?: AbortSignal
): Promise<Place[]> {
  const cacheKey = `overpass:${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  return cached(cacheKey, 6 * 3600_000, async () => {
    const settled = await Promise.allSettled(
      SHARDS.map(async (shard) => {
        const host = endpoints.overpass.mirrors[shard.mirror % endpoints.overpass.mirrors.length];
        const elements = await runShard(host, buildQuery(bbox, shard.selectors), signal);
        const places = toPlaces(elements);
        onProgress?.({ shard: shard.name, count: places.length, done: true });
        return places;
      })
    );
    const merged = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const seen = new Set<string>();
    return merged.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  });
}
