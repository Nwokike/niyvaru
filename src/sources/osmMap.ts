/**
 * Keyless OpenStreetMap map-API fallback for places.
 *
 * Overpass mirrors are frequently rate-limited or blocked from browser
 * origins. The core OSM `map` API serves the same ODbL data as XML with CORS,
 * so an area can always be assembled — no key, no paid tier, no build step.
 *
 * The API refuses any bbox holding more than 50,000 nodes, which a dense
 * city centre exceeds. The request therefore tiles itself: it tries the whole
 * bbox first and subdivides into quadrants whenever the server says the area
 * is too large, up to a bounded number of cells. Only tagged, named POIs that
 * match a selector we actually use are kept — raw geometry (streets, landuse,
 * bare buildings) is discarded immediately.
 */
import { endpoints } from "../config/endpoints";
import { cachedWhen } from "./cache";
import { matchesKnownKind, normalizeKind, toTags } from "./overpass";
import type { Bbox, Place } from "./types";

const MAX_PLACES = 1200;
/** Full quadtree depth: 1 + 4 + 16 + 64 cells. Dense cities need all of it. */
const MAX_DEPTH = 3;
const MAX_CELLS = 1 + 4 + 16 + 64;

function tagsOf(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tag of Array.from(el.getElementsByTagName("tag"))) {
    const k = tag.getAttribute("k");
    const v = tag.getAttribute("v");
    if (k && v) out[k] = v;
  }
  return out;
}

function distanceM(lat: number, lon: number, cLat: number, cLon: number): number {
  const dLat = (lat - cLat) * 111_320;
  const dLon = (lon - cLon) * 111_320 * Math.cos((cLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Parse one OSM XML response into the same Place schema Overpass returns. */
export function placesFromOsmXml(xml: string, bbox: Bbox): Place[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("osm map: invalid XML");
  const cLat = (bbox.north + bbox.south) / 2;
  const cLon = (bbox.east + bbox.west) / 2;
  const coords = new Map<string, [number, number]>();
  for (const node of Array.from(doc.getElementsByTagName("node"))) {
    const lat = Number(node.getAttribute("lat"));
    const lon = Number(node.getAttribute("lon"));
    if (Number.isFinite(lat) && Number.isFinite(lon)) coords.set(node.getAttribute("id") ?? "", [lat, lon]);
  }

  const places: Place[] = [];
  const seen = new Set<string>();
  const add = (type: string, id: string, lat: number, lon: number, tags: Record<string, string>): void => {
    const name = tags.name || tags["name:en"] || tags.brand;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (!matchesKnownKind(tags)) return;
    const key = `${type}/${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    places.push({
      id: key,
      name,
      nameEn: tags["name:en"] || undefined,
      lat,
      lon,
      kind: normalizeKind(tags),
      tags: toTags(tags),
      photos: [],
      origin: "osm",
      distanceM: Math.round(distanceM(lat, lon, cLat, cLon)),
    } as Place);
  };

  for (const node of Array.from(doc.getElementsByTagName("node"))) {
    add("node", node.getAttribute("id") ?? "", Number(node.getAttribute("lat")), Number(node.getAttribute("lon")), tagsOf(node));
  }
  for (const way of Array.from(doc.getElementsByTagName("way"))) {
    const refs = Array.from(way.getElementsByTagName("nd"))
      .map((nd) => coords.get(nd.getAttribute("ref") ?? ""))
      .filter((c): c is [number, number] => !!c);
    if (!refs.length) continue;
    const lat = refs.reduce((sum, c) => sum + c[0], 0) / refs.length;
    const lon = refs.reduce((sum, c) => sum + c[1], 0) / refs.length;
    add("way", way.getAttribute("id") ?? "", lat, lon, tagsOf(way));
  }

  return places;
}

function quadrants(bbox: Bbox): Bbox[] {
  const midLat = (bbox.south + bbox.north) / 2;
  const midLon = (bbox.west + bbox.east) / 2;
  return [
    { south: bbox.south, west: bbox.west, north: midLat, east: midLon },
    { south: bbox.south, west: midLon, north: midLat, east: bbox.east },
    { south: midLat, west: bbox.west, north: bbox.north, east: midLon },
    { south: midLat, west: midLon, north: bbox.north, east: bbox.east },
  ];
}

async function fetchCellXml(bbox: Bbox, signal?: AbortSignal): Promise<string> {
  const url = `${endpoints.osmMap.url}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  const res = await fetch(url, { signal, headers: { Accept: "application/xml" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(/too many nodes/i.test(body) ? "osm map: too many nodes" : `osm map ${res.status}`);
  }
  return res.text();
}

/**
 * Fetch the bbox, subdividing when the server rejects a too-large area.
 * Returns the number of cells that failed; any failure means the result is
 * partial and must not be cached as complete coverage. Timeouts and aborts are
 * fatal so a deadline never looks like success.
 */
async function collectPlaces(
  bbox: Bbox,
  depth: number,
  signal: AbortSignal | undefined,
  out: Place[],
  cells: { n: number }
): Promise<number> {
  if (cells.n >= MAX_CELLS) return 0;
  cells.n += 1;
  let xml: string;
  try {
    xml = await fetchCellXml(bbox, signal);
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "AbortError" || name === "TimeoutError" || signal?.aborted) throw e;
    if (depth < MAX_DEPTH && /too many nodes/i.test(String((e as Error).message))) {
      const failed = await Promise.all(quadrants(bbox).map((q) => collectPlaces(q, depth + 1, signal, out, cells)));
      return failed.reduce((a, b) => a + b, 0);
    }
    return 1;
  }
  try {
    out.push(...placesFromOsmXml(xml, bbox));
  } catch {
    return 1; // one malformed cell must not discard the rest
  }
  return 0;
}

export async function fetchPlacesFromOsmMap(bbox: Bbox, signal?: AbortSignal): Promise<Place[]> {
  const key = `osmmap-v2:${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  return cachedWhen(
    key,
    6 * 3600_000,
    async () => {
      const collected: Place[] = [];
      const failures = await collectPlaces(bbox, 0, signal, collected, { n: 0 });
      const seen = new Set<string>();
      return {
        places: collected
          .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
          .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0))
          .slice(0, MAX_PLACES),
        failures,
      };
    },
    (result) => result.failures === 0
  ).then((r) => r.places);
}
