import type { ReactNode } from "react";

const ICON_PATHS: Record<string, string> = {
  places: "M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z M12 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  pulse: "M3 12h4l2-5 4 10 2-5h6",
  story: "M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4V5Z M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6V5Z",
  chat: "M20 15a3 3 0 0 1-3 3H9l-5 3v-6a3 3 0 0 1-1-2V7a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v8Z",
  spark: "M12 2.5 13.9 9l6.6 1.9-6.6 1.9L12 20l-1.9-7.2-6.6-1.9L10.1 9 12 2.5Z",
  memory: "M5 7a7 4 0 0 1 14 0v10a7 4 0 0 1-14 0V7Z M5 7a7 4 0 0 0 14 0 M5 12a7 4 0 0 0 14 0",
  locate: "M12 21s7-7.6 7-12a7 7 0 1 0-14 0c0 4.4 7 12 7 12Z M12 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
};

export function SurfaceIcon({ name }: { name: string }) {
  return (
    <svg className="surface-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name] ?? ICON_PATHS.places} />
    </svg>
  );
}

import type { Dictionary } from "../config/i18n";

export function StatusPill({
  label,
  value,
  onClick,
  active = false,
  ariaLabel,
}: {
  label: string;
  value?: string;
  onClick?: () => void;
  active?: boolean;
  ariaLabel?: string;
}) {
  const className = `status-pill${active ? " active" : ""}`;
  const content = (
    <>
      <span className="status-label">{label}</span>
      {value ? <span className="status-value">{value}</span> : null}
    </>
  );
  if (!onClick) return <span className={className}>{content}</span>;
  return (
    <button type="button" className={className} onClick={onClick} aria-label={ariaLabel ?? `${label}${value ? ` ${value}` : ""}`} aria-pressed={active}>
      {content}
    </button>
  );
}

export function MetaRow({ children, dir }: { children: ReactNode; dir?: "ltr" | "rtl" | "auto" }) {
  return <div className="meta-row" dir={dir}>{children}</div>;
}

export function SourceBadge({ label, sponsored = false }: { label: string; sponsored?: boolean }) {
  return <span className={`source-badge${sponsored ? " sponsored" : ""}`}>{label}</span>;
}

export function EmptyState({
  d,
  title,
  detail,
  actionLabel,
  onAction,
}: {
  d: Dictionary;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">◇</span>
      <strong>{title}</strong>
      {detail ? <p className="muted">{detail}</p> : null}
      {actionLabel && onAction ? (
        <button type="button" className="btn btn-ghost" onClick={onAction}>{actionLabel}</button>
      ) : null}
      <span className="sr-only">{d.common.loading}</span>
    </div>
  );
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className="action-bar">{children}</div>;
}
