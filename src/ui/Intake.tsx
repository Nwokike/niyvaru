import { useState } from "react";
import type { Dictionary } from "../config/i18n";
import { writeFile } from "../memory/store";
import { searchAreas } from "../area/store";
import type { AreaMeta } from "../sources/types";

/**
 * The request form — a faithful copy of the original niyvaru.eu form
 * (one page, "1 Your stay / 2 Your details", chips, steppers, toggle-cards),
 * with the concierge improvements layered on top. The map stays visible
 * behind the panel. Everything the traveller answers is written straight
 * into the agent's memory files.
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
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-controls">
        <button type="button" className="stepper-btn" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Fewer ${label}`}>
          −
        </button>
        <span className="stepper-value">{value}</span>
        <button type="button" className="stepper-btn" onClick={() => onChange(value + 1)} aria-label={`More ${label}`}>
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
  onPickArea,
  onClose,
}: {
  d: Dictionary;
  area: AreaMeta | null;
  areas: AreaMeta[];
  locale: "en" | "ar";
  onPickArea: (meta: AreaMeta) => void;
  onClose: () => void;
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
  const [showDatesWarning, setShowDatesWarning] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<AreaMeta[] | null>(null);

  const finish = async (): Promise<void> => {
    const language = locale === "ar" ? "Arabic" : "English";
    try {
      await writeFile(
        "/memories/traveller.md",
        travellerMarkdown({ name, adults, children, rooms, standard, proximity, breakfast, elderly, wheelchair, interests, language })
      );
      const current = areas.find((a) => a.id === stay) ?? area;
      await writeFile(
        "/memories/trip.md",
        tripMarkdown({
          areaName: current?.name ?? area?.name ?? "not chosen yet",
          country: current?.country ?? area?.country,
          checkin,
          checkout,
          flexible,
        })
      );
    } finally {
      onClose();
    }
  };

  const runSearch = async (): Promise<void> => {
    const q = search.trim();
    if (q.length < 2 || searching) return;
    setSearching(true);
    try {
      const found = await searchAreas(q);
      setSearchResults(found);
    } catch {
      setSearchResults(null);
    } finally {
      setSearching(false);
    }
  };

  const submit = (): void => {
    if (!checkin || !checkout) {
      setShowDatesWarning(true);
      return;
    }
    void finish();
  };

  return (
    <div className="request-panel" role="dialog" aria-label={d.intake.title}>
      {!area ? (
        <img className="request-hero" src="/brand/hero-makkah.png" alt="" />
      ) : null}
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
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
          />
          {searching ? <span className="spinner" /> : null}
        </div>
        {searchResults?.length ? (
          <div className="request-chips">
            {searchResults.map((r) => (
              <button
                key={r.id}
                type="button"
                className="chip"
                data-selected={r.id === stay}
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
        <div className="request-chips">
          {(areas.length ? areas : area ? [area] : []).map((a) => (
            <button
              key={a.id}
              type="button"
              className="chip"
              data-selected={a.id === stay}
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
          <span>{d.intake.checkin}</span>
          <input className="field" type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)} />
        </label>
        <label className="request-field">
          <span>{d.intake.checkout}</span>
          <input className="field" type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)} />
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
          <Stepper label={d.intake.adults} value={adults} min={1} onChange={setAdults} />
          <Stepper label={d.intake.children} value={children} min={0} onChange={setChildren} />
          <Stepper label={d.intake.rooms} value={rooms} min={1} onChange={setRooms} />
        </div>
      </fieldset>

      <fieldset className="request-group">
        <legend>{d.intake.standard}</legend>
        <div className="request-chips">
          {(Object.entries(d.intake.standardOptions) as [Standard, string][]).map(([key, label]) => (
            <button key={key} type="button" className="chip" data-selected={standard === key} onClick={() => setStandard(key)}>
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="request-group">
        <legend>{d.intake.proximity}</legend>
        <div className="request-cards">
          {(Object.entries(d.intake.proximityOptions) as [Proximity, { label: string; hint: string }][]).map(([key, opt]) => (
            <button key={key} type="button" className="toggle-card" data-selected={proximity === key} onClick={() => setProximity(key)}>
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
            <button key={key} type="button" className="chip" data-selected={breakfast === key} onClick={() => setBreakfast(key)}>
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

      {showDatesWarning ? <p className="request-warning">{d.intake.datesRequired}</p> : null}

      <button type="button" className="btn btn-bronze request-cta" onClick={submit}>
        {d.intake.cta}
      </button>
      <p className="muted request-privacy">{d.intake.privacy}</p>
      </div>
    </div>
  );
}
