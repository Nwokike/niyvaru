import { useEffect, useRef, useState } from "react";
import { featuredAreas, searchAreas } from "../area/store";
import type { AreaMeta } from "../sources/types";
import type { Dictionary } from "../config/i18n";

export function Welcome({ d, onPick }: { d: Dictionary; onPick: (meta: AreaMeta) => void }) {
  const [query, setQuery] = useState("");
  const [featured, setFeatured] = useState<AreaMeta[]>([]);
  const [results, setResults] = useState<AreaMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    featuredAreas()
      .then(setFeatured)
      .catch(() => setFeatured([]));
  }, []);

  const runSearch = async (): Promise<void> => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || busy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      const found = await searchAreas(trimmed, controller.signal);
      setResults(found);
      if (!found.length) setError(d.welcome.noResults);
    } catch (e) {
      if (!controller.signal.aborted) setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const shown = results ?? featured;
  const label = results ? (results.length ? d.welcome.choose : d.welcome.featured) : d.welcome.featured;

  return (
    <div className="welcome grain">
      <div className="welcome-inner rise">
        <div className="eyebrow">{d.welcome.eyebrow}</div>
        <h1 className="display welcome-title">{d.welcome.title}</h1>
        <p className="lede welcome-lede">{d.welcome.lede}</p>

        <form
          className="welcome-search"
          onSubmit={(e) => {
            e.preventDefault();
            void runSearch();
          }}
        >
          <input
            className="field"
            value={query}
            placeholder={d.welcome.searchPlaceholder}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={d.welcome.searchPlaceholder}
          />
          <button className="btn btn-bronze" type="submit" disabled={busy || query.trim().length < 2}>
            {busy ? <span className="spinner" aria-hidden="true" /> : d.welcome.choose}
          </button>
        </form>
        {error ? <p className="welcome-error">{error}</p> : null}
        {results && results.length ? (
          <p className="welcome-hint">{d.welcome.choose} ↓</p>
        ) : null}

        <div className="welcome-featured">
          <h3>{label || d.welcome.featured}</h3>
          <div className="featured-grid">
            {shown.map((meta) => (
              <button key={meta.id} className="chip" onClick={() => onPick(meta)}>
                <span>
                  {meta.name}
                  <span className="featured-sub">{meta.country}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <p className="welcome-hint">{d.welcome.hint}</p>
      </div>
    </div>
  );
}
