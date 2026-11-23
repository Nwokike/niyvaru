# Dependency study

Evidence-based notes from reading the installed packages in `node_modules` and their call sites in `src/`. Paths below are relative to the repository root. "Declared" is the range in `package.json`; "installed" is the version in the corresponding `node_modules/<pkg>/package.json` on 2026-11-23. No API is listed here unless it was found in the installed source or type declarations.

| Package | Declared | Installed | License field | Used for |
|---|---|---|---|---|
| `ai` | `^7.0.179` | 7.0.179 | Apache-2.0 | `ToolLoopAgent`, tools, transports, stop conditions |
| `@ai-sdk/react` | `^4.0.183` | 4.0.183 | Apache-2.0 | `useChat` |
| `@ai-sdk/openai-compatible` | `^3.0.94` | 3.0.94 | Apache-2.0 | gateway model with custom `fetch` |
| `zod` | `^4.6.7` | 4.6.7 | MIT | 16 tool input schemas |
| `@orama/orama` | `^3.1.18` | 3.1.18 | Apache-2.0 | in-memory place and memory search |
| `idb` | `^8.0.4` | 8.0.4 | ISC | IndexedDB database wrapper |
| `maplibre-gl` | `^6.19.0` | 6.19.0 | BSD-3-Clause | map, style regrade, terrain, layers |
| `adhan` | `^4.4.3` | 4.4.6 | MIT | local prayer-time calculation |
| `react` / `react-dom` | `^19.2.0` | 19.3.1 | MIT | UI and DOM root |
| `vite` | `^7.1.0` | 7.3.8 | MIT | build, dev server, base path |
| `@vitejs/plugin-react` | `^5.0.0` | 5.2.0 | MIT | JSX transform / Fast Refresh |
| `pmtiles` | `^4.4.0` | 4.5.0 | BSD-3-Clause | **unused** — see the last section |

## `ai` 7.0.179

**Source paths read:** `node_modules/ai/package.json`, `node_modules/ai/dist/index.js`, `node_modules/ai/dist/index.d.ts`, `node_modules/ai/dist/index-CM_8u8gB.d.ts`.

**APIs used and where.** `ToolLoopAgent` (`index-CM_8u8gB.d.ts:6730`) is constructed in `src/agent/runtime.ts`; `tool()` is the schema helper for all tools in `src/agent/tools.ts` and `src/memory/memoryTool.ts`; `isStepCount` and `hasToolCall` (`:3820`, `:3834`) form `stopWhen`; `DirectChatTransport` (`:7338`) and `lastAssistantMessageIsCompleteWithToolCalls` (`:7371`) are used by `src/ui/ChatPanel.tsx`; the types `ToolCallRepairFunction` (`:3972`), `ToolSet`, `StopCondition` and `StepResult` are used by the repair function and the repeat-call stop predicate. `ToolLoopAgentSettings` (`:6465`) confirms the exact option names the app passes: `instructions`, `prepareStep`, `tools`, `toolOrder`, `toolCallConcurrency`, `stopWhen`, `repairToolCall`, `timeout`, `temperature`, `maxRetries`. `DirectChatTransportOptions` (`:7310`) accepts an agent plus `UIMessageStreamOptions`, which is where the app's `onError` comes from. `ChatInit` (`:6999`) confirms `transport`, `onFinish`, `sendAutomaticallyWhen` and `experimental_queue`.

**How it is utilized.** The transport calls the agent in-process — no HTTP chat route. The agent holds 16 tools; `toolOrder` is a sorted key list for stable provider caching, `toolCallConcurrency: 1` serializes map/memory mutations, and `repairToolCall` handles `InvalidToolInputError` (strip fences, trailing commas) and unknown tool names (substring match against the real roster). Tool results render as `tool-*` message parts in the chat.

**Risks.** These are current v7 APIs; `@ai-sdk/react` is a separate major line (4.x) and the pair must be upgraded together. `experimental_queue` is explicitly marked experimental in the installed typings. The per-step timeout object is SDK-level, not a replacement for gateway timeouts. `npx tsc -b` passes with the installed combination.

**Unused.** Stream helpers such as `streamText`, `generateObject`, `experimental_transcribe`, `gateway` and the WebSocket transports are exported but never imported.

## `@ai-sdk/react` 4.0.183

**Source paths read:** `node_modules/@ai-sdk/react/dist/index.d.ts`, `node_modules/@ai-sdk/react/dist/index.js`.

**APIs used.** `useChat` (`:130`) in `src/ui/ChatPanel.tsx`. `UseChatOptions` (`:113`) is a union of an existing `Chat` instance or `ChatInit`; the app passes `ChatInit` fields — `transport`, `onFinish`, `sendAutomaticallyWhen`, `experimental_queue` — from the `ai` package's `ChatInit`. Returned values used: `messages`, `sendMessage`, `status`, `error`, `stop`. `status === "submitted" || "streaming"` drives the busy state; message `parts` distinguish text from tool chips.

**Risks.** The UI walks `message.parts` with `p.type.startsWith("tool-")` and reads an optional `state`; that is a documented UI-message-part pattern, but part naming is SDK-version sensitive — verify after upgrades.

**Unused.** `useCompletion`, throttling options, `resume`, and all other hooks in the package.

## `@ai-sdk/openai-compatible` 3.0.94

**Source paths read:** `node_modules/@ai-sdk/openai-compatible/package.json`, `node_modules/@ai-sdk/openai-compatible/dist/index.d.ts`, `node_modules/@ai-sdk/openai-compatible/dist/index.js`.

**APIs used.** `createOpenAICompatible()` (`:419`) in `src/agent/gateway.ts`, with `name`, `baseURL`, `apiKey` and `fetch`. `OpenAICompatibleProviderSettings.fetch` (`:377`) is documented as a custom fetch for intercepting requests, which is exactly how the gateway adapter works. The installed `doGenerate`/`doStream` code builds the URL with `path: "/chat/completions"` (`:637`, `:673`) and passes `config.fetch` to `postJsonToApi`; the app's `gatewayFetch` rewrites that path to `/chat` and leaves the SDK's `Authorization: Bearer …` header intact.

**Risks.** The rewrite depends on the SDK's literal `/chat/completions` path. If a future provider version changes it, the `replace()` becomes a no-op and requests go to the wrong gateway path — the debug log in `gatewayFetch` prints the final URL, so this is visible. The retry parses `init.body` as a JSON string; that assumption is true for this provider today.

**Unused.** Completion, embedding and image models, `transformRequestBody`, `metadataExtractor`, `includeUsage` and `supportsStructuredOutputs` are available but not configured.

## `zod` 4.6.7

**Source paths read:** `node_modules/zod/package.json`, `node_modules/zod/index.d.cts`, `node_modules/zod/v4/classic/external.d.cts`, `node_modules/zod/v4/classic/schemas.d.cts`, `node_modules/zod/v4/classic/coerce.d.cts`.

**APIs used.** `z.object` (`classic/schemas.d.cts:530`), `z.enum`, `z.string`, `z.array`, `z.infer` (`classic/external.d.cts:7`), `z.coerce.number` / `z.coerce.boolean` (`classic/coerce.d.cts`: `number`, `boolean`) and `.catch()` (`classic/schemas.d.cts:57-58`) across the tool schemas. Validators include `.int()`, `.min()`, `.max()`, `.optional()` and `.nullable()`.

**How it is utilized.** Zod is the single validation boundary between weak free-model output and app state: bad numbers coerce to defaults via `.catch()`, enums reject unknown kinds, and `z.infer<typeof inputSchema>` types `MemoryInput` in `src/memory/memoryTool.ts`.

**Risks.** Only the v4 classic entry point is used; code must keep importing `"zod"`, not `"zod/v3"` or `"zod/mini"`. Coercion accepts loose inputs by design — values are corrected, not rejected, which is intentional here.

**Unused.** The v3 and mini entry points, refinements, transforms, discriminated unions and code generation from `node_modules/zod/compile.*`.

## `@orama/orama` 3.1.18

**Source paths read:** `node_modules/@orama/orama/dist/commonjs/index.d.ts`, `node_modules/@orama/orama/dist/commonjs/methods/create.d.ts`, `insert.d.ts`, `search.d.ts`.

**APIs used.** `create({ schema })`, `insert(db, doc)`, `insertMultiple(db, docs)` and `search(db, { term, limit, where })`. `create.d.ts` confirms the schema argument; `insert.d.ts` confirms both insert forms; `search.d.ts` shows the return is `Results | Promise<Results>`, which is why the app always `await`s it.

**How it is utilized.** Two in-memory indexes, both built per operation: `src/agent/tools.ts` indexes the current pack's places (`name`, `kind`, `extras`, `ref`) for `search_places`, including a `where: { kind: { eq: kind } }` filter; `src/memory/search.ts` indexes memory files plus up to 200 archive entries for retrieval, normalizing Arabic tashkeel and alef variants before indexing. No index is persisted.

**Risks.** `create()` has no persistence by default; at a few thousand documents per area the rebuild cost is negligible, but indexing the whole pack on every `search_places` call scales with place count. `where` field names must match the schema exactly.

**Unused.** `searchVector`, `save`/`load`, facets, pinning, grouping, sorting configuration, plugins and the browser/deno bundles.

## `idb` 8.0.4

**Source paths read:** `node_modules/idb/build/index.d.ts`, `node_modules/idb/build/entry.d.ts`, `node_modules/idb/build/database-extras.d.ts`.

**APIs used.** `openDB` (`entry.d.ts:44`), the `DBSchema` and `IDBPDatabase` types, and the promise-wrapped methods `put`, `get`, `getAll`, `add`, `delete`, `clear`, `count`. `build/index.d.ts` re-exports `entry.js` and pulls in `database-extras.js` and `async-iterators.js`.

**How it is utilized.** `src/sources/cache.ts` opens one `niyvaru` database at version 3 with typed stores: `packs` (key `string`), `kv` (`KvRecord` with `expiresAt`), `mem_files`, `mem_archive` (indexed by `archivedAt`) and `mem_chat` (auto-increment key). `cached()` and `cachedWithRefresh()` implement TTL semantics on top of `kv`. `src/memory/store.ts` uses the same handles for agent memory and `navigator.storage.persist()`.

**Risks.** Store names and key paths are part of the on-device schema: raising `DB_VERSION` needs an `upgrade` migration, and changing a key path breaks existing users' memory. IndexedDB is scoped to the origin, so changing `VITE_BASE` changes the data location.

**Unused.** Async iterators/cursors (`async-iterators.d.ts`), `unwrap`/`wrap`, `deleteDB`, transactions used directly, and the UMD build.

## `maplibre-gl` 6.19.0

**Source paths read:** `node_modules/maplibre-gl/package.json`, `node_modules/maplibre-gl/dist/maplibre-gl.mjs`, `node_modules/maplibre-gl/dist/maplibre-gl.d.ts`, `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` (header), and the deployed copy in `dist/assets/`.

**APIs used.** `Map` with a style URL and `attributionControl` regrade options in `src/map/style.ts`; the `style.load` event (`maplibre-gl.d.ts:8681`) is the readiness signal, deliberately ahead of `load` because of DEM tiles. `getStyle`, `setLayoutProperty`, `setPaintProperty` (`:9997`), `setFilter`, `addSource`, `addLayer`, `getSource`, `getLayer`, `setTerrain` (`:11248`/`:14800`), `setSky` (`:10017`), `setLight` (`:10013`), `setMaxBounds` (`:14038`), `setMinZoom` (`:14059`), `flyTo`, `fitBounds`, `jumpTo`, `on`, `remove`. Layer types used: `background`, `fill`, `line`, `symbol`, `hillshade`, `fill-extrusion`, `circle`, and a `line-gradient` line layer. `GeoJSONSource.setData` updates POI and route layers; `lineMetrics: true` enables `line-progress`. `Marker` with a custom DOM element keeps the focused pin keyboard-reachable.

**Worker evidence.** In `dist/maplibre-gl.mjs` the helper `kl()` reads `import.meta.url` and resolves `new URL("./" + (isDev ? "maplibre-gl-worker-dev.mjs" : "maplibre-gl-worker.mjs"), e)`; the worker can also be overridden through `WORKER_URL`. Vite does not emit that sibling file from the dynamic reference, so `vite.config.ts` copies `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` to `dist/assets` in the Rollup `closeBundle` hook (`node_modules/rollup/dist/rollup.d.ts:484` confirms the hook signature), and `worker.format: "es"` is set for module workers.

**How it is utilized.** `src/map/style.ts` classifies Positron layers into roles on `style.load`, pushes hour-keyframed colours from `src/map/palette.ts` into each role, and adds AWS Terrarium `raster-dem` sources for terrain plus hillshade and an OSM `building` `fill-extrusion` layer. `src/map/mapView.ts` bounds the camera to the area, passes the browser hour into `initMap`, caps POIs at 600 on low-power devices and uses a `styleEpoch` counter to restore custom layers after a fallback style replacement. Relighting is driven through `requestAnimationFrame`. `src/map/pois.ts` owns the POI/route sources and the focused marker.

**Risks.** WebGL2 is mandatory in v6. `setPaintProperty`, `setSky` and `setLight` are called with `{ validate: false }` (the `StyleSetterOptions.validate` flag exists in the typings) to allow data-driven expressions and experimental sky/light fields; a style-spec change can therefore fail silently at runtime. DEM tile failures are caught and terrain is disabled; style errors replace the map with a plain background. The style regrade depends on Positron layer ids matching the role regexes — an upstream style change needs `setup()` reviewed.

**Unused.** Style imports from `maplibre-gl.css`, custom protocols, `addProtocol`, `ImageSource`, `CanvasSource`, `VideoSource`, heatmaps, clustering, globe projection, 3D model layers, `queryRenderedFeatures` and the worker-pool configuration are all available but unused.

## `adhan` 4.4.6

**Source paths read:** `node_modules/adhan/lib/types/Adhan.d.ts`, `PrayerTimes.d.ts`, `CalculationMethod.d.ts`, `HighLatitudeRule.d.ts`, `CalculationParameters.d.ts`, plus runtime export checks.

**APIs used in `src/sources/prayer.ts`:** `CalculationMethod`, `CalculationParameters`, `Coordinates`, `HighLatitudeRule`, `Madhab`, `PolarCircleResolution`, `PrayerTimes`. `PrayerTimes.d.ts` confirms `new PrayerTimes(coordinates, date, calculationParameters)` with `fajr`, `sunrise`, `dhuhr`, `asr`, `maghrib` and `isha` date fields; `HighLatitudeRule.d.ts` confirms `recommended(coordinates)`; the runtime exports confirm `Madhab.Shafi`, `PolarCircleResolution.AqrabYaum` and all twelve `CalculationMethod` factories used in the method map.

**How it is utilized.** `computePrayer()` maps `AreaMeta.prayerMethod` to an adhan method, sets Shafi madhab, the recommended high-latitude rule and `AqrabYaum` for polar cases, then formats each prayer into the area's resolved timezone for seven days. This is a local computation — no prayer API and no stale cache for the times themselves. Timezone comes from Open-Meteo and is cached for 30 days.

**Risks.** `adhan` is listed under `devDependencies` even though `src/sources/prayer.ts` imports it at runtime; bundlers resolve it today, but a production install with `npm ci --omit=dev` would break. It should be moved to `dependencies`. Prayer output depends on the device's `Intl` timezone data.

**Unused.** `Qibla`, `SunnahTimes`, `Rounding`, `Shafaq`, `Prayer`, the `timeForPrayer`/`currentPrayer`/`nextPrayer` helpers and the CJS/UMD bundles.

## React, React DOM, Vite, plugin-react

**Source paths read:** `node_modules/@types/react-dom/client.d.ts`, `node_modules/vite/types/importMeta.d.ts`, `node_modules/vite/dist/node/index.d.ts`, `node_modules/rollup/dist/rollup.d.ts`, `node_modules/@vitejs/plugin-react/package.json`.

- `createRoot` (`@types/react-dom/client.d.ts:86`) and `StrictMode` mount the app in `src/main.tsx`. `useState`, `useEffect`, `useMemo`, `useCallback` and `useRef` drive views, refs and lifecycle in `App.tsx`; no external state manager is used.
- `import.meta.env.BASE_URL` is typed in `vite/types/importMeta.d.ts:15`. `src/main.tsx` uses it for service-worker registration and `src/config/endpoints.ts` re-exports it as `BASE_URL` for `areas.json`, `promotions.json` and brand assets.
- `vite.config.ts` uses `base` (`vite/dist/node/index.d.ts:3222`), `worker.format: "es"` (the `ResolvedWorkerOptions.format` union at `:3425-3427`), `optimizeDeps.exclude`, `server.proxy`, `build.rollupOptions.output.manualChunks` for lazy `maplibre`/`agent`/`search` chunks, and a Rollup `closeBundle` hook for the worker copy.
- `react()` from `@vitejs/plugin-react` provides JSX transform and Fast Refresh.

**Risks.** `VITE_BASE` is read from `process.env` in `vite.config.ts`: set it in the build environment (as the Pages workflow does), not only in `.env`. `VITE_*` values are inlined into the client bundle — only public settings belong there. React 19's concurrent features are used only implicitly through `useChat` state updates.

**Unused.** React Server Components, `hydrateRoot`, Vite SSR/environment APIs, library mode and the default `iife` worker format. `Suspense` is used for the lazy chat panel, but not for data fetching.

## Unused and to remove

- **`pmtiles`** (installed 4.5.0) has no import anywhere in `src/`. It survives only in `package.json` and as a string in `vite.config.ts` `manualChunks.maplibre`. The app fetches OpenFreeMap styles over HTTPS and AWS Terrarium PNG tiles directly; no `addProtocol` or PMTiles source exists. The main agent will remove the dependency and the chunk entry. Note that the old "style URL rewritten to `pmtiles://`" behaviour is gone: `src/map/style.ts` uses the Positron URL as-is.
- `src/ui/Welcome.tsx` exports `Welcome`, but nothing imports it; the full-page `Intake` component is the homepage.
- `src/sources/commons.ts` exports a plain `photosNear()` wrapper over `anchoredPhotosNear()`; the assembler uses the anchored form, so the wrapper has no importer. The newer `src/sources/photoMatch.ts` and `src/sources/text.ts` helpers are dependency-free and in active use (title matching and safe website URLs).
- `src/memory/search.ts` exports `searchMemory`; the memory tool searches the archive directly instead.
- `src/map/mapView.ts` still declares `protocolAdded` with `void protocolAdded` no-ops — a leftover from the removed PMTiles protocol registration.
- Unused declarations and settings worth pruning: `endpoints.mapillary.tiles`, `endpoints.gateway.taskType`, `primeGeocodeCache()`, `deletePack()`, `noteToArchive`, `TIME_STOPS` and `lightPosition`/`clockLabel` in `src/map/palette.ts`, `RoutePurpose` in `src/sources/types.ts`, and the `done` field of `ShardProgress`. `endpoints.tiles.openFreeMapStyle`, `endpoints.tiles.attributionHtml`, and `endpoints.terrain.terrariumTiles` are now the single source for map style/DEM URLs and attribution.

All listed packages are free and open by their declared licenses; none of the code paths above call a paid API.
