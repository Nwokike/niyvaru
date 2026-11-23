# Contributing to Niyvaru

Everyone should be able to clone this repo, run it, change one thing, and know where that thing lives. If that is not true, fix the docs in the same PR.

## Setup

```bash
git clone https://github.com/Nwokike/niyvaru.git
cd niyvaru
npm install
cp .env.example .env      # optional local settings
npm run dev               # http://127.0.0.1:5173
```

CI uses Node 24. No Python, Docker, database, paid API or data build step is needed: an area is assembled in the browser when the traveller submits the form. `npm run api:dev` and `npm run worker:dev` are only for the optional Worker mode (see [Deployment](docs/DEPLOYMENT.md)).

## Ground rules

1. **Stay free.** Do not add a dependency, API or host that needs a card or a paid tier. If something is unavoidable, document the cost and ask first.
2. **No secrets in git.** `.env`, `worker/.dev.vars` and `*.tsbuildinfo` are ignored. Never put a credential in a `VITE_*` variable — Vite inlines those into the browser bundle.
3. **City-agnostic code.** A city belongs in data (`public/areas.json`) or in a geocoder result, never as a literal in `src/`. Feed hashtags and queries are fields on `AreaMeta`.
4. **Grounded AI.** The system prompt in `src/agent/prompt.ts` forbids invented places, prices, hours, accessibility and events. Keep the gateway retry failure-only: no upfront message pruning.
5. **Client-owned memory.** Memory files and the chat window live in IndexedDB on the device. The optional Worker proxies inference and weather only; it stores nothing.
6. **Static-first.** The map, assembly and agent must keep working with the Worker down. All external URLs belong in `src/config/endpoints.ts`.

## Where to change what

| You want to change... | Edit |
|---|---|
| Views, tabs, assembly lifecycle, walk orchestration | `src/App.tsx`, `src/styles.css` |
| Homepage form, what is written to memory on submit | `src/ui/Intake.tsx`, `src/config/i18n/{en,ar}.ts` |
| Featured areas, feed queries, prayer method | `public/areas.json` |
| Geocoding, cache-freshness, area selection | `src/area/store.ts` |
| Assembly stages, stage counts, attribution | `src/sources/assemble.ts` |
| One data source or its endpoint | `src/sources/<adapter>.ts`, `src/config/endpoints.ts` |
| Photo/story title matching, safe website links | `src/sources/photoMatch.ts`, `src/sources/text.ts` |
| Map style, palette, terrain, extrusion, camera bounds | `src/map/style.ts`, `src/map/palette.ts`, `src/map/mapView.ts` |
| POI/route layers and focus marker | `src/map/pois.ts` |
| Agent loop, tool repair, stop conditions | `src/agent/runtime.ts` |
| Gateway URL rewrite and retry | `src/agent/gateway.ts` |
| Tools (the 16 typed actions) | `src/agent/tools.ts`, `src/memory/memoryTool.ts` |
| Prompt, grounded facts block | `src/agent/prompt.ts`, `src/agent/facts.ts` |
| Memory files, archive, budgets, export/import | `src/memory/`, `src/config/memory-policy.ts` |
| Walk matching and playback | `src/walk/matcher.ts`, `src/walk/player.ts` |
| Optional Worker routes | `worker/src/index.ts`, `worker/wrangler.toml` |
| Build base path, lazy chunks, MapLibre worker copy | `vite.config.ts` |
| Pages deploy | `.github/workflows/pages.yml` |

## Before opening a PR

```bash
npx tsc -b          # types must pass
npm run build       # production build must pass, including the MapLibre worker copy
git status --short  # no secrets, no generated junk
```

Confirm `dist/assets/maplibre-gl-worker.mjs` exists after a build, and check `dist/index.html` uses the expected base path when building with `VITE_BASE=/niyvaru/`.

PR checklist:

- [ ] Describes **why**, not only what.
- [ ] Keeps every dependency and API free and open.
- [ ] Adds no city-specific literal or editorial content to source code.
- [ ] Keeps the agent grounded and the gateway retry failure-only.
- [ ] Updates the relevant doc in `docs/` or this file.
- [ ] Commits no credentials and no build output.
- [ ] Adds new source fields to `src/sources/types.ts` and documents them in [Data pipeline](docs/DATA_PIPELINE.md).
- [ ] Preserves attribution strings in `src/sources/assemble.ts` and the UI.

## Branching and commits

The default branch is `master`. Work on a short branch (for example `feat/area-search`), keep commits focused, and use prefixes such as `feat:`, `fix:`, `docs:`, `chore:`.

## Reporting a problem

Open an issue with: what you expected, what happened, the exact command or UI step, browser/device, the area involved and the relevant console output. Set `localStorage.niyvaruDebug = "1"` to enable verbose `[niyvaru:*]` logs; failures log even without it. For agent answers, include the prompt and the tool names shown in the chat chips.

## Attribution reminder

OSM data is ODbL, Commons/Wikipedia content carries per-item licences, and Panoramax/Mapillary imagery is CC-BY-SA 4.0. `src/sources/assemble.ts` builds the pack's attribution map; the Discover Dossier, Story tab and map credit must keep displaying it.
