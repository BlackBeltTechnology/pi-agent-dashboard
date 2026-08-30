import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme, STORAGE_KEY, THEME_NAME_KEY } from "../useTheme.js";

// vitest runs the suite against ONE `--localstorage-file` shared by every
// worker process, so this file's storage handling is visible to every other
// client test file. `localStorage.clear()` would wipe a CONCURRENT suite's
// keys (it flaked useFolderUrgencySort), and the `light` / `github` values the
// cases below persist would decide the theme other suites resolve
// (it flaked editor-pane/theme-follow). Touch only the two keys this file owns,
// and hand them back clean.
function dropOwnKeys() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(THEME_NAME_KEY);
  } catch {
    /* storage unavailable */
  }
}

afterEach(dropOwnKeys);

beforeEach(() => {
  dropOwnKeys();
  document.documentElement.removeAttribute("data-theme");
  // Clear any inline style properties
  for (const prop of [...document.documentElement.style]) {
    document.documentElement.style.removeProperty(prop);
  }
  // Default matchMedia to dark
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

describe("useTheme", () => {
  it("defaults to system preference", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
  });

  it("resolves system to dark when OS is dark", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("dark");
  });

  it("resolves system to light when OS is light", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query !== "(prefers-color-scheme: dark)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("light");
  });

  it("reads persisted preference from localStorage", () => {
    localStorage.setItem(STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("light");
    expect(result.current.resolved).toBe("light");
  });

  it("persists preference to localStorage on change", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
    expect(result.current.preference).toBe("dark");
    expect(result.current.resolved).toBe("dark");
  });

  it("sets data-theme attribute for light mode", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes data-theme attribute for dark mode", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("handles invalid localStorage value gracefully", () => {
    localStorage.setItem(STORAGE_KEY, "garbage");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
  });

  // Theme name tests

  it("defaults theme name to base", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("base");
  });

  it("reads persisted theme name from localStorage", () => {
    localStorage.setItem(THEME_NAME_KEY, "dracula");
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("dracula");
  });

  it("falls back to base for unknown theme name", () => {
    localStorage.setItem(THEME_NAME_KEY, "nonexistent");
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeName).toBe("base");
  });

  it("persists theme name to localStorage on change", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setThemeName("nord"));
    expect(localStorage.getItem(THEME_NAME_KEY)).toBe("nord");
    expect(result.current.themeName).toBe("nord");
  });

  it("applies CSS variables for non-base theme", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setThemeName("dracula"));
    const bg = document.documentElement.style.getPropertyValue("--bg-primary");
    expect(bg).toBe("#282a36");
  });

  it("removes CSS variable overrides when switching back to base", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setThemeName("dracula"));
    expect(document.documentElement.style.getPropertyValue("--bg-primary")).toBe("#282a36");

    act(() => result.current.setThemeName("base"));
    expect(document.documentElement.style.getPropertyValue("--bg-primary")).toBe("");
  });

  it("re-applies theme vars when mode changes", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setThemeName("github"));
    act(() => result.current.setPreference("light"));
    const bg = document.documentElement.style.getPropertyValue("--bg-primary");
    expect(bg).toBe("#ffffff");
  });
});
