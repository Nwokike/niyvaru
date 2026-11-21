import { buildSystemPrompt, buildChatMessages, areaFacts } from "../../shared/prompt.ts";
import { profileToText } from "../../shared/profile.ts";

interface Env {
  GATEWAY_SECRET?: string;
  GATEWAY_URL?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function gatewayBase(env: Env): string {
  return (env.GATEWAY_URL || "https://api.kiri.ng").replace(/\/$/, "");
}

async function callGateway(env: Env, messages: { role: string; content: string }[], stream: boolean) {
  const res = await fetch(`${gatewayBase(env)}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GATEWAY_SECRET || ""}`,
    },
    body: JSON.stringify({ task_type: "text", stream, messages }),
  });
  return res;
}

async function handleChat(req: Request, env: Env): Promise<Response> {
  if (!env.GATEWAY_SECRET) {
    return json({ error: "GATEWAY_SECRET is not configured on this worker." }, 500);
  }
  const body = (await req.json()) as {
    text?: string;
    history?: { role: string; content: string }[];
    profile?: unknown;
    area?: Parameters<typeof areaFacts>[0];
  };
  if (!body.text || !body.area) return json({ error: "text and area are required" }, 400);

  const profileText = profileToText(body.profile as never);
  const system = buildSystemPrompt(profileText, areaFacts(body.area));
  const messages = buildChatMessages(system, body.history ?? [], body.text);

  const upstream = await callGateway(env, messages, true);
  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => "");
    return json({ error: `gateway ${upstream.status}: ${err.slice(0, 200)}` }, 502);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

async function handleMemory(req: Request, env: Env): Promise<Response> {
  if (!env.GATEWAY_SECRET) return json({ error: "GATEWAY_SECRET is not configured." }, 500);
  const body = (await req.json()) as { prompt?: string; profile?: unknown };
  if (!body.prompt) return json({ error: "prompt is required" }, 400);
  const messages = [
    { role: "system", content: "You extract structured traveller facts. Return JSON only." },
    { role: "user", content: body.prompt },
  ];
  const upstream = await callGateway(env, messages, false);
  if (!upstream.ok) return json({ error: `gateway ${upstream.status}` }, 502);
  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return json({ error: "no JSON in model output" }, 502);
  try {
    return json(JSON.parse(match[0]));
  } catch {
    return json({ error: "invalid JSON from model" }, 502);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json({ ok: true, service: "niyvaru-api", gateway: gatewayBase(env) });
    }
    if (url.pathname === "/api/chat" && req.method === "POST") return handleChat(req, env);
    if (url.pathname === "/api/memory" && req.method === "POST") return handleMemory(req, env);
    return json({ error: "not found" }, 404);
  },
};
