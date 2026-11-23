# Deployment

## Primary: GitHub Pages

`.github/workflows/pages.yml` runs on pushes to `master` or `main` and on manual dispatch. It uses Node 24, runs `npm ci`, builds with `VITE_BASE=/niyvaru/`, uploads `dist/` and deploys with the official Pages actions. The project site is `https://nwokike.github.io/niyvaru/`. No API process, Worker, database or build-time data job is involved.

Enablement: repository Settings → Pages → Source = **GitHub Actions**. The workflow declares `contents: read`, `pages: write` and `id-token: write`, and cancels superseded builds in the `pages` concurrency group.

Reproduce the published build locally:

```bash
npm ci
VITE_BASE=/niyvaru/ npm run build
npm run preview
```

`vite.config.ts` reads `VITE_BASE` from the build environment (not from `.env`), so the same source builds at `/` for local development and at `/niyvaru/` on Pages.

## What lands in `dist/`

- `index.html`, `areas.json`, `manifest.webmanifest`, `sw.js`, `icon.svg`, `brand/`
- hashed JS/CSS chunks, with lazy `maplibre`, `agent` and `search` bundles
- `assets/maplibre-gl-worker.mjs`

The worker file is copied from `node_modules/maplibre-gl/dist/` by a `closeBundle` plugin in `vite.config.ts`. MapLibre v6 derives its worker URL relative to `import.meta.url` (`./maplibre-gl-worker.mjs`), and Vite never emits that file from the dynamic reference, so without the copy the map 404s its worker on any static host. Browser-side asset URLs go through `import.meta.env.BASE_URL`: `featuredAreas()` and `promotionsFor()` fetch `BASE_URL + "areas.json"` / `"promotions.json"`, `main.tsx` registers `BASE_URL + "sw.js"`, and the homepage watermark uses `BASE_URL + "brand/..."`. The service worker itself uses relative paths from its own scope.

## Optional: Cloudflare Worker mode

Nothing in the product requires the Worker; it exists for capabilities a browser cannot do (setting an identifying User-Agent for MET Norway) and for proxy use cases. The client enables it by setting `VITE_API_BASE` at build time.

### Local development

```bash
cp worker/.dev.vars.example worker/.dev.vars   # set GATEWAY_SECRET
npm run api:dev                                # plain Node on :8787
# or: npm run worker:dev
VITE_API_BASE=http://127.0.0.1:8787 npm run dev
```

`vite.config.ts` proxies `/api` to `NIYVARU_API_TARGET` (default `http://127.0.0.1:8787`). `npm run api:dev` imports the exact Worker handler in Node for environments where `workerd` cannot start (for example Alpine/musl).

### Deployment

```bash
npx wrangler secret put GATEWAY_SECRET --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

`worker/wrangler.toml` sets `GATEWAY_URL=https://api.kiri.ng` as a var; `GATEWAY_SECRET` is a secret, and `WEATHER_CONTACT` can be set as a var or secret to identify MET Norway requests. Routes:

| Route | Response |
|---|---|
| `GET /api/health` | `{ ok: true, service: "niyvaru-api" }` |
| `POST /api/chat` | gateway `POST /chat` passthrough, `text/event-stream` |
| `POST /api/memory` | non-streaming gateway call |
| `GET /api/weather` | MET Norway compact forecast with a User-Agent |

Missing `GATEWAY_SECRET` returns 500 with an explanatory body; upstream failures return 502. CORS is open. In Worker mode `src/sources/weather.ts` tries `GET {VITE_API_BASE}/api/weather` first, then the direct providers. The agent itself still uses the browser gateway adapter; `/api/chat` and `/api/memory` are available for other clients.

To serve a static build from Cloudflare Pages instead of GitHub Pages: build with `npm run build` (base `/`) and deploy `dist/`, or connect the repo with build command `npm run build` and output `dist`. Add a route such as `niyvaru.pages.dev/api/*` to the Worker only if you use Worker mode.

## Verify a deployment

1. Open the site: the brand homepage renders; pick or search an area and submit.
2. Watch the assembly loader: places, photos, story, routes and pulse settle with counts, then the map reveals.
3. Check the map: 3D buildings and terrain, POI colours, and the hour slider. Relighting should be immediate.
4. Open Discover Dossier, use the arrow keys, and start a walk; the HUD shows distance and progress without covering the chat.
5. Check Happening, Story and Memory; the agent greets you in the language detected from the browser.
6. In Worker mode, `GET /api/health` returns `ok: true`.
7. `curl -I https://nwokike.github.io/niyvaru/areas.json` returns 200.

## Rollback

GitHub Pages keeps earlier deployments in the environment history; promote a previous one. For the Worker, `wrangler deployments list` shows versions and `wrangler rollback` restores one. Browser caches keep older packs and memory on-device; a fresh assembly replaces a stale pack automatically.

## Cost

| Item | Cost |
|---|---|
| GitHub repo, Actions, Pages | $0 on the free plan (Pages requires a public repo) |
| Cloudflare Pages / Workers (optional) | $0 within free-plan limits |
| OpenFreeMap, OSM/Overpass, Photon/Nominatim, Wikimedia, Panoramax, Mapillary, OSRM, AWS Terrarium, GDELT, Mastodon, Bluesky, MET Norway | $0 |
| Open-Meteo fallback | $0, non-commercial terms |
| Kiri Gateway | $0 within its free provider roster |
| App stores (not part of this web app) | iOS $99/year, Google Play $25 once |

No D1, R2, paid LLM API, paid geocoder, container or always-on server is used. Adding one changes this document and the cost section of the README in the same PR.
