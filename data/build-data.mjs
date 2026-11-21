/**
 * Niyvaru data pipeline — builds the static per-area packs.
 *
 * Everything here is free and keyless:
 *   - OpenStreetMap via the public Overpass API (attribution: © OSM contributors, ODbL)
 *   - Panoramax street-level frames (CC-BY-SA 4.0, no API key)
 *   - Prayer times computed locally with the adhan library (no API)
 *   - Weather from Open-Meteo (free/open-access; see README for the commercial note)
 *   - Live natural events from NASA EONET (public domain, no key)
 *   - Walking geometry from the public OSRM demo (prototype only; self-host later)
 *
 * Run: npm run data   (writes public/packs/*.json)
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Coordinates, CalculationMethod, Madhab, PrayerTimes } from "adhan";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "packs");
const UA = "niyvaru-data/0.1 (prototype; contact: nwokikeonyeka@gmail.com)";

const AREA = {
  id: "makkah-haram",
  name: "Makkah — Haram",
  center: [21.4225, 39.8262],
  radius_m: 2000,
  bbox: [21.395, 39.795, 21.455, 39.865], // south, west, north, east
};

const today = new Date().toISOString().slice(0, 10);
const version = today;

async function overpassPois() {
  const [s, w, n, e] = AREA.bbox;
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:60];
(
  node["tourism"="hotel"](${bbox});
  way["tourism"="hotel"](${bbox});
  node["amenity"="pharmacy"](${bbox});
  way["amenity"="pharmacy"](${bbox});
  node["amenity"="restaurant"](${bbox});
  way["amenity"="restaurant"](${bbox});
  node["amenity"="cafe"](${bbox});
  way["amenity"="cafe"](${bbox});
  node["shop"](${bbox});
  way["shop"](${bbox});
  node["amenity"~"^(hospital|clinic|atm|bank|toilets|police|place_of_worship)$"](${bbox});
  way["amenity"~"^(hospital|clinic|atm|bank|toilets|police|place_of_worship)$"](${bbox});
);
out center tags;`;
  const hosts = [
    "https://overpass.openstreetmap.fr/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];
  let json = null;
  let lastErr = null;
  for (const host of hosts) {
    try {
      const res = await fetch(host, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA, Accept: "application/json" },
        body: new URLSearchParams({ data: query }),
      });
      if (!res.ok) {
        lastErr = new Error(`overpass ${host} ${res.status}`);
        continue;
      }
      json = await res.json();
      if (!json.elements) {
        lastErr = new Error(`overpass ${host} returned no elements`);
        continue;
      }
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!json) throw lastErr ?? new Error("all overpass mirrors failed");
  const out = [];
  const seen = new Set();
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    let kind = null;
    if (tags.tourism === "hotel") kind = "hotel";
    else if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy") kind = "pharmacy";
    else if (tags.amenity === "restaurant") kind = "restaurant";
    else if (tags.amenity === "cafe") kind = "cafe";
    else if (tags.amenity === "place_of_worship") kind = tags.religion === "muslim" ? "mosque" : "place_of_worship";
    else if (tags.amenity) kind = tags.amenity;
    else if (tags.shop) kind = "shop";
    if (!kind) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: tags.name ?? tags["name:ar"] ?? "(unnamed)",
      name_en: tags["name:en"] || null,
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      kind,
      tags: {
        opening_hours: tags.opening_hours || "",
        wheelchair: tags.wheelchair || "",
        phone: tags.phone || "",
        website: tags.website || "",
        addr_street: tags["addr:street"] || "",
        addr_housenumber: tags["addr:housenumber"] || "",
        denomination: tags.denomination || "",
        religion: tags.religion || "",
      },
    });
  }
  return out;
}

async function panoramaxFrames() {
  const [s, w, n, e] = AREA.bbox;
  const url = `https://api.panoramax.xyz/api/search?bbox=${w},${s},${e},${n}&limit=1000`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`panoramax ${res.status}`);
  const json = await res.json();
  const groups = new Map();
  for (const f of json.features ?? []) {
    const col = f.collection ?? f.properties?.collection?.id ?? "unknown";
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (lat == null || lon == null) continue;
    if (!groups.has(col)) groups.set(col, []);
    groups.get(col).push({
      url: f.assets?.hd?.href ?? f.assets?.sd?.href ?? "",
      thumb: f.assets?.thumb?.href ?? f.assets?.sd?.href ?? "",
      lat,
      lon,
      heading: f.properties?.["view:azimuth"] ?? 0,
      datetime: f.properties?.datetime ?? f.properties?.datetimetz ?? "",
    });
  }
  const sequences = [];
  let i = 0;
  for (const [col, frames] of groups) {
    if (frames.length < 2) continue;
    frames.sort((a, b) => String(a.datetime).localeCompare(String(b.datetime)));
    i += 1;
    sequences.push({ id: `seq-${i}`, title: `Street walk ${i}`, frames });
  }
  sequences.sort((a, b) => b.frames.length - a.frames.length);
  return sequences.slice(0, 12);
}

function prayerTimes() {
  const coords = new Coordinates(AREA.center[0], AREA.center[1]);
  const params = CalculationMethod.MuslimWorldLeague();
  params.madhab = Madhab.Shafi;
  const days = [];
  for (let d = 0; d < 30; d++) {
    const date = new Date();
    date.setDate(date.getDate() + d);
    const p = new PrayerTimes(coords, date, params);
    const fmt = (x) => x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh", hour12: false });
    days.push({
      date: date.toISOString().slice(0, 10),
      fajr: fmt(p.fajr),
      sunrise: fmt(p.sunrise),
      dhuhr: fmt(p.dhuhr),
      asr: fmt(p.asr),
      maghrib: fmt(p.maghrib),
      isha: fmt(p.isha),
    });
  }
  return days;
}

async function weather() {
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${AREA.center[0]}&longitude=${AREA.center[1]}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode,wind_speed_10m_max&timezone=Asia%2FRiyadh&forecast_days=7`,
    { headers: { "User-Agent": UA } }
  );
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = await res.json();
  const d = j.daily ?? {};
  return (d.time ?? []).map((date, i) => ({
    date,
    temp_max_c: d.temperature_2m_max?.[i] ?? 0,
    temp_min_c: d.temperature_2m_min?.[i] ?? 0,
    precipitation_mm: d.precipitation_sum?.[i] ?? 0,
    weathercode: d.weathercode?.[i] ?? 0,
    wind_max_kmh: d.wind_speed_10m_max?.[i] ?? 0,
  }));
}

async function events() {
  const [s, w, n, e] = AREA.bbox;
  try {
    const res = await fetch(`https://eonet.gsfc.nasa.gov/api/v3/events?bbox=${w},${s},${e},${n}&status=open&limit=20`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const j = await res.json();
    return (j.events ?? []).map((ev) => {
      const geo = ev.geometry?.[0];
      const [lon, lat] = geo?.coordinates ?? [];
      return {
        id: String(ev.id),
        title: ev.title,
        category: ev.categories?.[0]?.title ?? "event",
        lat: lat ?? AREA.center[0],
        lon: lon ?? AREA.center[1],
        updated: ev.updated ?? "",
        link: ev.link ?? ev.sources?.[0]?.url ?? "",
      };
    });
  } catch {
    return [];
  }
}

async function osrmRoute(id, name, from, to) {
  const coords = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const profiles = ["foot", "walking", "driving"];
  for (const profile of profiles) {
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`,
        { headers: { "User-Agent": UA } }
      );
      if (!res.ok) continue;
      const j = await res.json();
      const r = j.routes?.[0];
      if (!r) continue;
      return {
        id,
        name,
        profile: "walking",
        wheelchair: false,
        distance_m: Math.round(r.distance),
        duration_s: Math.round(r.duration),
        geometry: r.geometry,
      };
    } catch {
      /* try next profile */
    }
  }
  return null;
}

async function routes() {
  const [lat, lon] = AREA.center;
  const defs = [
    ["walk-haram-ajyad", "Haram → Ajyad pharmacy row", [lat, lon], [21.4185, 39.8245]],
    ["walk-haram-gate", "Haram → King Abdulaziz Gate", [lat, lon], [21.4255, 39.8305]],
    ["walk-haram-jabal", "Haram → Jabal Omar", [lat, lon], [21.4175, 39.8315]],
  ];
  const out = [];
  for (const [id, name, from, to] of defs) {
    const r = await osrmRoute(id, name, from, to);
    if (r) out.push(r);
  }
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const [pois, sequences, prayer, weatherDays, eventList, routeList] = await Promise.all([
    overpassPois().catch((e) => (console.error("pois:", e.message), [])),
    panoramaxFrames().catch((e) => (console.error("frames:", e.message), [])),
    Promise.resolve(prayerTimes()),
    weather().catch((e) => (console.error("weather:", e.message), [])),
    events().catch((e) => (console.error("events:", e.message), [])),
    routes().catch((e) => (console.error("routes:", e.message), [])),
  ]);

  const pack = {
    id: AREA.id,
    name: AREA.name,
    version,
    generated_at: new Date().toISOString(),
    center: AREA.center,
    radius_m: AREA.radius_m,
    pois,
    routes: routeList,
    sequences,
    prayer,
    weather: weatherDays,
    events: eventList,
  };

  await writeFile(path.join(OUT_DIR, "index.json"), JSON.stringify({
    version,
    generated_at: new Date().toISOString(),
    areas: [{ id: AREA.id, name: AREA.name, center: AREA.center, radius_m: AREA.radius_m, file: `${AREA.id}.json` }],
  }, null, 2));
  await writeFile(path.join(OUT_DIR, `${AREA.id}.json`), JSON.stringify(pack, null, 2));

  console.log(`pack ${AREA.id} v${version}: ${pois.length} pois, ${sequences.length} frame sequences, ${routeList.length} routes, ${eventList.length} events`);
  const byKind = {};
  for (const p of pois) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  console.log("kinds:", JSON.stringify(byKind));
}

main();
