# Architecture

## One-sentence version

A static React app assembles any city from open sources in the browser, cache-first in IndexedDB, renders it with a time-aware MapLibre map, and exposes it to a client-side tool-calling agent whose memory stays on the device.

## Components

| Component | Technology | Responsibility |
|---|---|---|
| App shell (`src/main.tsx`, `src/App.tsx`) | React 19 + TypeScript | views, tabs, assembly lifecycle, walk orchestration |
| Area store (`src/area/store.ts`) | featured manifest + search | featured areas, geocoded areas, cache-first assembly |
| Assembler (`src/sources/assemble.ts`) | parallel fetches | five streamed stages, photo/story attachment, pack versioning |
| Source adapters (`src/sources/`) | fetch + IndexedDB | one module per open data provider |
| Cache (`src/sources/cache.ts`) | `idb` | packs, TTL key/value, memory files, archive, chat window |
| Map (`src/map/`) | MapLibre GL JS v6 | Positron regrade, terrain, buildings, POI/route layers, camera |
| Agent (`src/agent/`) | AI SDK `ToolLoopAgent` | 16 typed tools, gateway adapter, prompt and grounded facts |
| Memory (`src/memory/`) | IndexedDB files | traveller/trip/journal/places files, archive, retrieval, UI |
| Worker (`worker/`, optional) | Cloudflare Worker | inference passthrough and MET Norway proxy; nothing is stored |
| Hosting | GitHub Pages | static CDN at `/niyvaru/` |

## Runtime flow

```
Homepage form  ──write /memories/traveller.md + trip.md──▶ IndexedDB
     │  submit
     ▼
getOrAssembleArea(meta) ──fresh pack──▶ immediate map + agent
     │  miss / stale                (stale pack: re-assemble in background)
     ▼
assembleArea(meta) ── five parallel stages, live counts ──▶ AreaPack ──▶ savePack()
     │
     ├─ places: Overpass shards ──fallback──▶ OSM map API
     ├─ photos: Commons geosearch (anchored + titled) + Panoramax
     ├─ story:  Wikipedia geosearch in area language, fuzzy title match
     ├─ pulse:  weather, prayer, GDELT, Mastodon, placements
     └─ routes: OSRM walking routes to picked places (after places land)
     ▼
style.load ──▶ regraded map ──▶ Discover Dossier / Happening / Story / chat
```

The form is the full-page brand homepage. Assembly runs while a loader shows per-stage detail lines; when all five stages are `done` or `failed` the map grows in and fades the loader out. A failed stage yields an empty value, never a failed area.

## Area lifecycle

- **Featured areas** come from `fetch(BASE_URL + "areas.json")`; the manifest is data and can be edited without touching code.
- **Any other city** is searched with Photon, then Nominatim, through `searchAreas()`. `areaFromGeocode()` gives it a stable id, a 2 km radius and a default zoom.
- **Freshness:** a cached pack younger than 12 hours answers instantly. A stale pack also answers instantly and re-assembles in the background, pushing the fresh pack through `onUpdate`. A new area assembles from scratch, then saves its pack.
- `AbortController` cancels an in-flight assembly when the traveller changes area.
- Commons files arrive with coordinates and titles from `src/sources/commons.ts`; `src/sources/photoMatch.ts` provides the same fuzzy title matching for photographs and Wikipedia stories.

## Map architecture

`initMap()` in `src/map/mapView.ts` waits for MapLibre's `style.load` event rather than `load`, because `load` waits for DEM tiles and can stall on slow links while the map is already usable.

1. `loadRegradedStyle()` constructs the map with `endpoints.tiles.openFreeMapStyle`. On `style.load`, `setup()` classifies existing layers into roles (land, park, water, road, major road, rail, label, halo), hides decorative layers and the default building fill, and adds two raster-DEM sources from AWS Terrarium tiles (one for terrain, one for hillshade), a hillshade layer and a `fill-extrusion` layer sourced from the vector basemap's `building` layer. Devices detected as low power (`coarse pointer` and under 6 GB device memory) keep the flat brand palette: terrain and extrusion are skipped and the POI set is capped at 600 instead of 1,200.
2. `applyPalette(hour)` pushes `paletteAt(hour)` into every role through `setPaintProperty`, recolours buildings, sets hillshade colours and light direction, and drives `setSky()` / `setLight()`. Palette keyframes wrap around midnight; the slider and the `set_time_of_day` tool share the same hour value.
3. POIs come from a GeoJSON source with circle and label layers (`src/map/pois.ts`); the focused place gets a keyboard-reachable DOM marker. `filterKinds()` sets a `match`-style filter; routes are `line-gradient` layers with `lineMetrics` enabled.
4. `setMaxBounds()` inflates the area radius by 1.9× and `setMinZoom(11.5)` keeps the camera over the assembled area. Initial zoom and focus zoom ease down on narrow screens; pitch, bearing and fly duration respect `prefers-reduced-motion` where applicable. The initial hour is passed in from the browser clock at map construction.
5. Label language switches between `name:latin` and a `name:ar` coalesce expression for Arabic.

A basemap error falls back to a bare background style; DEM tile errors turn terrain off. `styleEpoch` tracks style reloads so the POI, route and filter state can be restored after a fallback instead of being wiped. Both failures are recoverable, not fatal.

## Agent and memory

The chat panel uses `useChat` with `DirectChatTransport`, so the agent runs in-process in the browser; the panel itself is a lazy React chunk. `ToolLoopAgent` is rebuilt for each area and memory revision; `prepareStep` re-reads the pack and memory before every step so tool writes are visible immediately. Read-only tools share a closure-local dedupe cache keyed by normalized arguments, and a third stop condition halts a turn when the same tool call repeats for three steps. All gateway calls go through `src/agent/gateway.ts`; retries happen only after an HTTP 400/5xx failure, with compacted messages, never as upfront pruning. Details in [AI and memory](AI_AND_MEMORY.md).

## UI map

| View / control | Files |
|---|---|
| Full-page homepage and intake form | `src/ui/Intake.tsx` |
| Assembly loader with live stage counts | `src/ui/Assembling.tsx` |
| Discover Dossier (next/prev, arrow keys, touch swipe, up to three credited photos, 3D flights) | `src/ui/DiscoverDossier.tsx`, `src/App.tsx` |
| Happening tab (weather, prayer, news, social, local posts) | `src/ui/PulsePanel.tsx` |
| Story tab (hero photo, narrative, attribution) | `src/ui/BriefPanel.tsx` |
| Memory panel (view, edit, export, import, clear, install) | `src/ui/MemoryPanel.tsx` |
| Chat and tool chips | `src/ui/ChatPanel.tsx` |
| Walk HUD (non-blocking overlay with pause/resume and ETA) | `src/walk/player.ts`, `src/walk/matcher.ts` |

The walk overlay is plain DOM mounted over the map. Space toggles pause/resume, Escape stops, and the camera glides along the real route while the HUD counts distance and remaining minutes. It never blocks the chat, tabs or map controls.

## State ownership

| State | Owner | Lifetime |
|---|---|---|
| Area packs and TTL caches | IndexedDB, `niyvaru` database | until expiry or replacement |
| Memory files, archive, chat window | IndexedDB (`mem_files`, `mem_archive`, `mem_chat`) | until user clears; deletes are archived |
| Locale and intake-done flags | `localStorage` | until cleared |
| Local pulse posts | `localStorage` | until cleared |
| Map camera, selection, walk handle | React refs in `App.tsx` | session |
| Chat transcript shown in UI | AI SDK `useChat` state | session; turn text also appended to memory chat |

`requestPersistence()` asks for persistent storage once so IndexedDB is exempt from pressure eviction where the browser grants it.

## PWA, i18n and build assets

- `public/sw.js` precaches the shell and serves it offline; cross-origin tiles and APIs use HTTP caching, and area data uses IndexedDB.
- `src/main.tsx` registers the service worker at `import.meta.env.BASE_URL + "sw.js"` and reloads once on `vite:preloadError` after a deploy invalidates a hashed chunk.
- Language is `ar` when the browser language starts with `ar` or a saved choice exists, otherwise `en`; `applyDocumentLocale()` sets `lang` and `dir`. Both dictionaries live in `src/config/i18n/`.
- The time-of-day control initialises from `new Date()` in the browser clock.
- `vite.config.ts` sets `base` from `process.env.VITE_BASE`, creates lazy `maplibre`, `agent` and `search` chunks, and copies `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` into `dist/assets` in a `closeBundle` hook. MapLibre computes that worker URL relative to `import.meta.url`, so the copy is required on any static host. `App.tsx` additionally lazy-loads the chat panel with `Suspense`, so it is not in the welcome-screen bundle.

## Extension points

- **New featured city:** add an entry to `public/areas.json` (id, name, centre, radius, zoom, language, prayer method, feed queries). No code change is needed; travellers can also search any city without an entry.
- **New source:** add an adapter under `src/sources/`, put its URL in `src/config/endpoints.ts`, cache it through `cached()` or `cachedWithRefresh()`, and add a stage or pulse item in `assemble.ts`.
- **New agent capability:** add one `tool()` in `src/agent/tools.ts` with a Zod schema; it is included automatically in the roster and in `toolOrder`.
- **New language:** add a dictionary in `src/config/i18n/` and extend the `Locale` union.

## Constraints

- MapLibre v6 requires WebGL2.
- Public Overpass mirrors and GDELT are rate-limited or CORS-restricted; the assembler degrades stage-by-stage.
- The gateway's free model roster is rate-limited; only the failure retry touches it twice.
- Browser storage is per-origin: changing the deploy path changes the cache and memory origin.
