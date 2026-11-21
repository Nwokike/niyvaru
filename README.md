# Niyvaru

A grounded travel companion for Makkah: a **social map** of real places, a
**real street-level walk**, and an **agent** that drives the map from a
client-side memory of the traveller.

This is a test prototype built on **100% free, keyless infrastructure** — no
card, no metered API, no paid tier, no server to start. The web app is static
and is published with **GitHub Pages**. By default the browser calls the Kiri
Gateway directly (CORS is allowed); a Cloudflare Worker is available as an
optional server-side mode for production.

- **Repo:** `Nwokike/niyvaru` (private), default branch `master`
- **Stack:** Vite + React + TypeScript + MapLibre GL JS + Cloudflare Pages/Worker
- **Runtime:** Node 24, npm 11 (CI pins Node 24)

## Contents

| Topic | Document |
|---|---|
| Architecture and request flow | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Data packs, sources, refresh, adding a city | [docs/DATA_PIPELINE.md](docs/DATA_PIPELINE.md) |
| Agent, gateway, client memory, action protocol | [docs/AI_AND_MEMORY.md](docs/AI_AND_MEMORY.md) |
| GitHub Pages / Cloudflare, $0 deployment | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
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
npm run data           # build public/packs/*.json
npm run dev            # http://127.0.0.1:5173 — no API process needed
```

Open <http://127.0.0.1:5173>. Chat works immediately: it uses the same shared
family gateway credential as the other Kiri apps, embedded at build time. Users
do not configure anything.

Optional server-side mode: set `VITE_API_BASE=/api` and run `npm run api:dev`
(or `npm run worker:dev`) with `worker/.dev.vars` configured.

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
  config.ts                 API mode + gateway endpoints
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
.github/workflows/pages.yml build + deploy to GitHub Pages
scripts/dev-api.mjs        local Node host for the Worker handler
```

## How a request works

1. The browser loads `packs/index.json`, then downloads the pack for the
   selected area (cached in IndexedDB, refreshed when the published version
   changes).
2. A chat message and a compact area summary (see [AI and memory](docs/AI_AND_MEMORY.md))
   are sent straight to the Kiri Gateway from the browser.
3. The gateway's SSE stream is read by `src/agent.ts`; a grounded system prompt
   is assembled in the browser from `shared/`.
4. The browser parses any map actions and executes them on the map; after the
   answer, a second gateway call extracts durable facts into the client profile.
   With `VITE_API_BASE` set, steps 2–4 go through the optional Worker instead.

## Deploy for $0

Primary: push to `master` — `.github/workflows/pages.yml` builds with
`VITE_BASE=/niyvaru/` and publishes to **https://nwokike.github.io/niyvaru/**.
No Worker is needed. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the
optional Cloudflare setup.

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
