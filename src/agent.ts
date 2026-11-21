import type { AgentAction, AreaSummary, ChatMessage, Profile } from "./types";
import { memoryExtractionPrompt, profileToText } from "./memory";
import { sanitizeProfile } from "../shared/profile";
import { areaFacts } from "../shared/facts";
import { buildSystemPrompt, buildChatMessages } from "../shared/prompt";
import { API_BASE, DIRECT_MODE, GATEWAY_KEY, GATEWAY_URL } from "./config";

export interface ChatResult {
  text: string;
  actions: AgentAction[];
  model: string;
}

function isActionLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return false;
  try {
    return typeof JSON.parse(t).action === "string";
  } catch {
    return false;
  }
}

function parseActions(text: string): AgentAction[] {
  const out: AgentAction[] = [];
  const re = /<niyvaru>\s*([\s\S]*?)\s*<\/niyvaru>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    try {
      out.push(JSON.parse(m[1]) as AgentAction);
    } catch {
      /* ignore malformed action blocks */
    }
  }
  // Free models often emit bare JSON lines instead of the tagged form.
  for (const line of text.split("\n")) {
    if (!isActionLine(line)) continue;
    try {
      const a = JSON.parse(line.trim()) as AgentAction;
      if (!out.some((x) => JSON.stringify(x) === JSON.stringify(a))) out.push(a);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function stripActionBlocks(text: string): string {
  return text
    .replace(/<niyvaru>[\s\S]*?<\/niyvaru>/g, "")
    .split("\n")
    .filter((line) => !isActionLine(line))
    .join("\n")
    .trim();
}

async function readSse(res: Response, onToken: (t: string) => void): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const obj = JSON.parse(data);
        const delta =
          obj?.choices?.[0]?.delta?.content ??
          obj?.choices?.[0]?.message?.content ??
          "";
        if (delta) {
          full += delta;
          onToken(delta);
        }
      } catch {
        /* partial chunk */
      }
    }
  }
  return full;
}

function trimArea(area: AreaSummary): AreaSummary {
  return {
    id: area.id,
    name: area.name,
    center: area.center,
    radius_m: area.radius_m,
    pois: area.pois.slice(0, 120),
    routes: area.routes,
    prayer: area.prayer.slice(0, 2),
    weather: area.weather.slice(0, 2),
    events: area.events,
  };
}

async function directGateway(messages: { role: string; content: string }[], stream: boolean) {
  const res = await fetch(`${GATEWAY_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GATEWAY_KEY}`,
    },
    body: JSON.stringify({ task_type: "text", stream, messages }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`gateway ${res.status}: ${err.slice(0, 200)}`);
  }
  return res;
}

export async function sendMessage(
  text: string,
  history: ChatMessage[],
  profile: Profile,
  area: AreaSummary,
  onToken: (t: string) => void
): Promise<ChatResult> {
  const trimmed = trimArea(area);
  let res: Response;

  if (DIRECT_MODE) {
    const system = buildSystemPrompt(profileToText(profile), areaFacts(trimmed));
    const messages = buildChatMessages(system, history.slice(-8), text);
    res = await directGateway(messages, true);
  } else {
    res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, history: history.slice(-8), profile, area: trimmed }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`chat failed ${res.status}: ${err.slice(0, 200)}`);
    }
  }

  const full = await readSse(res, onToken);
  return { text: stripActionBlocks(full), actions: parseActions(full), model: "" };
}

/** Ask the model to study the transcript and return merged durable facts. */
export async function extractMemory(history: ChatMessage[], profile: Profile): Promise<Profile> {
  const recent = history.slice(-6);
  const prompt = memoryExtractionPrompt(recent, profile);
  let data: Record<string, unknown>;

  if (DIRECT_MODE) {
    const res = await directGateway(
      [
        { role: "system", content: "You extract structured traveller facts. Return JSON only." },
        { role: "user", content: prompt },
      ],
      false
    );
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return profile;
    try {
      data = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return profile;
    }
  } else {
    const res = await fetch(`${API_BASE}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ history: recent, profile, prompt }),
    });
    if (!res.ok) return profile;
    data = (await res.json()) as Record<string, unknown>;
  }

  const incoming = sanitizeProfile(data);
  // Preserve existing values when the model returns nothing new for a field.
  return {
    ...profile,
    name: incoming.name ?? profile.name,
    mobility: incoming.mobility ?? profile.mobility,
    budget_usd_per_night: incoming.budget_usd_per_night ?? profile.budget_usd_per_night,
    preferences: incoming.preferences.length ? incoming.preferences : profile.preferences,
    constraints: incoming.constraints.length ? incoming.constraints : profile.constraints,
    interests: incoming.interests.length ? incoming.interests : profile.interests,
    notes: incoming.notes.length ? incoming.notes : profile.notes,
    home_area: incoming.home_area ?? profile.home_area,
    updated_at: new Date().toISOString(),
  };
}

export { profileToText };
