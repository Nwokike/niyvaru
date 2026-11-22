/**
 * GDELT DOC 2.0 — worldwide news geolocated by mention, "100% free and open",
 * no key. Some deployments lack CORS; the adapter fails softly and the
 * optional Worker mode (config) can proxy it.
 */
import { endpoints } from "../config/endpoints";
import { cached } from "./cache";
import type { PulseItem } from "./types";

export async function newsForArea(
  areaName: string,
  query?: string,
  signal?: AbortSignal
): Promise<PulseItem[]> {
  const q = query ?? areaName;
  return cached(`gdelt:${q}`, 15 * 60_000, async () => {
    const params = new URLSearchParams({
      query: `${q} sourcelang:eng`,
      mode: "ArtList",
      maxrecords: "12",
      format: "json",
      timespan: "2d",
      sort: "datedesc",
    });
    // GDELT often hangs for 15 s+ from browser origins. News is optional
    // pulse, never a gate on showing the assembled city.
    const deadline = AbortSignal.timeout(5000);
    const res = await fetch(`${endpoints.gdelt.doc}?${params}`, {
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!res.ok) throw new Error(`gdelt ${res.status}`);
    const json = (await res.json()) as {
      articles?: { url: string; title: string; seendate?: string; domain?: string; socialimage?: string }[];
    };
    return (json.articles ?? []).map<PulseItem>((a) => ({
      id: `gdelt/${a.url}`,
      source: "gdelt",
      kind: "organic",
      title: a.title,
      url: a.url,
      at: parseGdeltDate(a.seendate),
    }));
  });
}

/** GDELT dates look like 20261122T093000Z. */
function parseGdeltDate(s?: string): string | undefined {
  if (!s || s.length < 15) return undefined;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
