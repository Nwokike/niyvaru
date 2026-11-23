/**
 * Wikimedia Commons geosearch — the single coordinate-aware adapter for real
 * photographs of real places, worldwide, keyless, CORS-open. Every photo
 * keeps its author and licence so the UI can always credit the photographer
 * (Commons requirement). Results are cached with a background refresh.
 */
import { endpoints } from "../config/endpoints";
import { cachedWithRefresh } from "./cache";
import type { Photo } from "./types";

export interface AnchoredPhoto {
  photo: Photo;
  lat: number;
  lon: number;
  /** Raw Commons file title, e.g. "File:Blue Mosque.jpg". */
  title: string;
  /** Human-readable name from extmetadata (may still contain markup). */
  objectName?: string;
}

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  extmetadata?: {
    Artist?: { value: string };
    LicenseShortName?: { value: string };
    ObjectName?: { value: string };
  };
}

/** Commons metadata is HTML with entities — turn it into plain credit text. */
function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const text = s
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const hex = code[1]?.toLowerCase() === "x";
        const num = parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(num) && num > 0 && num <= 0x10ffff
          ? String.fromCodePoint(num)
          : " ";
      }
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
        ndash: "–",
        mdash: "—",
      };
      return named[code.toLowerCase()] ?? " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

const COMMONS_TTL_MS = 7 * 24 * 3600_000;

/**
 * Geosearch WITH per-file coordinates and titles, so photos can be attached
 * to the exact place they depict (or named on the file page). Stale cache
 * hits are returned immediately and refreshed in the background.
 */
export async function anchoredPhotosNear(
  lat: number,
  lon: number,
  radiusM: number,
  limit = 120,
  signal?: AbortSignal
): Promise<AnchoredPhoto[]> {
  const radius = Math.min(Math.max(radiusM, 10), 10000);
  const key = `commons-anchored:${lat.toFixed(4)},${lon.toFixed(4)},${radius},${limit}`;
  return cachedWithRefresh(key, COMMONS_TTL_MS, async () => {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "geosearch",
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radius),
      ggslimit: String(Math.min(Math.max(limit, 1), 500)),
      gsnamespace: "6",
      prop: "coordinates|imageinfo",
      iiprop: "url|extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName|ObjectName",
      iiurlwidth: String(endpoints.commons.thumbWidth),
    });
    const res = await fetch(`${endpoints.commons.api}?${params}`, { signal });
    if (!res.ok) throw new Error(`commons ${res.status}`);
    const json = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            title: string;
            coordinates?: { lat: number; lon: number }[];
            imageinfo?: CommonsImageInfo[];
          }
        >;
      };
    };
    const out: AnchoredPhoto[] = [];
    for (const page of Object.values(json.query?.pages ?? {})) {
      const info = page.imageinfo?.[0];
      const coord = page.coordinates?.[0];
      if (!info?.url || !coord) continue;
      if (!/\.(jpe?g|png|webp)$/i.test(info.url.split("?")[0] ?? "")) continue;
      out.push({
        photo: {
          url: info.url,
          thumbUrl: info.thumburl ?? info.url,
          attribution: stripHtml(info.extmetadata?.Artist?.value) ?? page.title,
          license: stripHtml(info.extmetadata?.LicenseShortName?.value),
          source: "commons",
        },
        lat: coord.lat,
        lon: coord.lon,
        title: page.title,
        objectName: stripHtml(info.extmetadata?.ObjectName?.value),
      });
    }
    return out;
  });
}

/** Plain photo list for callers that do not need coordinates — same adapter. */
export async function photosNear(
  lat: number,
  lon: number,
  radiusM: number,
  limit = 100,
  signal?: AbortSignal
): Promise<Photo[]> {
  return (await anchoredPhotosNear(lat, lon, radiusM, limit, signal)).map((a) => a.photo);
}
