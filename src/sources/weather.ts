/**
 * Weather — provider chain from config. MET Norway (free incl. commercial,
 * CC BY 4.0) wants an identifying User-Agent that browsers cannot set, so in
 * direct mode we go through the optional Worker when present; the final
 * fallback is Open-Meteo open-access, whose items are labelled with their
 * non-commercial terms so the UI never hides licensing reality.
 */
import { endpoints, WORKER_MODE, API_BASE } from "../config/endpoints";
import { cached } from "./cache";
import type { WeatherDay } from "./types";

const WMO: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
};

export function describeWeather(code: number): string {
  return WMO[code] ?? "";
}

export async function weatherFor(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherDay[]> {
  return cached(`weather:${lat.toFixed(3)},${lon.toFixed(3)}`, 3 * 3600_000, async () => {
    if (WORKER_MODE) {
      try {
        return await metNo(lat, lon, `${API_BASE}/api/weather`, signal);
      } catch {
        /* fall through */
      }
    }
    try {
      return await metNoDirect(lat, lon, signal);
    } catch {
      return openMeteo(lat, lon, signal);
    }
  });
}

async function metNoDirect(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherDay[]> {
  const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lon.toFixed(4) });
  const res = await fetch(`${endpoints.weather.metNo}?${params}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`met.no ${res.status}`);
  return parseMetNo((await res.json()) as MetNoResponse);
}

async function metNo(lat: number, lon: number, url: string, signal?: AbortSignal): Promise<WeatherDay[]> {
  const res = await fetch(`${url}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`, { signal });
  if (!res.ok) throw new Error(`worker weather ${res.status}`);
  return parseMetNo((await res.json()) as MetNoResponse);
}

interface MetNoResponse {
  properties?: {
    timeseries?: {
      time: string;
      data: {
        instant: { details: { air_temperature?: number; wind_speed?: number; precipitation_amount?: number } };
        next_6_hours?: { details?: { precipitation_amount?: number } };
      };
    }[];
  };
}

function parseMetNo(json: MetNoResponse): WeatherDay[] {
  const byDay = new Map<string, { min: number; max: number; wind: number; precip: number }>();
  for (const ts of json.properties?.timeseries ?? []) {
    const date = ts.time.slice(0, 10);
    const d = ts.data.instant.details;
    const slot = byDay.get(date) ?? { min: Infinity, max: -Infinity, wind: 0, precip: 0 };
    if (d.air_temperature != null) {
      slot.min = Math.min(slot.min, d.air_temperature);
      slot.max = Math.max(slot.max, d.air_temperature);
    }
    slot.wind = Math.max(slot.wind, d.wind_speed ?? 0);
    slot.precip += (ts.data.next_6_hours?.details?.precipitation_amount ?? d.precipitation_amount ?? 0);
    byDay.set(date, slot);
  }
  return [...byDay.entries()]
    .slice(0, 7)
    .map(([date, s]) => ({
      date,
      tempMaxC: Math.round(s.max),
      tempMinC: Math.round(s.min),
      precipitationMm: Math.round(s.precip * 10) / 10,
      windMaxKmh: Math.round(s.wind * 3.6),
      weatherCode: -1,
      provider: "MET Norway (CC BY 4.0)",
    }));
}

async function openMeteo(lat: number, lon: number, signal?: AbortSignal): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,wind_speed_10m_max",
    timezone: "auto",
    forecast_days: "7",
  });
  const res = await fetch(`${endpoints.weather.openMeteo}?${params}`, { signal });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = (await res.json()) as {
    daily?: Record<string, (number | string)[]>;
    timezone?: string;
  };
  const d = j.daily ?? {};
  return (d.time ?? []).map((date, i) => ({
    date: String(date),
    tempMaxC: Math.round(Number(d.temperature_2m_max?.[i] ?? 0)),
    tempMinC: Math.round(Number(d.temperature_2m_min?.[i] ?? 0)),
    precipitationMm: Number(d.precipitation_sum?.[i] ?? 0),
    windMaxKmh: Math.round(Number(d.wind_speed_10m_max?.[i] ?? 0)),
    weatherCode: Number(d.weathercode?.[i] ?? -1),
    provider: "Open-Meteo open-access (non-commercial)",
  }));
}
