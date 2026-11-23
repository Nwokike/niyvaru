# Niyvaru

**Feel the place before you book it.** Niyvaru is a city-agnostic browser app that assembles a living, walkable map of **any city on Earth** at runtime from free, open data, then lets a private concierge drive that map from a memory of the traveller and the trip.

It is a static Vite + React + TypeScript app: no server to start, no database, no paid API. Production is GitHub Pages, built with `VITE_BASE=/niyvaru/` and served at `https://nwokike.github.io/niyvaru/`.

## What it does

- **Search any city** with Photon (Nominatim fallback), or pick a featured area from `public/areas.json`. Areas are editorial data — no city names, feed queries or content are hardcoded in the application logic.
- **Assembles the area at runtime** in `src/area/store.ts` and `src/sources/assemble.ts`: Overpass shards across mirrors (with the OSM map API in `src/sources/osmMap.ts` as a fallback) build the place set; Commons photos, Wikipedia stories, pedestrian routes, prayer times, weather and the pulse feed stream in parallel. Every stage reports live counts in the loader. Photos are matched to places by position and file title, with bounded galleries and full credits.
- **Renders a time-aware map** with MapLibre GL JS v6 over OpenFreeMap Positron. `src/map/style.ts` regrades every basemap layer by hour (dawn, midday, golden, dusk, night), adds AWS Terrarium terrain and hillshade, builds 3D OSM extrusions, colours POI layers by kind and keeps the camera inside the area. The hour starts from the browser clock; the header slider overrides it. Low-power devices skip terrain and extrusion and show fewer POIs.
- **Discover Dossier** steps through places with next/prev buttons, arrow keys, touch swipes and smooth 3D flights, showing up to three credited photographs, opening hours, accessibility and the place's Wikipedia story.
- **Happening / Story / Memory tabs**: live pulse (MET Norway or Open-Meteo weather, locally computed prayer times, GDELT news, Bluesky stream, Mastodon posts, clearly labelled placements), the area story with full attribution, and an editable on-device memory directory with export/import.
- **Walk mode** matches Panoramax and Mapillary frames to a real walking route and crossfades them in a non-blocking HUD with distance, ETA and pause/resume (space bar or button; Escape stops). Sparse imagery falls back to a smooth 3D camera glide; reduced-motion users get a photo strip.
- **Concierge agent**: an AI SDK `ToolLoopAgent` with 16 typed tools over the Kiri Gateway's OpenAI-compatible endpoint. It can search places, focus or filter them, draw routes, start walks, change the time of day, report what is happening now and maintain its own memory files. Repeated read calls are deduplicated and a loop of identical tool calls stops the turn.
- **PWA shell, i18n en/ar**: installable offline shell, language auto-detected from the browser on first visit, full Arabic layout (`dir=rtl`), with a saved language choice taking precedence.

## Quick start

```bash
npm install
cp .env.example .env      # optional: gateway URL, Mapillary token, Worker URL
npm run dev               # http://127.0.0.1:5173
```

`npm run dev` needs no API process. Type-check and build with `npm run build` (`tsc -b` then `vite build`); `npm run preview` serves `dist/` locally.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on `:5173`; proxies `/api` to `NIYVARU_API_TARGET` (default `http://127.0.0.1:8787`) |
| `npm run build` | Type-check and build the static site into `dist/` |
| `npm run preview` | Serve the built site locally |
| `npm run api:dev` | Run the optional Worker handler in plain Node on `:8787` |
| `npm run worker:dev` | Run the optional Worker with `wrangler dev` |
| `npm run worker:deploy` | Deploy the optional Worker to Cloudflare |

## Repository map

```
index.html                  app shell and metadata
public/areas.json           featured areas (data, not code)
public/manifest.webmanifest PWA manifest
public/sw.js                offline shell service worker
public/brand/               brand imagery and favicon
src/
  main.tsx                  React root, PWA registration, preload-error reload
  App.tsx                   views, tabs, assembly lifecycle, walk orchestration
  area/store.ts             featured/search areas, cache-first assembly
  sources/assemble.ts       runtime area assembler (five streamed stages)
  sources/cache.ts          IndexedDB: packs, TTL cache, memory stores
  sources/                  one adapter per open source (OSM, photos, pulse, routes)
  sources/photoMatch.ts     shared fuzzy title matching for photos and stories
  sources/text.ts           safe website URL helpers for the UI
  map/                      MapLibre style regrade, palette, POI/route layers
  agent/                    ToolLoopAgent, gateway adapter, 16 tools, prompt, facts
  memory/                   memory files, archive, core blocks, retrieval
  config/endpoints.ts       every external URL and public setting
  config/i18n/              English and Arabic dictionaries
  ui/                       homepage/intake, dossier, panels, chat
  walk/                     frame matching and playback
worker/src/index.ts         optional Worker: /api/chat, /api/memory, /api/weather
scripts/dev-api.mjs         local host for the same Worker handler
vite.config.ts              base path, lazy chunks, MapLibre worker copy
.github/workflows/pages.yml build and deploy to GitHub Pages
```

## How a request works

1. The homepage form resolves an area (featured manifest or geocoded search) and writes the traveller and trip facts into `/memories/traveller.md` and `/memories/trip.md` **before** assembly starts.
2. `getOrAssembleArea()` returns an IndexedDB pack immediately when fresh; when stale it returns the cached pack and re-assembles in the background. A new area launches all five stages in parallel.
3. The map is initialised under the loader and waits for `style.load`, then receives the assembled places. When stages settle the app reveals the map with a grow-and-fade transition.
4. The chat panel talks to a client-side `ToolLoopAgent` through `DirectChatTransport`. Tools read the current pack and operate on the live map and the IndexedDB memory files; the model itself is reached through the Kiri Gateway adapter.

## Deployment

Push to `master` (or `main`): `.github/workflows/pages.yml` builds with `VITE_BASE=/niyvaru/` and deploys `dist/` to GitHub Pages. `vite.config.ts` copies the MapLibre worker into `dist/assets` in a `closeBundle` hook because MapLibre derives its worker URL from `import.meta.url`. All app assets use `import.meta.env.BASE_URL`, so the same build works at a sub-path or at the domain root. See [Deployment](docs/DEPLOYMENT.md) for the optional Cloudflare Worker mode.

## Cost boundaries

Everything the app calls is free and open: GitHub, OpenFreeMap, OpenStreetMap/Overpass, Photon/Nominatim, Wikimedia Commons/Wikipedia, Panoramax and Mapillary (free developer token), MET Norway, OSRM, GDELT, Mastodon, Bluesky Jetstream, AWS Terrarium tiles and the Kiri Gateway. No paid map, geocoder, weather API, LLM API or database. App-store distribution, if ever wanted, is outside the web app: iOS $99/year, Google Play $25 once. Open-Meteo's open-access tier is used only as a fallback and is labelled non-commercial.

## Honest limits

- Public Overpass mirrors are rate-limited; the OSM map API fallback covers most browser blocks. Panoramax and Mapillary coverage varies by city, and the walk HUD says so when a route has no frames.
- GDELT and some Mastodon instances lack reliable CORS; news and social items are optional pulse, not a gate on the map.
- Open map data carries no hotel prices. The concierge says so instead of quoting numbers.
- The service worker caches the app shell only; area packs and memory live in IndexedDB, and map tiles rely on HTTP caching.

## Documentation

| Topic | Document |
|---|---|
| Components, lifecycle, state ownership | [Architecture](docs/ARCHITECTURE.md) |
| Open data sources, assembly stages, adding an area | [Data pipeline](docs/DATA_PIPELINE.md) |
| Agent, tools, gateway and memory | [AI and memory](docs/AI_AND_MEMORY.md) |
| Pages build and optional Worker | [Deployment](docs/DEPLOYMENT.md) |
| PWA and native-shell research | [Mobile](docs/MOBILE.md) |
| Common failures and fixes | [Troubleshooting](docs/TROUBLESHOOTING.md) |
| Installed libraries, APIs actually used, risks | [Dependency study](docs/DEPENDENCY_STUDY.md) |
| Ground rules and PR checklist | [Contributing](CONTRIBUTING.md) |
