/**
 * `render` wrapped in the providers most client components assume: a default `ThemeProvider`
 * (with a `window.matchMedia` shim, which jsdom lacks and `useTheme` reads on mount).
 *
 * Use it instead of hand-rolling a wrapper, so a component that calls `useThemeContext()` never
 * throws "must be used within ThemeProvider" because an earlier file happened to leave a provider
 * or a `matchMedia` stub behind. The original `matchMedia` is restored by `restore-globals.ts`.
 *
 * See change: test-trust-audit (design D6).
 */
import { type RenderOptions, type RenderResult, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ThemeProvider } from "../components/settings/ThemeProvider.js";

function ensureMatchMedia(): void {
  if (typeof window.matchMedia === "function") return;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

export function renderWithProviders(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">): RenderResult {
  ensureMatchMedia();
  return render(ui, { ...options, wrapper: ThemeProvider });
}
