/**
 * Walking routes — FOSSGIS OSRM pedestrian instance (keyless, CORS — the
 * same router openstreetmap.org uses for walking directions). Foot profiles
 * only: a driving result must never masquerade as a walk.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { WalkRoute } from "./types";

async function request(
  base: string,
  coords: [number, number][],
  signal?: AbortSignal
): Promise<{ distanceM: number; durationS: number; coordinates: [number, number][] }> {
  const path = coords.map(([lon, lat]) => `${lon},${lat}`).join(";");
  const url = `${base}/${path}?overview=full&geometries=geojson&steps=false`;
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`router ${res.status}`);
  const json = (await res.json()) as {
    code: string;
    routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
  };
  if (json.code !== "Ok" || !json.routes?.length) throw new Error("no route");
  const r = json.routes[0];
  return { distanceM: Math.round(r.distance), durationS: Math.round(r.duration), coordinates: r.geometry.coordinates };
}

/**
 * Walking route between points ([lat, lon] pairs, human order).
 * FOSSGIS foot first, public demo fallback. Never accepts a driving profile.
 */
export async function walkingRoute(
  name: string,
  waypoints: [number, number][],
  signal?: AbortSignal
): Promise<WalkRoute> {
  const coords = waypoints.map(([lat, lon]) => [lon, lat] as [number, number]);
  return cached(
    `route:${name}:${coords.map((c) => c.map((n) => n.toFixed(5)).join(",")).join("|")}`,
    24 * 3600_000,
    async () => {
      let result: { distanceM: number; durationS: number; coordinates: [number, number][] };
      try {
        result = await request(endpoints.routing.foot, coords, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        result = await request(endpoints.routing.osrmDemo, coords, signal);
      }
      if (result.distanceM > 25000) throw new Error("implausible walking distance — refusing");
      return {
        id: `walk-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 48)}`,
        name,
        distanceM: result.distanceM,
        durationS: result.durationS,
        coordinates: result.coordinates,
      };
    }
  );
}
