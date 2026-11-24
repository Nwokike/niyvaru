import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { NiyvaruAgent } from "./agent/runtime";
import type { MapApi } from "./map/mapView";
import { getOrAssembleArea } from "./area/store";
import type { StageKey, StageState, StageUpdate } from "./sources/assemble";
import { requestPersistence } from "./sources/cache";
import { walkingRoute } from "./sources/walkingRoutes";
import { fetchFramesForRoute, matchFramesToRoute } from "./walk/matcher";
import { startWalk, type WalkHandle } from "./walk/player";
import { addChatMessage } from "./memory/store";
import { KIND_GROUPS } from "./brand/tokens";
import { dict, applyDocumentLocale, type Locale, type Dictionary } from "./config/i18n";
import { Assembling } from "./ui/Assembling";
import { Intake } from "./ui/Intake";
import { PlaceCard } from "./ui/PlaceCard";
import { DiscoverDossier } from "./ui/DiscoverDossier";
import { PulsePanel } from "./ui/PulsePanel";
import { BriefPanel } from "./ui/BriefPanel";
import { MemoryPanel } from "./ui/MemoryPanel";
import { MapShell } from "./ui/MapShell";
import { SURFACES, type Detent, type SurfaceId } from "./config/surfaces";
import { localClock, localHourNow, localTimeZone, subscribeLocalTime } from "./config/time";
import { shellReducer, initialShellState } from "./state/shell";
import type { AreaMeta, AreaPack, Place, WalkRoute } from "./sources/types";

const ChatPanel = lazy(() => import("./ui/ChatPanel").then((m) => ({ default: m.ChatPanel })));

import type { TimePhase } from "./agent/tools";

type View = "form" | "assembling" | "explore";
type StageView = { state: StageState; detail?: string };

const EMPTY_STAGES: Record<StageKey, StageView> = {
  places: { state: "pending" },
  photos: { state: "pending" },
  story: { state: "pending" },
  routes: { state: "pending" },
  pulse: { state: "pending" },
};

// Named stops on the 24h dial (Sete Colinas pattern)
const TOD_STOPS: { key: TimePhase; label: string; hour: number }[] = [
  { key: "dawn", label: "Dawn", hour: 6.5 },
  { key: "day", label: "Midday", hour: 13 },
  { key: "golden", label: "Golden", hour: 18.5 },
  { key: "night", label: "Night", hour: 23 },
];

function todLabel(d: Dictionary, stop: (typeof TOD_STOPS)[number]): string {
  return d.explore.timeOfDay[stop.key];
}

function todClock(hour: number): string {
  const hh = Math.floor(hour % 24);
  const mm = Math.floor((hour % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function nearestStop(hour: number): (typeof TOD_STOPS)[number] {
  return TOD_STOPS.reduce((best, stop) => (Math.abs(stop.hour - hour) < Math.abs(best.hour - hour) ? stop : best), TOD_STOPS[0]);
}



export function App() {
  // Language is automatic: a saved choice wins, otherwise the browser's
  // language decides (first visit anywhere in the world).
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem("niyvaru.locale");
    if (stored === "en" || stored === "ar") return stored;
    if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ar")) return "ar";
    return "en";
  });
  const d = dict(locale);
  const [view, setView] = useState<View>("form");
  const [showIntake, setShowIntake] = useState(false);
  const [meta, setMeta] = useState<AreaMeta | null>(null);
  const [pack, setPack] = useState<AreaPack | null>(null);
  const [stages, setStages] = useState<Record<StageKey, StageView>>(EMPTY_STAGES);
  const [revealing, setRevealing] = useState(false);
  const [hero, setHero] = useState<AreaPack["heroPhoto"]>(undefined);
  const [shell, shellDispatch] = useReducer(shellReducer, initialShellState);
  const [activeKindGroup, setActiveKindGroup] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [walking, setWalking] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  // The hour follows the phone's local clock. The Atmosphere sheet can override it.
  const [tod, setTod] = useState(() => localHourNow());
  const [agent, setAgent] = useState<NiyvaruAgent | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [memoryRev, setMemoryRev] = useState(0);
  const [notice, setNotice] = useState("");
  const [areas, setAreas] = useState<AreaMeta[]>([]);
  const [discoverIndex, setDiscoverIndex] = useState(0);
  const [chatPrefill, setChatPrefill] = useState("");
  const [chatPrefillNonce, setChatPrefillNonce] = useState(0);
  const [peekAsk, setPeekAsk] = useState("");
  const todRef = useRef(tod);
  todRef.current = tod;

  const openSurface = useCallback((surface: SurfaceId, detent?: Detent) => {
    shellDispatch({ type: "openSurface", surface, detent });
  }, []);
  const setDetent = useCallback((detent: Detent) => {
    shellDispatch({ type: "setDetent", detent });
  }, []);

  // Every assembled place is browsable. A dot on the map that the dossier
  // cannot reach is a dead end, so there is no showcase cap here.
  const discoverPlaces = useMemo(() => {
    if (!pack) return [];
    if (activeKindGroup) {
      const allowed = new Set(KIND_GROUPS[activeKindGroup] ?? []);
      return pack.places.filter((p) => allowed.has(p.kind));
    }
    return pack.places;
  }, [pack, activeKindGroup]);

  const selectDiscoverIndex = useCallback(
    (idx: number) => {
      if (!discoverPlaces.length) return;
      const clamped = Math.max(0, Math.min(discoverPlaces.length - 1, idx));
      setDiscoverIndex(clamped);
      const target = discoverPlaces[clamped];
      if (target) {
        setPlace(target);
        mapRef.current?.focusPlace(target, () => setPlace(target));
        openSurface("explore", "half");
      }
    },
    [discoverPlaces, openSurface]
  );

  // A new area has its own place list; a stale index would point past its end
  // and leave the dossier blank even though the map is full of pins.
  useEffect(() => {
    setDiscoverIndex(0);
  }, [meta?.id]);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapApi | null>(null);
  const walkRef = useRef<WalkHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<number | undefined>(undefined);
  const packRef = useRef<AreaPack | null>(null);
  packRef.current = pack;
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;
  const discoverPlacesRef = useRef(discoverPlaces);
  discoverPlacesRef.current = discoverPlaces;

  // persistence + locale side effects
  useEffect(() => {
    void requestPersistence();
    void import("./area/store")
      .then(({ featuredAreas }) => featuredAreas())
      .then(setAreas)
      .catch(() => {});
  }, []);
  useEffect(() => {
    applyDocumentLocale(locale);
    localStorage.setItem("niyvaru.locale", locale);
    mapRef.current?.labelLanguage(locale === "ar" ? "ar" : "en");
  }, [locale]);

  useEffect(() => subscribeLocalTime(() => setTod(localHourNow())), []);

  useEffect(() => () => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
  }, []);

  const viewportInsetRef = useRef(0);
  useEffect(() => {
    const apply = (): void => {
      const surface = document.querySelector<HTMLElement>(".surface");
      const mobile = window.matchMedia("(max-width: 720px)").matches;
      const inset = !mobile || !surface
        ? 0
        : Math.max(0, window.innerHeight - surface.getBoundingClientRect().top);
      viewportInsetRef.current = inset;
      mapRef.current?.setViewportInset(inset);
    };
    const id = window.requestAnimationFrame(apply);
    window.addEventListener("resize", apply);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", apply);
    };
  }, [shell.detent, view]);

  // From the form: select the area — assembly starts on submit
  const selectArea = useCallback((next: AreaMeta) => {
    setMeta(next);
  }, []);

  // ——— area assembly — called when the form is submitted ———
  const startAssembly = useCallback((next: AreaMeta) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setMeta(next);
    setPack(null);
    setHero(undefined);
    setStages(EMPTY_STAGES);
    setRevealing(false);
    setPlace(null);
    shellDispatch({ type: "reset" });
    setView("assembling");
  }, []);

  useEffect(() => {
    if (view !== "assembling" || !meta) return;
    const controller = abortRef.current ?? new AbortController();
    const onStage = (update: StageUpdate): void =>
      setStages((s) => ({
        ...s,
        [update.key]: { state: update.state, detail: update.detail ?? s[update.key]?.detail },
      }));
    getOrAssembleArea(meta, onStage, (fresh) => {
      setPack(fresh);
      setHero(fresh.heroPhoto);
    }, controller.signal).then((assembled) => {
      if (controller.signal.aborted) return;
      setPack(assembled);
      setHero(assembled.heroPhoto);
    }).catch((e) => {
      if (!controller.signal.aborted) setNotice(String((e as Error).message ?? e));
    });
    return () => controller.abort();
  }, [view, meta]);

  // ——— reveal once every stage settles (the grow-and-fade moment) ———
  const revealedRef = useRef(false);
  useEffect(() => {
    if (view !== "assembling" || !meta) return;
    const settled = (Object.keys(EMPTY_STAGES) as StageKey[]).every(
      (k) => stages[k].state === "done" || stages[k].state === "failed"
    );
    if (settled && !revealedRef.current) {
      revealedRef.current = true;
      setRevealing(true);
      window.setTimeout(() => {
        setView("explore");
        if (!localStorage.getItem("niyvaru.intake.done")) setShowIntake(true);
      }, 750);
    }
  }, [stages, view, meta]);

  useEffect(() => {
    return () => {
      revealedRef.current = false;
    };
  }, [meta]);

  // ——— map lifecycle: loads under the loader, destroyed on area change ———
  const mapAllowed = view !== "form";
  useEffect(() => {
    if (!meta || !mapEl.current || !mapAllowed) return;
    let disposed = false;
    const mapController = new AbortController();
    const apiPromise = import("./map/mapView")
      .then(({ initMap }) => initMap(mapEl.current!, meta, mapController.signal, todRef.current))
      .then((api) => {
        if (disposed) {
          api.destroy();
          return null;
        }
        mapRef.current = api;
        api.setViewportInset(viewportInsetRef.current);
        if (packRef.current) api.setPlaces(packRef.current);
        api.onPlaceClick(
          (p) => {
            setPlace(p);
            api.focusPlace(p, () => setPlace(p));
            openSurface("explore", "half");
            const foundIdx = discoverPlacesRef.current.findIndex((x) => x.id === p.id);
            if (foundIdx >= 0) setDiscoverIndex(foundIdx);
          },
          (id) => packRef.current?.places.find((x) => x.id === id)
        );
        api.labelLanguage(localeRef.current === "ar" ? "ar" : "en");
        return api;
      })
      .catch((e) => {
        if (!disposed) setNotice(d.explore.errors.mapFailed.replace("{error}", String((e as Error).message ?? e)));
        return null;
      });
    return () => {
      disposed = true;
      mapController.abort();
      void apiPromise.then((api) => api?.destroy());
      mapRef.current = null;
    };
  }, [meta, mapAllowed]);

  useEffect(() => {
    if (mapRef.current && pack) mapRef.current.setPlaces(pack);
  }, [pack]);

  // ——— agent lifecycle (rebuilt per area + per memory revision) ———
  const agentCtx = useMemo(
    () => ({
      getPack: () => packRef.current,
      locale: () => localeRef.current,
      ui: {
        focusPlace(p: Place) {
          mapRef.current?.focusPlace(p, () => setPlace(p));
        },
        openPlaceCard(p: Place) {
          setPlace(p);
          const idx = discoverPlacesRef.current.findIndex((x) => x.id === p.id);
          if (idx >= 0) setDiscoverIndex(idx);
        },
        filterKinds(kinds: string[] | null) {
          mapRef.current?.filterKinds(kinds);
        },
        showRoute(route: WalkRoute | null) {
          mapRef.current?.showRoute(route);
        },
        startWalk(route: WalkRoute) {
          void beginWalk(route);
        },
        setTimeOfDay(phase: TimePhase) {
          const hour = TOD_STOPS.find((s) => s.key === phase)?.hour ?? 18.5;
          mapRef.current?.setHour(hour);
          setTod(hour);
        },
        openSurface(surface: SurfaceId, detent?: Detent) {
          openSurface(surface, detent);
        },
        setSurfaceDetent(detent: Detent) {
          setDetent(detent);
        },
        clearView() {
          mapRef.current?.filterKinds(null);
          mapRef.current?.showRoute(null);
          mapRef.current?.clearFocus();
          setPlace(null);
          setActiveKindGroup(null);
        },
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (view !== "explore") return;
    let alive = true;
    setAgentError(null);
    import("./agent/runtime")
      .then(({ createNiyvaruAgent }) => createNiyvaruAgent(agentCtx, pack))
      .then((a) => {
        if (alive) setAgent(a);
      })
      .catch((e) => {
        if (alive) setAgentError(String((e as Error).message ?? e));
      });
    return () => {
      alive = false;
    };
  }, [view, pack, memoryRev, agentCtx, locale]);

  const onTurnComplete = useCallback(
    (userText: string, assistantText: string): void => {
      void addChatMessage("user", userText);
      void addChatMessage("assistant", assistantText);
      setMemoryRev((r) => r + 1);
    },
    []
  );

  // ——— walk ———
  const beginWalk = useCallback(async (route: WalkRoute): Promise<void> => {
    const api = mapRef.current;
    if (!api) return;
    setWalking(true);
    walkRef.current?.stop();
    try {
      const frames = matchFramesToRoute(route, await fetchFramesForRoute(route));
      walkRef.current = startWalk({
        map: api,
        route,
        frames,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        labels: {
          eyebrow: d.walk.eyebrow,
          stop: d.walk.stop,
          exit: d.walk.exit,
          pause: d.walk.pause,
          resume: d.walk.resume,
          follow: d.walk.follow,
          following: d.walk.following,
          fromCentre: d.walk.fromCentre,
          album: d.walk.album,
          eta: (n: number) => d.walk.eta.replace("{n}", String(n)),
          distance: (walked: number, total: number) =>
            d.walk.distance.replace("{walked}", String(walked)).replace("{total}", String(total)),
          streetFrame: (n: number) => d.walk.streetFrame.replace("{n}", String(n)),
          of: d.walk.of,
          realFrames: (n: number) => d.walk.realFrames.replace("{n}", String(n)),
          routeOnly: d.walk.routeOnly,
        },
        onEnd: () => setWalking(false),
      });
    } catch {
      setWalking(false);
      setNotice(d.explore.errors.walkUnavailable);
    }
  }, [d]);

  const locateMe = useCallback((): void => {
    if (!navigator.geolocation) {
      setNotice(d.explore.errors.locationUnsupported);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserLocation(point);
        mapRef.current?.setUserLocation(point.lat, point.lon);
      },
      (err) => {
        // The three browser failure modes need different advice; a generic
        // "unavailable" sent users looking for a permission toggle that was fine.
        const code = (err as GeolocationPositionError | null)?.code;
        const key =
          code === 1 ? "locationDenied" : code === 3 ? "locationTimeout" : code === 2 ? "locationUnavailable" : "noLocation";
        const message = d.explore.errors[key];
        setNotice(message);
        if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = window.setTimeout(
          () => setNotice((current) => (current === message ? "" : current)),
          8000
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [d]);

  const walkToPlace = useCallback(
    async (target: Place): Promise<void> => {
      const origin = userLocation ?? (meta ? { lat: meta.lat, lon: meta.lon } : pack ? { lat: pack.center[0], lon: pack.center[1] } : null);
      if (!origin) return;
      setWalking(true);
      try {
        // walkingRoute takes [lat, lon] pairs (it converts to GeoJSON order).
        const route = await walkingRoute(d.walk.routeTo.replace("{name}", target.nameEn ?? target.name), [
          [origin.lat, origin.lon],
          [target.lat, target.lon],
        ]);
        mapRef.current?.showRoute(route, false);
        await beginWalk(route);
      } catch {
        setWalking(false);
        setNotice(d.explore.errors.noRoute);
      }
    },
    [userLocation, meta, pack, beginWalk, d]
  );

  // ——— derived ———
  const setKindGroup = (group: string | null): void => {
    setActiveKindGroup(group);
    mapRef.current?.filterKinds(group ? KIND_GROUPS[group] ?? null : null);
    setDiscoverIndex(0);
    if (pack) {
      const filtered = group
        ? pack.places.filter((p) => (KIND_GROUPS[group] ?? []).includes(p.kind))
        : pack.places;
      if (filtered[0]) {
        setPlace(filtered[0]);
        mapRef.current?.focusPlace(filtered[0], () => setPlace(filtered[0]));
      }
    }
  };
  const applyTod = (hour: number): void => {
    setTod(hour);
    mapRef.current?.setHour(hour);
  };
  const lookupPlace = (id: string): Place | undefined => pack?.places.find((p) => p.id === id);

  return (
    <div
      className="app"
      data-view={view}
      data-walking={walking ? "true" : "false"}
      data-surface={shell.surface}
      data-detent={shell.detent}
    >
      <div ref={mapEl} className="map" aria-label={meta ? d.a11y.mapLabel.replace("{area}", meta.name) : "map"} />

      {view === "explore" && discoverPlaces.length ? (
        <ul className="sr-only" aria-label={d.a11y.placeList}>
          <li>{d.explore.keyboardHelp}</li>
          {discoverPlaces.map((p, idx) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  setDiscoverIndex(idx);
                  setPlace(p);
                  mapRef.current?.focusPlace(p, () => setPlace(p));
                }}
              >
                {p.nameEn ?? p.name} · {p.kind}
                {p.distanceM != null ? ` · ${d.common.kmAway.replace("{d}", String(p.distanceM))}` : ""}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {view === "assembling" && meta ? (
        <Assembling
          d={d}
          areaName={meta.name}
          stages={stages}
          hero={hero}
          revealing={revealing}
          onEnter={() => {
            setView("explore");
            if (!localStorage.getItem("niyvaru.intake.done")) setShowIntake(true);
          }}
        />
      ) : null}

      {view === "explore" ? (
        <MapShell
          d={d}
          shell={shell}
          metaName={meta?.name ?? ""}
          pack={pack}
          todLabel={todLabel(d, nearestStop(tod))}
          clock={todClock(tod)}
          walking={walking}
          walkingDistance={walking ? (userLocation ? d.walk.fromYou : d.walk.fromCentre) : undefined}
          notice={notice}
          counts={{
            explore: discoverPlaces.length,
            pulse: pack?.pulse.length ?? 0,
            brief: pack?.places.filter((p) => p.story).length ?? 0,
          }}
          locale={locale}
          kindGroup={activeKindGroup}
          onKindGroup={setKindGroup}
          onLocale={setLocaleState}
          onOpenSearch={() => setShowIntake(true)}
          onLocate={locateMe}
          onOpenAtmosphere={() => shellDispatch({ type: "toggleAtmosphere" })}
          onOpenSurface={openSurface}
          onSetDetent={setDetent}
          onDismissNotice={() => setNotice("")}
        >
          {shell.detent === "peek" ? (
            <div className="surface-compact rise">
              <span className="eyebrow">{d.shell.peek} · {SURFACES.find((s) => s.id === shell.surface)?.label(d)}</span>
              {shell.surface === "explore" ? (
                <button
                  type="button"
                  className="compact-row"
                  onClick={() => {
                    if (!place && discoverPlaces[0]) selectDiscoverIndex(0);
                    setDetent("half");
                  }}
                >
                  <span>{d.shell.places.replace("{n}", String(discoverPlaces.length))}</span>
                  <strong>{place ? (place.nameEn ?? place.name) : discoverPlaces[0] ? (discoverPlaces[0].nameEn ?? discoverPlaces[0].name) : d.discover.noPlaces}</strong>
                  <span aria-hidden="true">→</span>
                </button>
              ) : shell.surface === "pulse" ? (
                <button type="button" className="compact-row" onClick={() => setDetent("half")}>
                  <span>{d.shell.happening.replace("{n}", String(pack?.pulse.length ?? 0))}</span>
                  <strong>{pack?.pulse[0]?.title ?? d.pulse.empty}</strong>
                  <span aria-hidden="true">→</span>
                </button>
              ) : shell.surface === "brief" ? (
                <button type="button" className="compact-row" onClick={() => setDetent("half")}>
                  <span>{d.tabs.brief}</span>
                  <strong>{pack?.places.find((p) => p.story)?.story?.title ?? d.brief.noStory}</strong>
                  <span aria-hidden="true">→</span>
                </button>
              ) : shell.surface === "agent" ? (
                <form
                  className="compact-ask"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = peekAsk.trim();
                    if (!text) { setDetent("half"); return; }
                    setChatPrefill(text);
                    setChatPrefillNonce((n) => n + 1);
                    setPeekAsk("");
                    setDetent("half");
                  }}
                >
                  <input
                    className="field"
                    value={peekAsk}
                    placeholder={place ? d.discover.askAbout.replace("{name}", place.nameEn ?? place.name) : d.explore.askPlaceholder}
                    aria-label={d.explore.askPlaceholder}
                    onChange={(e) => setPeekAsk(e.target.value)}
                  />
                  <button type="submit" className="btn btn-ghost" aria-label={d.shell.ask}>→</button>
                </form>
              ) : (
                <button type="button" className="compact-row" onClick={() => setDetent("half")}>
                  <span>{d.shell.you}</span>
                  <strong>{d.memory.title}</strong>
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          ) : shell.surface === "explore" ? (
            <>
              {discoverPlaces.length > 0 && place ? (
                <DiscoverDossier
                  d={d}
                  places={discoverPlaces}
                  currentIndex={discoverIndex}
                  onSelectIndex={selectDiscoverIndex}
                  walking={walking}
                  keyboardEnabled={!showIntake && !walking}
                  onWalk={(p) => void walkToPlace(p)}
                  onAsk={(p) => {
                    setChatPrefill(d.discover.askAbout.replace("{name}", p.nameEn ?? p.name));
                    setChatPrefillNonce((n) => n + 1);
                    openSurface("agent", "half");
                  }}
                  onClose={() => {
                    setPlace(null);
                    mapRef.current?.clearFocus();
                  }}
                />
              ) : place ? (
                <PlaceCard
                  d={d}
                  place={place}
                  walking={walking}
                  onWalk={(p) => void walkToPlace(p)}
                  onClose={() => {
                    setPlace(null);
                    mapRef.current?.clearFocus();
                  }}
                />
              ) : discoverPlaces[0] ? (
                <button type="button" className="discover-preview rise" onClick={() => selectDiscoverIndex(0)}>
                  <span className="eyebrow">{d.tabs.brief} · {discoverPlaces.length} {d.welcome.featured.toLowerCase()}</span>
                  <h4 className="discover-preview-title">{discoverPlaces[0].nameEn ?? discoverPlaces[0].name} →</h4>
                </button>
              ) : (
                <p className="muted">{d.discover.noPlaces}</p>
              )}
            </>
          ) : shell.surface === "pulse" && pack ? (
            <PulsePanel d={d} meta={meta ?? ({ id: pack.id, name: pack.name, lat: pack.center[0], lon: pack.center[1], radiusM: pack.radiusM, feeds: pack.feeds } as AreaMeta)} pack={pack} />
          ) : shell.surface === "brief" && pack ? (
            <BriefPanel d={d} pack={pack} />
          ) : shell.surface === "memory" ? (
            <MemoryPanel d={d} />
          ) : null}

          {/* The conversation stays mounted while the agent drives the map:
              acting on a place must never erase the answer it gave. */}
          {agent ? (
            <div className="surface-agent" hidden={shell.surface !== "agent"}>
              <Suspense fallback={<p className="muted">{d.common.loading}</p>}>
                <ChatPanel
                  d={d}
                  agent={agent}
                  greeting={d.explore.greeting}
                  suggestions={[...d.explore.suggestions]}
                  chatLabel={d.a11y.chatLabel}
                  prefill={chatPrefill}
                  prefillNonce={chatPrefillNonce}
                  onTurnComplete={onTurnComplete}
                  active={shell.surface === "agent"}
                />
              </Suspense>
            </div>
          ) : shell.surface === "agent" ? (
            <p className="muted">{agentError ?? d.common.loading}</p>
          ) : null}
        </MapShell>
      ) : null}

      {view === "explore" && shell.atmosphereOpen ? (
        <div className="atmosphere-sheet" role="dialog" aria-modal="false" aria-label={d.shell.atmosphere}>
          <div className="atmosphere-head">
            <strong>{d.shell.atmosphere}</strong>
            <button type="button" className="btn btn-ghost" onClick={() => shellDispatch({ type: "toggleAtmosphere", open: false })}>
              {d.common.close}
            </button>
          </div>
          <p className="muted">{d.explore.timeOfDayLocal} · {localTimeZone()}</p>
          <input
            className="tod-slider"
            type="range"
            min={0}
            max={24}
            step={0.1}
            value={tod}
            onChange={(e) => applyTod(Number(e.target.value))}
            aria-label={d.explore.timeOfDayLabel}
            aria-valuetext={d.a11y.timeOfDay.replace("{clock}", todClock(tod)).replace("{phase}", todLabel(d, nearestStop(tod)))}
          />
          <div className="tod-stops">
            {TOD_STOPS.map((stop) => (
              <button key={stop.key} data-active={nearestStop(tod).key === stop.key && Math.abs(tod - stop.hour) < 0.15} onClick={() => applyTod(stop.hour)}>
                {todLabel(d, stop)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {view === "form" || (showIntake && view === "explore") ? (
        <Intake
          d={d}
          area={meta}
          areas={areas}
          locale={locale}
          homepage={view === "form"}
          onPickArea={selectArea}
          onClose={(chosen) => {
            setShowIntake(false);
            localStorage.setItem("niyvaru.intake.done", "1");
            setMemoryRev((r) => r + 1);
            if (chosen) {
              if (view === "form" || chosen.id !== meta?.id) {
                startAssembly(chosen);
              }
            }
          }}
        />
      ) : null}
    </div>
  );
}

export type { StageKey, StageState, StageUpdate };
