import type { Dictionary } from "../config/i18n";
import type { SurfaceId } from "../config/surfaces";
import type { AreaPack } from "../sources/types";
import { KindFilter } from "./KindFilter";
import { StatusPill } from "./primitives";

export function StatusRail({
  d,
  pack,
  todLabel,
  clock,
  walking,
  walkingDistance,
  kindGroup,
  onKindGroup,
  onOpenAtmosphere,
  onOpenSurface,
}: {
  d: Dictionary;
  pack: AreaPack | null;
  todLabel: string;
  clock: string;
  walking: boolean;
  walkingDistance?: string;
  kindGroup: string | null;
  onKindGroup: (group: string | null) => void;
  onOpenAtmosphere: () => void;
  onOpenSurface: (surface: SurfaceId) => void;
}) {
  return (
    <div className="status-rail" role="group" aria-label={d.shell.status}>
      <KindFilter d={d} value={kindGroup} onChange={onKindGroup} />
      <StatusPill label={d.shell.atmosphere} value={`${clock} · ${todLabel}`} onClick={onOpenAtmosphere} ariaLabel={d.a11y.timeOfDay.replace("{clock}", clock).replace("{phase}", todLabel)} />
      {pack?.weather[0] ? (
        <StatusPill label={d.pulse.sources.weather} value={`${pack.weather[0].tempMaxC}°`} onClick={() => onOpenSurface("pulse")} />
      ) : null}
      {pack?.prayer[0] ? (
        <StatusPill label={d.pulse.sources.prayer} value={pack.prayer[0].asr} onClick={() => onOpenSurface("pulse")} />
      ) : null}
      {pack?.pulse.length ? (
        <StatusPill label={d.shell.live} value={String(pack.pulse.length)} onClick={() => onOpenSurface("pulse")} />
      ) : null}
      {walking ? (
        <StatusPill label={d.tabs.explore} value={walkingDistance ?? d.walk.album} onClick={() => onOpenSurface("explore")} active />
      ) : null}
    </div>
  );
}
