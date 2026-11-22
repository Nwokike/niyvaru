/**
 * Compact OSM opening_hours evaluator — covers the patterns that matter on
 * the ground: 24/7, weekday+time ranges, multiple ranges, "off", closed.
 * Deliberately dependency-free (the canonical parser is LGPL); anything it
 * cannot parse returns "unknown" rather than a guess.
 */

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function minutesOf(hhmm: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return undefined;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface OpenStatus {
  state: "open" | "closed" | "unknown";
  /** Human-readable next change when known, e.g. "closes 22:00". */
  nextChange?: string;
}

/**
 * Evaluate a value like "Mo-Sa 09:00-21:00; Su 10:00-16:00" at a moment.
 */
export function openingHoursAt(value: string, at: Date = new Date()): OpenStatus {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return { state: "unknown" };
  if (trimmed === "24/7") return { state: "open" };
  if (/^(closed|off)$/.test(trimmed)) return { state: "closed" };

  const day = at.getDay(); // 0 = Sunday
  const minutes = at.getHours() * 60 + at.getMinutes();

  let openNow = false;
  let nextChange: number | undefined;
  let parsedAny = false;

  for (const rule of trimmed.split(";")) {
    const part = rule.trim();
    if (!part || part === "ph off" || part === "sh off") continue;
    const match = /^(?:(mo|tu|we|th|fr|sa|su)(?:-(mo|tu|we|th|fr|sa|su))?)?\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(
      part.replace(/,/g, " ")
    );
    if (!match) {
      // "24/7" inside a rule list
      if (/^24\/7$/.test(part)) {
        parsedAny = true;
        openNow = true;
        nextChange = undefined;
        continue;
      }
      continue;
    }
    parsedAny = true;
    const fromDay = match[1] ? DAYS.indexOf(match[1].toUpperCase()) : day;
    const toDay = match[2] ? DAYS.indexOf(match[2].toUpperCase()) : fromDay;
    const start = minutesOf(match[3]);
    const end = minutesOf(match[4]);
    if (start == null || end == null) continue;

    let dayMatch = false;
    if (fromDay <= toDay) dayMatch = day >= fromDay && day <= toDay;
    else dayMatch = day >= fromDay || day <= toDay; // wraps the week
    if (!dayMatch) continue;

    if (end <= start) {
      // spans midnight
      if (minutes >= start) {
        openNow = true;
        nextChange = undefined; // closes tomorrow — approximate
      } else if (minutes < end) {
        openNow = true;
        nextChange = end;
      }
    } else if (minutes >= start && minutes < end) {
      openNow = true;
      nextChange = end;
    } else if (minutes < start) {
      nextChange = Math.min(nextChange ?? 1440, start);
    }
  }

  if (!parsedAny) return { state: "unknown" };
  const hhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return {
    state: openNow ? "open" : "closed",
    nextChange: nextChange != null ? `${openNow ? "closes" : "opens"} ${hhmm(nextChange)}` : undefined,
  };
}
