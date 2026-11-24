# Niyvaru

Feel the place before you book it.

Niyvaru is a city-agnostic browser app. It assembles a live, walkable 3D map of any city from free open data, remembers what matters to the traveller on the device, and lets a private concierge drive the map through typed tools.

## Run it

```bash
npm install
npm run dev
```

The app opens at `http://127.0.0.1:5173`. No API server or account is required.

```bash
npm run check
npm run preview
```

`npm run check` type-checks, builds, and verifies the static deploy artifacts.

## What is inside

- Runtime city assembly from Photon or Nominatim, Overpass with an OSM map fallback, Wikimedia Commons, Wikipedia, Panoramax, MET Norway, GDELT, Mastodon, and Bluesky.
- A MapLibre map regraded by hour, with terrain, building extrusions, bounded zoom, POI layers, and a time control that follows the phone clock.
- A mapped surface shell: Explore, Happening, Story, Agent, Memory, with minimized visible states and expanded context.
- A place dossier with photographs, stories, opening hours, accessibility, walking actions, and map flights.
- A client-side ToolLoopAgent with typed tools, tool deduplication, on-device memory files, and failure-only context compaction.
- An installable PWA shell, English and Arabic, including RTL layout.

## Deploy

Push to `master`. GitHub Pages builds with `VITE_BASE=/niyvaru/` and deploys `dist/`. The build copies the MapLibre worker into `dist/assets` so the static map loads at the project sub-path.

## Limits

Coverage varies by city. Some places have no photos or stories. Overpass mirrors and social feeds can be rate-limited. Open map data has no hotel prices. The concierge says so rather than inventing them.
