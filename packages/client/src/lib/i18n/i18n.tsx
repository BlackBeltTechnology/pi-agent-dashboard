import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { logRejection } from "../report-error.js";

export type Language = "en" | "zh-CN" | "hu";

const STORAGE_KEY = "pi-dashboard-language";

export const LANGUAGE_OPTIONS: Array<{ value: Language; label: string }> = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
  { value: "hu", label: "Magyar" },
];

export const normalizeLanguage = (value: string | null | undefined): Language | null => {
  if (!value) return null;
  const v = value.toLowerCase();
  if (v === "zh" || v === "zh-cn" || v.startsWith("zh-hans")) return "zh-CN";
  if (v === "hu" || v === "hu-hu" || v.startsWith("hu-")) return "hu";
  if (v === "en" || v.startsWith("en-")) return "en";
  return null;
};

const envDefaultLanguage = normalizeLanguage((import.meta as any).env?.VITE_PI_DASHBOARD_DEFAULT_LANGUAGE);

export const detectInitialLanguage = (): Language => {
  try {
    const stored = normalizeLanguage(window.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* ignore storage access failures */
  }
  if (envDefaultLanguage) return envDefaultLanguage;
  const browserLanguage = normalizeLanguage(window.navigator.language);
  return browserLanguage ?? "en";
};

const en: Record<string, string> = {};

/**
 * Non-English core catalogs are NOT imported statically: each is a separate
 * chunk fetched by `loadCatalog`. The dictionaries start empty so
 * `registerPluginCatalog` can write plugin keys at any time (before or after
 * the core catalog arrives — distinct `plugin.<id>.` prefix, so the merge
 * order cannot matter). See change: shrink-client-entry-lazy-islands.
 */
const dictionaries: Record<Language, Record<string, string>> = {
  en,
  "zh-CN": {},
  hu: {},
};

const catalogLoads = new Map<Language, Promise<void>>();

function importCatalog(lang: Language): Promise<Record<string, string>> {
  if (lang === "zh-CN") return import("./i18n-zh-CN.js").then((m) => m.zhCNCatalog);
  return import("./i18n-hu.js").then((m) => m.huCatalog);
}

/**
 * Load a language's core catalog once per page. `en` needs none. Never
 * rejects: a failed load is logged and leaves the dictionary without core keys,
 * so `t()` falls back to the English call-site text; the memo is dropped so a
 * later language switch can retry.
 */
export function loadCatalog(lang: Language): Promise<void> {
  if (lang === "en") return Promise.resolve();
  const memo = catalogLoads.get(lang);
  if (memo) return memo;
  const load = importCatalog(lang).then(
    (catalog) => {
      Object.assign(dictionaries[lang], catalog);
    },
    (e: unknown) => {
      catalogLoads.delete(lang);
      console.error(`[pi-dashboard] failed to load the ${lang} catalog:`, e);
    },
  );
  catalogLoads.set(lang, load);
  return load;
}

/**
 * LEGACY_ALIASES maps deprecated keys (old `auto.*` and flat legacy keys) to
 * their structured replacement. Resolved transparently by the translator so
 * call sites can migrate incrementally. Emptied once all call sites use
 * structured keys. See ./i18n-legacy-aliases.
 */
export { LEGACY_ALIASES } from "./i18n-legacy-aliases.js";

import { LEGACY_ALIASES } from "./i18n-legacy-aliases.js";

/**
 * Merge a plugin's translation catalog into the active dictionaries under a
 * `plugin.<id>.` namespace so plugin keys cannot collide with core keys or with
 * another plugin. Keys are authored unprefixed by the plugin; the runtime adds
 * the prefix here. Idempotent per key; safe to call again on language change.
 */
export function registerPluginCatalog(
  id: string,
  catalog: Partial<Record<Language, Record<string, string>>> | undefined | null,
): void {
  if (!catalog) return;
  for (const lang of Object.keys(catalog) as Language[]) {
    const block = catalog[lang];
    if (!block || !dictionaries[lang]) continue;
    const target = dictionaries[lang];
    for (const [k, v] of Object.entries(block)) {
      target[`plugin.${id}.${k}`] = v;
    }
  }
}

// <reserved-label-translations:begin> generated — `node scripts/i18n-parity.mjs --fix`
// Built-in settings-nav labels (the `BUILT_IN_SETTINGS_LABELS` keys in
// lib/settings-promotions.ts) in every non-English shipped locale, [zh-CN, hu].
// Static so the reserved-label collision rule never depends on which catalog
// happens to be loaded. Drift against the catalogs fails `npm run i18n:parity`.
export const RESERVED_LABEL_TRANSLATIONS: Readonly<Record<string, readonly string[]>> = {
  "settings.groupModels": ["模型", "Modellek"],
  "settings.groupDashboard": ["仪表板", "Irányítópult"],
  "settings.groupNetwork": ["网络", "Hálózat"],
  "settings.groupPi": ["pi", "pi"],
  "settings.piSettingsPage": ["pi 设置", "pi beállítások"],
  "settings.groupServices": ["服务", "Szolgáltatások"],
  "settings.groupAddons": ["附加组件", "Kiegészítők"],
  "settings.groupResources": ["资源", "Erőforrások"],
  "settings.groupAdvanced": ["高级", "Speciális"],
  "settings.general": ["常规", "Általános"],
  "common.server": ["服务器", "Szerver"],
  "settings.sessions": ["会话", "Munkamenetek"],
  "settings.remoteServers": ["远程服务器", "Távoli szerverek"],
  "settings.gateway": ["网关", "Gateway"],
  "settings.security": ["安全", "Biztonság"],
  "settings.access": ["访问控制", "Hozzáférés"],
  "settings.providers": ["提供商", "Szolgáltatók"],
  "settings.vault": ["密钥库", "Széf"],
  "settings.addons": ["附加组件", "Kiegészítők"],
  "settings.plugins": ["插件", "Bővítmények"],
  "settings.openspec": ["OpenSpec", "OpenSpec"],
  "settings.services": ["所有服务", "Összes szolgáltatás"],
  "settings.runtimes": ["运行时", "Futtatókörnyezetek"],
  "common.skills": ["技能", "Skillek"],
  "common.agents": ["代理", "Ügynökök"],
  "packages.extensions": ["扩展", "Bővítmények"],
  "session.prompts": ["提示词", "Kérések"],
  "common.themes": ["主题", "Témák"],
  "settings.developer": ["开发者", "Fejlesztő"],
  "common.instructions": ["说明", "Utasítások"],
};
// <reserved-label-translations:end>

/**
 * Every shipped-locale translation of a built-in settings label key (locales
 * lacking it are skipped). Locale-independent AND independent of which lazy
 * catalogs are loaded: reads the static `RESERVED_LABEL_TRANSLATIONS` table.
 * See changes: promote-model-roles-settings, shrink-client-entry-lazy-islands.
 */
export function translationsOf(key: string): string[] {
  return [...(RESERVED_LABEL_TRANSLATIONS[key] ?? [])];
}

type Vars = Record<string, string | number>;

// Module-level current language singleton. Kept in sync by I18nProvider so the
// standalone `t()` below works outside React components (helpers, event
// handlers, toast/error calls). Provider re-renders its subtree on language
// change, so module-level reads pick up the new value on the next render.
let currentLanguage: Language = detectInitialLanguage();

const interpolate = (template: string, vars?: Vars) => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
};

/**
 * Standalone translator usable anywhere (no hook required). Reads the current
 * language singleton. Inside components prefer `useI18n().t` for clarity, but
 * this is equivalent and required for non-component code.
 */
export function t(key: string, vars?: Vars, fallback?: string): string {
  const resolved = LEGACY_ALIASES[key] ?? key;
  const template = dictionaries[currentLanguage][resolved] ?? fallback ?? key;
  return interpolate(template, vars);
}

interface I18nContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Vars, fallback?: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const fallbackI18n: I18nContextValue = {
  language: "en",
  setLanguage: () => {},
  t: (_key, vars, fallback) => {
    const template = fallback ?? _key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
  },
};

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(detectInitialLanguage);
  // Latest requested language: a slower earlier load must not overwrite a newer pick.
  const requestedLanguage = useRef<Language>(language);
  const setLanguage = useCallback((next: Language) => {
    requestedLanguage.current = next;
    // Load first, apply after: the UI flips once, already translated.
    void loadCatalog(next)
      .then(() => {
        if (requestedLanguage.current === next) setLanguageState(next);
      })
      .catch(logRejection("I18nProvider.setLanguage"));
  }, []);

  // Keep the module-level singleton in sync synchronously during render so
  // standalone `t()` calls in this subtree read the active language.
  currentLanguage = language;

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      /* ignore storage access failures */
    }
  }, [language]);

  const value = useMemo<I18nContextValue>(() => {
    const translate = (key: string, vars?: Vars, fallback?: string) => {
      const resolved = LEGACY_ALIASES[key] ?? key;
      const template = dictionaries[language][resolved] ?? fallback ?? key;
      return interpolate(template, vars);
    };
    return {
      language,
      setLanguage,
      t: translate,
    };
  }, [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  return context ?? fallbackI18n;
}
