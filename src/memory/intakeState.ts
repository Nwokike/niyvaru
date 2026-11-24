/**
 * Intake persistence — the form is part of the product, not a one-time screen.
 *
 * Draft state lives in localStorage so unsaved edits survive a refresh. The
 * last submitted profile lives in the agent's memory files, so rehydration
 * works across sessions without a server or account.
 */
import { readFile } from "./store";

const DRAFT_KEY = "niyvaru.intake.draft.v1";
const LAST_AREA_KEY = "niyvaru.intake.lastArea.v1";

export interface IntakeFormState {
  stay: string;
  checkin: string;
  checkout: string;
  flexible: boolean;
  adults: number;
  children: number;
  rooms: number;
  standard: "star3" | "star4" | "star5" | "any";
  proximity: "courtyard" | "within500" | "shuttle";
  breakfast: "included" | "preferred" | "roomOnly";
  elderly: boolean;
  wheelchair: boolean;
  interests: string[];
  name: string;
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadDraft(): Partial<IntakeFormState> | null {
  if (typeof localStorage === "undefined") return null;
  return safeParse<Partial<IntakeFormState>>(localStorage.getItem(DRAFT_KEY));
}

export function saveDraft(state: IntakeFormState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    if (state.stay) localStorage.setItem(LAST_AREA_KEY, state.stay);
  } catch {
    /* storage is best-effort */
  }
}

export function clearDraft(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage is best-effort */
  }
}

function valueAfter(lines: string[], prefix: string): string {
  const line = lines.find((l) => l.startsWith(`- ${prefix}:`));
  return line ? line.slice(prefix.length + 3).trim() : "";
}

function parseTraveller(content: string): Partial<IntakeFormState> {
  const lines = content.split("\n");
  const party = valueAfter(lines, "party");
  const match = party.match(/(\d+) adults?, (\d+) children?, (\d+) room/);
  const standard = valueAfter(lines, "hotel standard");
  const proximity = valueAfter(lines, "proximity");
  const interestKeys = valueAfter(lines, "interest keys").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    name: valueAfter(lines, "name"),
    adults: match ? Number(match[1]) : undefined,
    children: match ? Number(match[2]) : undefined,
    rooms: match ? Number(match[3]) : undefined,
    standard: standard === "3★" ? "star3" : standard === "4★" ? "star4" : standard === "5★" ? "star5" : standard === "any" ? "any" : undefined,
    proximity: proximity.includes("courtyard") ? "courtyard" : proximity.includes("500") ? "within500" : proximity.includes("shuttle") ? "shuttle" : undefined,
    breakfast: valueAfter(lines, "breakfast") as IntakeFormState["breakfast"] || undefined,
    elderly: lines.some((l) => l.includes("travelling with elderly")),
    wheelchair: lines.some((l) => l.includes("wheelchair user")),
    interests: interestKeys.length ? interestKeys : valueAfter(lines, "interests").split(",").map((s) => s.trim()).filter(Boolean),
  };
}

function parseTrip(content: string): Partial<IntakeFormState> {
  const lines = content.split("\n");
  const area = valueAfter(lines, "area");
  const dates = valueAfter(lines, "dates");
  const match = dates.match(/(\d{4}-\d{2}-\d{2}) → (\d{4}-\d{2}-\d{2})/);
  return {
    checkin: match?.[1] ?? "",
    checkout: match?.[2] ?? "",
    flexible: dates.includes("flexible"),
    stay: valueAfter(lines, "area id") || (typeof localStorage !== "undefined" ? localStorage.getItem(LAST_AREA_KEY) ?? "" : ""),
  };
}

function meaningful(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export async function loadIntakeState(): Promise<Partial<IntakeFormState>> {
  const draft = loadDraft();
  const traveller = await readFile("/memories/traveller.md");
  const trip = await readFile("/memories/trip.md");
  const submitted: Partial<IntakeFormState> = {
    ...(traveller ? parseTraveller(traveller.content) : {}),
    ...(trip ? parseTrip(trip.content) : {}),
  };
  const overrides = Object.fromEntries(
    Object.entries(draft ?? {}).filter(([, value]) => meaningful(value))
  ) as Partial<IntakeFormState>;
  return { ...submitted, ...overrides };
}
