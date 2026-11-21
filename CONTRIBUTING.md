# Contributing to Niyvaru

Everyone should be able to clone this repo, run it, change one thing, and know
where that thing lives. If that is not true, fix the docs in the same PR.

## Setup

```bash
git clone https://github.com/Nwokike/niyvaru.git
cd niyvaru
npm install
cp worker/.dev.vars.example worker/.dev.vars   # add a gateway key for chat
npm run data
npm run api:dev        # terminal 1
npm run dev            # terminal 2 -> http://127.0.0.1:5173
```

Node 24 and npm 11 are what CI uses. No Python, Docker, database or paid API is
needed. `wrangler dev` is optional; use `npm run api:dev` if it fails on your
platform (see [Troubleshooting](docs/TROUBLESHOOTING.md)).

## Ground rules

1. **Stay free.** Do not add a dependency, API or host that needs a card or a
   paid tier. If something is unavoidable, document the cost and ask first.
2. **No secrets in git.** `worker/.dev.vars`, `.env` and `*.tsbuildinfo` are
   ignored. Use the example files. Never prefix a secret with `VITE_`.
3. **Grounded AI.** Never change the system prompt so the model can invent
   places, prices, hours or accessibility facts. If a fact is missing, the
   model must say so.
4. **Client-owned memory.** Profile and transcript stay in the browser. Do not
   send them to a server other than the stateless Worker doing inference.
5. **Static-first.** Map, packs and walks must keep working if the Worker is
   down. Do not move static data behind an API without a good reason.

## Where to change what

| You want to change... | Edit |
|---|---|
| UI layout, tabs, feed, ops | `src/App.tsx`, `src/styles.css` |
| Map layers, camera, actions | `src/mapView.ts` |
| Chat parser, actions, memory study | `src/agent.ts` |
| Memory storage/keys | `src/memory.ts`, `shared/profile.ts` |
| System prompt, grounded facts | `shared/prompt.ts`, `shared/facts.ts` |
| Worker routes, gateway call | `worker/src/index.ts` |
| Data sources / pack schema | `data/build-data.mjs`, `src/types.ts` |
| Daily refresh schedule | `.github/workflows/data.yml` |
| Deployment | `docs/DEPLOYMENT.md`, `worker/wrangler.toml`, `vite.config.ts` |

Keep files in `shared/` free of browser-only globals (`localStorage`,
`indexedDB`) — the Worker imports them too.

## Before opening a PR

```bash
npx tsc -b          # types must pass
npm run build       # production build must pass
npm run data        # only if you changed data/ or want fresh packs
git status --short  # no secrets, no generated junk
```

PR checklist:

- [ ] Describes **why**, not only what.
- [ ] Keeps the free-tier constraint.
- [ ] Updates the relevant doc in `docs/` or this file.
- [ ] Does not commit `worker/.dev.vars` or any key.
- [ ] New data fields are added to `src/types.ts` and documented in
      [Data pipeline](docs/DATA_PIPELINE.md).

## Branching and commits

The default branch is `master`. Work on a short branch (for example
`feat/area-selector`), keep commits focused, and use prefixes such as `feat:`,
`fix:`, `docs:`, `data:`, `chore:`.

## Reporting a problem

Open an issue with: what you expected, what happened, the exact command or UI
step, browser/device, and the relevant console or terminal output. For AI
answers, include the prompt and the action JSON emitted (no secrets).

## Data attribution reminder

OSM data is ODbL, Panoramax imagery is CC-BY-SA 4.0. Both need credit in the
app. Do not remove attribution strings when changing the map or walk code.
