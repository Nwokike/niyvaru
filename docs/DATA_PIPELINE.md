# Data pipeline

`data/build-data.mjs` is the only data job. It runs locally (`npm run data`) or
in `.github/workflows/data.yml` (daily at 03:17 UTC, on manual dispatch, and on
pushes that touch `data/`). It writes `public/packs/index.json` and one pack per
area. Everything it uses is free and keyless.

## Sources, endpoints and licences

| Source | Endpoint used | Produces | Terms |
|---|---|---|---|
| OpenStreetMap via Overpass | `https://overpass.openstreetmap.fr/api/interpreter` (plus fallbacks: `overpass-api.de`, `overpass.osm.ch`, `overpass.kumi.systems`, `overpass.private.coffee`) | hotels, pharmacies, shops, restaurants, cafés, mosques, banks, ATMs, hospitals, clinics, toilets, police, opening hours, phone, website, wheelchair | © OSM contributors, **ODbL** — attribute; derivative databases share-alike |
| Panoramax | `https://api.panoramax.xyz/api/search?bbox=...&limit=1000` | ordered street-level frame sequences with GPS, azimuth, timestamps and image URLs | **CC-BY-SA 4.0** — attribute |
| adhan (npm, local computation) | none — computed in Node | 30 days of prayer times, Muslim World League method, Shafi madhab, Asia/Riyadh | open source |
| Open-Meteo | `https://api.open-meteo.com/v1/forecast` | 7-day temperature, precipitation, weather code, wind | free/open-access tier is **non-commercial** |
| NASA EONET | `https://eonet.gsfc.nasa.gov/api/v3/events?bbox=...&status=open` | open natural events near the area | public domain |
| OSRM demo | `https://router.project-osrm.org/route/v1/{foot,walking,driving}` | walking geometry, distance, duration | prototype only; self-host for production |

The pipeline catches per-source failures: a dead source yields an empty array,
and the rest of the pack is still written. Check the console output after
`npm run data` — it prints counts by kind.

## Pack format

`index.json`:

```json
{
  "version": "2026-11-21",
  "generated_at": "...",
  "areas": [
    { "id": "makkah-haram", "name": "Makkah — Haram",
      "center": [21.4225, 39.8262], "radius_m": 2000,
      "file": "makkah-haram.json" }
  ]
}
```

`makkah-haram.json` adds:

- `pois[]` — `{ id, name, name_en, lat, lon, kind, tags }`
- `routes[]` — `{ id, name, profile, wheelchair, distance_m, duration_s, geometry }`
- `sequences[]` — `{ id, title, frames[] }`, each frame `{ url, thumb, lat, lon, heading, datetime }`
- `prayer[]`, `weather[]`, `events[]`

The pack `version` is the UTC date. `packs.ts` compares the cached version with
`index.json`; on mismatch it downloads the new pack and replaces the cache.

## What happens at run time

1. `loadPackIndex()` fetches `/packs/index.json` with `cache: no-cache`.
2. `loadPack(id, index)` reads IndexedDB; if the version matches, use it.
3. Otherwise fetch `/packs/<file>`, store it, return it.
4. `App.tsx` feeds the pack into MapLibre layers and into the agent context.

This is the "download a neighbourhood when the traveller selects a place"
behaviour. There is currently one area; the mechanism is multi-area ready.

## Refreshing locally

```bash
npm run data
git diff --stat public/packs
```

The Action does the same and commits only if `public/packs` changed. It pushes
to `master` (and `main`, if that branch is ever created).

## Adding another city

The script currently has a single `AREA` constant and writes a single area to
the index. To support many cities:

1. Change `AREA` to an array of area objects.
2. Wrap the body of `main()` in a loop and write `<id>.json` per area.
3. Include every area in `index.json` with its bbox/centre/radius.
4. Add a UI selector that calls `loadPack(selectedId, index)`.

No changes are needed in `packs.ts`, `mapView.ts` or the Worker — they are
already keyed by area id.

## Production upgrades

- **OSM:** download the regional extract (Geofabrik publishes a daily Saudi
  PBF), run your own Overpass or import into a local database. Do not depend on
  public mirrors at scale.
- **Routing:** self-host OSRM or Valhalla with the same extract; derive an
  accessibility-aware profile from OSM `wheelchair`/`entrance` tags.
- **Basemap:** generate a PMTiles basemap with Planetiler and serve it from a
  static host; OpenFreeMap remains a good fallback.
- **Weather:** self-host Open-Meteo or use NOAA GFS (public domain) for
  commercial use.
- **Imagery:** Panoramax coverage is thin; self-host Geovisio or add another
  open imagery source with a compatible licence.

## Attribution

The app must display "© OpenStreetMap contributors (ODbL)" and credit Panoramax
imagery (CC-BY-SA 4.0). OpenFreeMap attribution is included by the style.
