# Troubleshooting

Verbose logs are opt-in: set `localStorage.niyvaruDebug = "1"` and reload for `[niyvaru:*]` scope logs. Failures log even without it.

## Map is blank or reports a GPU error

MapLibre v6 requires WebGL2. Check `document.createElement("canvas").getContext("webgl2")` in the console. If it returns `null`, use a newer browser/device or pin `maplibre-gl` to v5. iOS WebViews have known context-loss reports; test on a real device.

## Map style fails or looks flat

`loadRegradedStyle()` loads `endpoints.tiles.openFreeMapStyle` and regrades it on `style.load`. Watch for `[niyvaru:map] basemap error` in the console: the code falls back to a bare background style, so a flat map means the style request failed. If only relief is missing, either the Terrarium tiles failed (`setTerrain(null)`) or the device was detected as low power — in that case flat terrain and no extrusion are intentional, and the POI set is capped at 600. A CSP or native shell must allow the tile and DEM hosts.

## Map worker 404 after a static deploy

MapLibre v6 resolves its worker as `./maplibre-gl-worker.mjs` relative to `import.meta.url`. `vite.config.ts` copies that file into `dist/assets` in a `closeBundle` hook. Check that `dist/assets/maplibre-gl-worker.mjs` exists after `npm run build`, that the deployed URL matches `VITE_BASE`, and that the file is served with a JavaScript content type. If the worker fails, the map canvas usually stays blank with a console error about workers.

## Assembly never finishes

The loader reveals when all five stages reach `done` or `failed`; the Enter button enables after the first stage settles. Each stage has a fallback, so even a total source outage produces an empty-but-valid area. Check the stage detail lines and the `[niyvaru:map]`/network logs. Changing the area aborts the previous assembly through `AbortController`; a stale pack is returned immediately and refreshed in the background, so old data on first paint is expected.

## No places on the map

- Confirm the `places` stage count in the loader. Overpass runs three shards on public mirrors with a 25 s timeout; if all fail, `src/sources/osmMap.ts` fetches the OSM map API and caps at 1,200 places.
- The pack is cached for 12 hours. Clear storage from the Memory panel to force a full re-assembly.
- Previous kind filters hide places: tap **All** in the layer chips or ask the agent to clear the view. POI circles become visible at zoom 12.5 and labels at zoom 16.
- The camera is bounded to roughly 1.9× the area radius; zooming out cannot reveal places outside it.
- If a place has no photographs: Commons files are only attached within 300 m or by a matching file title, and each place holds at most six. Unmatched photos still introduce the area as the hero image.

## Walk shows no street photographs

Coverage varies by city. `src/walk/matcher.ts` attaches frames within 60 m of the route, enforces 18 m spacing and caps playback at 110 frames. With fewer than two frames the HUD says route-only and glides the camera along the real route; with reduced motion it shows a photo strip instead. The HUD counts distance and remaining minutes; use the pause button or space bar to pause, Escape to stop. Panoramax is keyless; Mapillary needs `VITE_MAPILLARY_TOKEN`, and without it only Panoramax frames are used. Both adapters are cached for 24 hours.

## Chat fails or returns an error

- Check `VITE_GATEWAY_URL` (default `https://api.kiri.ng`) and the gateway's health. The client requests model `beam` through the OpenAI-compatible adapter and rewrites `/chat/completions` to `/chat`.
- On HTTP 400 or 5xx the gateway adapter retries **once** with compacted tool results and a shortened message list. A persistent error is shown verbatim in the chat, not hidden.
- The loop stops at 12 steps, when `start_walk` runs, or when the same tool call repeats for three steps. Complex requests may need to be split; the tool chips show which tool ran and whether its output arrived.
- A repeated read tool may answer with an "already retrieved" note rather than fresh data. That is the agent's dedupe cache, not a failure; use a different question or reload the page after the area is re-assembled.
- `DirectChatTransport` `onError` surfaces the real message. If text is missing after tool calls, check that `sendAutomaticallyWhen` logic still matches the installed AI SDK version ([Dependency study](DEPENDENCY_STUDY.md)).

## A tool call does nothing

Tool inputs are Zod schemas with coercion and defaults. `repairToolCall` fixes fenced/trailing-comma JSON and fuzzy-matches a hallucinated tool name to the real roster; an id that is not in the current pack returns an error to the model. Check that the pack has finished assembling, that the tool chip reached `output-available`, and that the id shown in the dossier or facts block is the one used.

## Prayer times or weather look wrong

Prayer times are computed locally by `adhan` from the area coordinates, the area's `prayerMethod` (default `mwl`) and a timezone resolved through Open-Meteo; they are never fetched from a prayer API. Weather prefers MET Norway, then Open-Meteo, and labels the provider and licence. A wrong timezone entry cached in IndexedDB persists for 30 days; clear storage to refresh it.

## Memory did not learn anything

The intake form writes `traveller.md` and `trip.md` on submit; everything else is written by the `memory` tool during a turn. Files have per-path character caps (4,000–20,000) and oversized writes are refused with a note. Deletes move content to the archive instead of destroying it. The Memory panel lists every file, allows editing, exports/imports JSON and clears all stores (then re-seeds the empty files). Storage is per-origin: a different base path has different memory.

## Wrong language or time of day

The first visit picks Arabic when `navigator.language` starts with `ar`, otherwise English; a saved `localStorage.niyvaru.locale` wins. The header selector overrides both. The hour starts from `new Date()` in the browser and can be changed with the slider, the named stops or the `set_time_of_day` tool. A restored tab keeps the slider position for the session, not across reloads.

## Offline shell does not install or update

The service worker is registered only when `serviceWorker` exists and only from the base path given by `import.meta.env.BASE_URL`. It precaches the shell, not tiles or APIs. After a deploy, `vite:preloadError` reloads once to recover from stale hashed chunks; if a stale shell persists, unregister the worker in DevTools and reload. PWA install availability is reported through `beforeinstallprompt`, which the Memory panel turns into an Install button.

## Optional Worker problems

- `curl https://<worker>/api/health` should return `{"ok":true,"service":"niyvaru-api"}`.
- Copy `worker/.dev.vars.example` to `worker/.dev.vars` and set `GATEWAY_SECRET`, or set it in production with `npx wrangler secret put GATEWAY_SECRET --config worker/wrangler.toml`.
- On Alpine/musl, `wrangler dev` can fail with `spawn .../workerd ENOENT`; use `npm run api:dev`, which runs the same handler in Node.
- The agent does not require the Worker. The only browser path that uses it by default is the MET Norway weather proxy when `VITE_API_BASE` is set.

## Build or type errors

Run `npx tsc -b` alone for a clean report; `npm run build` runs the same check before Vite. `tsconfig.tsbuildinfo` is generated and ignored. After a successful build, verify `dist/assets/maplibre-gl-worker.mjs` exists and that `dist/index.html` references the expected base path when building with `VITE_BASE=/niyvaru/`.
