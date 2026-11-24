import { useEffect, useRef, useState } from "react";
import type { Dictionary } from "../config/i18n";
import { writeFile } from "../memory/store";
import { searchAreas } from "../area/store";
import { BASE_URL } from "../config/endpoints";
import type { AreaMeta } from "../sources/types";

/**
 * The request form — a faithful editorial implementation of the original
 * niyvaru.eu layout (warm paper, Clock Tower watermark, 2-column hero, value
 * props, and the glass concierge card).
 * City-neutral: any city on Earth can be searched or selected.
 * Everything the traveller answers writes directly into the agent's memory.
 */

type Standard = "star3" | "star4" | "star5" | "any";
type Proximity = "courtyard" | "within500" | "shuttle";
type Breakfast = "included" | "preferred" | "roomOnly";

function travellerMarkdown(input: {
  name: string;
  adults: number;
  children: number;
  rooms: number;
  standard: Standard;
  proximity: Proximity;
  breakfast: Breakfast;
  elderly: boolean;
  wheelchair: boolean;
  interests: string[];
  language: string;
}): string {
  const lines = ["# Traveller", ""];
  lines.push(`- language: ${input.language}`);
  if (input.name) lines.push(`- name: ${input.name}`);
  lines.push(`- party: ${input.adults} adults, ${input.children} children, ${input.rooms} room${input.rooms > 1 ? "s" : ""}`);
  lines.push(`- hotel standard: ${input.standard === "any" ? "any" : input.standard.replace("star", "")}★`);
  if (input.wheelchair) lines.push("- mobility: wheelchair user — step-free route to the gate required");
  else if (input.elderly) lines.push("- mobility: travelling with elderly — short walks, easy lifts");
  if (input.proximity === "courtyard") lines.push("- proximity: wants courtyard, zero-metre access");
  else if (input.proximity === "within500") lines.push("- proximity: within 500 m (5–7 minute walk)");
  else lines.push("- proximity: shuttle-friendly is acceptable");
  lines.push(`- breakfast: ${input.breakfast}`);
  if (input.interests.length) lines.push(`- interests: ${input.interests.join(", ")}`);
  lines.push("");
  return lines.join("\n");
}

function tripMarkdown(input: {
  areaName: string;
  country?: string;
  checkin: string;
  checkout: string;
  flexible: boolean;
}): string {
  const lines = ["# Trip", ""];
  lines.push(`- area: ${input.areaName}${input.country ? `, ${input.country}` : ""}`);
  if (input.checkin || input.checkout) {
    lines.push(`- dates: ${input.checkin || "?"} → ${input.checkout || "?"}${input.flexible ? " (flexible ±2 days)" : ""}`);
  } else {
    lines.push("- dates: not set");
  }
  lines.push("- status: exploring");
  lines.push("");
  return lines.join("\n");
}

function Stepper({
  d,
  label,
  value,
  min,
  onChange,
}: {
  d: Dictionary;
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" className="stepper-btn" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`${d.intake.fewer} ${label}`}>
          −
        </button>
        <span className="stepper-value">{value}</span>
        <button type="button" className="stepper-btn" onClick={() => onChange(value + 1)} aria-label={`${d.intake.more} ${label}`}>
          +
        </button>
      </div>
    </div>
  );
}

export function Intake({
  d,
  area,
  areas,
  locale,
  homepage,
  onPickArea,
  onClose,
}: {
  d: Dictionary;
  area: AreaMeta | null;
  areas: AreaMeta[];
  locale: "en" | "ar";
  /** The form IS the homepage in this view — even after a city is selected. */
  homepage: boolean;
  onPickArea: (meta: AreaMeta) => void;
  onClose: (area: AreaMeta | null) => void;
}) {
  const [stay, setStay] = useState(area?.id ?? "");
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [flexible, setFlexible] = useState(false);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [rooms, setRooms] = useState(1);
  const [standard, setStandard] = useState<Standard>("star5");
  const [proximity, setProximity] = useState<Proximity>("within500");
  const [breakfast, setBreakfast] = useState<Breakfast>("preferred");
  const [elderly, setElderly] = useState(false);
  const [wheelchair, setWheelchair] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [showWarning, setShowWarning] = useState("");
  const [saveError, setSaveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AreaMeta[] | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  onCloseRef.current = onClose;

  const selectedArea = areas.find((a) => a.id === stay) ?? searchResults?.find((a) => a.id === stay) ?? area;

  useEffect(() => {
    if (homepage) return;
    const root = modalRef.current;
    if (!root) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onCloseRef.current(area);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [homepage, area]);

  const finish = async (): Promise<void> => {
    if (submitting) return;
    const language = locale === "ar" ? "Arabic" : "English";
    if (checkin && checkout && checkout < checkin) {
      setShowWarning(d.intake.dateOrder);
      return;
    }
    let current = selectedArea ?? searchResults?.[0] ?? null;
    if (!current && search.trim().length >= 2) {
      try {
        current = (await searchAreas(search.trim()))[0] ?? null;
      } catch {
        current = null;
      }
    }
    if (!current) {
      setShowWarning(d.intake.areaRequired);
      return;
    }
    setSubmitting(true);
    setShowWarning("");
    try {
      await writeFile(
        "/memories/traveller.md",
        travellerMarkdown({ name, adults, children, rooms, standard, proximity, breakfast, elderly, wheelchair, interests, language })
      );
      await writeFile(
        "/memories/trip.md",
        tripMarkdown({
          areaName: current.name,
          country: current.country,
          checkin,
          checkout,
          flexible,
        })
      );
      setSaveError("");
      onClose(current);
    } catch {
      setSaveError(d.intake.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const runSearch = async (): Promise<void> => {
    const q = search.trim();
    if (q.length < 2) {
      setSearchResults(null);
      return;
    }
    if (searching) return;
    setSearching(true);
    try {
      const found = await searchAreas(q);
      setSearchResults(found);
      if (found[0]) {
        setStay(found[0].id);
        onPickArea(found[0]);
      }
    } catch {
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  const submit = (): void => {
    void finish();
  };

  const formContent = (
    <div className="request-content">
      <div className="eyebrow">{d.intake.eyebrow}</div>
      <h2 className="display request-title">{d.intake.title}</h2>
      <p className="muted" style={{ marginTop: "0.4rem" }}>{d.intake.lede}</p>

      <div className="request-sections" aria-hidden="true">
        <span>
          <i>1</i> {d.intake.sectionStay}
        </span>
        <span>
          <i>2</i> {d.intake.sectionDetails}
        </span>
      </div>

      {/* ——— 1 · Your stay ——— */}
      <p className="request-section-label">{d.intake.sectionStay}</p>

      <fieldset className="request-group">
        <legend>{d.intake.area}</legend>
        <div className="request-search">
          <input
            className="field"
            value={search}
            placeholder={d.welcome.searchPlaceholder}
            aria-label={d.welcome.searchPlaceholder}
            aria-controls="area-search-results"
            aria-expanded={!!searchResults?.length}
            onChange={(e) => {
              setSearch(e.target.value);
              setSearchResults(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
          />
          <button type="button" className="btn btn-ghost search-btn" onClick={() => void runSearch()} disabled={searching || search.trim().length < 2}>
            {searching ? <span className="spinner" /> : d.welcome.searchAction}
          </button>
        </div>
        <p className="muted search-hint" aria-live="polite">
          {searching
            ? d.welcome.searching
            : searchResults
              ? searchResults.length
                ? d.welcome.resultCount.replace("{n}", String(searchResults.length))
                : d.welcome.noResults
              : d.welcome.searchHint}
        </p>
        {selectedArea && searchResults?.length ? (
          <p className="selected-area" role="status">
            {d.intake.selectedArea.replace("{area}", selectedArea.name)}
          </p>
        ) : null}
        <div id="area-search-results" aria-label={d.a11y.searchResults}>
        {searchResults?.length ? (
          <div className="request-chips">
            {searchResults.map((r) => (
              <button
                key={r.id}
                type="button"
                className="chip"
                data-selected={r.id === stay}
                aria-pressed={r.id === stay}
                onClick={() => {
                  setStay(r.id);
                  onPickArea(r);
                }}
              >
                {r.name}
                {r.country ? <span className="featured-sub">{r.country}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        </div>
        <div className="request-chips">
          {(areas.length ? areas : area ? [area] : []).map((a) => (
            <button
              key={a.id}
              type="button"
              className="chip"
              data-selected={a.id === stay}
              aria-pressed={a.id === stay}
              onClick={() => {
                setStay(a.id);
                onPickArea(a);
              }}
            >
              {a.name.split("—")[0].trim()}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="request-dates">
        <label className="request-field">
          <span>{d.intake.checkin} <small className="muted">({d.intake.optional})</small></span>
          <input className="field" type="date" value={checkin} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setCheckin(e.target.value)} />
        </label>
        <label className="request-field">
          <span>{d.intake.checkout} <small className="muted">({d.intake.optional})</small></span>
          <input className="field" type="date" value={checkout} min={checkin || new Date().toISOString().slice(0, 10)} onChange={(e) => setCheckout(e.target.value)} />
        </label>
      </div>

      <button
        type="button"
        className="toggle-card"
        data-selected={flexible}
        onClick={() => setFlexible((v) => !v)}
        role="switch"
        aria-checked={flexible}
      >
        <div>
          <div>{d.intake.flexible}</div>
          <div className="muted">{d.intake.flexibleHint}</div>
        </div>
      </button>

      <fieldset className="request-group">
        <legend>{d.intake.party}</legend>
        <div className="request-steppers">
          <Stepper d={d} label={d.intake.adults} value={adults} min={1} onChange={setAdults} />
          <Stepper d={d} label={d.intake.children} value={children} min={0} onChange={setChildren} />
          <Stepper d={d} label={d.intake.rooms} value={rooms} min={1} onChange={setRooms} />
        </div>
      </fieldset>

      <fieldset className="request-group">
        <legend>{d.intake.standard}</legend>
        <div className="request-chips">
          {(Object.entries(d.intake.standardOptions) as [Standard, string][]).map(([key, label]) => (
            <button key={key} type="button" className="chip" data-selected={standard === key} aria-pressed={standard === key} onClick={() => setStandard(key)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="request-group">
        <legend>{d.intake.proximity}</legend>
        <div className="request-cards">
          {(Object.entries(d.intake.proximityOptions) as [Proximity, { label: string; hint: string }][]).map(([key, opt]) => (
            <button key={key} type="button" className="toggle-card" data-selected={proximity === key} aria-pressed={proximity === key} onClick={() => setProximity(key)}>
              <div>
                <div>{opt.label}</div>
                <div className="muted">{opt.hint}</div>
              </div>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="request-group">
        <legend>{d.intake.breakfast}</legend>
        <div className="request-chips">
          {(Object.entries(d.intake.breakfastOptions) as [Breakfast, string][]).map(([key, label]) => (
            <button key={key} type="button" className="chip" data-selected={breakfast === key} aria-pressed={breakfast === key} onClick={() => setBreakfast(key)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="request-group">
        <legend>{d.intake.accessibility}</legend>
        <div className="request-cards">
          <button type="button" className="toggle-card" data-selected={elderly} onClick={() => setElderly((v) => !v)} role="checkbox" aria-checked={elderly}>
            <div>
              <div>{d.intake.elderly.label}</div>
              <div className="muted">{d.intake.elderly.hint}</div>
            </div>
          </button>
          <button type="button" className="toggle-card" data-selected={wheelchair} onClick={() => setWheelchair((v) => !v)} role="checkbox" aria-checked={wheelchair}>
            <div>
              <div>{d.intake.wheelchair.label}</div>
              <div className="muted">{d.intake.wheelchair.hint}</div>
            </div>
          </button>
        </div>
      </fieldset>

      {/* ——— 2 · Your details (the concierge layer) ——— */}
      <p className="request-section-label">{d.intake.sectionDetails}</p>

      <fieldset className="request-group">
        <legend>{d.intake.interests}</legend>
        <div className="request-chips">
          {Object.values(d.intake.interestOptions).map((label) => (
            <button
              key={label}
              type="button"
              className="chip"
              data-selected={interests.includes(label)}
              aria-pressed={interests.includes(label)}
              onClick={() => setInterests((list) => (list.includes(label) ? list.filter((x) => x !== label) : [...list, label]))}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <label className="request-field">
        <span>{d.intake.name}</span>
        <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      {showWarning ? <p className="request-warning" role="alert">{showWarning}</p> : null}
      {saveError ? <p className="request-warning" role="alert">{saveError}</p> : null}

      <button type="button" className="btn btn-bronze request-cta" onClick={submit} disabled={submitting}>
        {submitting ? <span className="spinner" /> : null}
        {submitting ? d.intake.submitting : d.intake.cta}
      </button>
      <p className="muted request-privacy">{d.intake.privacy}</p>
    </div>
  );

  if (homepage) {
    return (
      <div className="home-layout" role="main">
        <div
          className="home-watermark"
          style={{ backgroundImage: `url(${BASE_URL}brand/hero-makkah.png)` }}
          aria-hidden="true"
        />
        <div className="home-container">
          <div className="home-editorial rise">
            <p className="eyebrow home-eyebrow">{d.intake.heroEyebrow}</p>
            <h1 className="home-title">
              {d.intake.heroTitle}{" "}
              <span className="home-title-highlight">{d.intake.heroTitleHighlight}</span>
            </h1>
            <p className="home-lede">{d.intake.heroLede}</p>
            <p className="home-trust">{d.intake.heroTrust}</p>
            <ul className="home-perks">
              <li className="home-perk">
                <span className="home-perk-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="5" />
                    <path d="M20 21a8 8 0 0 0-16 0" />
                  </svg>
                </span>
                <div>
                  <span className="home-perk-title">{d.intake.perks[0].title}</span>
                  <span className="home-perk-desc">{d.intake.perks[0].desc}</span>
                </div>
              </li>
              <li className="home-perk">
                <span className="home-perk-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
                    <path d="m15 9-6 6" />
                    <path d="M9 9h.01" />
                    <path d="M15 15h.01" />
                  </svg>
                </span>
                <div>
                  <span className="home-perk-title">{d.intake.perks[1].title}</span>
                  <span className="home-perk-desc">{d.intake.perks[1].desc}</span>
                </div>
              </li>
              <li className="home-perk">
                <span className="home-perk-icon">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </span>
                <div>
                  <span className="home-perk-title">{d.intake.perks[2].title}</span>
                  <span className="home-perk-desc">{d.intake.perks[2].desc}</span>
                </div>
              </li>
            </ul>
          </div>
          <section className="request-card rise" aria-label={d.intake.title}>
            {formContent}
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="request-modal-overlay">
      <div ref={modalRef} className="request-panel request-panel-modal" role="dialog" aria-modal="true" aria-label={d.intake.title}>
        <button type="button" className="request-close" onClick={() => onClose(area)} aria-label={d.common.close}>
          ✕
        </button>
        {formContent}
      </div>
    </div>
  );
}
