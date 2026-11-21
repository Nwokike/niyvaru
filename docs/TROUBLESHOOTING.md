# Troubleshooting

## Map is blank / "GPU initialization" error

- MapLibre v6 requires WebGL2. Check in the browser console:
  `document.createElement('canvas').getContext('webgl2')`.
- If null: use a newer browser/device, or pin `maplibre-gl` to v5 (WebGL1).
- On iOS WebViews, WebGL context loss is a known issue; add context-loss
  handlers and test on a real device.

## Map style does not load

- `initMap()` fetches `https://tiles.openfreemap.org/styles/liberty` and
  rewrites `sources.openmaptiles.url` to a `pmtiles://` URL. Check the network
  tab for that style and for `https://tiles.openfreemap.org/planet`.
- The `pmtiles` protocol is registered once via `maplibregl.addProtocol`.
- If you set a CSP (Tauri or self-hosted headers), allow the basemap host.

## POI pins are missing

- Check `GET /packs/index.json` and `/packs/makkah-haram.json`.
- Regenerate with `npm run data`; the console prints POI counts by kind.
- The main Overpass instance is sometimes at capacity. The pipeline falls back
  through five mirrors; check which one answered. If all fail, the pack still
  builds with zero POIs — re-run later.
- Pins are filtered if a previous agent action called `highlight_kind`; say
  "clear the filters" or use the Ops tab action.

## Walk overlay shows no frames

- `pack.sequences` may be empty if Panoramax was unavailable during the build.
- Frames come from `assets.hd.href`/`sd.href`; Panoramax CORS allows direct
  image loading, but a CSP must allow `panoramax.openstreetmap.fr`.
- A route can play without frames; the UI says "route only".

## Chat fails in Worker mode

- This only applies when `VITE_API_BASE` is set. Copy
  `worker/.dev.vars.example` to `worker/.dev.vars`, restart the API process, and
  in production set the Worker secret with
  `npx wrangler secret put GATEWAY_SECRET --config worker/wrangler.toml`.
- In direct mode (default on GitHub Pages) there is no Worker and no setup.

## Chat returns 502 / gateway errors

- `curl https://api.kiri.ng/health` to confirm the gateway is up.
- Free provider rosters can be rate-limited; the gateway tries fallbacks but
  may exhaust them. Retry later.
- Check `GATEWAY_URL` — it defaults to `https://api.kiri.ng`.

## The model emits raw JSON instead of `<niyvaru>` blocks

Expected. `src/agent.ts` accepts both forms and strips them from the answer.
If an action does nothing, check that the `id` exists in the current pack and
that the action name is one of the five documented in
[AI and memory](AI_AND_MEMORY.md).

## Memory did not learn anything

- Memory extraction runs *after* the reply and is non-blocking; give it a
  second and check the Ops tab.
- `sanitizeProfile()` drops malformed values. Explicit statements such as "I
  use a wheelchair and my budget is $120" work best.
- Clear memory in Ops if the profile is stale.

## `wrangler dev` fails with `spawn .../workerd ENOENT`

On Alpine/musl, workerd's glibc-linked binary cannot start. Use
`npm run api:dev` — it imports the same worker handler in plain Node.
`wrangler deploy --dry-run` still works for bundling checks.

## `npm run data` returns zero POIs but a pack is written

Per-source failures are intentionally non-fatal. Read the first console line
(`overpass ...`), re-run later, and consider adding/rotating mirrors in
`overpassPois()`.

## CI did not refresh the packs

- The workflow triggers on `master` and `main`, on `data/**` pushes, on manual
  dispatch, and daily at 03:17 UTC.
- It needs `contents: write`; check the workflow permissions in GitHub settings.
- Manual: `gh workflow run data-pack`.

## TypeScript/build errors

Run `npx tsc -b` on its own to see them clearly. `npm run build` runs the same
check before Vite. Keep generated `tsconfig.tsbuildinfo` out of git (ignored).
