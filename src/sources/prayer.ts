/**
 * Prayer times — computed locally by coordinates for anywhere on Earth
 * (no API, cannot go stale). The calculation method comes from the area's
 * data; the timezone is resolved once per area via Open-Meteo's timezone=auto.
 */
import {
  CalculationMethod,
  CalculationParameters,
  Coordinates,
  HighLatitudeRule,
  Madhab,
  PolarCircleResolution,
  PrayerTimes,
} from "adhan";
import { cached } from "./cache";
import type { PrayerDay } from "./types";

const METHODS: Record<string, () => CalculationParameters> = {
  umm_al_qura: () => CalculationMethod.UmmAlQura(),
  mwl: () => CalculationMethod.MuslimWorldLeague(),
  egyptian: () => CalculationMethod.Egyptian(),
  karachi: () => CalculationMethod.Karachi(),
  diyanet: () => CalculationMethod.Turkey(),
  dubai: () => CalculationMethod.Dubai(),
  qatar: () => CalculationMethod.Qatar(),
  kuwait: () => CalculationMethod.Kuwait(),
  singapore: () => CalculationMethod.Singapore(),
  tehran: () => CalculationMethod.Tehran(),
  north_america: () => CalculationMethod.NorthAmerica(),
  moonsighting: () => CalculationMethod.MoonsightingCommittee(),
};

export function areaTimezone(lat: number, lon: number, signal?: AbortSignal): Promise<string> {
  return cached(`tz:${lat.toFixed(3)},${lon.toFixed(3)}`, 30 * 24 * 3600_000, async () => {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=auto&forecast_days=1`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`tz ${res.status}`);
    const j = (await res.json()) as { timezone?: string };
    return j.timezone ?? "UTC";
  });
}

export function computePrayer(
  lat: number,
  lon: number,
  method = "mwl",
  days = 7,
  timeZone = "UTC",
  signal?: AbortSignal
): PrayerDay[] {
  void signal;
  const params = (METHODS[method] ?? METHODS.mwl)();
  params.madhab = Madhab.Shafi;
  // Worldwide-correct edges: recommended high-latitude rule above 48°,
  // and a resolution for polar-circle trips instead of undefined times.
  params.highLatitudeRule = HighLatitudeRule.recommended(new Coordinates(lat, lon));
  params.polarCircleResolution = PolarCircleResolution.AqrabYaum;
  const coords = new Coordinates(lat, lon);
  const fmt = (d: Date): string =>
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });
  const out: PrayerDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const p = new PrayerTimes(coords, date, params);
    out.push({
      date: date.toISOString().slice(0, 10),
      fajr: fmt(p.fajr),
      sunrise: fmt(p.sunrise),
      dhuhr: fmt(p.dhuhr),
      asr: fmt(p.asr),
      maghrib: fmt(p.maghrib),
      isha: fmt(p.isha),
    });
  }
  return out;
}
