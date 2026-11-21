import type { Profile } from "../src/types";

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
