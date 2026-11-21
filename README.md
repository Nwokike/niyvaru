# Niyvaru

A grounded travel companion for Makkah: a social map of real places, a real
street-level walk, and an agent that drives the map. Prototype built to run on
**100% free, keyless infrastructure** — no card, no metered API, no paid tier.

## What it does

- **Social map** — real OpenStreetMap places around the Haram (hotels,
  pharmacies, shops, mosques, ATMs, hospitals) with opening hours, phone,
  website and wheelchair tags, rendered with MapLibre on a free vector basemap.
- **Walk mode** — real Panoramax street-level frames played along a real OSRM
  walking route, with distance and heading.
- **Agent** — a chat companion grounded only in the data pack and the client
  memory. It can focus a place, highlight a kind of place, show a route, or
  start a walk by emitting `<niyvaru>{...}</niyvaru>` action blocks.
- **Client memory** — the traveller's durable facts live in `localStorage`.
  Every request re-assembles context from memory + the area pack, and after
  each answer a small extraction pass merges new facts into memory. Nothing
  about the user is stored on a server.
- **Ops** — inspect the learned memory, edit it, and see the routes.

## Architecture

```
Browser (Vite + React + MapLibre, static build)
  ├── /packs/*.json         static per-area data packs (versioned)
  ├── localStorage          client memory + transcript + local posts
  └── /api/chat, /api/memory → Cloudflare Worker → Kiri Gateway (api.kiri.ng)
```

- **Web:** Vite + React + TypeScript, built to static files, deployable to
  Cloudflare Pages.
- **Worker:** one Cloudflare Worker proxying the Kiri Gateway `/chat` contract
  (`task_type: text`, SSE). The gateway secret never reaches the browser.
- **Data:** `data/build-data.mjs` builds `public/packs/*.json` from OpenStreetMap
  (Overpass), Panoramax, Open-Meteo, NASA EONET and OSRM. A GitHub Action
  refreshes it daily.
- **No D1, no R2, no database.** Social posts are local to the device in this
  prototype; the schema for a shared social layer is a later step.

## Run it locally

```bash
npm install
cp worker/.dev.vars.example worker/.dev.vars   # add your Kiri Gateway secret
npm run data                                     # build the Makkah pack (needs network)

# terminal 1 — the API worker
npm run worker:dev                               # http://127.0.0.1:8787

# terminal 2 — the web app (proxies /api to the worker)
npm run dev                                      # http://127.0.0.1:5173
```

If `wrangler dev` cannot start (e.g. Alpine/musl, where workerd's glibc binary
won't run), use `npm run api:dev` instead — it imports the **same** worker
handler in plain Node. For a quick local test, the Asase family key in Asase's
public `src/core/constants.py` is a valid gateway secret; production should set
its own via `wrangler secret put GATEWAY_SECRET`.

Without `GATEWAY_SECRET` the map, packs, walks and memory still work; chat
returns a clear configuration error.

## Deploy (free)

```bash
npm run build
npx wrangler pages deploy dist --project-name niyvaru
npx wrangler secret put GATEWAY_SECRET --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

Point the Worker route at `/api/*` and set `NIYVARU_API_TARGET` (or the Vite
proxy) to the deployed Worker for local development against production.

## Data sources and licences

| Source | Use | Licence / terms |
|---|---|---|
| OpenStreetMap / Overpass | places, opening hours, accessibility | © OSM contributors, ODbL — attribute, share-alike for derivatives |
| Panoramax | street-level frames | CC-BY-SA 4.0 — attribute |
| OpenFreeMap | vector basemap style | free public service, self-hostable; no key |
| Open-Meteo | weather | free/open-access tier is non-commercial — self-host or use NOAA for production |
| NASA EONET | live natural events | public domain, no key |
| OSRM demo | prototype walking geometry | not for production; self-host OSRM/Valhalla later |
| Kiri Gateway | LLM inference | your own gateway |

## Honest limits

- The prototype uses the public Overpass API with mirror fallback; production
  should download the Makkah extract and self-host Overpass/Valhalla.
- Panoramax coverage near the Haram is real but thin (88 frames in ~1.2 km).
  It is enough for a few credible walks, not the whole city.
- There is no free live crowd/traffic feed; the "now" layer is prayer times,
  weather, EONET and local posts — nothing is faked.
- Kiri Gateway is the fastest path but depends on your free provider roster;
  the worker talks the OpenAI wire format, so a local model can replace it
  without touching the app.
