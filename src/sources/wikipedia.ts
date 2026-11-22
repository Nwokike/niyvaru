/**
 * Wikipedia geosearch — the encyclopedic story of a place, in the area's
 * language when available. Keyless, CORS-open.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { PlaceStory } from "./types";

export async function storiesNear(
  lat: number,
  lon: number,
  lang = "en",
  radiusM = 2000,
  limit = 12,
  signal?: AbortSignal
): Promise<PlaceStory[]> {
  const radius = Math.min(Math.max(radiusM, 10), 10000);
  const key = `wikipedia:${lang}:${lat.toFixed(4)},${lon.toFixed(4)},${radius}`;
  return cached(key, 7 * 24 * 3600_000, async () => {
    const endpoint = endpoints.wikipedia.base.replace("{lang}", lang);
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      generator: "geosearch",
      ggscoord: `${lat}|${lon}`,
      ggsradius: String(radius),
      ggslimit: String(limit),
      prop: "extracts|info",
      inprop: "url",
      exintro: "1",
      explaintext: "1",
      exsectionformat: "plain",
    });
    const res = await fetch(`${endpoint}?${params}`, { signal });
    if (!res.ok) throw new Error(`wikipedia ${res.status}`);
    const json = (await res.json()) as {
      query?: { pages?: Record<string, { title: string; extract?: string; fullurl?: string }> };
    };
    return Object.values(json.query?.pages ?? {})
      .filter((p) => p.extract && p.extract.length > 80)
      .map((p) => ({
        title: p.title,
        extract: p.extract!,
        pageUrl: p.fullurl ?? "",
        lang,
      }));
  });
}
