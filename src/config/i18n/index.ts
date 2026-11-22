import { en, type Dictionary } from "./en";
import { ar } from "./ar";

export type Locale = "en" | "ar";

const dictionaries: Record<Locale, Dictionary> = { en, ar };

export function dict(locale: Locale): Dictionary {
  return dictionaries[locale] ?? en;
}

export function applyDocumentLocale(locale: Locale): void {
  const d = dict(locale);
  document.documentElement.lang = d.locale;
  document.documentElement.dir = d.dir;
}

export type { Dictionary };
