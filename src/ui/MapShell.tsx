import type { ReactNode } from "react";
import type { Dictionary } from "../config/i18n";
import type { SurfaceId } from "../config/surfaces";
import type { AreaPack } from "../sources/types";
import type { ShellState } from "../state/shell";
import { StatusRail } from "./StatusRail";
import { SurfaceIcon } from "./primitives";
import { SurfaceDock } from "./SurfaceDock";

export function MapShell({
  d,
  shell,
  metaName,
  pack,
  todLabel,
  clock,
  walking,
  walkingDistance,
  notice,
  counts,
  locale,
  kindGroup,
  onKindGroup,
  onLocale,
  onOpenSearch,
  onLocate,
  onOpenAtmosphere,
  onOpenSurface,
  onSetDetent,
  onDismissNotice,
  children,
}: {
  d: Dictionary;
  shell: ShellState;
  metaName: string;
  pack: AreaPack | null;
  todLabel: string;
  clock: string;
  walking: boolean;
  walkingDistance?: string;
  notice: string;
  counts: Partial<Record<SurfaceId, number>>;
  locale: "en" | "ar";
  kindGroup: string | null;
  onKindGroup: (group: string | null) => void;
  onLocale: (locale: "en" | "ar") => void;
  onOpenSearch: () => void;
  onLocate: () => void;
  onOpenAtmosphere: () => void;
  onOpenSurface: (surface: SurfaceId) => void;
  onSetDetent: (detent: ShellState["detent"]) => void;
  onDismissNotice: () => void;
  children: ReactNode;
}) {
  const surfaceLabel = shell.surface === "memory" ? d.tabs.memory : d.tabs[shell.surface];

  return (
    <div className="map-shell">
      <header className="command-rail">
        <button type="button" className="command-search" onClick={onOpenSearch} aria-label={d.shell.search}>
          <span className="command-mark" aria-hidden="true">ن</span>
          <span className="command-place">{metaName || d.shell.search}</span>
          <span className="command-action">{d.shell.search}</span>
        </button>
        <button type="button" className="command-ask" onClick={() => onOpenSurface("agent")} aria-label={`${d.shell.ask} ${d.tabs.agent}`}>
          <span aria-hidden="true"><SurfaceIcon name="spark" /></span>
          <span>{d.shell.ask}</span>
        </button>
        <StatusRail
          d={d}
          pack={pack}
          todLabel={todLabel}
          clock={clock}
          walking={walking}
          walkingDistance={walkingDistance}
          kindGroup={kindGroup}
          onKindGroup={onKindGroup}
          onOpenAtmosphere={onOpenAtmosphere}
          onOpenSurface={onOpenSurface}
        />
        <button type="button" className="command-locate" onClick={onLocate} aria-label={d.shell.locate} title={d.shell.locate}>
          <span aria-hidden="true"><SurfaceIcon name="locate" /></span>
          <span>{d.shell.locate}</span>
        </button>
        <button type="button" className="command-you" onClick={() => onOpenSurface("memory")} aria-label={d.shell.you}>
          <span aria-hidden="true"><SurfaceIcon name="memory" /></span>
          <span>{d.shell.you}</span>
        </button>
        <select
          className="command-lang"
          value={locale}
          onChange={(e) => onLocale(e.target.value as "en" | "ar")}
          aria-label="Language / اللغة"
        >
          <option value="en">EN</option>
          <option value="ar">ع</option>
        </select>
      </header>

      {notice ? (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button type="button" className="notice-dismiss" onClick={onDismissNotice} aria-label={d.common.dismiss}>✕</button>
        </div>
      ) : null}

      <section
        className="surface"
        data-surface={shell.surface}
        data-detent={shell.detent}
        id="active-surface"
        role="region"
        aria-label={surfaceLabel}
      >
        <button
          type="button"
          className="surface-grab"
          onClick={() => onSetDetent(shell.detent === "peek" ? "half" : shell.detent === "half" ? "full" : "peek")}
          aria-label={`${surfaceLabel}: ${d.shell[shell.detent]}`}
        >
          <span aria-hidden="true" />
          <span>{surfaceLabel} · {d.shell[shell.detent]}</span>
        </button>
        <div className="surface-body">{children}</div>
      </section>

      <SurfaceDock
        d={d}
        surface={shell.surface}
        detent={shell.detent}
        counts={counts}
        walking={walking}
        surfaceId="active-surface"
        onSelect={onOpenSurface}
        onSetDetent={onSetDetent}
      />
    </div>
  );
}
