import { useEffect, useMemo, useRef, useState } from "react";
import { blueskyLive } from "../sources/social";
import { describeWeather } from "../sources/weather";
import type { Dictionary } from "../config/i18n";
import type { AreaMeta, AreaPack, PulseItem } from "../sources/types";

/**
 * The pulse — everything happening around you: news, live social stream,
 * travellers' local posts, weather, prayer, and (as data, clearly labelled)
 * promoted local placements.
 */

const LOCAL_POSTS_KEY = "niyvaru.local-posts.v2";

interface LocalPost {
  id: string;
  text: string;
  at: string;
}

function loadLocalPosts(): LocalPost[] {
  try {
    const raw = localStorage.getItem(LOCAL_POSTS_KEY);
    return raw ? (JSON.parse(raw) as LocalPost[]) : [];
  } catch {
    return [];
  }
}

function saveLocalPosts(posts: LocalPost[]): void {
  localStorage.setItem(LOCAL_POSTS_KEY, JSON.stringify(posts.slice(0, 50)));
}

function sourceLabel(d: Dictionary, source: PulseItem["source"]): string {
  return (d.pulse.sources as Record<string, string>)[source] ?? source;
}

function timeAgo(d: Dictionary, at?: string): string {
  if (!at) return "";
  const delta = Date.now() - new Date(at).getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return d.pulse.now;
  if (minutes < 60) return d.pulse.minutesAgo.replace("{n}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return d.pulse.hoursAgo.replace("{n}", String(hours));
  return d.pulse.daysAgo.replace("{n}", String(Math.floor(hours / 24)));
}

export function PulsePanel({
  d,
  meta,
  pack,
}: {
  d: Dictionary;
  meta: AreaMeta;
  pack: AreaPack;
}) {
  const [localPosts, setLocalPosts] = useState<LocalPost[]>(() => loadLocalPosts());
  const [live, setLive] = useState<PulseItem[]>([]);
  const [draft, setDraft] = useState("");
  const seen = useRef(new Set<string>());

  // Live Bluesky stream filtered by the area's hashtags — closable, deduped.
  useEffect(() => {
    seen.current = new Set();
    setLive([]);
    const close = blueskyLive(meta, (item) => {
      if (seen.current.has(item.id)) return;
      seen.current.add(item.id);
      setLive((prev) => [item, ...prev].slice(0, 40));
    });
    return close;
  }, [meta.id, meta.name, JSON.stringify(meta.feeds)]);

  const merged = useMemo(() => {
    const items: PulseItem[] = [
      ...live,
      ...pack.pulse,
      ...localPosts.map<PulseItem>((p) => ({
        id: `local/${p.id}`,
        source: "local",
        kind: "organic",
        title: p.text,
        at: p.at,
      })),
    ];
    const deduped = new Map<string, PulseItem>();
    for (const item of items) if (!deduped.has(item.id)) deduped.set(item.id, item);
    return [...deduped.values()].slice(0, 40);
  }, [live, pack.pulse, localPosts]);

  const weather = pack.weather[0];
  const prayer = pack.prayer[0];
  const hasPulse = merged.length > 0;

  const post = (): void => {
    const text = draft.trim();
    if (!text) return;
    const next: LocalPost[] = [{ id: `${Date.now()}`, text, at: new Date().toISOString() }, ...localPosts];
    setLocalPosts(next);
    saveLocalPosts(next);
    setDraft("");
  };

  return (
    <>
      {weather ? (
        <div className="panel-card">
          <div className="pulse-item" style={{ borderBottom: 0, paddingBottom: 0 }}>
            <div className="pulse-head">
              <span className="pulse-source">{d.pulse.sources.weather}</span>
              <span>{weather.provider}</span>
            </div>
            <p>
              {weather.tempMaxC}° / {weather.tempMinC}°C{describeWeather(weather.weatherCode) ? ` · ${describeWeather(weather.weatherCode)}` : ""} · {weather.precipitationMm} mm · {weather.windMaxKmh} km/h
            </p>
          </div>
        </div>
      ) : null}
      {prayer ? (
        <div className="panel-card">
          <div className="pulse-item" style={{ borderBottom: 0, paddingBottom: 0 }}>
            <div className="pulse-head">
              <span className="pulse-source">{d.pulse.sources.prayer}</span>
              <span>{prayer.date}</span>
            </div>
            <p className="prayer-row">
              <span>{d.pulse.prayerNames}</span>
              <span dir="ltr">{[prayer.fajr, prayer.dhuhr, prayer.asr, prayer.maghrib, prayer.isha].join(" · ")}</span>
            </p>
          </div>
        </div>
      ) : null}

      <div className="pulse-compose">
        <input
          className="field"
          value={draft}
          placeholder={d.pulse.share}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && post()}
        />
        <button className="btn btn-ghost" onClick={post} disabled={!draft.trim()}>
          {d.pulse.post}
        </button>
      </div>

      {!hasPulse && !weather && !prayer ? (
        <p className="muted">{d.common.loading}</p>
      ) : null}
      {hasPulse === false && (weather || prayer) ? <p className="muted">{d.pulse.empty}</p> : null}
      {merged.map((item) => (
        <article key={item.id} className="pulse-item">
          <div className="pulse-head">
            <span className="pulse-source">
              {item.source === "local" ? d.pulse.localDevice : sourceLabel(d, item.source)}
            </span>
            {item.source === "local" ? <span className="pulse-badge">{d.pulse.notShared}</span> : null}
            {item.kind === "promoted" ? (
              <span className="pulse-source" style={{ background: "rgba(150,104,47,0.16)" }}>
                ★ {item.sponsor?.name ?? d.pulse.sources.promotions}
              </span>
            ) : null}
            <span>{timeAgo(d, item.at)}</span>
          </div>
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer">
              <p>{item.title}</p>
            </a>
          ) : (
            <p>{item.title}</p>
          )}
          {item.sponsor?.note ? <p className="muted">{item.sponsor.note}</p> : null}
        </article>
      ))}
    </>
  );
}
