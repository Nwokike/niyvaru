import type { Dictionary } from "../config/i18n";
import { DOCK_SURFACES, type Detent, type SurfaceId } from "../config/surfaces";
import { SurfaceIcon } from "./primitives";

export function SurfaceDock({
  d,
  surface,
  detent,
  counts,
  walking,
  surfaceId,
  onSelect,
  onSetDetent,
}: {
  d: Dictionary;
  surface: SurfaceId;
  detent: Detent;
  counts: Partial<Record<SurfaceId, number>>;
  walking: boolean;
  surfaceId: string;
  onSelect: (surface: SurfaceId, detent?: Detent) => void;
  onSetDetent: (detent: Detent) => void;
}) {
  return (
    <nav className="surface-dock" role="tablist" aria-label={d.shell.expand}>
      <div className="dock-detents" role="group" aria-label={d.shell.expand}>
        {(["peek", "half", "full"] as Detent[]).map((value) => (
          <button
            key={value}
            type="button"
            className="dock-detent"
            aria-pressed={detent === value}
            aria-label={d.shell[value]}
            onClick={() => onSetDetent(value)}
          >
            <span aria-hidden="true">{value === "peek" ? "—" : value === "half" ? "＝" : "≣"}</span>
          </button>
        ))}
      </div>
      <div className="dock-tabs">
        {DOCK_SURFACES.map((def) => {
          const count = counts[def.id];
          return (
            <button
              key={def.id}
              type="button"
              role="tab"
              aria-controls={surfaceId}
              aria-selected={surface === def.id || (walking && def.id === "explore")}
              className="dock-tab"
              data-active={surface === def.id}
              onClick={() => onSelect(def.id, def.defaultDetent)}
            >
              <span className="dock-icon" aria-hidden="true"><SurfaceIcon name={def.icon} /></span>
              <span className="dock-label">{def.label(d)}</span>
              {count != null && count > 0 ? <span className="dock-count">{count}</span> : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
