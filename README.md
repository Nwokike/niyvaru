# Niyvaru

A grounded travel companion for Makkah: a **social map** of real places, a
**real street-level walk**, and an **agent** that drives the map from a
client-side memory of the traveller.

This is a prototype built on **100% free, keyless infrastructure** — no card,
no metered API, no paid tier, no server to start. The web app is static; the
only backend is one free Cloudflare Worker that proxies an AI gateway.

- **Repo:** `Nwokike/niyvaru` (private), default branch `master`
- **Stack:** Vite + React + TypeScript + MapLibre GL JS + Cloudflare Pages/Worker
- **Runtime:** Node 24, npm 11 (CI pins Node 24)

## Contents

| Topic | Document |
|---|---|
| Architecture and request flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Data packs, sources, refresh, adding a city | [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) |
| Agent, gateway, client memory, action protocol | [docs/AI_AND_MEMORY.md](docs/AI_AND_MEMORY.md) |
| Deploy to Cloudflare for $0 | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Mobile: PWA / Capacitor / Tauri research | [docs/MOBILE.md](docs/MOBILE.md) |
| Errors and gotchas | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| How to contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |

## What is in the prototype

- **Social map:** 1,400+ real OpenStreetMap places around the Haram — hotels,
  pharmacies, shops, mosques, ATMs, hospitals — with opening hours, phone,
  website and wheelchair tags.
- **Walk mode:** real Panoramax street-level frames played along a real OSRM
  walking route, with distance, heading and a progress bar.
- **Agent:** chat grounded *only* in the area data pack and client memory. It can
  focus a place, highlight a kind of place, show a route, or start a walk.
- **Client memory:** durable traveller facts (mobility, budget, preferences)
  live in `localStorage`; a post-answer extraction pass merges new facts. No
  user data is stored on a server.
- **Feed:** prayer times, weather, NASA EONET events and local posts — the
  "what is happening now" layer, with nothing fabricated.
- **Ops:** inspect/edit the learned memory and see the routes.

## Quick start

```bash
cd niyvaru
npm install
cp worker/.dev.vars.example worker/.dev.vars   # put a valid gateway key in it
npm run data                                    # build public/packs/*.json

# terminal 1 — API (choose ONE)
npm run api:dev        # plain Node, works everywhere (recommended here)
# npm run worker:dev   # wrangler dev, needs a workerd binary for your platform

# terminal 2 — web app
npm run dev            # http://127.0.0.1:5173, proxies /api to :8787
```

Open <http://127.0.0.1:5173>. The map and packs work even with no gateway key;
chat returns a clear configuration error instead of failing silently.

For a quick local smoke test, a valid family key is in Asase's public
`src/core/constants.py` (`Nwokike/Asase`). For anything shared, use your own
gateway secret. **Never commit `worker/.dev.vars`** — it is gitignored.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5173; proxies `/api` to `NIYVARU_API_TARGET` (default `http://127.0.0.1:8787`) |
| `npm run build` | Type-check (`tsc -b`) and build static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run data` | Regenerate all area packs from free sources |
| `npm run api:dev` | Run the exact Worker handler in Node on :8787 |
| `npm run worker:dev` | Run the Worker with `wrangler dev` |
| `npm run worker:deploy` | Deploy the Worker to Cloudflare |

## Repository map

```
index.html                  app shell
src/
  App.tsx                   UI: map, chat, feed, ops
  agent.ts                  chat client, SSE parser, action parser, memory study
  mapView.ts                MapLibre setup, POI/route layers, focus/highlight
  memory.ts                 localStorage profile + transcript
  packs.ts                  load packs on demand, cache in IndexedDB
  walkPlayer.ts             real-frame walk playback
  types.ts                  shared TypeScript types
shared/                     code used by BOTH browser and Worker
  facts.ts                  grounded context builder
  profile.ts                profile text + sanitising model output
  prompt.ts                 system prompt
worker/src/index.ts         Cloudflare Worker: /api/health, /api/chat, /api/memory
worker/wrangler.toml        Worker config (GATEWAY_URL var)
data/build-data.mjs         free data pipeline -> public/packs/*.json
public/packs/               generated packs (committed, versioned)
.github/workflows/data.yml  daily pack refresh + commit
scripts/dev-api.mjs         local Node host for the Worker handler
```

## How a request works

1. The browser loads `packs/index.json`, then downloads the pack for the
   selected area (cached in IndexedDB, refreshed when the published version
   changes).
2. A chat message is sent to `POST /api/chat` with the last 8 messages, the
   client profile and a compact area summary (see [AI and memory](docs/AI_AND_MEMORY.md)).
3. The Worker builds a grounded system prompt and streams the Kiri Gateway
   response as SSE back to the browser.
4. The browser parses any map actions and executes them on the map; after the
   answer, `POST /api/memory` extracts durable facts into the client profile.

## Deploy for $0

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Short version:

```bash
npm run build
npx wrangler pages deploy dist --project-name niyvaru
npx wrangler secret put GATEWAY_SECRET --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

## Cost boundaries (read before promising "free")

- Free: GitHub, GitHub Actions (public repo, or private within included minutes),
  Cloudflare Pages, Workers, OpenFreeMap, OSM/Overpass, Panoramax, Open-Meteo
  open-access tier, NASA EONET, OSRM demo, Kiri Gateway.
- Not free: **iOS App Store ($99/year), Google Play ($25 one-time)**, and any
  commercial tier of the map/weather providers listed in
  [Data pipeline](docs/DATA_PIPELINE.md).
- The prototype deliberately uses no D1, R2, paid LLM API or paid geocoding.

## Honest limits

- Public Overpass mirrors are rate-limited; the pipeline tries five mirrors and
  the main instance is sometimes at capacity.
- Panoramax coverage near the Haram is real but thin (~88 frames in 1.2 km).
- There is no free live crowd/traffic feed; "what is happening" is prayer times,
  weather, EONET and local posts only.
- The free Open-Meteo tier is non-commercial; production needs self-hosting or
  NOAA. OSRM demo is prototype-only.
- Kiri Gateway depends on your free provider roster. The Worker speaks OpenAI
  wire format, so a local model can replace it without changing the app.
- The Worker free plan has request/CPU limits; the static-first design keeps
  map, packs and walks off the Worker entirely.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). No secrets in commits; run `npm run build`
before opening a PR.
