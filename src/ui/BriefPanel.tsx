import { useMemo } from "react";
import type { Dictionary } from "../config/i18n";
import type { AreaPack } from "../sources/types";

/** The area's story — hero photograph (with attribution), narrative, facts. */
export function BriefPanel({ d, pack }: { d: Dictionary; pack: AreaPack }) {
  const hero = pack.heroPhoto;
  const storyPlace = useMemo(() => pack.places.find((p) => p.story?.extract), [pack]);
  const counts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of pack.places) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [pack]);

  return (
    <>
      {hero ? (
        <img className="brief-hero arch" src={hero.thumbUrl} alt={hero.attribution} loading="lazy" />
      ) : null}
      {hero ? <p className="muted">{hero.attribution}{hero.license ? ` · ${hero.license}` : ""}</p> : null}

      <div className="brief-facts">
        {counts.map(([kind, n]) => (
          <span key={kind} className="chip" style={{ cursor: "default" }}>
            {n} {kind}
          </span>
        ))}
      </div>

      {storyPlace?.story ? (
        <div className="panel-card">
          <h3 className="section-title">{storyPlace.story.title}</h3>
          <p className="brief-prose">{storyPlace.story.extract}</p>
          {storyPlace.story.pageUrl ? (
            <a className="muted" href={storyPlace.story.pageUrl} target="_blank" rel="noreferrer" style={{ color: "var(--bronze-deep)" }}>
              {d.brief.from.replace("{source}", "Wikipedia")}
            </a>
          ) : null}
        </div>
      ) : (
        <p className="muted">{d.pulse.empty}</p>
      )}

      <div className="panel-card">
        <h3 className="section-title">{d.brief.facts}</h3>
        {Object.entries(pack.attribution).map(([source, licence]) => (
          <p key={source} className="muted" style={{ margin: "0.2rem 0" }}>
            {source} — {licence}
          </p>
        ))}
      </div>
    </>
  );
}
