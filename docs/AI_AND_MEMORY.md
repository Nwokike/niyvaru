# AI and memory

## The agent runs in the browser

`src/agent/runtime.ts` creates an AI SDK `ToolLoopAgent` with the Kiri Gateway model and 16 typed tools. `src/ui/ChatPanel.tsx` uses `useChat` from `@ai-sdk/react` with a `DirectChatTransport`, so there is no chat API route in the default setup: the transport drives the agent in-process, streams UI message parts, and renders tool activity as chips. The agent is rebuilt when the area pack, locale or memory revision changes; `prepareStep` re-reads the pack and memory before every step, so a write made by the `memory` tool is visible in the same turn.

Settings that matter:

| Setting | Value | Why |
|---|---|---|
| `toolOrder` | tools sorted by name | stable provider-side prompt caching |
| `toolCallConcurrency` | `1` | all tools share one map and one memory store |
| `stopWhen` | `[isStepCount(12), hasToolCall("start_walk"), stopAfterRepeatedToolCalls(3)]` | bounds the loop; starting a walk or three identical consecutive tool calls ends the turn |
| `repairToolCall` | custom | rescues fenced/trailing-comma JSON and fuzzy-matches hallucinated tool names |
| `timeout` | `firstChunkMs 30s`, `chunkMs 20s`, `toolMs 25s`, `stepMs 180s` | keeps weak free models from hanging the UI |
| `temperature` / `maxRetries` | `0.4` / `1` | short, consistent answers |

`lastAssistantMessageIsCompleteWithToolCalls` resubmits automatically after tool results, and `experimental_queue: true` queues messages sent while a turn is busy. `DirectChatTransport`'s `onError` returns the real error text to the chat instead of a generic failure.

Two safeguards address weak free models without touching the message history: `normalizeToolArgs()` trims strings and sorts object keys so cosmetic rewrites collapse to one cache key, and a closure-local `readCache` gives repeated `search_places`, `nearby`, `place_details`, `get_now` and `get_place_story` calls their earlier result with a note instead of re-running them. The cache lives only as long as that agent instance. `stopAfterRepeatedToolCalls(3)` is a pure stop predicate: it neither prunes messages nor changes the 12-step ceiling.

## The 16 tools

Defined with `tool()` and Zod schemas in `src/agent/tools.ts` and `src/memory/memoryTool.ts`. Numeric and boolean inputs use `z.coerce` with `.catch()` defaults so free models are corrected rather than rejected.

| Tool | Effect |
|---|---|
| `search_places` | Orama full-text search over place names, kinds and tags; returns real ids |
| `nearby` | Places near a place id or the area centre, filtered by kind, distance and open-now |
| `place_details` | Hours, accessibility, contact, photos and story for one place |
| `photos_for_place` | Real photographs with attribution and licence |
| `focus_place` | Pins a place and flies the map to it |
| `highlight_kinds` | Filters POI layers to selected kinds; null clears |
| `clear_view` | Clears filters, route, focus pin and dossier |
| `route_to` | Fetches a live walking route and draws it |
| `show_route` | Draws one of the area's pre-assembled routes by id |
| `start_walk` | Starts immersive walk playback along a route or to a place |
| `set_time_of_day` | Relights the map: dawn, day, golden or night |
| `get_now` | Today's prayer times, weather and latest pulse items |
| `get_place_story` | Wikipedia extract attached to a place |
| `draft_area_brief` | Hero photo, attached stories and place-kind counts |
| `select_candidates` | Ranks hotels against mobility, budget and preferences with explicit reasons |
| `memory` | Agent-managed memory files (`view`, `create`, `str_replace`, `insert`, `rename`, `delete`, `search`) |

Every id in a tool result comes from the assembled pack. `select_candidates` states plainly that open data has no prices; it never invents them.

## Gateway adapter and retry policy

`src/agent/gateway.ts` uses `createOpenAICompatible({ name, baseURL, apiKey, fetch })` and requests model `beam`. The custom `fetch`:

1. Rewrites the SDK's `POST {baseURL}/chat/completions` to the gateway's `POST {baseURL}/chat`. Authorization, headers and body pass through untouched.
2. Returns an OK response unchanged — **no upfront pruning**. The full message history and all tool results reach the model on the first attempt.
3. Only on `res.status >= 500` or `400` (the gateway's fallback chain exhausted, often from a smaller model's context limit) reads the body, truncates `tool` message content over 300 characters, keeps the system message, the first user prompt and the last four messages, and retries **once** with those compacted messages.
4. If the retry also fails, returns the original response so the UI can show the real failure.

There is no other retry path and no proactive trimming. `VITE_GATEWAY_URL` overrides the base URL; the gateway credential is the public family key in `src/config/endpoints.ts`, not a user secret. Model choice and free-provider fallbacks stay inside the gateway.

## Grounding

`src/agent/prompt.ts` fixes the voice and the hard rules; `src/agent/facts.ts` builds the compact `AREA DATA` block. The prompt requires the model to:

- use only AREA DATA, memory files and tool results; never invent a place, price, hour, phone number, accessibility feature or event;
- say "I don't have that data yet" when a fact is missing;
- name the place and cite the fact behind a recommendation;
- take distances and walking times from routes or supplied facts, never silent estimates;
- answer in the traveller's language, in at most three sentences or a compact list unless depth is requested;
- drive the live map through tools, then describe the change in one sentence.

The prompt also enforces tool economy: reuse ids and facts already listed in AREA DATA instead of re-searching, make one tool call per distinct intent, report a gap plainly rather than retrying a reworded query, and answer after a tool runs unless a genuinely different action is needed.

`areaFacts()` includes up to 80 places with their ids, kind, distance, hours, wheelchair tag and photo/story flags, plus place counts, walks, today's prayer and weather, a short pulse list and the attribution map. Place ids exist so tool calls can reference real objects.

## Memory: a filesystem in IndexedDB

`src/sources/cache.ts` owns the `niyvaru` IndexedDB database (version 3). Memory uses three of its stores:

| Store | Content |
|---|---|
| `mem_files` | Markdown files keyed by path under `/memories/` |
| `mem_archive` | every previous version and every delete, appended with an id and timestamp |
| `mem_chat` | auto-incrementing chat records, trimmed to the policy window |

`seedIfEmpty()` creates four files from `src/config/memory-policy.ts`:

| File | Purpose | Char cap |
|---|---|---|
| `/memories/traveller.md` | party, ages, mobility, budget, language, preferences | 4,000 |
| `/memories/trip.md` | dates, area, candidates considered or rejected, decisions | 6,000 |
| `/memories/journal.md` | dated log across sessions; append, never rewrite | 20,000 |
| `/memories/places.md` | notes keyed by place id | 12,000 |

The full-page intake form writes `traveller.md` and `trip.md` **before** assembly starts, so the first agent turn already knows who is travelling and when. After each completed turn, `App.tsx` appends the user and assistant text to `mem_chat` and bumps `memoryRev`, which rebuilds the agent.

`assembleMemoryContext()` injects two core blocks (traveller capped at 1,200 chars, trip at 1,600), a directory listing with character counts, and a retrieval hint into the system prompt. The whole slice is capped at 2,600 tokens (~10,400 characters). Oversized blocks are trimmed with an explicit marker, never silently dropped.

The `memory` tool follows the public memory-tool command set but **delete archives instead of destroying**: `writeFile()` copies the previous content into `mem_archive` before overwriting, and `deleteFile()` moves the current content there before removing the live file. `search` reads the archive; `src/memory/search.ts` additionally provides Arabic-safe Orama retrieval over files and archived entries (tashkeel and alef variants are normalized before indexing).

`src/ui/MemoryPanel.tsx` shows the files, lets the traveller edit them in place, export a JSON dump (files, archive, chat, policy), import one, clear everything, and see whether persistent storage was granted. Clear re-seeds the four empty files.

## Privacy and failure notes

- Memory, chat history and packs never leave the browser. The optional Worker proxies inference and weather only and stores nothing.
- Tool outputs are validated against pack ids before the map changes; a hallucinated id returns an error string to the model.
- Chat text and pulse posts render as React text nodes, not HTML.
- Failures are logged by `src/debug.ts` even when verbose logging is off. Set `localStorage.niyvaruDebug = "1"` for verbose `[niyvaru:*]` logs.
- If the gateway reply fails, the chat shows the error; a compacted retry happens only for the HTTP statuses listed above, never for a healthy response.
