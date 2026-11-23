/**
 * Compact, grounded facts block — everything the agent may claim about the
 * current area, small enough for any free model's window. Every place id
 * listed below is ready to use directly in tool calls — reuse those ids and
 * their facts instead of re-searching for the same places.
 */
import type { AreaPack, Place } from "../sources/types";

const MAX_PLACES = 80;

function placeLine(p: Place): string {
  const t = p.tags;
  const bits = [
    `[${p.id}]`,
    p.nameEn ?? p.name,
    p.kind,
    `${p.distanceM ?? "?"}m`,
    t.openingHours ? `open:${t.openingHours}` : null,
    t.wheelchair ? `wheelchair:${t.wheelchair}` : null,
    t.phone ?? null,
    t.website ?? null,
    p.photos.length ? `photos:${p.photos.length}` : null,
    p.story ? "story:yes" : null,
  ].filter(Boolean);
  return `- ${bits.join(" | ")}`;
}

export function areaFacts(pack: AreaPack): string {
  const lines: string[] = [];
  lines.push(`AREA: ${pack.name}${pack.country ? `, ${pack.country}` : ""} (centre ${pack.center[0].toFixed(4)}, ${pack.center[1].toFixed(4)}, radius ${pack.radiusM} m)`);
  lines.push(`ASSEMBLED: ${pack.version}`);

  const counts = new Map<string, number>();
  for (const p of pack.places) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  lines.push(`PLACE COUNTS: ${[...counts.entries()].map(([k, n]) => `${n} ${k}`).join(", ") || "none"}`);

  const featured = pack.places.slice(0, MAX_PLACES);
  lines.push(`PLACES (id | name | kind | distance | facts) — these listed ids are ready to use directly in tool calls; reuse them instead of searching again:`);
  for (const p of featured) lines.push(placeLine(p));

  if (pack.routes.length) {
    lines.push(
      `WALKS: ${pack.routes.map((r) => `${r.name} [${r.id}] ${r.distanceM}m ${Math.round(r.durationS / 60)}min`).join("; ")}`
    );
  }
  const today = pack.prayer[0];
  if (today) {
    lines.push(
      `PRAYER TIMES TODAY (${today.date}): Fajr ${today.fajr}, Sunrise ${today.sunrise}, Dhuhr ${today.dhuhr}, Asr ${today.asr}, Maghrib ${today.maghrib}, Isha ${today.isha}.`
    );
  }
  const weather = pack.weather[0];
  if (weather) {
    lines.push(
      `WEATHER TODAY (${weather.provider}): high ${weather.tempMaxC}°C, low ${weather.tempMinC}°C, precipitation ${weather.precipitationMm}mm, wind max ${weather.windMaxKmh} km/h.`
    );
  }
  if (pack.pulse.length) {
    lines.push(`PULSE (latest): ${pack.pulse.slice(0, 6).map((i) => `${i.source}: ${i.title}`).join(" | ")}`);
  }
  lines.push(`ATTRIBUTION: ${Object.entries(pack.attribution).map(([k, v]) => `${k} (${v})`).join("; ")}`);
  return lines.join("\n");
}
