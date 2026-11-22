/**
 * Kiri Gateway adapter — the free inference path.
 *
 * The gateway speaks its family contract (POST /chat with task_type);
 * this adapter lets the AI SDK talk OpenAI wire format transparently.
 * Authorization is set by the SDK from apiKey (the family key, like
 * Akili ships it). Model selection and free-provider fallbacks stay
 * inside the gateway.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { endpoints } from "../config/endpoints";
import { debugLog, debugError } from "../debug";

async function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Rewrite the URL path only: the SDK sends POST {base}/chat/completions,
  // the gateway expects POST {base}/chat. Headers (Authorization from apiKey)
  // pass through untouched — the gateway verifies them directly.
  const original = input instanceof Request ? input.url : String(input);
  const target = original.replace(/\/chat\/completions/, "/chat");
  debugLog("gateway", `POST ${target.replace(endpoints.gateway.url, "")}`);

  const res = await fetch(target, init);
  if (res.ok) return res;

  // On HTTP 500 / 502 / 503 / 504 / 400 (which indicates the gateway's fallback
  // chain exhausted all free models, often due to context limits on smaller models):
  // perform an emergency context compaction and retry once without breaking user flow.
  if (res.status >= 500 || res.status === 400) {
    const errText = await res.clone().text().catch(() => "");
    debugError("gateway", `HTTP ${res.status}`, errText.slice(0, 300));

    if (init?.body && typeof init.body === "string") {
      try {
        const bodyObj = JSON.parse(init.body);
        if (Array.isArray(bodyObj.messages) && bodyObj.messages.length > 2) {
          const msgs = bodyObj.messages;
          const systemMsg = msgs.find((m: { role: string }) => m.role === "system");
          const nonSystem = msgs.filter((m: { role: string }) => m.role !== "system");

          // Truncate bulky tool results
          const compacted = nonSystem.map((m: { role: string; content?: string }) => {
            if (m.role === "tool" && typeof m.content === "string" && m.content.length > 300) {
              return { ...m, content: m.content.slice(0, 300) + "… [compacted]" };
            }
            return m;
          });

          // Retain system instructions, first user prompt, and the last 4 messages
          const pruned = [
            ...(systemMsg ? [systemMsg] : []),
            compacted[0],
            ...compacted.slice(-4),
          ].filter((v, i, a) => a.indexOf(v) === i);

          debugLog("gateway", `retrying on HTTP ${res.status} with compacted messages (${msgs.length} → ${pruned.length})`);
          const retryInit = {
            ...init,
            body: JSON.stringify({ ...bodyObj, messages: pruned }),
          };
          const retryRes = await fetch(target, retryInit);
          if (retryRes.ok) {
            debugLog("gateway", "emergency compaction succeeded on retry");
            return retryRes;
          }
        }
      } catch {
        /* proceed to return original response */
      }
    }
  }

  return res;
}

/** The routed model: the gateway resolves its own free roster per task type. */
export function gatewayModel() {
  const provider = createOpenAICompatible({
    name: "kiri-gateway",
    baseURL: endpoints.gateway.url,
    apiKey: endpoints.gateway.key,
    fetch: gatewayFetch,
  });
  return provider("beam");
}
