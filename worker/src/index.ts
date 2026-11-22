/**
 * Optional Worker mode — the only place a server identity is allowed.
 * Routes:
 *   GET  /api/health   → liveness
 *   POST /api/chat     → Kiri Gateway /chat passthrough (SSE, family contract)
 *   POST /api/memory   → non-streaming gateway call for JSON extraction
 *   GET  /api/weather  → MET Norway Locationforecast with an identifying
 *                        User-Agent (browsers cannot set one themselves)
 * Everything the app does works without this Worker; these routes exist for
 * capability, not necessity.
 */
interface Env {
  GATEWAY_URL?: string;
  GATEWAY_SECRET?: string;
  WEATHER_CONTACT?: string;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function callGateway(env: Env, body: Record<string, unknown>): Promise<Response> {
  const base = (env.GATEWAY_URL || "https://api.kiri.ng").replace(/\/$/, "");
  return fetch(`${base}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.GATEWAY_SECRET ?? ""}`,
    },
    body: JSON.stringify({ task_type: "text", ...body }),
  });
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (!env.GATEWAY_SECRET) return json({ error: "GATEWAY_SECRET is not configured on this worker." }, 500);
  const body = (await request.json()) as { messages?: unknown; stream?: boolean };
  if (!body.messages) return json({ error: "messages are required" }, 400);
  const upstream = await callGateway(env, { stream: true, messages: body.messages });
  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => "");
    return json({ error: `gateway ${upstream.status}: ${err.slice(0, 200)}` }, 502);
  }
  return new Response(upstream.body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", ...CORS },
  });
}

async function handleMemory(request: Request, env: Env): Promise<Response> {
  if (!env.GATEWAY_SECRET) return json({ error: "GATEWAY_SECRET is not configured." }, 500);
  const body = (await request.json()) as { messages?: unknown };
  const upstream = await callGateway(env, { stream: false, messages: body.messages });
  if (!upstream.ok) return json({ error: `gateway ${upstream.status}` }, 502);
  return json(await upstream.json());
}

async function handleWeather(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (!lat || !lon) return json({ error: "lat and lon are required" }, 400);
  const contact = env.WEATHER_CONTACT || "niyvaru-worker/1.0 (prototype)";
  const upstream = await fetch(
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`,
    { headers: { "User-Agent": contact, Accept: "application/json" } }
  );
  if (!upstream.ok) return json({ error: `met.no ${upstream.status}` }, 502);
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=1800",
      ...CORS,
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "niyvaru-api" });
    }
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname === "/api/memory" && request.method === "POST") return handleMemory(request, env);
    if (url.pathname === "/api/weather" && request.method === "GET") return handleWeather(request, env);
    return json({ error: "not found" }, 404);
  },
};
