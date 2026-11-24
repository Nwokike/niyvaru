/**
 * Phone-local time utilities.
 *
 * The map's atmosphere follows the user's device clock, not the destination
 * clock. Destination prayer times remain physically correct and separately
 * labelled in the UI.
 */

export function localHourNow(now = new Date()): number {
  return now.getHours() + now.getMinutes() / 60;
}

export function localClock(now = new Date()): string {
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function localTimeZone(): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Re-sample local time when the phone returns from background or timezone changes. */
export function subscribeLocalTime(cb: () => void): () => void {
  const onVisible = (): void => { if (!document.hidden) cb(); };
  window.addEventListener("focus", cb);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("focus", cb);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
