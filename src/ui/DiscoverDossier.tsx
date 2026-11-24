import { useEffect, useState } from "react";
import { openingHoursAt } from "../sources/openingHours";
import { safeWebsiteHost, safeWebsiteUrl } from "../sources/text";
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
  keyboardEnabled,
  onWalk,
  onAsk,
  onClose,
}: {
  d: Dictionary;
  places: Place[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  walking: boolean;
  keyboardEnabled: boolean;
  onWalk: (place: Place) => void;
  onAsk: (place: Place) => void;
  onClose: () => void;
}) {
  const total = places.length;
  const place = places[currentIndex] ?? places[0];
  const rtl = d.dir === "rtl";
  const [expanded, setExpanded] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  const goPrev = (): void => {
    onSelectIndex(currentIndex > 0 ? currentIndex - 1 : total - 1);
  };

  const goNext = (): void => {
    onSelectIndex(currentIndex < total - 1 ? currentIndex + 1 : 0);
  };

  useEffect(() => {
    setExpanded(false);
    setPhotoFailed(false);
  }, [currentIndex]);

  useEffect(() => {
    if (!keyboardEnabled) return;
    const handleKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          target instanceof HTMLButtonElement ||
          target.isContentEditable)
      ) return;
      if (e.key === "ArrowRight") {
        if (rtl) goPrev();
        else goNext();
      } else if (e.key === "ArrowLeft") {
        if (rtl) goNext();
        else goPrev();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  if (!place) return null;

  const status = place.tags.openingHours ? openingHoursAt(place.tags.openingHours) : { state: "unknown" as const };
  const name = place.nameEn ?? place.name;
  // Every photograph the assembler attached is shown; the pack already bounds
  // galleries per place, so there is no arbitrary showcase cut here.
  const photos = place.photos;
  const mainPhoto = photos[0];
  const website = safeWebsiteUrl(place.tags.website);
  const websiteHost = safeWebsiteHost(place.tags.website);
  const credit = (photo: (typeof photos)[number]): string =>
    `${photo.attribution}${photo.license ? ` · ${photo.license}` : ""}`;
  const prevPlace = places[currentIndex > 0 ? currentIndex - 1 : total - 1];
  const nextPlace = places[currentIndex < total - 1 ? currentIndex + 1 : 0];

  let touchStartX = 0;
  let touchStartY = 0;

  return (
    <div
      className="discover-dossier rise"
      onTouchStart={(e) => {
        touchStartX = e.changedTouches[0]?.clientX ?? 0;
        touchStartY = e.changedTouches[0]?.clientY ?? 0;
      }}
      onTouchEnd={(e) => {
        const dx = (e.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
        const dy = (e.changedTouches[0]?.clientY ?? touchStartY) - touchStartY;
        if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
        const forward = rtl ? dx > 0 : dx < 0;
        if (forward) goNext();
        else goPrev();
      }}
    >
      <div className="dossier-nav">
        <div className="dossier-index" role="status">
          <span className="dossier-count">
            {String(currentIndex + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
          <span className="dossier-kind-tag">{d.explore.layers[place.kind as keyof typeof d.explore.layers] ?? place.kind}</span>
        </div>
        <div className="dossier-stepper">
          <button
            type="button"
            className="stepper-arrow"
            onClick={goPrev}
            aria-label={prevPlace ? d.discover.previousPlace.replace("{name}", prevPlace.nameEn ?? prevPlace.name) : d.discover.previous}
            title={d.discover.previousHint}
          >
            {rtl ? "→" : "←"}
          </button>
          <button
            type="button"
            className="stepper-arrow"
            onClick={goNext}
            aria-label={nextPlace ? d.discover.nextPlace.replace("{name}", nextPlace.nameEn ?? nextPlace.name) : d.discover.next}
            title={d.discover.nextHint}
          >
            {rtl ? "←" : "→"}
          </button>
          <button type="button" className="dossier-close" onClick={onClose} aria-label={d.common.close}>
            ✕
          </button>
        </div>
      </div>
      <p className="muted dossier-nav-hint">{d.discover.navHint}</p>

      {mainPhoto && !photoFailed ? (
        <>
          <div className="dossier-photo-wrap arch">
            <img
              src={mainPhoto.thumbUrl}
              alt=""
              title={credit(mainPhoto)}
              className="dossier-photo"
              loading="lazy"
              onError={() => setPhotoFailed(true)}
            />
            <div className="dossier-photo-attr">{credit(mainPhoto)}</div>
          </div>
          {photos.length > 1 ? (
            <div className="dossier-photo-strip">
              {photos.slice(1).map((photo, i) => (
                <figure className="dossier-photo-thumb" key={i} title={credit(photo)}>
                  <img
                    src={photo.thumbUrl}
                    alt=""
                    loading="lazy"
                    onError={(e) => (e.currentTarget.parentElement?.style.setProperty("display", "none"))}
                  />
                  <figcaption className="dossier-photo-thumb-attr">{credit(photo)}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="dossier-photo-empty">
          <span aria-hidden="true">◎</span>
          <span>{d.discover.noPhoto}</span>
        </div>
      )}

      <div className="dossier-head" role="status">
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
        {place.tags.openingHours ? <span dir="ltr">{place.tags.openingHours}</span> : null}
        {place.tags.cuisine ? <span>{place.tags.cuisine}</span> : null}
        {place.tags.takeaway ? <span>{d.place.takeaway}</span> : null}
        {place.tags.outdoorSeating ? <span>{d.place.outdoorSeating}</span> : null}
        {place.tags.internet ? <span>{place.tags.internet}</span> : null}
      </div>

      {place.story ? (
        <div className="dossier-story">
          <p className={`dossier-extract${expanded ? " expanded" : ""}`}>{place.story.extract}</p>
          <div className="dossier-story-actions">
            <button type="button" className="link-btn" onClick={() => setExpanded((v) => !v)}>
              {expanded ? d.discover.readLess : d.discover.readMore}
            </button>
            {place.story.pageUrl ? (
              <a href={place.story.pageUrl} target="_blank" rel="noreferrer" className="dossier-source-link">
                {d.brief.from.replace("{source}", d.discover.source)} ↗
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {place.tags.phone || place.tags.website || place.tags.addrStreet ? (
        <div className="place-meta dossier-contact">
          {place.tags.phone ? <span dir="ltr">☎ {place.tags.phone}</span> : null}
          {website && websiteHost ? (
            <a href={website} target="_blank" rel="noreferrer" className="dossier-link" dir="ltr">
              {websiteHost} ↗
            </a>
          ) : null}
          {place.tags.addrStreet ? (
            <span>{[place.tags.addrNumber, place.tags.addrStreet].filter(Boolean).join(" ")}</span>
          ) : null}
        </div>
      ) : null}

      <p className="muted dossier-coverage">{d.discover.coverage}</p>

      <div className="dossier-actions">
        <button type="button" className="btn btn-bronze dossier-walk-btn" onClick={() => onWalk(place)} disabled={walking}>
          {walking ? <span className="spinner" /> : `🚶 ${d.explore.walk}`}
        </button>
        <button type="button" className="btn btn-ghost dossier-ask-btn" onClick={() => onAsk(place)}>
          {d.discover.ask}
        </button>
      </div>
    </div>
  );
}
