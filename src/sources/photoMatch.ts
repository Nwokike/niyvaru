/**
 * Shared fuzzy title matching. OSM place names and Commons file titles (or
 * extmetadata ObjectName) rarely match byte-for-byte, so compare normalized
 * forms. Used both for Wikipedia story attachment and Commons photographs.
 */
import type { Place } from "./types";

export interface TitleMatch {
  place: Place;
  /** 3 = exact, 2 = containment, 1 = shared distinctive word. */
  score: number;
}

/** Commons titles look like "File:Blue Mosque, Istanbul.jpg" — make them comparable to OSM names. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Best place whose name resembles the given title, with a strength score. */
export function matchByTitleScore(title: string, places: Place[]): TitleMatch | undefined {
  const needle = normalizeTitle(title);
  if (!needle) return undefined;
  let best: TitleMatch | undefined;
  for (const place of places) {
    const name = normalizeTitle(place.nameEn ?? place.name);
    if (!name) continue;
    let score = 0;
    if (name === needle) score = 3;
    else if (name.includes(needle) || needle.includes(name)) score = 2;
    else if (name.split(/\s+/).some((word) => word.length > 3 && needle.includes(word))) score = 1;
    if (score > (best?.score ?? 0)) best = { place, score };
  }
  // A single shared word is too weak to attach real content to a place.
  return best && best.score >= 2 ? best : undefined;
}

export function matchByTitle(title: string, places: Place[]): Place | undefined {
  return matchByTitleScore(title, places)?.place;
}
