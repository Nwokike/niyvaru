/**
 * Free inference adapter. The SDK sees an OpenAI-compatible provider; this
 * file only normalizes the request path and handles failed responses.
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

  const errText = await res.clone().text().catch(() => "");

  // Only a genuine capacity failure is worth compacting for. A 400 caused by
  // auth/schema/provider misuse must surface as-is instead of triggering a
  // pointless retry (and the original response is returned either way).
  if (!isCapacityFailure(res.status, errText)) return res;

  debugError("gateway", `HTTP ${res.status}`, errText.slice(0, 300));

  if (init?.body && typeof init.body === "string") {
    try {
      const bodyObj = JSON.parse(init.body);
      if (Array.isArray(bodyObj.messages) && bodyObj.messages.length > 2) {
        const msgs = bodyObj.messages as { role: string; content?: string }[];
        const systemMsg = msgs.find((m) => m.role === "system");
        const nonSystem = msgs.filter((m) => m.role !== "system");
        // Keep from the last user instruction onward: that slice is internally
        // consistent (tool calls and their results stay together), unlike an
        // arbitrary tail cut.
        let tailStart = nonSystem.length - 1;
        while (tailStart > 0 && nonSystem[tailStart].role !== "user") tailStart -= 1;
        const kept = nonSystem.slice(tailStart).map((m) => {
          if (m.role === "tool" && typeof m.content === "string" && m.content.length > 300) {
            return { ...m, content: m.content.slice(0, 300) + "… [compacted]" };
          }
          return m;
        });
        const pruned = [...(systemMsg ? [systemMsg] : []), ...kept];

        debugLog("gateway", `retrying on HTTP ${res.status} with compacted messages (${msgs.length} → ${pruned.length})`);
        const retryInit = { ...init, body: JSON.stringify({ ...bodyObj, messages: pruned }) };
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

  return res;
}

function isCapacityFailure(status: number, errText: string): boolean {
  if (status === 413 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  // Some providers report a context overflow as 400 with prose in the body.
  if (status === 400) return /context|token|too long|maximum|length|messages/i.test(errText);
  return false;
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
