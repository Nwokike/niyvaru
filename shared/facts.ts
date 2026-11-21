import type { AreaSummary, Poi } from "../src/types";

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const KIND_LABEL: Record<string, string> = {
  hotel: "hotel",
  pharmacy: "pharmacy",
  shop: "shop",
  restaurant: "restaurant",
  cafe: "cafe",
  mosque: "mosque",
  atm: "ATM",
  hospital: "hospital",
  clinic: "clinic",
  supermarket: "supermarket",
  bank: "bank",
  police: "police",
  place_of_worship: "place of worship",
  toilets: "toilets",
  parking: "parking",
};

export function withDistances(pois: Poi[], center: [number, number]): Poi[] {
  return pois
    .map((p) => ({ ...p, distance_m: Math.round(haversineM(center, [p.lat, p.lon])) }))
    .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
}

/** Compact, grounded facts block. Small enough for any open model's window. */
export function areaFacts(area: AreaSummary): string {
  const lines: string[] = [];
  lines.push(`AREA: ${area.name} (center ${area.center[0].toFixed(4)}, ${area.center[1].toFixed(4)}, radius ${area.radius_m} m)`);

  const byKind = new Map<string, number>();
  for (const p of area.pois) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
  const counts = [...byKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(", ");
  lines.push(`PLACE COUNTS: ${counts || "none"}`);

  const top = withDistances(area.pois, area.center).slice(0, 60);
  lines.push("PLACES (name | kind | distance_m | opening_hours | wheelchair | phone | website):");
  for (const p of top) {
    const t = p.tags || {};
    const bits = [
      p.name_en || p.name,
      KIND_LABEL[p.kind] || p.kind,
      `${p.distance_m ?? "?"}m`,
      t.opening_hours ? `open:${t.opening_hours}` : null,
      t.wheelchair ? `wheelchair:${t.wheelchair}` : null,
      t.phone ?? null,
      t.website ?? null,
    ].filter(Boolean);
    lines.push(`- ${bits.join(" | ")}`);
  }

  const today = area.prayer?.[0];
  if (today) {
    lines.push(
      `PRAYER TIMES TODAY (${today.date}): Fajr ${today.fajr}, Sunrise ${today.sunrise}, Dhuhr ${today.dhuhr}, Asr ${today.asr}, Maghrib ${today.maghrib}, Isha ${today.isha}.`
    );
  }
  const w = area.weather?.[0];
  if (w) {
    lines.push(
      `WEATHER TODAY: high ${w.temp_max_c}C, low ${w.temp_min_c}C, precipitation ${w.precipitation_mm}mm, wind max ${w.wind_max_kmh} km/h, code ${w.weathercode}.`
    );
  }
  if (area.events?.length) {
    lines.push(`LIVE EVENTS: ${area.events.map((e) => `${e.title} (${e.category})`).join("; ")}`);
  } else {
    lines.push("LIVE EVENTS: none reported in this area.");
  }
  if (area.routes?.length) {
    lines.push(
      `WALKS: ${area.routes.map((r) => `${r.name} [${r.id}] ${r.distance_m}m, ${Math.round(r.duration_s / 60)}min${r.wheelchair ? ", wheelchair-flagged" : ""}`).join("; ")}`
    );
  }
  return lines.join("\n");
}
