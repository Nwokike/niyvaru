/**
 * Mapillary — street imagery, 100% free for any use (Meta), CC-BY-SA.
 * Requires a free developer token from config. Without a token the adapter
 * is simply unavailable and the app degrades to Panoramax/OpenFreeMap.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { Bbox, Frame } from "./types";

function available(): boolean {
  return Boolean(endpoints.mapillary.token);
}

const MAX_BBOX_DEG = 0.01; // API limit for the images bbox search

function splitBbox(bbox: Bbox): Bbox[] {
  const width = bbox.east - bbox.west;
  const height = bbox.north - bbox.south;
  const cols = Math.max(1, Math.ceil(width / MAX_BBOX_DEG));
  const rows = Math.max(1, Math.ceil(height / MAX_BBOX_DEG));
  const cells: Bbox[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      cells.push({
        west: bbox.west + (width * c) / cols,
        east: bbox.west + (width * (c + 1)) / cols,
        south: bbox.south + (height * r) / rows,
        north: bbox.south + (height * (r + 1)) / rows,
      });
    }
  }
  return cells;
}

export async function framesInBbox(bbox: Bbox, limitPerCell = 60, signal?: AbortSignal): Promise<Frame[]> {
  if (!available()) return [];
  const token = endpoints.mapillary.token!;
  const key = `mapillary:frames:${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`;
  return cached(key, 24 * 3600_000, async () => {
    const cells = splitBbox(bbox).slice(0, 16);
    const results = await Promise.allSettled(
      cells.map(async (cell) => {
        const params = new URLSearchParams({
          bbox: `${cell.west},${cell.south},${cell.east},${cell.north}`,
          limit: String(limitPerCell),
          fields: "id,geometry,compass_angle,captured_at,thumb_1024_url,is_pano",
        });
        const res = await fetch(`${endpoints.mapillary.api}/images?${params}`, {
          headers: { Authorization: `OAuth ${token}` },
          signal,
        });
        if (!res.ok) throw new Error(`mapillary ${res.status}`);
        const json = (await res.json()) as {
          data: {
            id: string;
            geometry: { coordinates: [number, number] };
            compass_angle?: number;
            captured_at?: string;
            thumb_1024_url?: string;
          }[];
        };
        return json.data
          .filter((d) => d.geometry?.coordinates && d.thumb_1024_url)
          .map<Frame>((d) => ({
            id: `mapillary/${d.id}`,
            url: d.thumb_1024_url!,
            thumbUrl: d.thumb_1024_url!,
            lat: d.geometry.coordinates[1],
            lon: d.geometry.coordinates[0],
            heading: d.compass_angle ?? 0,
            capturedAt: d.captured_at ?? "",
            source: "mapillary",
          }));
      })
    );
    const frames = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    // de-dupe across cells
    const seen = new Set<string>();
    return frames.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
  });
}
