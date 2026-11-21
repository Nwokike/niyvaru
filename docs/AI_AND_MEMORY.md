# AI and client memory

## Why the gateway, not the router

Kiri Router is local-only: `POST https://router.kiri.ng/v1/chat/completions`
returns `cloud_chat_disabled`; inference runs at `http://127.0.0.1:8082/v1` on
the device whose IP is allowed. A hosted web app cannot reach a visitor's
localhost, so the prototype uses **Kiri Gateway** through the Worker. The
Worker only depends on the OpenAI chat wire format, so the provider is swappable.

## Gateway contract used

`POST https://api.kiri.ng/chat`

```json
{
  "task_type": "text",
  "stream": true,
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ]
}
```

Headers: `Content-Type: application/json`, `Authorization: Bearer <GATEWAY_SECRET>`.

The gateway's family roster (in `Nwokike/kiri-gateway/index.js`) tries Groq
qwen3.8-27b → qwen3.6-27b → gpt-oss-120b → gpt-oss-20b → NVIDIA
diffusiongemma → nemotron variants, with per-model timeouts, SSE passthrough
and `_model_used` tagging. The Worker simply forwards the upstream SSE as
`text/event-stream` with CORS headers.

**The "4K/8K context" worry:** the `6144` in the gateway roster is
`max_completion_tokens`, not a context-window cap. Our context problem is
solved by construction: each request sends a compact area summary plus the
profile and last 8 messages, not the whole pack or the full history.

## Worker API

| Route | Request | Response |
|---|---|---|
| `GET /api/health` | — | `{ ok, service, gateway }` |
| `POST /api/chat` | `{ text, history, profile, area }` | SSE chunks of `choices[0].delta.content` |
| `POST /api/memory` | `{ history, profile, prompt }` | JSON object with extracted profile fields |

`area` is a trimmed shape: first 120 POIs, all routes, first 2 prayer days,
first 2 weather days and all events. `shared/facts.ts` turns that into a few
kilobytes of plain text with distances computed from the area centre.

Errors are explicit: missing `GATEWAY_SECRET` returns HTTP 500 with a message;
gateway failures return 502 with the upstream status. The UI shows them in a
notice/message rather than failing silently.

## Grounding rules

`shared/prompt.ts` instructs the model to:

- use only supplied facts and never invent places, prices, hours, accessibility
  or events;
- say "I don't have that data yet" when a fact is missing;
- cite the fact behind a recommendation (distance, hours, wheelchair tag);
- keep answers short;
- emit map actions **only** when the traveller asked for an action.

## Action protocol

An action is a JSON object with an `action` field. Preferred form:

```
<niyvaru>{"action":"highlight_kind","kind":"pharmacy"}</niyvaru>
```

Free models often emit the bare JSON line instead. `src/agent.ts` accepts both,
deduplicates them, and strips them from the displayed text.

| Action | Effect in `App.tsx` |
|---|---|
| `focus_poi` with `id` | fly to POI, show marker |
| `highlight_kind` with `kind` | filter POI circles and labels |
| `show_route` with `id` | draw route, fit bounds |
| `start_walk` with optional `route`, `sequence` | draw route, play frames |
| `clear` | clear filters and route |

The facts builder includes POI ids (`[node/123]`) and route ids precisely so
the model can emit valid actions.

## Client memory

Keys in `localStorage`:

| Key | Content |
|---|---|
| `niyvaru.profile.v1` | `{ version, name, mobility, budget_usd_per_night, preferences, constraints, interests, language, home_area, notes, updated_at }` |
| `niyvaru.chat.v1` | last 12 messages |
| `niyvaru.posts.v1` | local feed posts |

After each answer, `extractMemory()` calls `/api/memory` with a prompt that asks
for JSON only. `shared/profile.ts` `sanitizeProfile()` coerces model output:
unknown mobility values become `undefined`, non-positive budgets are dropped,
arrays are filtered to strings. Existing values are preserved when the model
returns nothing new — a bad model response cannot wipe the profile.

The Ops tab lets a user seed or correct: mobility, budget, preferences,
constraints and interests, and clear memory entirely.

## Security notes

- The gateway secret lives only in the Worker (`GATEWAY_SECRET`). Never put it
  in Vite code — `VITE_`-prefixed variables are bundled into the browser.
- `worker/.dev.vars` is gitignored; use `worker/.dev.vars.example` as a template.
- The browser parses model output as text; action JSON is validated by field
  name and matched against known POI/route ids before anything happens.
- User prompt text is passed through without HTML rendering; chat messages are
  rendered as React text nodes.
