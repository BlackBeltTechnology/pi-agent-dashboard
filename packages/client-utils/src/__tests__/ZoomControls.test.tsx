import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ZoomControls } from "../ZoomControls.js";

afterEach(cleanup);
const noop = () => {};
const mk = (scale: number, initialScale?: number) =>
  render(<ZoomControls onZoomIn={noop} onZoomOut={noop} onReset={noop} scale={scale} initialScale={initialScale} />);

// See change: fix-markdown-remount-storm
describe("ZoomControls indicator", () => {
  it("hidden at the initial scale", () => {
    expect(mk(2.5, 2.5).container.textContent).not.toContain("%");
  });
  it("shows percentage off the initial scale", () => {
    expect(mk(3, 2.5).container.textContent).toContain("300%");
  });
  it("legacy: hidden at 1 without initialScale", () => {
    expect(mk(1).container.textContent).not.toContain("%");
  });
  it("legacy: shows 120% at 1.2", () => {
    expect(mk(1.2).container.textContent).toContain("120%");
  });
});

// See change: retro-ux-chat-rendering (test-plan E8, E10)
describe("ZoomControls accessibility + targets", () => {
  it("E8: default labels name and title each button; icons are aria-hidden", () => {
    const { container } = mk(1);
    for (const name of ["Zoom in", "Zoom out", "Reset zoom"]) {
      const btn = container.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
      expect(btn).toBeTruthy();
      expect(btn.title).toBe(name);
    }
    const svgs = container.querySelectorAll("button svg");
    expect(svgs).toHaveLength(3);
    for (const svg of svgs) expect(svg.getAttribute("aria-hidden")).toBe("true");
  });

  it("uses translated labels for both aria-label and title", () => {
    const { container } = render(
      <ZoomControls
        onZoomIn={noop}
        onZoomOut={noop}
        onReset={noop}
        scale={1}
        labels={{ zoomIn: "Nagyítás", zoomOut: "Kicsinyítés", reset: "Nagyítás visszaállítása" }}
      />,
    );
    const btn = container.querySelector('button[aria-label="Nagyítás"]') as HTMLButtonElement;
    expect(btn.title).toBe("Nagyítás");
  });

  it("E10: 44px/32px targets, focus ring, live readout at >= 11px in --text-secondary", () => {
    const { container } = mk(1.2);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(3);
    for (const b of buttons) {
      expect(b.className).toContain("min-w-[44px]");
      expect(b.className).toContain("min-h-[44px]");
      expect(b.className).toContain("sm:min-w-[32px]");
      expect(b.className).toContain("sm:min-h-[32px]");
      expect(b.className).toContain("focus-ring");
    }
    const readout = container.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(readout.textContent).toBe("120%");
    expect(readout.className).toContain("text-[11px]");
    expect(readout.className).toContain("text-[var(--text-secondary)]");
    expect(readout.className).not.toContain("text-muted");
  });
});
