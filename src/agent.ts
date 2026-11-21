import type { AgentAction, AreaSummary, ChatMessage, Profile } from "./types";
import { memoryExtractionPrompt, profileToText } from "./memory";

export interface ChatResult {
  text: string;
  actions: AgentAction[];
  model: string;
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
  return out;
}

function stripActionBlocks(text: string): string {
  return text.replace(/<niyvaru>[\s\S]*?<\/niyvaru>/g, "").trim();
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

export async function sendMessage(
  text: string,
  history: ChatMessage[],
  profile: Profile,
  area: AreaSummary,
  onToken: (t: string) => void
): Promise<ChatResult> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      history: history.slice(-8),
      profile,
      area: {
        id: area.id,
        name: area.name,
        center: area.center,
        radius_m: area.radius_m,
        pois: area.pois.slice(0, 120),
        routes: area.routes,
        prayer: area.prayer.slice(0, 2),
        weather: area.weather.slice(0, 2),
        events: area.events,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`chat failed ${res.status}: ${err.slice(0, 200)}`);
  }
  const full = await readSse(res, onToken);
  return { text: stripActionBlocks(full), actions: parseActions(full), model: "" };
}

/** Ask the model to study the transcript and return merged durable facts. */
export async function extractMemory(history: ChatMessage[], profile: Profile): Promise<Profile> {
  const res = await fetch("/api/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ history: history.slice(-6), profile, prompt: memoryExtractionPrompt(history.slice(-6), profile) }),
  });
  if (!res.ok) return profile;
  const data = (await res.json()) as Profile;
  return { ...profile, ...data, version: 1 };
}

export { profileToText };
