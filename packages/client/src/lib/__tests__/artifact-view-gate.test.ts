import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileProvider, useMobile } from "../../hooks/useMobile.js";
import { type ArtifactRef, openArtifactForViewport } from "../util/artifact-view-gate.js";

afterEach(() => {
  cleanup();
  // @ts-expect-error test cleanup
  delete window.matchMedia;
});

const ref: ArtifactRef = { cwd: "/w", changeName: "ch", artifactId: "proposal" };

function makeHandlers() {
  return { navigateToPreview: vi.fn(), openDialog: vi.fn() };
}

describe("openArtifactForViewport (gate branches)", () => {
  it("E1: non-mobile → opens the dialog, does NOT navigate", () => {
    const h = makeHandlers();
    openArtifactForViewport(false, ref, h);
    expect(h.openDialog).toHaveBeenCalledWith(ref);
    expect(h.navigateToPreview).not.toHaveBeenCalled();
  });

  it("E2: mobile → navigates to preview, does NOT open the dialog", () => {
    const h = makeHandlers();
    openArtifactForViewport(true, ref, h);
    expect(h.navigateToPreview).toHaveBeenCalledWith(ref);
    expect(h.openDialog).not.toHaveBeenCalled();
  });
});

// Generic matchMedia stub: parses `(max-width: Npx)` / `(max-height: Mpx)`
// comma-OR clauses against a fixed viewport. Generic (does not hardcode the
// 767/599 breakpoints), so it honestly evaluates MobileProvider's own query.
function installMatchMedia(vw: number, vh: number): void {
  window.matchMedia = ((query: string) => {
    const matches = query.split(",").map((c) => c.trim()).some((clause) => {
      const mw = clause.match(/max-width:\s*(\d+)px/);
      if (mw) return vw <= Number(mw[1]);
      const mh = clause.match(/max-height:\s*(\d+)px/);
      if (mh) return vh <= Number(mh[1]);
      return false;
    });
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
}

/** Render MobileProvider (real query) and capture the resolved useMobile(). */
function resolveIsMobile(vw: number, vh: number): boolean {
  installMatchMedia(vw, vh);
  let captured = false;
  function Probe() {
    captured = useMobile();
    return null;
  }
  render(
    React.createElement(MobileProvider, null, React.createElement(Probe)),
  );
  return captured;
}

describe("E3456: useMobile boundary matrix → gate route", () => {
  const cases: Array<{ label: string; vw: number; vh: number; expectMobile: boolean }> = [
    { label: "E3 vw=768,vh=800 → not mobile → dialog", vw: 768, vh: 800, expectMobile: false },
    { label: "E4 vw=767,vh=800 → mobile → navigate", vw: 767, vh: 800, expectMobile: true },
    { label: "E5 vw=1400,vh=599 (short-wide IS mobile) → navigate", vw: 1400, vh: 599, expectMobile: true },
    { label: "E6 vw=1400,vh=600 → not mobile → dialog", vw: 1400, vh: 600, expectMobile: false },
  ];

  for (const c of cases) {
    it(c.label, () => {
      const isMobile = resolveIsMobile(c.vw, c.vh);
      expect(isMobile).toBe(c.expectMobile);

      const h = makeHandlers();
      openArtifactForViewport(isMobile, ref, h);
      if (c.expectMobile) {
        expect(h.navigateToPreview).toHaveBeenCalledWith(ref);
        expect(h.openDialog).not.toHaveBeenCalled();
      } else {
        expect(h.openDialog).toHaveBeenCalledWith(ref);
        expect(h.navigateToPreview).not.toHaveBeenCalled();
      }
    });
  }
});
