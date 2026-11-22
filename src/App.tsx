import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { dict, applyDocumentLocale, type Locale } from "./config/i18n";
import { Assembling } from "./ui/Assembling";
import { Intake } from "./ui/Intake";
import { PlaceCard } from "./ui/PlaceCard";
import { PulsePanel } from "./ui/PulsePanel";
import { BriefPanel } from "./ui/BriefPanel";
import { MemoryPanel } from "./ui/MemoryPanel";
import { ChatPanel } from "./ui/ChatPanel";
import type { AreaMeta, AreaPack, Place, WalkRoute } from "./sources/types";
import type { TimePhase } from "./agent/tools";

type View = "form" | "assembling" | "explore";
type StageView = { state: StageState; detail?: string };
type Tab = "explore" | "pulse" | "brief" | "memory";

const EMPTY_STAGES: Record<StageKey, StageView> = {
  places: { state: "pending" },
  photos: { state: "pending" },
  story: { state: "pending" },
  routes: { state: "pending" },
  pulse: { state: "pending" },
};

const PHASE_T: Record<TimePhase, number> = { dawn: 0, day: 1 / 3, golden: 2 / 3, night: 1 };
// Named stops on the 24h dial (Sete Colinas pattern)
const TOD_STOPS: { label: string; hour: number }[] = [
  { label: "Dawn", hour: 6.5 },
  { label: "Midday", hour: 13 },
  { label: "Golden", hour: 18.5 },
  { label: "Night", hour: 23 },
];

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
  const [tab, setTab] = useState<Tab>("explore");
  const [activeKindGroup, setActiveKindGroup] = useState<string | null>(null);
  const [place, setPlace] = useState<Place | null>(null);
  const [walking, setWalking] = useState(false);
  // The hour auto-follows the browser's local time — night opens dark,
  // golden hour opens warm. The slider lets you override it.
  const [tod, setTod] = useState(() => {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    return h;
  });
  const [agent, setAgent] = useState<NiyvaruAgent | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [memoryRev, setMemoryRev] = useState(0);
  const [notice, setNotice] = useState("");
  const [areas, setAreas] = useState<AreaMeta[]>([]);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapApi | null>(null);
  const walkRef = useRef<WalkHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const packRef = useRef<AreaPack | null>(null);
  packRef.current = pack;
  const localeRef = useRef<Locale>(locale);
  localeRef.current = locale;

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
    setTab("explore");
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
  useEffect(() => {
    if (!meta || !mapEl.current) return;
    let disposed = false;
    const apiPromise = import("./map/mapView")
      .then(({ initMap }) => initMap(mapEl.current!, meta))
      .then((api) => {
        if (disposed) {
          api.destroy();
          return null;
        }
        mapRef.current = api;
        if (packRef.current) api.setPlaces(packRef.current);
        api.onPlaceClick(
          (p) => {
            setPlace(p);
            api.focusPlace(p, () => setPlace(p));
          },
          (id) => packRef.current?.places.find((x) => x.id === id)
        );
        api.labelLanguage(localeRef.current === "ar" ? "ar" : "en");
        return api;
      })
      .catch((e) => {
        if (!disposed) setNotice(`map failed: ${String((e as Error).message ?? e)}`);
        return null;
      });
    return () => {
      disposed = true;
      void apiPromise.then((api) => api?.destroy());
      mapRef.current = null;
    };
  }, [meta]);

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
          const hour = TOD_STOPS.find((s) => s.label.toLowerCase() === phase)?.hour ?? 18.5;
          mapRef.current?.setHour(hour);
          setTod(hour);
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
          stop: d.walk.stop,
          realFrames: (n: number) => d.walk.realFrames.replace("{n}", String(n)),
          routeOnly: d.walk.routeOnly,
        },
        onEnd: () => setWalking(false),
      });
    } catch {
      setWalking(false);
      setNotice("walk imagery unavailable right now");
    }
  }, [d]);

  const walkToPlace = useCallback(
    async (target: Place): Promise<void> => {
      const m = meta ?? (pack ? { lat: pack.center[0], lon: pack.center[1] } as AreaMeta : null);
      if (!m) return;
      setWalking(true);
      try {
        const route = await walkingRoute(`Walk to ${target.nameEn ?? target.name}`, [
          [m.lat, m.lon],
          [target.lat, target.lon],
        ]);
        mapRef.current?.showRoute(route, false);
        await beginWalk(route);
      } catch {
        setWalking(false);
        setNotice("no walking route found for that destination");
      }
    },
    [meta, pack, beginWalk]
  );

  // ——— derived ———
  const setKindGroup = (group: string | null): void => {
    setActiveKindGroup(group);
    mapRef.current?.filterKinds(group ? KIND_GROUPS[group] ?? null : null);
  };
  const applyTod = (hour: number): void => {
    setTod(hour);
    mapRef.current?.setHour(hour);
  };
  const lookupPlace = (id: string): Place | undefined => pack?.places.find((p) => p.id === id);

  return (
    <div className="app" data-view={view}>
      <div ref={mapEl} className="map" aria-label={meta ? d.a11y.mapLabel.replace("{area}", meta.name) : "map"} />

      {/* The form IS the homepage — map behind, dimmed until assembled */}
      {view === "form" && meta ? null : null}

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
        <>
          <header className="topbar">
            <div className="brand">
              <span className="brand-mark">ن</span>
              <div>
                <div className="brand-name">{d.brand.name}</div>
                <div className="brand-sub">
                  {meta?.name ?? ""}
                  {pack ? ` · ${pack.places.length}` : ""}
                </div>
              </div>
            </div>
            <div className="topbar-actions">
              <div className="tod" role="group" aria-label={d.explore.timeOfDay.day}>
                <div className="tod-readout">
                  <span className="tod-clock">{todClock(tod)}</span>
                  <span className="tod-phase">· {nearestStop(tod).label}</span>
                </div>
                <input
                  className="tod-slider"
                  type="range"
                  min={0}
                  max={24}
                  step={0.1}
                  value={tod}
                  onChange={(e) => applyTod(Number(e.target.value))}
                  aria-label={d.explore.timeOfDay.day}
                />
                <div className="tod-stops">
                  {TOD_STOPS.map((stop) => (
                    <button key={stop.label} data-active={nearestStop(tod).label === stop.label && Math.abs(tod - stop.hour) < 0.15} onClick={() => applyTod(stop.hour)}>
                      {stop.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lang">
                <select
                  className="lang-select"
                  value={locale}
                  onChange={(e) => setLocaleState(e.target.value as Locale)}
                  aria-label="Language / اللغة"
                >
                  <option value="en">English</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              <button className="chip" onClick={() => setShowIntake(true)} aria-label={d.intake.title}>
                ✎
              </button>
              <button className="chip" onClick={() => setTab("memory")} aria-label={d.memory.title}>
                🧠
              </button>
              <button className="chip" onClick={() => { setView("form"); setMeta(null); setPack(null); }} aria-label="change area">
                ⟲
              </button>
            </div>
          </header>

          {notice ? (
            <div className="notice" onClick={() => setNotice("")}>
              {notice}
            </div>
          ) : null}

          <aside className="panel">
            <nav className="panel-tabs">
              {(["explore", "pulse", "brief"] as Tab[]).map((key) => (
                <button key={key} data-active={tab === key} onClick={() => setTab(key)}>
                  {d.tabs[key]}
                </button>
              ))}
            </nav>
            <div className="panel-body">
              {tab === "explore" ? (
                <>
                  {place ? (
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
                  ) : null}
                  <div className="chat-suggestions">
                    <button className="chip" data-selected={activeKindGroup === null} onClick={() => setKindGroup(null)}>
                      {d.explore.layers.all}
                    </button>
                    {["hotels", "pharmacy", "food", "worship", "shops", "health", "money", "heritage", "green"].map((group) =>
                      KIND_GROUPS[group] ? (
                        <button key={group} className="chip" data-selected={activeKindGroup === group} onClick={() => setKindGroup(group)}>
                          {(d.explore.layers as Record<string, string>)[group] ?? group}
                        </button>
                      ) : null
                    )}
                  </div>
                  {agent ? (
                    <ChatPanel
                      d={d}
                      agent={agent}
                      greeting={d.explore.greeting}
                      suggestions={[...d.explore.suggestions]}
                      chatLabel={d.a11y.chatLabel}
                      onTurnComplete={onTurnComplete}
                    />
                  ) : (
                    <p className="muted">
                      {agentError ?? d.common.loading}
                    </p>
                  )}
                </>
              ) : null}
              {tab === "pulse" && pack ? <PulsePanel d={d} meta={meta ?? ({ id: pack.id, name: pack.name, lat: pack.center[0], lon: pack.center[1], radiusM: pack.radiusM, feeds: pack.feeds } as AreaMeta)} pack={pack} /> : null}
              {tab === "brief" && pack ? <BriefPanel d={d} pack={pack} /> : null}
              {tab === "memory" ? <MemoryPanel d={d} /> : null}
            </div>
          </aside>
        </>
      ) : null}

      {view === "form" ? (
        <Intake
          d={d}
          area={meta}
          areas={areas}
          locale={locale}
          onPickArea={selectArea}
          onClose={(chosen) => {
            setShowIntake(false);
            localStorage.setItem("niyvaru.intake.done", "1");
            setMemoryRev((r) => r + 1);
            if (chosen) startAssembly(chosen);
          }}
        />
      ) : null}
    </div>
  );
}

export type { StageKey, StageState, StageUpdate };
