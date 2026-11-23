import { openingHoursAt } from "../sources/openingHours";
import { safeWebsiteHost, safeWebsiteUrl } from "../sources/text";
import type { Dictionary } from "../config/i18n";
import type { Place } from "../sources/types";

export function PlaceCard({
  d,
  place,
  walking,
  onWalk,
  onClose,
}: {
  d: Dictionary;
  place: Place;
  walking: boolean;
  onWalk: (place: Place) => void;
  onClose: () => void;
}) {
  const status = place.tags.openingHours ? openingHoursAt(place.tags.openingHours) : { state: "unknown" as const };
  const name = place.nameEn ?? place.name;
  const website = safeWebsiteUrl(place.tags.website);
  const websiteHost = safeWebsiteHost(place.tags.website);

  return (
    <div className="place-card rise" aria-live="polite">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
        <h3 className="section-title">{name}</h3>
        <button className="btn btn-ghost" style={{ padding: "0.3rem 0.6rem" }} onClick={onClose} aria-label={d.common.close}>
          ✕
        </button>
      </div>
      <div className="place-meta">
        <span>{place.kind}</span>
        {place.distanceM != null ? <span>{d.common.kmAway.replace("{d}", String(place.distanceM))}</span> : null}
        <span>
          {status.state === "open"
            ? `${d.common.openNow}${status.nextChange ? ` · ${status.nextChange}` : ""}`
            : status.state === "closed"
              ? `${d.common.closed}${status.nextChange ? ` · ${status.nextChange}` : ""}`
              : d.common.hoursUnknown}
        </span>
        {place.tags.wheelchair === "yes" ? <span>{d.common.wheelchairYes}</span> : null}
      </div>
      {place.tags.phone || place.tags.website || place.tags.addrStreet ? (
        <div className="place-meta">
          {place.tags.phone ? <span>☎ {place.tags.phone}</span> : null}
          {website && websiteHost ? (
            <a href={website} target="_blank" rel="noreferrer" className="muted" style={{ color: "var(--bronze-deep)" }}>
              {websiteHost}
            </a>
          ) : null}
          {place.tags.addrStreet ? <span>{[place.tags.addrNumber, place.tags.addrStreet].filter(Boolean).join(" ")}</span> : null}
        </div>
      ) : null}
      {place.story ? <p className="muted" style={{ margin: 0, lineHeight: 1.5 }}>{place.story.extract.slice(0, 280)}…</p> : null}
      {place.photos.length ? (
        <div className="place-photos">
          {place.photos.map((photo, i) => (
            <figure
              key={i}
              style={{ margin: 0, position: "relative" }}
              title={`${photo.attribution}${photo.license ? ` · ${photo.license}` : ""}`}
            >
              <img
                src={photo.thumbUrl}
                alt={`${name} — ${photo.attribution}`}
                loading="lazy"
                onError={(e) => e.currentTarget.parentElement?.style.setProperty("display", "none")}
              />
            </figure>
          ))}
        </div>
      ) : null}
      <div className="place-actions">
        <button className="btn btn-bronze" onClick={() => onWalk(place)} disabled={walking}>
          {walking ? <span className="spinner" /> : `🚶 ${d.explore.walk}`}
        </button>
      </div>
      {place.photos.length ? (
        <p className="muted" style={{ margin: 0 }}>
          {place.photos.map((p) => p.attribution).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
