/**
 * Wikimedia Commons geosearch — real photographs of real places, worldwide,
 * keyless, CORS-open. Photos carry their attribution and licence so the UI
 * can always credit the photographer (Commons requirement).
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { Photo } from "./types";

interface CommonsImageInfo {
  url: string;
  thumburl?: string;
  descriptionurl?: string;
  extmetadata?: {
    Artist?: { value: string };
    LicenseShortName?: { value: string };
    ObjectName?: { value: string };
  };
}

function stripHtml(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const text = s.replace(/<[^>]*>/g, "").trim();
  return text || undefined;
}

export async function photosNear(
  lat: number,
  lon: number,
  radiusM: number,
  limit = 100,
  signal?: AbortSignal
): Promise<Photo[]> {
  const radius = Math.min(Math.max(radiusM, 10), 10000);
  const key = `commons:${lat.toFixed(4)},${lon.toFixed(4)},${radius}`;
  return cached(key, 7 * 24 * 3600_000, async () => {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "geosearch",
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radius),
      ggslimit: String(limit),
      gsnamespace: "6",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: String(endpoints.commons.thumbWidth),
    });
    const res = await fetch(`${endpoints.commons.api}?${params}`, { signal });
    if (!res.ok) throw new Error(`commons ${res.status}`);
    const json = (await res.json()) as { query?: { pages?: Record<string, { title: string; imageinfo?: CommonsImageInfo[] }> } };
    const pages = Object.values(json.query?.pages ?? {});
    const photos: Photo[] = [];
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info?.url) continue;
      const isPhoto = /\.(jpe?g|png|webp)$/i.test(info.url.split("?")[0] ?? "");
      if (!isPhoto) continue;
      photos.push({
        url: info.url,
        thumbUrl: info.thumburl ?? info.url,
        attribution: stripHtml(info.extmetadata?.Artist?.value) ?? page.title,
        license: stripHtml(info.extmetadata?.LicenseShortName?.value),
        source: "commons",
      });
    }
    return photos;
  });
}
