/**
 * App i18n: HU default, EN toggle, identical key sets. Language comes from the
 * host (`host.i18n`), so embedded follows the dashboard and standalone follows
 * its own toggle. See change: add-team-plugin (D10/D16).
 */
import { useAppHost, useHostValue } from "@blackbelt-technology/pi-dashboard-app-kit/react";
import { useCallback } from "react";
import { CATALOG, type CatalogKey, type Lang } from "./catalog.js";

export type TFn = (key: CatalogKey, vars?: Record<string, string | number>) => string;

export function normaliseLang(l: string | undefined): Lang {
  return l?.toLowerCase().startsWith("en") ? "en" : "hu";
}

export function translate(lang: string, key: CatalogKey, vars?: Record<string, string | number>): string {
  const table = CATALOG[normaliseLang(lang)] as Record<string, string>;
  const s = table[key] ?? (CATALOG.en as Record<string, string>)[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, v: string) => String(vars[v] ?? `{${v}}`)) : s;
}

export function useT(): TFn {
  const host = useAppHost();
  const lang = useHostValue(host.i18n.subscribe, host.i18n.language);
  return useCallback<TFn>((key, vars) => translate(lang, key, vars), [lang]);
}

/** Relative time label: now / N min / N h / N d (from an ISO stamp). */
export function relativeTime(t: TFn, iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return t("time.now");
  if (min < 60) return t("time.min", { n: min });
  if (min < 1440) return t("time.hour", { n: Math.round(min / 60) });
  return t("time.day", { n: Math.round(min / 1440) });
}
