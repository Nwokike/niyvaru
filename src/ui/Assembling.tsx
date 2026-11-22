import { useEffect, useState } from "react";
import type { Dictionary } from "../config/i18n";
import type { StageKey, StageState } from "../sources/assemble";
import type { Photo } from "../sources/types";

const ORDER: StageKey[] = ["places", "photos", "story", "routes", "pulse"];

export interface StageView {
  state: StageState;
  detail?: string;
}

const PIN_SVG = `<svg viewBox="0 0 24 32" width="44" height="59" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 0C5.4 0 0 5.4 0 12c0 8.4 12 20 12 20s12-11.6 12-20C24 5.4 18.6 0 12 0Z" fill="#96682f"/>
  <path d="M7 17c0-4 2.2-7 5-7s5 3 5 7h-3.2c0-2.3-1-4-1.8-4s-1.8 1.7-1.8 4H7Z" fill="#fbf7f1"/>
</svg>`;

/**
 * The assembly loader — a Niyvaru reading of the Sete Colinas pattern:
 * a brand mark inside a ring with a comet arc turning in one-second laps,
 * live counts ticking per stage, a hairline of progress, and the
 * grow-and-fade reveal when the place is ready.
 */
export function Assembling({
  d,
  areaName,
  stages,
  hero,
  revealing,
  onEnter,
}: {
  d: Dictionary;
  areaName: string;
  stages: Record<StageKey, StageView>;
  hero?: Photo;
  revealing: boolean;
  onEnter: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const settled = ORDER.filter((k) => stages[k].state === "done" || stages[k].state === "failed").length;
  const progress = settled / ORDER.length;
  const anythingReady = settled > 0;

  return (
    <div className={`assembling grain${revealing ? " exit" : ""}`} aria-live="polite">
      <div className="assembling-card rise">
        <div className="loader-ring" aria-hidden="true">
          <div className="loader-comet" />
          <div className="loader-mark" dangerouslySetInnerHTML={{ __html: PIN_SVG }} />
          {hero ? (
            <img
              className="loader-hero arch"
              src={hero.thumbUrl}
              alt={hero.attribution}
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : null}
        </div>
        <div className="eyebrow">{d.brand.name}</div>
        <h2 className="display" style={{ fontSize: "1.7rem", margin: "0.4rem 0 0.9rem" }}>
          {d.assembling.title.replace("{area}", areaName)}
        </h2>
        <div className="assembling-steps">
          {ORDER.map((key) => (
            <div key={key} className="assembling-step" data-state={stages[key].state}>
              <span className="assembling-name">{d.assembling.steps[key]}</span>
              <span className="assembling-status">
                {stages[key].detail ??
                  (stages[key].state === "done"
                    ? d.assembling.ready
                    : stages[key].state === "failed"
                      ? d.assembling.failed
                      : stages[key].state === "active"
                        ? "…"
                        : "")}
              </span>
            </div>
          ))}
        </div>
        <div className="loader-progress" aria-hidden="true">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="muted" style={{ margin: "0.5rem 0 1rem" }}>{elapsed}s</p>
        <button className="btn btn-bronze" onClick={onEnter} disabled={!anythingReady}>
          {d.assembling.enter}
        </button>
      </div>
    </div>
  );
}
