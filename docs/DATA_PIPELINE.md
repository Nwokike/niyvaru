# Data pipeline

There is no build-time data job. `src/sources/assemble.ts` is the system of record: it builds an `AreaPack` in the browser when a traveller submits the area form, then `src/sources/cache.ts` stores that pack in IndexedDB. Featured areas are editorial data in `public/areas.json`; every other city comes from geocoding. No city name, feed query or editorial content is hardcoded in the source.

## Area meta

```json
{
  "id": "area-id",
  "name": "Display name",
  "country": "Country",
  "lat": 0,
  "lon": 0,
  "radiusM": 2000,
  "zoom": 15.2,
  "language": "en",
  "prayerMethod": "umm_al_qura",
  "feeds": { "hashtags": ["..."], "gdeltQuery": "..." }
}
```

`featuredAreas()` fetches `areas.json` from `BASE_URL` with `cache: "no-cache"`. `searchAreas()` calls `searchCities()` (Photon, then Nominatim) and converts each result with `areaFromGeocode()`: 2 km radius, zoom 15.2, language `en`, id derived from name and coordinates. `bboxOf()` turns the radius into a bounding box for every bbox-based source.

## The five assembly stages

All stages launch in parallel; the routes stage starts when the places stage resolves because it needs destinations. `runStage()` emits `pending → active → done | failed`, and a failure returns an empty fallback so the rest of the area still renders. `onStage()` detail lines are the live counts shown by `src/ui/Assembling.tsx`.

| Stage | Sources | Result on the pack |
|---|---|---|
| `places` | Overpass shards → OSM map API fallback | `places[]` with normalized `kind`, tags, photos `[]` |
| `photos` | Wikimedia Commons geosearch (anchored and titled), Panoramax meta-catalog | `heroPhoto`, photos matched to places by distance and title, at most six per place |
| `story` | Wikipedia geosearch in `meta.language` | `story` attached to a place by fuzzy title match |
| `routes` | FOSSGIS OSRM foot, public OSRM demo fallback | up to three `routes[]` (landmark, practical, green) |
| `pulse` | MET Norway → Open-Meteo, adhan + Open-Meteo timezone, GDELT, Mastodon, `promotions.json` | `prayer[]`, `weather[]`, `pulse[]` |

Photo and story attachment happens after the parallel fetches. `src/sources/commons.ts` is the single coordinate-aware Commons adapter: `anchoredPhotosNear()` keeps each file's coordinates, title and `ObjectName`, decodes HTML entities in credits, and uses `cachedWithRefresh()` so a stale cache answers immediately and refreshes in the background. `src/sources/photoMatch.ts` normalizes `File:` prefixes, extensions and separators once and is shared by photograph and Wikipedia-story matching. A Commons photo is assigned to a place within 300 m, with a title match as tie-breaker and as fallback for files without usable coordinates; assignments are scored so the strongest claim the limited slots (six photos per place) and no photo is used twice. Unattached photos become hero candidates, so the hero is never empty when photographs exist. Places are finally sorted by haversine distance from the area centre. The pack's `version` is an ISO timestamp, and its `attribution` map records every licence actually used.

## Sources, endpoints and licences

All URLs live in `src/config/endpoints.ts`.

| Source | Endpoint | Used for | Terms |
|---|---|---|---|
| Overpass | `overpass-api.de`, `overpass.openstreetmap.fr`, `overpass.kumi.systems`, `overpass.private.coffee` | named, tagged POIs: hotels, food, cafés, bars, shops, worship, health, money, toilets, green, heritage, civic | © OSM contributors, ODbL |
| OSM map API (fallback) | `https://api.openstreetmap.org/api/0.6/map` | same ODbL data as XML when Overpass is unavailable or blocked | ODbL |
| Photon / Nominatim | `photon.komoot.io/api`, `nominatim.openstreetmap.org/search` | search-as-you-type and fallback search | free, keyless; Nominatim 1 req/s policy |
| Wikimedia Commons | `commons.wikimedia.org/w/api.php` | geosearched photographs with coordinates, file title, artist and licence | per-photo licence, credited in the UI |
| Wikipedia | `{lang}.wikipedia.org/w/api.php` | intro extracts, linked to the source page | CC BY-SA, credited in the UI |
| Panoramax | `api.panoramax.xyz` meta-catalog | street-level frames and place photos | CC-BY-SA 4.0 |
| Mapillary | `graph.mapillary.com` with `VITE_MAPILLARY_TOKEN` | extra walk frames, optional | free developer token, CC-BY-SA |
| OSRM | `routing.openstreetmap.de/routed-foot`, `router.project-osrm.org/route/v1/foot` | real pedestrian routes, distance and duration | keyless; self-host for production |
| adhan (local) | no endpoint | prayer times for 7 days from coordinates and method | open source |
| Open-Meteo | `api.open-meteo.com/v1/forecast` | timezone (`timezone=auto`) and weather fallback | open-access tier, non-commercial |
| MET Norway | `api.met.no/weatherapi/locationforecast/2.0/compact` | preferred weather, also via optional Worker proxy | free including commercial use, CC BY 4.0 |
| GDELT DOC 2.0 | `api.gdeltproject.org/api/v2/doc/doc` | open news articles from the last two days | free and open; CORS varies |
| Bluesky Jetstream | `wss://jetstream1.us-east.bsky.network/subscribe` | live posts filtered by area hashtags | public relay, no auth |
| Mastodon | `mastodon.social`, `mstdn.social` public hashtag timelines | recent posts | public, unauthenticated reads |
| Placements | `BASE_URL + promotions.json` | clearly labelled promoted pulse items | data file, not code |

`src/sources/openingHours.ts` evaluates OSM `opening_hours` strings locally with a small dependency-free parser; unparseable values return `unknown` rather than a guess.

## Overpass shards and fallback

`fetchPlacesSharded()` runs three selector shards — `core`, `food` and the heavy `shops` shard — across two mirrors in parallel (never two simultaneous hits on one mirror), each with a 25 s timeout and `Promise.allSettled`. Progress callbacks report per-shard counts. Results are merged and de-duplicated by OSM id; unnamed objects are dropped. If no places arrive, `fetchPlacesFromOsmMap()` fetches the bbox from the core OSM map API, parses the XML with `DOMParser`, centroids ways from their nodes and caps the result at 1,200 places. `normalizeKind()` and `toTags()` are shared by both adapters so the pack shape is identical.

## Walking routes

`walkingRoute()` requests full GeoJSON foot routes from FOSSGIS, falling back to the public OSRM demo. It refuses implausible results over 25 km, caches for 24 hours and never accepts a driving profile. The assembler ranks places by distance and picks a heritage/worship landmark, a pharmacy or shop, and a green space, then resolves each pick in `Promise.allSettled`. The agent's `route_to` and `start_walk` tools can compute additional live routes the same way.

## Pack shape

`AreaPack` in `src/sources/types.ts`:

- identity: `id`, `name`, `country?`, `version`, `center: [lat, lon]`, `radiusM`, `zoom`, `language`, `feeds?`, `prayerMethod?`
- `places[]`: `{ id, name, nameEn?, lat, lon, kind, distanceM?, tags, photos[], story? }`
- `routes[]`: `{ id, name, distanceM, durationS, coordinates: [lon, lat][] }`
- `prayer[]`: date plus fajr, sunrise, dhuhr, asr, maghrib, isha
- `weather[]`: date, high/low, precipitation, wind, WMO code, provider label
- `pulse[]`: `{ id, source, kind: organic | promoted, title, text?, url?, at?, sponsor? }`
- `heroPhoto?`, and `attribution`: source → licence map

## Cache and refresh

| Entry | Store / TTL |
|---|---|
| Area packs | `packs`, no TTL; `getOrAssembleArea()` treats a pack as fresh for 12 hours |
| Geocode results | `kv`, 24 h |
| Overpass shards | `kv`, 6 h |
| OSM map fallback | `kv`, 6 h |
| Commons photos | `kv`, 7 days |
| Wikipedia stories | `kv`, 7 days |
| Panoramax frames | `kv`, 24 h |
| Mapillary frames | `kv`, 24 h |
| Weather | `kv`, 3 h |
| GDELT news | `kv`, 15 min |
| Mastodon posts | `kv`, 10 min |
| Routes | `kv`, 24 h |
| Timezone | `kv`, 30 days |

`cached()` returns a valid entry or produces and stores a new one; `cachedWithRefresh()` returns a stale hit immediately and refreshes in the background (used by Commons geosearch and geocode priming; area packs have their own 12-hour stale-while-revalidate path). `requestPersistence()` requests persistent storage at app start. The purge command for all of it is `clearEverything()`, exposed to the traveller as **Clear** in the Memory panel; each delete in memory is archived first.

## Adding an area

Add one object to `public/areas.json`. The homepage lists it, the form can select it, and the same assembler, map and agent handle it. Nothing in `packs`, `mapView` or the Worker is keyed to a particular city. Travellers do not need an entry at all: they can type any place into the search field.

## Attributable data

Keep the attribution map built in `assemble.ts` and the credits rendered in the Discover Dossier, Story tab and map control. OSM is ODbL; Commons/Wikipedia items carry their own licences; Panoramax and Mapillary are CC-BY-SA 4.0; MET Norway is CC BY 4.0; Open-Meteo items are marked non-commercial. Removing those strings breaks the source terms.
