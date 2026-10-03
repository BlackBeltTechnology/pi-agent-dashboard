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
