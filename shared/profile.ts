import type { Profile } from "../src/types.ts";

export function defaultProfile(): Profile {
  return {
    version: 1,
    preferences: [],
    constraints: [],
    interests: [],
    language: "en",
    notes: [],
    updated_at: new Date().toISOString(),
  };
}

/** Compact, human-readable client memory block for the model. */
/** Coerce model output into a safe Profile — free models sometimes emit wrong types. */
export function sanitizeProfile(input: unknown): Profile {
  const p = (input ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const mobility = ["wheelchair", "limited", "none"].includes(String(p.mobility)) ? (p.mobility as Profile["mobility"]) : undefined;
  const budget = typeof p.budget_usd_per_night === "number" && p.budget_usd_per_night > 0 ? p.budget_usd_per_night : undefined;
  return {
    version: 1,
    name: typeof p.name === "string" && p.name ? p.name : undefined,
    mobility,
    budget_usd_per_night: budget,
    preferences: arr(p.preferences),
    constraints: arr(p.constraints),
    interests: arr(p.interests),
    language: typeof p.language === "string" && p.language ? p.language : "en",
    home_area: typeof p.home_area === "string" ? p.home_area : undefined,
    notes: arr(p.notes),
    updated_at: new Date().toISOString(),
  };
}

export function profileToText(p: Profile): string {
  const lines: string[] = [];
  if (p.name) lines.push(`traveller name: ${p.name}`);
  if (p.mobility) lines.push(`mobility: ${p.mobility}`);
  if (p.budget_usd_per_night) lines.push(`budget: under $${p.budget_usd_per_night} per night`);
  if (p.preferences.length) lines.push(`prefers: ${p.preferences.join(", ")}`);
  if (p.constraints.length) lines.push(`constraints: ${p.constraints.join(", ")}`);
  if (p.interests.length) lines.push(`interested in: ${p.interests.join(", ")}`);
  if (p.home_area) lines.push(`home area: ${p.home_area}`);
  if (p.notes.length) lines.push(`notes: ${p.notes.join("; ")}`);
  if (!lines.length) return "traveller memory: none recorded yet.";
  return `TRAVELLER MEMORY (learned from this user, treat as fact):\n${lines.map((l) => `- ${l}`).join("\n")}`;
}
