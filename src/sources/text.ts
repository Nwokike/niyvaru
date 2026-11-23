/**
 * Small, dependency-free helpers for text/URL normalization shared by the UI.
 * OSM `website` tags are free-form: they may be bare domains, missing a
 * scheme, or simply malformed. Nothing here may throw on user/source data.
 */

const SAFE_PROTOCOLS = new Set(["http:", "https:"]);

function toHttpUrl(raw: string | undefined): URL | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  // A leading "//host" is protocol-relative, not a scheme — strip it first.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;
  try {
    const url = new URL(candidate);
    if (!SAFE_PROTOCOLS.has(url.protocol) || !url.hostname) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** Normalize a website tag to a safe http(s) URL, or undefined if unusable. */
export function safeWebsiteUrl(raw: string | undefined): string | undefined {
  return toHttpUrl(raw)?.href;
}

/** Display label for a website tag; never throws, even on malformed input. */
export function safeWebsiteHost(raw: string | undefined): string | undefined {
  return toHttpUrl(raw)?.host;
}
