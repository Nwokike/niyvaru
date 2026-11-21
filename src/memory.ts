import type { ChatMessage, Profile } from "./types";
import { defaultProfile } from "../shared/profile";

const PROFILE_KEY = "niyvaru.profile.v1";
const CHAT_KEY = "niyvaru.chat.v1";
const MAX_HISTORY = 12;

export { defaultProfile };
export { profileToText } from "../shared/profile";

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw);
    return { ...defaultProfile(), ...parsed, version: 1 };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile) {
  p.updated_at = new Date().toISOString();
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

export function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(msgs: ChatMessage[]) {
  localStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-MAX_HISTORY)));
}

export function clearMemory() {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(CHAT_KEY);
}

/** Prompt the model to extract durable facts from the latest exchange. */
export function memoryExtractionPrompt(msgs: ChatMessage[], current: Profile): string {
  const transcript = msgs
    .slice(-6)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
  return [
    "You maintain a long-term memory profile for a traveller. Extract ONLY facts the traveller stated or clearly implied.",
    "Return JSON only, no prose, with this exact shape:",
    JSON.stringify({
      name: "string or null",
      mobility: "wheelchair|limited|none|null",
      budget_usd_per_night: "number or null",
      preferences: ["short lowercase labels"],
      constraints: ["short lowercase labels"],
      interests: ["short lowercase labels"],
      notes: ["short factual sentences"],
    }),
    "Rules: never invent; if nothing new, return the current profile unchanged; merge new facts into the existing profile rather than replacing it.",
    "CURRENT PROFILE:",
    JSON.stringify(current),
    "TRANSCRIPT:",
    transcript,
  ].join("\n");
}
