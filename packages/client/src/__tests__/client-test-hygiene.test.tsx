/**
 * Shared client-test hygiene (test-plan F4, F5): the globals the suite is known to replace are
 * put back, and `renderWithProviders` supplies a default ThemeProvider.
 *
 * See change: test-trust-audit (design D6).
 */
import { screen } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import { useThemeContext } from "../components/settings/ThemeProvider.js";
import { renderWithProviders } from "../test-support/renderWithProviders.js";
import { restoreGlobals } from "../test-support/restore-globals.js";

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;

afterAll(() => {
  // Leave this file's own replacements out of the worker's environment.
  restoreGlobals();
});

describe("restoreGlobals (F4)", () => {
  it("puts back a replaced localStorage, a stubbed getBoundingClientRect and a stubbed matchMedia", () => {
    Object.defineProperty(globalThis, "localStorage", { value: { stub: true }, configurable: true, writable: true });
    Element.prototype.getBoundingClientRect = () => ({ width: 1 }) as DOMRect;
    const priorMatchMedia = window.matchMedia;
    window.matchMedia = (() => ({ matches: true })) as unknown as typeof window.matchMedia;

    expect(typeof localStorage.clear).not.toBe("function");
    restoreGlobals();

    expect(typeof localStorage.clear).toBe("function");
    expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(originalLocalStorage);
    expect(Element.prototype.getBoundingClientRect).toBe(originalGetBoundingClientRect);
    expect(window.matchMedia).toBe(priorMatchMedia);
  });

  it("clears storage contents a test left behind", () => {
    localStorage.setItem("leak", "1");
    sessionStorage.setItem("leak", "1");
    restoreGlobals();
    expect(localStorage.getItem("leak")).toBeNull();
    expect(sessionStorage.getItem("leak")).toBeNull();
  });
});

function ThemeProbe() {
  const { theme } = useThemeContext() as unknown as { theme?: string };
  return <div data-testid="probe">{typeof theme === "string" ? theme : "default"}</div>;
}

describe("renderWithProviders (F5)", () => {
  it("supplies a default ThemeProvider (and matchMedia) so useThemeContext does not throw", () => {
    expect(() => renderWithProviders(<ThemeProbe />)).not.toThrow();
    expect(screen.getByTestId("probe")).toBeTruthy();
  });
});
