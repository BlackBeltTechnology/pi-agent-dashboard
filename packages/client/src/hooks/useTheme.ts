import { useState, useEffect, useCallback } from "react";
import { getTheme, CSS_VAR_KEYS } from "../lib/theme/themes.js";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dashboard:theme";
const THEME_NAME_KEY = "dashboard:theme-name";

function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch { /* noop */ }
  return "system";
}

function readThemeName(): string {
  try {
    const raw = localStorage.getItem(THEME_NAME_KEY);
    if (raw && getTheme(raw)) return raw;
  } catch { /* noop */ }
  return "base";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") return getSystemTheme();
  return pref;
}

function applyMode(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  if (resolved === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

/** Apply theme CSS variables. For "base", remove inline overrides so CSS takes over. */
export function applyThemeVars(themeName: string, resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;

  if (themeName === "base") {
    // Remove all inline variable overrides — let CSS handle it
    for (const key of CSS_VAR_KEYS) {
      el.style.removeProperty(key);
    }
    return;
  }

  const theme = getTheme(themeName);
  if (!theme) return;

  const vars = resolved === "light" ? theme.light : theme.dark;
  for (const key of CSS_VAR_KEYS) {
    const value = vars[key];
    if (value) {
      el.style.setProperty(key, value);
    }
  }
}

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  themeName: string;
  setPreference: (pref: ThemePreference) => void;
  setThemeName: (name: string) => void;
}

export function useTheme(): ThemeState {
  const [preference, setPreferenceRaw] = useState<ThemePreference>(readPreference);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readPreference()));
  const [themeName, setThemeNameRaw] = useState<string>(readThemeName);

  const setPreference = useCallback((pref: ThemePreference) => {
    setPreferenceRaw(pref);
    try { localStorage.setItem(STORAGE_KEY, pref); } catch { /* noop */ }
    const r = resolveTheme(pref);
    setResolved(r);
    applyMode(r);
    // Re-apply theme vars for new mode
    setThemeNameRaw((current) => {
      applyThemeVars(current, r);
      return current;
    });
  }, []);

  const setThemeName = useCallback((name: string) => {
    setThemeNameRaw(name);
    try { localStorage.setItem(THEME_NAME_KEY, name); } catch { /* noop */ }
    applyThemeVars(name, resolveTheme(preference));
  }, [preference]);

  // Listen for OS theme changes when in system mode
  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = resolveTheme("system");
      setResolved(r);
      applyMode(r);
      applyThemeVars(themeName, r);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [preference, themeName]);

  // Apply on mount
  useEffect(() => {
    applyMode(resolved);
    applyThemeVars(themeName, resolved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { preference, resolved, themeName, setPreference, setThemeName };
}

export { STORAGE_KEY, THEME_NAME_KEY };
