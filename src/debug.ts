/**
 * Debug logging — always-on for failures, opt-in verbose via
 * localStorage.niyvaruDebug = "1". Failures log even when verbose is off:
 * a silent failure is the same as a hidden bug.
 */

const enabled = (): boolean => {
  try {
    return localStorage.getItem("niyvaruDebug") === "1";
  } catch {
    return false;
  }
};

const tag = (scope: string): string[] => [`%c[niyvaru:${scope}]`, "color:#96682f;font-weight:600"];

export function debugLog(scope: string, ...args: unknown[]): void {
  if (!enabled()) return;
  console.info(...tag(scope), ...args);
}

export function debugWarn(scope: string, ...args: unknown[]): void {
  if (!enabled()) return;
  console.warn(...tag(scope), ...args);
}

/** Failures are always logged — never swallowed. */
export function debugError(scope: string, ...args: unknown[]): void {
  console.error(...tag(scope), ...args);
}

export function debugTime(scope: string, label: string): () => void {
  if (!enabled()) return () => {};
  const start = performance.now();
  return () => console.info(...tag(scope), `${label}: ${Math.round(performance.now() - start)}ms`);
}
