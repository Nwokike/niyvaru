/**
 * Wikimedia Commons geosearch — the single coordinate-aware adapter for real
 * photographs of real places, worldwide, keyless, CORS-open. Every photo
 * keeps its author and licence so the UI can always credit the photographer
 * (Commons requirement). Results are cached with a background refresh.
 */
import { endpoints } from "../config/endpoints";
import { cachedWithRefresh } from "./cache";
import { debugLog } from "../debug";
import type { Photo, PulseItem } from "./types";

export interface AnchoredPhoto {
  photo: Photo;
  lat: number;
  lon: number;
  /** Raw Commons file title, e.g. "File:Blue Mosque.jpg". */
  title: string;
  /** Human-readable name from extmetadata (may still contain markup). */
  objectName?: string;
  /** Source-supplied last change time, used by the happening feed. */
  at?: string;
  /** Commons file description page. */
  sourceUrl?: string;
}

interface CommonsImageInfo {
  url: string;
  descriptionurl?: string;
  timestamp?: string;
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
  const key = `commons-anchored-v2:${lat.toFixed(4)},${lon.toFixed(4)},${radius},${limit}`;
  return cachedWithRefresh(key, COMMONS_TTL_MS, async () => {
    debugLog("commons", "geosearch", { lat, lon, radius, limit });
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "geosearch",
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radius),
      ggslimit: String(Math.min(Math.max(limit, 1), 500)),
      ggsnamespace: "6",
      prop: "coordinates|imageinfo",
      iiprop: "url|extmetadata|timestamp",
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
        at: info.timestamp,
        sourceUrl: info.descriptionurl,
      });
    }
    return out;
  });
}

/**
 * Commons photographs near the area. Recent uploads lead; when a city has no
 * upload inside the window, the newest available photographs still appear,
 * undated, so the feed never hides real imagery behind a calendar rule. The
 * Commons timestamp is a file change date, never an invented capture date.
 */
export async function commonsRecentPulse(
  lat: number,
  lon: number,
  radiusM: number,
  signal?: AbortSignal
): Promise<PulseItem[]> {
  const photos = await anchoredPhotosNear(lat, lon, radiusM, 80, signal);
  const cutoff = Date.now() - 30 * 24 * 3600_000;
  const dated = photos.filter((p) => p.at).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  const fresh = dated.filter((p) => new Date(p.at!).getTime() >= cutoff);
  const chosen = fresh.length ? fresh : dated;
  return chosen.slice(0, 8).map<PulseItem>((p) => {
    const isFresh = p.at != null && new Date(p.at).getTime() >= cutoff;
    return {
      id: `commons/${p.title}`,
      source: "commons",
      kind: "organic",
      title: p.objectName ?? p.title.replace(/^File:/, ""),
      text: isFresh ? "Recently updated photograph near this area" : "Photograph near this area",
      at: isFresh ? p.at : undefined,
      lat: p.lat,
      lon: p.lon,
      image: {
        url: p.photo.url,
        thumbUrl: p.photo.thumbUrl,
        credit: p.photo.attribution,
        license: p.photo.license,
        sourceUrl: p.sourceUrl,
      },
    };
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
