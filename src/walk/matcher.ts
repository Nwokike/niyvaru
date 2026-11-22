/**
 * Route↔imagery matcher — the difference between a slideshow and a walk.
 * Frames are anchored to the nearest point on the real route, ordered by
 * distance walked, spaced so playback feels like motion, never random.
 */
import { framesInBbox as panoramaxFrames } from "../sources/panoramax";
import { framesInBbox as mapillaryFrames } from "../sources/mapillary";
import type { Bbox, Frame, WalkRoute } from "../sources/types";

const MAX_ATTACH_M = 60;
const MIN_SPACING_M = 18;
const MAX_FRAMES = 110;

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function routeBbox(route: WalkRoute, inflateM = 120): Bbox {
  const lats = route.coordinates.map((c) => c[1]);
  const lons = route.coordinates.map((c) => c[0]);
  const dLat = inflateM / 111_320;
  const dLon = inflateM / (111_320 * Math.cos((route.coordinates[0]?.[1] ?? 0) * Math.PI / 180));
  return {
    south: Math.min(...lats) - dLat,
    north: Math.max(...lats) + dLat,
    west: Math.min(...lons) - dLon,
    east: Math.max(...lons) + dLon,
  };
}

/** Distance-along-route for every coordinate, in metres (cumulative). */
function cumulativeDistances(route: WalkRoute): number[] {
  const out: number[] = [0];
  for (let i = 1; i < route.coordinates.length; i++) {
    const [lonA, latA] = route.coordinates[i - 1];
    const [lonB, latB] = route.coordinates[i];
    out.push(out[i - 1] + haversine(latA, lonA, latB, lonB));
  }
  return out;
}

export interface AnchoredFrame extends Frame {
  /** Metres along the route where this frame sits. */
  alongM: number;
}

export async function fetchFramesForRoute(route: WalkRoute, signal?: AbortSignal): Promise<Frame[]> {
  const bbox = routeBbox(route);
  const [pano, mly] = await Promise.allSettled([
    panoramaxFrames(bbox, 400, signal),
    mapillaryFrames(bbox, 60, signal),
  ]);
  const frames = [
    ...(pano.status === "fulfilled" ? pano.value : []),
    ...(mly.status === "fulfilled" ? mly.value : []),
  ];
  const seen = new Set<string>();
  return frames.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

export function matchFramesToRoute(route: WalkRoute, frames: Frame[]): AnchoredFrame[] {
  const cumulative = cumulativeDistances(route);
  const anchored: AnchoredFrame[] = [];
  for (const frame of frames) {
    let bestIdx = -1;
    let bestD = MAX_ATTACH_M;
    for (let i = 0; i < route.coordinates.length; i++) {
      const [lon, lat] = route.coordinates[i];
      const d = haversine(frame.lat, frame.lon, lat, lon);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) anchored.push({ ...frame, alongM: cumulative[bestIdx] });
  }
  anchored.sort((a, b) => a.alongM - b.alongM);

  // Enforce spacing so playback never stalls on clustered frames.
  const spaced: AnchoredFrame[] = [];
  let last = -Infinity;
  for (const frame of anchored) {
    if (frame.alongM - last < MIN_SPACING_M) continue;
    spaced.push(frame);
    last = frame.alongM;
  }
  return spaced.slice(0, MAX_FRAMES);
}
