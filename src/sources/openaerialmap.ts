/**
 * OpenAerialMap v2 STAC — keyless global aerial imagery, CC BY 4.0.
 * Only source-supplied coordinates and timestamps are used. Thumbnails are
 * linked, never rehosted.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { Bbox, PulseItem } from "./types";

interface StacFeature {
  id?: string;
  bbox?: [number, number, number, number] | [number, number, number, number, number, number];
  geometry?: { coordinates?: unknown };
  links?: { rel: string; href: string }[];
  assets?: { thumbnail?: { href: string }; visual?: { href: string }; overview?: { href: string } };
  properties?: {
    title?: string;
    datetime?: string;
    start_datetime?: string;
    created?: string;
    provider?: string;
    license?: string;
  };
}

function centerOf(feature: StacFeature): [number, number] | null {
  if (feature.bbox && feature.bbox.length >= 4) {
    const [west, south, east, north] = feature.bbox;
    return [(south + north) / 2, (west + east) / 2];
  }
  const coords = feature.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2 && Array.isArray(coords[0]) && coords[0].length >= 2) {
    const ring = coords[0] as number[][];
    const xs = ring.map((c) => c[0]).filter(Number.isFinite);
    const ys = ring.map((c) => c[1]).filter(Number.isFinite);
    if (xs.length && ys.length) return [(Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...xs) + Math.max(...xs)) / 2];
  }
  return null;
}

export async function aerialPulse(bbox: Bbox, signal?: AbortSignal): Promise<PulseItem[]> {
  const key = `oam:${bbox.west.toFixed(4)},${bbox.south.toFixed(4)},${bbox.east.toFixed(4)},${bbox.north.toFixed(4)}`;
  return cached(key, 3 * 3600_000, async () => {
    const params = new URLSearchParams({
      bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`,
      limit: "8",
      sortby: "-datetime",
    });
    const res = await fetch(`${endpoints.aerial.stac}?${params}`, { signal });
    if (!res.ok) throw new Error(`openaerialmap ${res.status}`);
    const json = (await res.json()) as { features?: StacFeature[] };
    const out: PulseItem[] = [];
    for (const feature of json.features ?? []) {
      const center = centerOf(feature);
      // Only browser-renderable rasters: a COG/GeoTIFF asset cannot be shown in
      // an <img>, so it is never presented as a photograph.
      const thumb = [
        feature.assets?.thumbnail?.href,
        feature.assets?.visual?.href,
        feature.assets?.overview?.href,
      ].find((href) => typeof href === "string" && /\.(jpe?g|png|webp)([?#]|$)/i.test(href));
      if (!center || !thumb || !feature.id) continue;
      const at = feature.properties?.start_datetime ?? feature.properties?.datetime ?? feature.properties?.created;
      const sourceUrl = feature.links?.find((l) => l.rel === "self")?.href;
      const provider = feature.properties?.provider ?? "OpenAerialMap contributors";
      out.push({
        id: `openaerialmap/${feature.id}`,
        source: "openaerialmap",
        kind: "organic",
        title: feature.properties?.title ?? "Aerial imagery",
        text: `Source: ${provider}`,
        at,
        lat: center[0],
        lon: center[1],
        image: {
          url: thumb,
          thumbUrl: thumb,
          credit: `OpenAerialMap / ${provider}`,
          license: feature.properties?.license ?? "CC BY 4.0",
          sourceUrl,
        },
      });
    }
    return out.slice(0, 8);
  });
}
