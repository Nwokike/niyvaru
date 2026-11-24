import { KIND_GROUPS } from "../brand/tokens";
import type { Dictionary } from "../config/i18n";

/**
 * The place-kind filter, as one compact dropdown in the top rail.
 *
 * The option set is data: every group in KIND_GROUPS, labelled from the
 * dictionary, with "Everything" clearing the filter. No city, kind list or
 * label lives in this component.
 */
export function KindFilter({
  d,
  value,
  onChange,
}: {
  d: Dictionary;
  value: string | null;
  onChange: (group: string | null) => void;
}) {
  const groups = Object.keys(KIND_GROUPS);
  return (
    <select
      className="kind-filter"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={d.explore.layersToggle}
    >
      <option value="">{d.explore.layers.all}</option>
      {groups.map((group) => (
        <option key={group} value={group}>
          {(d.explore.layers as Record<string, string>)[group] ?? group}
        </option>
      ))}
    </select>
  );
}
