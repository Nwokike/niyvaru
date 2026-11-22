/**
 * Geocoding — the "search any city on Earth" entry point.
 * Photon (keyless, CORS) first; Nominatim fallback for user-triggered searches.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { GeocodeResult } from "./types";

function clean(s: string): string {
  return s.replace(/<[^>]*>/g, "").trim();
}

async function photon(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url = `${endpoints.geocode.photon}/?q=${encodeURIComponent(query)}&limit=8`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`photon ${res.status}`);
  const json = (await res.json()) as {
    features: {
      properties: {
        osm_id?: number;
        name?: string;
        country?: string;
        city?: string;
        state?: string;
        street?: string;
        extent?: [number, number, number, number];
      };
      geometry: { coordinates: [number, number] };
    }[];
  };
  return json.features
    .filter((f) => f.properties.name)
    .map((f) => ({
      id: f.properties.osm_id ? `osm/${f.properties.osm_id}` : undefined,
      name: f.properties.name!,
      secondary: [f.properties.city, f.properties.state].filter(Boolean).join(", ") || undefined,
      country: f.properties.country,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
      extent: f.properties.extent,
    }));
}

async function nominatim(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const url = `${endpoints.geocode.nominatim}?q=${encodeURIComponent(query)}&format=jsonv2&limit=8`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`nominatim ${res.status}`);
  const json = (await res.json()) as {
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    boundingbox: [string, string, string, string];
  }[];
  return json.map((r) => {
    const parts = r.display_name.split(", ");
    const [south, north, west, east] = r.boundingbox.map(Number);
    return {
      id: `nominatim/${r.place_id}`,
      name: parts[0],
      secondary: parts.slice(1, 3).join(", ") || undefined,
      lat: Number(r.lat),
      lon: Number(r.lon),
      extent: [west, south, east, north] as [number, number, number, number],
    };
  });
}

export async function searchCities(query: string, signal?: AbortSignal): Promise<GeocodeResult[]> {
  const trimmed = clean(query);
  if (trimmed.length < 2) return [];
  return cached(`geocode:${trimmed.toLowerCase()}`, 24 * 3600_000, async () => {
    try {
      const results = await photon(trimmed, signal);
      if (results.length) return results;
    } catch (e) {
      if (signal?.aborted) throw e;
    }
    return nominatim(trimmed, signal);
  });
}
