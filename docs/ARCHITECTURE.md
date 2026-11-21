# Architecture

## One-sentence version

A static web app renders a real map from versioned JSON packs; one free Cloudflare
Worker proxies an AI gateway; the traveller's memory stays in the browser.

## Components

| Component | Technology | Responsibility |
|---|---|---|
| Web app (`src/`) | Vite + React + TypeScript | UI, map, chat, feed, ops, walk player |
| Map | MapLibre GL JS + OpenFreeMap style | vector basemap, POI/route layers, camera, actions |
| Packs (`public/packs/`) | JSON files | area facts: POIs, routes, Panoramax frames, prayer, weather, events |
| Cache | IndexedDB (`niyvaru`, store `packs`) | downloaded area packs, versioned |
| Client memory | `localStorage` | profile, last 12 chat messages, local posts |
| API (`worker/`) | Cloudflare Worker | `/api/health`, `/api/chat`, `/api/memory` |
| AI | Kiri Gateway (`api.kiri.ng/chat`) | free text inference, SSE |
| Data job (`data/`, GitHub Actions) | Node 24 | daily regeneration of packs |
| Hosting | Cloudflare Pages + Workers (free) | static CDN + API route |

## Request flow

```
[Browser]
  index.json -> pack download (IndexedDB cache)
  |-- GET  /api/health            -> Worker -> { ok, gateway }
  |-- POST /api/chat { text, history, profile, area }
  |          -> Worker -> build grounded system prompt
  |          -> Kiri Gateway /chat (task_type:text, stream:true)
  |          <- SSE -> browser renders tokens
  |          <- <niyvaru> actions -> map.focus / highlight / route / walk
  |-- POST /api/memory { history, profile, prompt }
             -> Worker -> Gateway (no stream) -> JSON facts -> sanitised -> localStorage
```

## Design decisions and why

1. **Static-first.** Tiles, POIs, routes, frames and the AI prompt are files on
   a CDN. If the Worker hits its free-plan request limit, the map and walks
   still work. Only chat and memory need the Worker.
2. **No database.** Posts and memory are device-local. This keeps the prototype
   at $0 and avoids a shared-data surface before the product is validated.
   A production social layer will need a real store; none of the current code
   assumes one.
3. **On-demand area packs (your idea).** The daily job builds packs at
   build time; the app downloads the pack for the selected area at run time and
   caches it. Travelling to a new city becomes "add another pack", not
   "rebuild the app".
4. **Grounded-only agent.** The system prompt forbids inventing places, prices,
   hours or accessibility facts. If a fact is absent, the model must say so.
   This is the same discipline Asase uses for telemetry briefings.
5. **Client-side memory.** Long-term facts never leave the device. Each request
   re-assembles a small context, which is why the gateway's completion cap is
   not a context problem.
6. **OpenAI-wire interface only.** The Worker talks the standard chat format;
   changing from Kiri Gateway to a local model is a base-URL change plus an
   auth adjustment, not a rewrite.

## State ownership

| State | Owner | Lifetime |
|---|---|---|
| Area pack | IndexedDB | until a newer `version` is published |
| Profile + transcript | `localStorage` | until user clears memory (Ops tab) |
| Local posts | `localStorage` | until cleared |
| Map camera / selection | React refs in `App.tsx` | session |
| Walk playback | `walkPlayer.ts` | until stopped/finished |

## Extension points

- **More cities:** extend `data/build-data.mjs` from one `AREA` to a list and
  write one pack per area into `index.json`. `packs.ts` already loads by id.
- **Real basemap offline:** generate a PMTiles basemap with Planetiler for the
  area and add it as a local source in `mapView.ts`.
- **Shared social layer:** replace `loadPosts()` in `App.tsx` with an API call;
  keep the same `Post` type.
- **Local model:** point `GATEWAY_URL` at an OpenAI-compatible local server
  (e.g. Kiri Router on the device) — see [AI and memory](AI_AND_MEMORY.md).
- **Mobile shell:** see [Mobile](MOBILE.md).

## Constraints to remember

- Worker free plan: 100k requests/day, 10 ms CPU, 128 MB memory.
- Pages free plan: 20k files/site, 25 MiB per asset, 500 builds/month.
- MapLibre v6 requires WebGL2.
- Gateway free providers are rate-limited; fallbacks exist in the gateway.
