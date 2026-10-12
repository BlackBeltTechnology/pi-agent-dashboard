import { renderHook } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileProvider, useMobile } from "../useMobile.js";

/**
 * Mocks `window.matchMedia` so it answers any query string the way a browser
 * with the given viewport (vw, vh) would: parses `(max-width: Npx)` and
 * `(max-height: Npx)` clauses, treats commas as OR. This mirrors what
 * `useMediaQuery` consumes — the comma-OR semantics is the actual contract
 * we want to pin in `useMobile`.
 */
function installMatchMediaForViewport(vw: number, vh: number): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const clauses = query.split(",").map((c) => c.trim());
      const matches = clauses.some((clause) => {
        const w = clause.match(/\(\s*max-width:\s*(\d+)px\s*\)/);
        if (w) return vw <= Number(w[1]);
        const h = clause.match(/\(\s*max-height:\s*(\d+)px\s*\)/);
        if (h) return vh <= Number(h[1]);
        return false;
      });
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  return <MobileProvider>{children}</MobileProvider>;
}

describe("useMobile — width-or-height predicate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("portrait phone (375x812) is mobile (width arm)", () => {
    installMatchMediaForViewport(375, 812);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(true);
  });

  it("landscape phone (844x390) is mobile (height arm) — the iPhone 14 case", () => {
    installMatchMediaForViewport(844, 390);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(true);
  });

  it("landscape phone (915x412) is mobile (height arm) — the Pixel 8 case", () => {
    installMatchMediaForViewport(915, 412);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(true);
  });

  it("tablet portrait (768x1024) is NOT mobile", () => {
    installMatchMediaForViewport(768, 1024);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(false);
  });

  it("tablet landscape (1024x768) is NOT mobile", () => {
    installMatchMediaForViewport(1024, 768);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(false);
  });

  it("desktop (1440x900) is NOT mobile", () => {
    installMatchMediaForViewport(1440, 900);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(false);
  });

  it("desktop short window (1200x500) flips to mobile (documented side effect)", () => {
    // Pinned regression: shrinking a desktop window vertically below 600px
    // intentionally enters mobile mode. See design.md decision 1 alternatives.
    installMatchMediaForViewport(1200, 500);
    const { result } = renderHook(() => useMobile(), { wrapper });
    expect(result.current).toBe(true);
  });
});
