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

function gatewayFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Rewrite the URL path only: the SDK sends POST {base}/chat/completions,
  // the gateway expects POST {base}/chat. Headers (Authorization from apiKey)
  // pass through untouched — the gateway verifies them directly.
  const original = input instanceof Request ? input.url : String(input);
  const target = original.replace(/\/chat\/completions/, "/chat");
  debugLog("gateway", `POST ${target.replace(endpoints.gateway.url, "")}`);
  return fetch(target, init).then(async (res) => {
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      debugError("gateway", `HTTP ${res.status}`, text.slice(0, 300));
    }
    return res;
  });
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
