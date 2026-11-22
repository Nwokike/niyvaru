/**
 * The agent's tools — everything the concierge can *do*. All client-side,
 * all operating on the assembled area pack / live map / memory. Schemas are
 * typed so weak models get validation and repair instead of silent breakage.
 */
import { tool } from "ai";
import { z } from "zod";
import { create, insertMultiple, search } from "@orama/orama";
import { walkingRoute } from "../sources/walkingRoutes";
import { openingHoursAt } from "../sources/openingHours";
import { KINDS } from "../sources/overpass";
import { memoryTool } from "../memory/memoryTool";
import type { AreaPack, Place, WalkRoute } from "../sources/types";
import type { MapApi } from "../map/mapView";

export type TimePhase = "dawn" | "day" | "golden" | "night";

export interface AgentUi {
  focusPlace(place: Place): void;
  openPlaceCard(place: Place): void;
  filterKinds(kinds: string[] | null): void;
  showRoute(route: WalkRoute | null, fit?: boolean): void;
  startWalk(route: WalkRoute): void;
  setTimeOfDay(phase: TimePhase): void;
  clearView(): void;
}

export interface AgentContext {
  getPack(): AreaPack | null;
  ui: AgentUi;
  locale: () => "en" | "ar";
}

const PHASE_T: Record<TimePhase, number> = { dawn: 0, day: 1 / 3, golden: 2 / 3, night: 1 };

function compactPlace(p: Place): Record<string, unknown> {
  return {
    id: p.id,
    name: p.nameEn ?? p.name,
    kind: p.kind,
    distanceM: p.distanceM,
    open: p.tags.openingHours ? openingHoursAt(p.tags.openingHours).state : "unknown",
    wheelchair: p.tags.wheelchair || undefined,
    phone: p.tags.phone || undefined,
    website: p.tags.website || undefined,
    photos: p.photos.length,
    story: p.story ? p.story.title : undefined,
  };
}

async function placeIndex(pack: AreaPack) {
  const db = create({ schema: { name: "string", kind: "enum", extras: "string", ref: "string" } });
  await insertMultiple(
    db,
    pack.places.map((p) => ({
      name: `${p.nameEn ?? p.name} ${p.name}`,
      kind: p.kind,
      extras: Object.values(p.tags).filter(Boolean).join(" "),
      ref: p.id,
    }))
  );
  return db;
}

function resolvePlace(pack: AreaPack, placeId: string): Place | undefined {
  return pack.places.find((p) => p.id === placeId);
}

export function createAgentTools(ctx: AgentContext) {
  const packNow = (): AreaPack => {
    const pack = ctx.getPack();
    if (!pack) throw new Error("the area is still assembling — try again in a moment");
    return pack;
  };

  return {
    search_places: tool({
      description:
        "Search the places of the current area by free text and kind. Returns real ids — use them with other tools.",
      inputSchema: z.object({
        query: z.string().describe("What to find, e.g. 'pharmacy', 'Swissôtel', 'coffee'"),
        kind: z.enum(KINDS).optional(),
        limit: z.coerce.number().int().min(1).max(20).catch(8),
      }),
      execute: async ({ query, kind, limit }) => {
        const pack = packNow();
        const db = await placeIndex(pack);
        const result = await search(db, {
          term: query,
          limit,
          where: kind ? { kind: { eq: kind } } : undefined,
        });
        const ranked = result.hits
          .map((h) => pack.places.find((p) => p.id === (h.document as { ref: string }).ref))
          .filter((p): p is Place => Boolean(p));
        return { count: ranked.length, places: ranked.map(compactPlace) };
      },
    }),

    nearby: tool({
      description:
        "Places near an anchor (a place id, or the area centre) filtered by kind, distance and open-now.",
      inputSchema: z.object({
        anchorPlaceId: z.string().optional(),
        kinds: z.array(z.enum(KINDS)).optional(),
        withinM: z.coerce.number().int().min(50).max(5000).catch(800),
        openNow: z.coerce.boolean().catch(false),
        limit: z.coerce.number().int().min(1).max(20).catch(8),
      }),
      execute: async ({ anchorPlaceId, kinds, withinM, openNow, limit }) => {
        const pack = packNow();
        const anchor = anchorPlaceId ? resolvePlace(pack, anchorPlaceId) : undefined;
        const lat = anchor?.lat ?? pack.center[0];
        const lon = anchor?.lon ?? pack.center[1];
        let candidates = pack.places
          .filter((p) => (kinds?.length ? (kinds as string[]).includes(p.kind) : true))
          .filter((p) => !anchor || p.id !== anchor.id);
        if (openNow) {
          candidates = candidates.filter(
            (p) => p.tags.openingHours && openingHoursAt(p.tags.openingHours).state === "open"
          );
        }
        const ranked = candidates
          .map((p) => ({ place: p, distanceM: Math.round(haversine(lat, lon, p.lat, p.lon)) }))
          .filter((x) => x.distanceM <= withinM)
          .sort((a, b) => a.distanceM - b.distanceM)
          .slice(0, limit);
        return {
          anchor: anchor ? anchor.name : "area centre",
          count: ranked.length,
          places: ranked.map((x) => ({ ...compactPlace(x.place), distanceM: x.distanceM })),
        };
      },
    }),

    place_details: tool({
      description: "Everything known about one place: hours, accessibility, contact, photos, story.",
      inputSchema: z.object({ placeId: z.string() }),
      execute: async ({ placeId }) => {
        const pack = packNow();
        const place = resolvePlace(pack, placeId);
        if (!place) return { error: `unknown place id ${placeId}` };
        return {
          ...compactPlace(place),
          addr: [place.tags.addrNumber, place.tags.addrStreet].filter(Boolean).join(" ") || undefined,
          story: place.story?.extract?.slice(0, 500),
          photos: place.photos.map((p) => ({ thumb: p.thumbUrl, attribution: p.attribution, license: p.license, source: p.source })),
        };
      },
    }),

    photos_for_place: tool({
      description: "Real photographs of a place with their attribution and licence.",
      inputSchema: z.object({ placeId: z.string() }),
      execute: async ({ placeId }) => {
        const pack = packNow();
        const place = resolvePlace(pack, placeId);
        if (!place) return { error: `unknown place id ${placeId}` };
        return {
          count: place.photos.length,
          photos: place.photos.map((p) => ({ thumb: p.thumbUrl, attribution: p.attribution, license: p.license ?? "unknown" })),
        };
      },
    }),

    focus_place: tool({
      description: "Move the traveller's view to a place and pin it.",
      inputSchema: z.object({ placeId: z.string() }),
      execute: async ({ placeId }) => {
        const pack = packNow();
        const place = resolvePlace(pack, placeId);
        if (!place) return { error: `unknown place id ${placeId}` };
        ctx.ui.openPlaceCard(place);
        ctx.ui.focusPlace(place);
        return { focused: place.nameEn ?? place.name };
      },
    }),

    highlight_kinds: tool({
      description: "Highlight only certain kinds of places (e.g. pharmacies). Null/empty clears.",
      inputSchema: z.object({ kinds: z.array(z.enum(KINDS)).max(6).nullable() }),
      execute: async ({ kinds }) => {
        ctx.ui.filterKinds(kinds && kinds.length ? kinds : null);
        return { highlighted: kinds ?? "all" };
      },
    }),

    clear_view: tool({
      description: "Clear highlights, routes and the focus pin.",
      inputSchema: z.object({}),
      execute: async () => {
        ctx.ui.clearView();
        return { cleared: true };
      },
    }),

    route_to: tool({
      description:
        "Fetch a real walking route (pedestrian routing, live) from the area centre or a place to a destination, and draw it.",
      inputSchema: z.object({
        fromPlaceId: z.string().optional(),
        toPlaceId: z.string(),
        label: z.string().optional(),
      }),
      execute: async ({ fromPlaceId, toPlaceId, label }) => {
        const pack = packNow();
        const from = fromPlaceId ? resolvePlace(pack, fromPlaceId) : undefined;
        const to = resolvePlace(pack, toPlaceId);
        if (!to) return { error: `unknown place id ${toPlaceId}` };
        const route = await walkingRoute(label ?? `Walk to ${to.nameEn ?? to.name}`, [
          [from?.lat ?? pack.center[0], from?.lon ?? pack.center[1]],
          [to.lat, to.lon],
        ]);
        ctx.ui.showRoute(route);
        return { routeId: route.id, name: route.name, distanceM: route.distanceM, minutes: Math.round(route.durationS / 60) };
      },
    }),

    show_route: tool({
      description: "Show one of the pre-assembled walking routes by id.",
      inputSchema: z.object({ routeId: z.string() }),
      execute: async ({ routeId }) => {
        const pack = packNow();
        const route = pack.routes.find((r) => r.id === routeId);
        if (!route) return { error: `unknown route id ${routeId}`, available: pack.routes.map((r) => r.id) };
        ctx.ui.showRoute(route);
        return { shown: route.name, distanceM: route.distanceM, minutes: Math.round(route.durationS / 60) };
      },
    }),

    start_walk: tool({
      description:
        "Start the immersive walk along a route (real street photographs where coverage exists, camera flythrough otherwise). Optionally computes the route to a place first.",
      inputSchema: z.object({ routeId: z.string().optional(), toPlaceId: z.string().optional() }),
      execute: async ({ routeId, toPlaceId }) => {
        const pack = packNow();
        let route = routeId ? pack.routes.find((r) => r.id === routeId) : undefined;
        if (!route && toPlaceId) {
          const to = resolvePlace(pack, toPlaceId);
          if (!to) return { error: `unknown place id ${toPlaceId}` };
          route = await walkingRoute(`Walk to ${to.nameEn ?? to.name}`, [
            [pack.center[0], pack.center[1]],
            [to.lat, to.lon],
          ]);
        }
        if (!route) route = pack.routes[0];
        if (!route) return { error: "no route available in this area yet" };
        ctx.ui.showRoute(route, false);
        ctx.ui.startWalk(route);
        return { started: route.name, distanceM: route.distanceM, minutes: Math.round(route.durationS / 60) };
      },
    }),

    set_time_of_day: tool({
      description: "Relight the whole map: dawn, day, golden hour or night.",
      inputSchema: z.object({ phase: z.enum(["dawn", "day", "golden", "night"]) }),
      execute: async ({ phase }) => {
        ctx.ui.setTimeOfDay(phase);
        return { timeOfDay: phase };
      },
    }),

    get_now: tool({
      description: "What's true right now: today's prayer times, today's weather, latest pulse items.",
      inputSchema: z.object({}),
      execute: async () => {
        const pack = packNow();
        return {
          prayer: pack.prayer[0] ?? null,
          weather: pack.weather[0] ?? null,
          pulse: pack.pulse.slice(0, 8).map((i) => ({ source: i.source, title: i.title, url: i.url, at: i.at })),
        };
      },
    }),

    get_place_story: tool({
      description: "The encyclopedic story attached to a place (Wikipedia, in the area's language).",
      inputSchema: z.object({ placeId: z.string() }),
      execute: async ({ placeId }) => {
        const pack = packNow();
        const place = resolvePlace(pack, placeId);
        if (!place) return { error: `unknown place id ${placeId}` };
        return place.story ?? { note: "no story attached to this place" };
      },
    }),

    draft_area_brief: tool({
      description: "Raw ingredients for writing the area's story: hero photo, attached stories, kind counts.",
      inputSchema: z.object({}),
      execute: async () => {
        const pack = packNow();
        const counts = new Map<string, number>();
        for (const p of pack.places) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
        return {
          area: pack.name,
          country: pack.country,
          heroPhoto: pack.heroPhoto ? { thumb: pack.heroPhoto.thumbUrl, attribution: pack.heroPhoto.attribution } : null,
          stories: pack.places.filter((p) => p.story).slice(0, 8).map((p) => ({ place: p.nameEn ?? p.name, title: p.story!.title, extract: p.story!.extract.slice(0, 400) })),
          placeCounts: Object.fromEntries(counts),
        };
      },
    }),

    select_candidates: tool({
      description:
        "Score candidate stays/hotels in the area against the traveller's needs (mobility, budget, preferences). Returns ranked candidates with explicit reasons; pricing comes from the private inventory feed when connected.",
      inputSchema: z.object({
        mobility: z.enum(["none", "limited", "wheelchair"]).optional(),
        budgetPerNightUsd: z.coerce.number().optional(),
        preferences: z.array(z.string()).max(8).optional(),
        limit: z.coerce.number().int().min(1).max(5).catch(3),
      }),
      execute: async ({ mobility, budgetPerNightUsd, preferences, limit }) => {
        const pack = packNow();
        const hotels = pack.places.filter((p) => p.kind === "hotel");
        const reasonsFor = (p: Place): string[] => {
          const reasons: string[] = [];
          if (mobility === "wheelchair") {
            if (p.tags.wheelchair === "yes") reasons.push("wheelchair-tagged entrance");
            else reasons.push("no wheelchair data in open records — verify before booking");
          }
          if (p.distanceM != null) reasons.push(`${p.distanceM} m from the centre`);
          if (p.photos.length) reasons.push(`${p.photos.length} real photograph${p.photos.length > 1 ? "s" : ""}`);
          if (p.story) reasons.push("has a recorded story");
          if (preferences?.some((pref) => (p.nameEn ?? p.name).toLowerCase().includes(pref.toLowerCase()))) {
            reasons.push("name matches a stated preference");
          }
          if (budgetPerNightUsd) reasons.push("price unknown in open data — confirm against wholesale inventory");
          return reasons;
        };
        const scored = hotels
          .map((p) => ({
            place: compactPlace(p),
            score:
              (mobility === "wheelchair" && p.tags.wheelchair === "yes" ? 3 : 0) +
              (p.photos.length ? 1 : 0) +
              (p.story ? 1 : 0) +
              (p.distanceM != null ? Math.max(0, 2 - p.distanceM / 1000) : 0),
            reasons: reasonsFor(p),
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        return { candidates: scored, note: "pricing is not in open data; the wholesale feed supplies it" };
      },
    }),

    memory: memoryTool,
  };
}

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
