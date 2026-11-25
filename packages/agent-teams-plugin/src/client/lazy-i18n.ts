/**
 * Translator for the lazy modules (design D9, task 9.5): every lazy module owns its
 * en / zh-CN / hu table and picks the locale with the runtime's `useLanguage()`, so
 * none of these strings lands in the eager catalog (cold-chunk budget). No strings
 * live here. A missing key falls back to the `en` text, never to the raw key.
 * See change: add-agent-teams-ui.
 */
import { useLanguage } from "@blackbelt-technology/dashboard-plugin-runtime";
import { useMemo } from "react";

export type Locale = "en" | "zh-CN" | "hu";
type Table = Readonly<Record<string, string>>;
export interface Tables {
  en: Table;
  "zh-CN": Table;
  hu: Table;
}
export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** `zh`, `zh-Hans`, `hu-HU` … → the closest shipped locale; anything else is English. */
export function resolveLocale(language: string | undefined): Locale {
  const lang = (language ?? "en").toLowerCase();
  if (lang === "zh-cn" || lang.startsWith("zh")) return "zh-CN";
  if (lang.startsWith("hu")) return "hu";
  return "en";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

export function makeTranslate(tables: Tables, language: string | undefined): Translate {
  const table = tables[resolveLocale(language)];
  return (key, vars) => interpolate(table[key] ?? tables.en[key] ?? key, vars);
}

/** Hook form: the module's translator for the active UI language. */
export function useLazyT(tables: Tables): Translate {
  const language = useLanguage();
  return useMemo(() => makeTranslate(tables, language), [tables, language]);
}
