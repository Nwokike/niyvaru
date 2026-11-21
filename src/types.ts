export interface Poi {
  id: string;
  name: string;
  name_en?: string;
  lat: number;
  lon: number;
  kind: string;
  tags: Record<string, string>;
  distance_m?: number;
}

export interface Frame {
  url: string;
  thumb: string;
  lat: number;
  lon: number;
  heading: number;
  datetime: string;
}

export interface FrameSequence {
  id: string;
  title: string;
  frames: Frame[];
}

export interface WalkRoute {
  id: string;
  name: string;
  profile: string;
  wheelchair: boolean;
  distance_m: number;
  duration_s: number;
  geometry: { type: "LineString"; coordinates: [number, number][] };
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

export interface WeatherDay {
  date: string;
  temp_max_c: number;
  temp_min_c: number;
  precipitation_mm: number;
  weathercode: number;
  wind_max_kmh: number;
}

export interface LiveEvent {
  id: string;
  title: string;
  category: string;
  lat: number;
  lon: number;
  updated: string;
  link?: string;
}

export interface AreaPack {
  id: string;
  name: string;
  version: string;
  generated_at: string;
  center: [number, number];
  radius_m: number;
  pois: Poi[];
  routes: WalkRoute[];
  sequences: FrameSequence[];
  prayer: PrayerDay[];
  weather: WeatherDay[];
  events: LiveEvent[];
}

export interface PackIndex {
  version: string;
  generated_at: string;
  areas: { id: string; name: string; center: [number, number]; radius_m: number; file: string }[];
}

export interface Profile {
  version: 1;
  name?: string;
  mobility?: "wheelchair" | "limited" | "none";
  budget_usd_per_night?: number;
  preferences: string[];
  constraints: string[];
  interests: string[];
  language: string;
  home_area?: string;
  notes: string[];
  updated_at: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AreaSummary {
  id: string;
  name: string;
  center: [number, number];
  radius_m: number;
  pois: Poi[];
  routes: WalkRoute[];
  prayer: PrayerDay[];
  weather: WeatherDay[];
  events: LiveEvent[];
}

export type AgentAction =
  | { action: "focus_poi"; id: string }
  | { action: "highlight_kind"; kind: string }
  | { action: "show_route"; id: string }
  | { action: "start_walk"; route?: string; sequence?: string }
  | { action: "clear" };

export interface Post {
  id: string;
  area: string;
  place_id?: string;
  place_name?: string;
  body: string;
  mood: string;
  created_at: string;
}
