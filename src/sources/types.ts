/** Shared vocabulary for every source adapter and the assembled area pack. */

export interface Bbox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface AreaMeta {
  id: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
  radiusM: number;
  zoom?: number;
  language?: string;
  /** Prayer calculation method as data (adhan supports every major method). */
  prayerMethod?: string;
  feeds?: {
    hashtags?: string[];
    gdeltQuery?: string;
  };
}

export interface GeocodeResult {
  id?: string;
  name: string;
  secondary?: string;
  country?: string;
  lat: number;
  lon: number;
  /** Suggested view bbox [west, south, east, north] when the result is an area. */
  extent?: [number, number, number, number];
}

export type PhotoSource = "commons" | "panoramax" | "mapillary";

export interface Photo {
  url: string;
  thumbUrl: string;
  attribution: string;
  license?: string;
  source: PhotoSource;
}

export interface PlaceStory {
  title: string;
  extract: string;
  pageUrl: string;
  lang: string;
}

export interface PlaceTags {
  openingHours?: string;
  wheelchair?: string;
  phone?: string;
  website?: string;
  cuisine?: string;
  addrStreet?: string;
  addrNumber?: string;
  takeaway?: string;
  outdoorSeating?: string;
  internet?: string;
}

export interface Place {
  id: string;
  name: string;
  nameEn?: string;
  lat: number;
  lon: number;
  /** Normalized kind (hotel, pharmacy, cafe, mosque, shop, …). */
  kind: string;
  distanceM?: number;
  tags: PlaceTags;
  photos: Photo[];
  story?: PlaceStory;
  /** Raw source: "osm" or "overture" — kept so enrichment can prefer one. */
  origin: "osm";
}

export interface WalkRoute {
  id: string;
  name: string;
  /** metres */
  distanceM: number;
  /** seconds */
  durationS: number;
  /** GeoJSON order: [lon, lat]. */
  coordinates: [number, number][];
}

export interface Frame {
  id: string;
  url: string;
  thumbUrl: string;
  lat: number;
  lon: number;
  /** Degrees from north. */
  heading: number;
  capturedAt: string;
  source: PhotoSource;
  /** Source-supplied credit and licence, when the API exposes them. */
  credit?: string;
  license?: string;
}

export type PulseSource =
  | "gdelt"
  | "bluesky"
  | "mastodon"
  | "wikipedia"
  | "local"
  | "weather"
  | "prayer"
  | "promotions"
  | "commons"
  | "panoramax"
  | "openaerialmap";

/** External, source-hosted preview — linked only, never rehosted by the app. */
export interface PulseImage {
  url: string;
  thumbUrl: string;
  credit: string;
  license?: string;
  sourceUrl?: string;
}

export interface PulseItem {
  id: string;
  source: PulseSource;
  /** Organic = from a live source or a traveller. Promoted = paid local placement. */
  kind: "organic" | "promoted";
  title: string;
  text?: string;
  url?: string;
  at?: string;
  /** Only set when the source itself supplies a real location. */
  lat?: number;
  lon?: number;
  /** Source-hosted preview image, linked and credited. */
  image?: PulseImage;
  sponsor?: {
    name: string;
    note?: string;
  };
}

export interface WeatherDay {
  date: string;
  tempMaxC: number;
  tempMinC: number;
  precipitationMm: number;
  windMaxKmh: number;
  weatherCode: number;
  /** e.g. "met.no (CC BY 4.0)" — shown in the UI so the source is never hidden. */
  provider: string;
}

export interface PrayerDay {
  date: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

export interface AreaPack {
  id: string;
  name: string;
  country?: string;
  /** ISO timestamp; newer version replaces the cached pack. */
  version: string;
  /** [lat, lon] */
  center: [number, number];
  radiusM: number;
  zoom: number;
  language: string;
  places: Place[];
  routes: WalkRoute[];
  prayer: PrayerDay[];
  weather: WeatherDay[];
  pulse: PulseItem[];
  heroPhoto?: Photo;
  /** Source → required credit line. */
  attribution: Record<string, string>;
  feeds: AreaMeta["feeds"];
  prayerMethod?: string;
}

/** Destination archetypes used to choose generic walking routes in any city. */
export type RoutePurpose = "landmark" | "practical" | "green" | "worship";
