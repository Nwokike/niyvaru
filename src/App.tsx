import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAction, AreaPack, ChatMessage, Poi, Post, Profile, WalkRoute } from "./types";
import { initMap, setPois, setRoutes, focusPoi, highlightKind, showRoute, onPoiClick } from "./mapView";
import type * as maplibregl from "maplibre-gl";
import { loadPack, loadPackIndex } from "./packs";
import { loadHistory, loadProfile, saveHistory, saveProfile, clearMemory, defaultProfile } from "./memory";
import { extractMemory, sendMessage, profileToText } from "./agent";
import { startWalk, type WalkHandle } from "./walkPlayer";

const POSTS_KEY = "niyvaru.posts.v1";
const DEFAULT_AREA = "makkah-haram";

function loadPosts(): Post[] {
  try {
    const raw = localStorage.getItem(POSTS_KEY);
    if (raw) return JSON.parse(raw) as Post[];
  } catch {
    /* ignore */
  }
  return [
    {
      id: "seed-1",
      area: DEFAULT_AREA,
      place_name: "Near King Abdulaziz Gate",
      body: "Crowds thin out about 20 min after Maghrib. The pharmacy on Ajyad street is open late.",
      mood: "calm",
      created_at: new Date().toISOString(),
    },
  ];
}

export function App() {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const walkRef = useRef<WalkHandle | null>(null);
  const lookupRef = useRef<(id: string) => Poi | undefined>(() => undefined);

  const [packIndex, setPackIndex] = useState<{ areas: { id: string; name: string }[] } | null>(null);
  const [pack, setPack] = useState<AreaPack | null>(null);
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [history, setHistory] = useState<ChatMessage[]>(() => loadHistory());
  const [posts, setPosts] = useState<Post[]>(() => loadPosts());
  const [tab, setTab] = useState<"chat" | "feed" | "ops">("chat");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [activeRoute, setActiveRoute] = useState<string | null>(null);
  const [walking, setWalking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const map = await initMap(mapEl.current!);
      if (cancelled) return;
      mapRef.current = map;
      const index = await loadPackIndex();
      if (cancelled) return;
      setPackIndex(index);
      const p = await loadPack(DEFAULT_AREA, index);
      if (cancelled) return;
      setPack(p);
      setPois(map, p.pois);
      setRoutes(map, p.routes);
      lookupRef.current = (id) => p.pois.find((x) => x.id === id);
      onPoiClick(
        map,
        (poi) => {
          setNotice(`${poi.name_en || poi.name} · ${poi.kind}${poi.tags?.opening_hours ? ` · open ${poi.tags.opening_hours}` : ""}${poi.tags?.wheelchair ? ` · wheelchair ${poi.tags.wheelchair}` : ""}`);
        },
        (id) => lookupRef.current(id)
      );
    })().catch((e) => setNotice(`map init failed: ${String(e)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const area = useMemo(() => {
    if (!pack) return null;
    return {
      id: pack.id,
      name: pack.name,
      center: pack.center,
      radius_m: pack.radius_m,
      pois: pack.pois,
      routes: pack.routes,
      prayer: pack.prayer,
      weather: pack.weather,
      events: pack.events,
    };
  }, [pack]);

  const runActions = useCallback(
    (actions: AgentAction[]) => {
      const map = mapRef.current;
      if (!map || !pack) return;
      for (const a of actions) {
        if (a.action === "focus_poi") {
          const poi = pack.pois.find((p) => p.id === a.id);
          if (poi) focusPoi(map, poi);
        } else if (a.action === "highlight_kind") {
          highlightKind(map, a.kind);
        } else if (a.action === "clear") {
          highlightKind(map, null);
          showRoute(map, null);
          setActiveRoute(null);
        } else if (a.action === "show_route") {
          const route = pack.routes.find((r) => r.id === a.id);
          if (route) {
            showRoute(map, route);
            setActiveRoute(route.id);
          }
        } else if (a.action === "start_walk") {
          const route =
            pack.routes.find((r) => r.id === a.route) ??
            (a.route ? undefined : pack.routes[0]);
          if (route) {
            showRoute(map, route);
            setActiveRoute(route.id);
            const seq = pack.sequences.find((s) => s.id === a.sequence) ?? pack.sequences[0];
            walkRef.current?.stop();
            walkRef.current = startWalk(document.body, route, seq, () => setWalking(false));
            setWalking(true);
          }
        }
      }
    },
    [pack]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !area || streaming) return;
    setInput("");
    setStreaming(true);
    setTab("chat");
    const userMsg: ChatMessage = { role: "user", content: text };
    const nextHistory = [...history, userMsg];
    setHistory(nextHistory);
    let acc = "";
    try {
      const res = await sendMessage(text, history, profile, area, (t) => {
        acc += t;
      });
      const assistant: ChatMessage = { role: "assistant", content: res.text || acc };
      const merged = [...nextHistory, assistant];
      setHistory(merged);
      saveHistory(merged);
      runActions(res.actions);
      // Memory study: run after the answer so it never blocks the reply.
      extractMemory(merged, profile)
        .then((p) => {
          setProfile(p);
          saveProfile(p);
        })
        .catch(() => {});
    } catch (e) {
      const assistant: ChatMessage = { role: "assistant", content: `⚠ ${String(e)}` };
      const merged = [...nextHistory, assistant];
      setHistory(merged);
      saveHistory(merged);
    } finally {
      setStreaming(false);
    }
  }, [area, history, input, profile, runActions, streaming]);

  const addPost = useCallback((body: string, mood: string) => {
    if (!body.trim()) return;
    const post: Post = {
      id: `p-${Date.now()}`,
      area: pack?.id ?? DEFAULT_AREA,
      place_name: pack?.name,
      body: body.trim(),
      mood,
      created_at: new Date().toISOString(),
    };
    setPosts((prev) => {
      const next = [post, ...prev].slice(0, 50);
      localStorage.setItem(POSTS_KEY, JSON.stringify(next));
      return next;
    });
  }, [pack]);

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch, version: 1 as const };
      saveProfile(next);
      return next;
    });
  }, []);

  const today = pack?.prayer?.[0];
  const weather = pack?.weather?.[0];

  return (
    <div className="app">
      <div ref={mapEl} className="map" />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">ن</span>
          <div>
            <div className="brand-name">Niyvaru</div>
            <div className="brand-sub">{pack ? `${pack.name} · ${pack.pois.length} places` : "loading area…"}</div>
          </div>
        </div>
        <div className="topbar-right">
          {today && <span className="pill">🕌 {today.maghrib} Maghrib</span>}
          {weather && <span className="pill">☀ {weather.temp_max_c}°C</span>}
          {pack && <span className="pill">v{pack.version.slice(0, 10)}</span>}
        </div>
      </header>

      {notice && (
        <div className="notice" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}

      <aside className="panel">
        <nav className="tabs">
          <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>Walk</button>
          <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>Feed</button>
          <button className={tab === "ops" ? "active" : ""} onClick={() => setTab("ops")}>Ops</button>
        </nav>

        {tab === "chat" && (
          <div className="chat">
            <div className="chat-log">
              {history.length === 0 && (
                <div className="hint">
                  <p><strong>Niyvaru</strong> walks Makkah with you. Try:</p>
                  <ul>
                    <li>“Walk me to a pharmacy near the Haram”</li>
                    <li>“A quiet hotel under $150 with an accessible entrance”</li>
                    <li>“What’s happening around me right now?”</li>
                  </ul>
                </div>
              )}
              {history.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  {m.role === "assistant" ? <span className="avatar">ن</span> : null}
                  <div className="bubble">{m.content}</div>
                </div>
              ))}
              {streaming && <div className="msg assistant"><span className="avatar">ن</span><div className="bubble typing">walking through the data…</div></div>}
            </div>
            <div className="chat-input">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Ask Niyvaru…"
              />
              <button onClick={send} disabled={streaming || !input.trim()}>Send</button>
            </div>
          </div>
        )}

        {tab === "feed" && (
          <div className="feed">
            <section className="card">
              <h3>Now</h3>
              {today && <p>Fajr {today.fajr} · Dhuhr {today.dhuhr} · Asr {today.asr} · Maghrib {today.maghrib} · Isha {today.isha}</p>}
              {weather && <p>{weather.temp_max_c}°C / {weather.temp_min_c}°C · rain {weather.precipitation_mm} mm · wind {weather.wind_max_kmh} km/h</p>}
              <p className="muted">{pack?.events?.length ? pack.events.map((e) => e.title).join(" · ") : "No reported events in this area."}</p>
            </section>
            <section className="card">
              <h3>Near you</h3>
              <div className="post-form">
                <input id="post-body" placeholder="Share what you see…" />
                <div className="post-row">
                  <select id="post-mood">
                    <option value="calm">calm</option>
                    <option value="busy">busy</option>
                    <option value="open late">open late</option>
                    <option value="accessible">accessible</option>
                  </select>
                  <button onClick={() => {
                    const body = (document.getElementById("post-body") as HTMLInputElement).value;
                    const mood = (document.getElementById("post-mood") as HTMLSelectElement).value;
                    addPost(body, mood);
                    (document.getElementById("post-body") as HTMLInputElement).value = "";
                  }}>Post</button>
                </div>
              </div>
              {posts.map((p) => (
                <div key={p.id} className="post">
                  <div className="post-head"><span className={`mood ${p.mood}`}>{p.mood}</span><span>{p.place_name ?? p.area}</span></div>
                  <div>{p.body}</div>
                  <div className="muted">{new Date(p.created_at).toLocaleString()}</div>
                </div>
              ))}
            </section>
          </div>
        )}

        {tab === "ops" && (
          <div className="ops">
            <section className="card">
              <h3>Client memory</h3>
              <pre className="memory">{profileToText(profile)}</pre>
              <div className="ops-grid">
                <label>Mobility
                  <select value={profile.mobility ?? ""} onChange={(e) => updateProfile({ mobility: (e.target.value || undefined) as Profile["mobility"] })}>
                    <option value="">unknown</option>
                    <option value="none">none</option>
                    <option value="limited">limited</option>
                    <option value="wheelchair">wheelchair</option>
                  </select>
                </label>
                <label>Budget $/night
                  <input type="number" value={profile.budget_usd_per_night ?? ""} onChange={(e) => updateProfile({ budget_usd_per_night: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label>Preferences <input value={profile.preferences.join(", ")} onChange={(e) => updateProfile({ preferences: split(e.target.value) })} /></label>
                <label>Constraints <input value={profile.constraints.join(", ")} onChange={(e) => updateProfile({ constraints: split(e.target.value) })} /></label>
                <label>Interests <input value={profile.interests.join(", ")} onChange={(e) => updateProfile({ interests: split(e.target.value) })} /></label>
              </div>
              <div className="ops-actions">
                <button onClick={() => { clearMemory(); setProfile(defaultProfile()); setHistory([]); }}>Clear memory</button>
                <span className="muted">Area pack {pack?.version ?? "—"} · {pack?.generated_at?.slice(0, 10) ?? ""}</span>
              </div>
            </section>
            <section className="card">
              <h3>Routes</h3>
              {pack?.routes.map((r: WalkRoute) => (
                <div key={r.id} className="route-row">
                  <span>{r.name} · {r.distance_m} m · {Math.round(r.duration_s / 60)} min</span>
                  <button onClick={() => { runActions([{ action: "show_route", id: r.id }]); }}>Show</button>
                </div>
              ))}
              {activeRoute && walking && <p className="muted">Walk playing — stop it from the map overlay.</p>}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function split(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}
