/**
 * Keyless OpenStreetMap map-API fallback for places.
 *
 * Overpass mirrors are frequently rate-limited or blocked from browser
 * origins. The core OSM `map` API serves the same ODbL data as XML with CORS,
 * so an area can always be assembled — no key, no paid tier, no build step.
 * Only tagged, named POIs are kept; raw geometry is discarded immediately.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import { normalizeKind, toTags } from "./overpass";
import type { Bbox, Place } from "./types";

const MAX_PLACES = 1200;

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
  return dLat * dLat + dLon * dLon;
}

/** Parse the OSM XML into the same Place schema the Overpass adapter returns. */
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
      distanceM: Math.round(Math.sqrt(distanceM(lat, lon, cLat, cLon))),
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

  return places.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0)).slice(0, MAX_PLACES);
}

export async function fetchPlacesFromOsmMap(bbox: Bbox, signal?: AbortSignal): Promise<Place[]> {
  const key = `osmmap:${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
  return cached(key, 6 * 3600_000, async () => {
    const url = `${endpoints.osmMap.url}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
    const res = await fetch(url, { signal, headers: { Accept: "application/xml" } });
    if (!res.ok) throw new Error(`osm map ${res.status}`);
    return placesFromOsmXml(await res.text(), bbox);
  });
}
