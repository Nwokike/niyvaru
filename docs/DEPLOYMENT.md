# Deployment ($0)

## Primary: GitHub Pages (test / non-commercial)

`.github/workflows/pages.yml` builds with `VITE_BASE=/niyvaru/` and deploys the
`dist/` output to GitHub Pages on every push to `master` (or `main`). The site
is live at **https://nwokike.github.io/niyvaru/**. No API process, no Worker and
no configuration is needed — chat calls the gateway directly from the browser.

Enablement (already done for this repo): Settings → Pages → Source = GitHub
Actions, and the repo must be public on a Free account.

To reproduce a build locally:

```bash
npm install
VITE_BASE=/niyvaru/ npm run build
```

## Optional: Cloudflare (server-side mode)

### Prerequisites

- A Cloudflare account on the **Free** plan (no card needed).
- Node 24 + npm 11 locally.
- `wrangler login` completed once, or `CLOUDFLARE_API_TOKEN` in CI.

### 1. Build and deploy the static site

```bash
npm install
npm run build                 # runs tsc -b and vite build -> dist/
npx wrangler pages deploy dist --project-name niyvaru
```

Cloudflare Pages free limits: 20,000 files/site, 25 MiB per asset, 500 builds
per month, one concurrent build. Our `dist/` plus packs is far below that.

To connect Pages to GitHub instead of direct upload: Cloudflare dashboard →
Workers & Pages → Create → Pages → Connect to Git → repo `Nwokike/niyvaru`,
build command `npm run build`, output directory `dist`. Set the Node version to
24 in the build environment if the UI offers it.

## 2. Deploy and configure the Worker

```bash
npx wrangler secret put GATEWAY_SECRET --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

`GATEWAY_URL` defaults to `https://api.kiri.ng` in `worker/wrangler.toml`;
override it with `wrangler secret put GATEWAY_URL` only if you use a different
gateway. Verify:

```bash
curl https://<your-worker>.workers.dev/api/health
# {"ok":true,"service":"niyvaru-api","gateway":"https://api.kiri.ng"}
```

Then add a route so the deployed site's `/api/*` goes to the Worker (Cloudflare
dashboard → Workers → the Worker → Triggers → Routes), e.g.
`niyvaru.pages.dev/api/*`. If you deploy via your own domain, use that domain
in the route pattern.

### 3. Local development against the deployed API

For the optional Worker mode, set `VITE_API_BASE=https://<your-worker>.workers.dev`
when building; `vite.config.ts` also proxies `/api` to `NIYVARU_API_TARGET`
(default `http://127.0.0.1:8787`) for local development.

## 4. Data refresh

The workflow `.github/workflows/data.yml` rebuilds packs daily and commits them
when they change. It runs on `master` and `main`, on manual dispatch, and on
`data/**` pushes. If you deploy with direct upload, re-run `npm run build` and
`wrangler pages deploy dist` after a pack refresh. A Git-connected Pages project
rebuilds automatically on the pack commit.

## 5. Verify a production deployment

1. Open the site: map renders and POI pins are visible.
2. In Worker mode, check `GET /api/health`.
3. Ask "walk me to a pharmacy" — a route appears and the walk overlay plays.
4. Check the Ops tab: profile fields are editable and memory clears.
5. `curl -I /packs/index.json` — should be 200 with a cache header.

## Rollback

Pages keeps previous deployments in the dashboard; select an earlier one and
promote it. For the Worker, `wrangler deployments list` shows versions; use
`wrangler rollback` (or re-deploy a known-good commit).

## Cost checklist

| Item | Cost on Free |
|---|---|
| GitHub repo, Actions, Pages | $0 (Pages needs a public repo on Free) |
| Cloudflare Pages | $0 |
| Cloudflare Workers | $0 up to 100k requests/day |
| OpenFreeMap, OSM/Overpass, Panoramax, EONET, OSRM demo | $0 |
| Open-Meteo open tier | $0, non-commercial only |
| Kiri Gateway | $0 within your own free provider rosters |
| App stores (optional, not part of prototype) | iOS $99/year, Google Play $25 once |

## What is deliberately absent

D1, R2, Vectorize, paid maps, paid LLM APIs, a container, and a server to start.
If you add any of them, update this file and the cost checklist in the README.
