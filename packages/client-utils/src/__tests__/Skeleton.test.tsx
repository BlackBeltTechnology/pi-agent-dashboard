import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Skeleton } from "../Skeleton.js";

afterEach(() => cleanup());

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion") ? reduce : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  );
  // jsdom attaches matchMedia to window; mirror the stub there too.
  (window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
    globalThis.matchMedia;
}

describe("Skeleton", () => {
  beforeEach(() => mockReducedMotion(false));

  it("renders `count` shaped placeholder rows", () => {
    const { container } = render(<Skeleton variant="bubble" count={3} />);
    expect(container.querySelectorAll("[data-skeleton-item]")).toHaveLength(3);
    expect(container.querySelector("[data-skeleton='bubble']")).toBeTruthy();
  });

  it("animates (shimmer) when reduced motion is off", () => {
    mockReducedMotion(false);
    const { container } = render(<Skeleton variant="row" />);
    const item = container.querySelector("[data-skeleton-item]");
    expect(item?.className).toContain("animate-pulse");
  });

  it("renders static (no shimmer) under prefers-reduced-motion: reduce", () => {
    mockReducedMotion(true);
    const { container } = render(<Skeleton variant="row" />);
    expect(container.querySelector("[data-skeleton][data-static='true']")).toBeTruthy();
    const item = container.querySelector("[data-skeleton-item]");
    expect(item?.className).not.toContain("animate-pulse");
  });
});
