import { useEffect } from "react";
import { openingHoursAt } from "../sources/openingHours";
import type { Dictionary } from "../config/i18n";
import type { Place } from "../sources/types";

/**
 * Discover Dossier — stepping through places, stories, and photographs with
 * smooth 3D camera flights, matching the Lisbon City in Relief experience.
 * Supports next/prev buttons, touch/swipe, and arrow keys.
 */

export function DiscoverDossier({
  d,
  places,
  currentIndex,
  onSelectIndex,
  walking,
  onWalk,
  onClose,
}: {
  d: Dictionary;
  places: Place[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  walking: boolean;
  onWalk: (place: Place) => void;
  onClose: () => void;
}) {
  const total = places.length;
  const place = places[currentIndex];

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight") {
        if (currentIndex < total - 1) onSelectIndex(currentIndex + 1);
        else onSelectIndex(0);
      } else if (e.key === "ArrowLeft") {
        if (currentIndex > 0) onSelectIndex(currentIndex - 1);
        else onSelectIndex(total - 1);
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex, total, onSelectIndex, onClose]);

  if (!place) return null;

  const status = place.tags.openingHours ? openingHoursAt(place.tags.openingHours) : { state: "unknown" as const };
  const name = place.nameEn ?? place.name;
  const photo = place.photos[0];

  const goPrev = (): void => {
    onSelectIndex(currentIndex > 0 ? currentIndex - 1 : total - 1);
  };

  const goNext = (): void => {
    onSelectIndex(currentIndex < total - 1 ? currentIndex + 1 : 0);
  };

  return (
    <div className="discover-dossier rise" aria-live="polite">
      <div className="dossier-nav">
        <div className="dossier-index">
          <span className="dossier-count">
            {String(currentIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <span className="dossier-kind-tag">{place.kind}</span>
        </div>
        <div className="dossier-stepper">
          <button
            type="button"
            className="stepper-arrow"
            onClick={goPrev}
            aria-label="Previous place"
            title="Previous (←)"
          >
            ←
          </button>
          <button
            type="button"
            className="stepper-arrow"
            onClick={goNext}
            aria-label="Next place"
            title="Next (→)"
          >
            →
          </button>
          <button
            type="button"
            className="dossier-close"
            onClick={onClose}
            aria-label={d.common.close}
          >
            ✕
          </button>
        </div>
      </div>

      {photo ? (
        <div className="dossier-photo-wrap arch">
          <img
            src={photo.thumbUrl}
            alt={`${name} — ${photo.attribution}`}
            className="dossier-photo"
            loading="lazy"
          />
          <div className="dossier-photo-attr">
            {photo.attribution}
            {photo.license ? ` · ${photo.license}` : ""}
          </div>
        </div>
      ) : null}

      <div className="dossier-head">
        <h3 className="dossier-title">{name}</h3>
        {place.nameEn && place.nameEn !== place.name ? (
          <div className="dossier-subname">{place.name}</div>
        ) : null}
      </div>

      <div className="place-meta">
        {place.distanceM != null ? (
          <span>{d.common.kmAway.replace("{d}", String(place.distanceM))}</span>
        ) : null}
        <span>
          {status.state === "open"
            ? `${d.common.openNow}${status.nextChange ? ` · ${status.nextChange}` : ""}`
            : status.state === "closed"
              ? `${d.common.closed}${status.nextChange ? ` · ${status.nextChange}` : ""}`
              : d.common.hoursUnknown}
        </span>
        {place.tags.wheelchair === "yes" ? <span>{d.common.wheelchairYes}</span> : null}
      </div>

      {place.story ? (
        <div className="dossier-story">
          <p className="dossier-extract">{place.story.extract}</p>
          {place.story.pageUrl ? (
            <a
              href={place.story.pageUrl}
              target="_blank"
              rel="noreferrer"
              className="dossier-source-link"
            >
              {d.brief.from.replace("{source}", "Wikipedia")} ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {place.tags.phone || place.tags.website || place.tags.addrStreet ? (
        <div className="place-meta dossier-contact">
          {place.tags.phone ? <span>☎ {place.tags.phone}</span> : null}
          {place.tags.website ? (
            <a
              href={place.tags.website.startsWith("http") ? place.tags.website : `https://${place.tags.website}`}
              target="_blank"
              rel="noreferrer"
              className="dossier-link"
            >
              {new URL(place.tags.website.startsWith("http") ? place.tags.website : `https://${place.tags.website}`).host} ↗
            </a>
          ) : null}
          {place.tags.addrStreet ? (
            <span>{[place.tags.addrNumber, place.tags.addrStreet].filter(Boolean).join(" ")}</span>
          ) : null}
        </div>
      ) : null}

      <div className="dossier-actions">
        <button
          type="button"
          className="btn btn-bronze dossier-walk-btn"
          onClick={() => onWalk(place)}
          disabled={walking}
        >
          {walking ? <span className="spinner" /> : `🚶 ${d.explore.walk}`}
        </button>
      </div>
    </div>
  );
}
