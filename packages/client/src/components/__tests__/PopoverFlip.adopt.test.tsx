import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { ThemePicker } from "../settings/ThemePicker.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import { PackageRow } from "../packages/PackageRow.js";

function setViewportHeight(h: number) {
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
}

/** Force every measured trigger near the viewport bottom so flip-up engages. */
function mockBottomEdge() {
  setViewportHeight(950);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 900,
    bottom: 930,
    left: 0,
    right: 0,
    width: 0,
    height: 30,
    x: 0,
    y: 900,
    toJSON: () => ({}),
  } as DOMRect);
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  setViewportHeight(1000);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ThemePicker viewport flip", () => {
  it("flips its dropdown upward with a clamped max-height near the viewport bottom", () => {
    mockBottomEdge();
    render(
      <ThemeProvider>
        <ThemePicker />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId("theme-picker-trigger"));
    const dropdown = screen.getByTestId("theme-picker-dropdown");
    expect(dropdown.className).toContain("bottom-full");
    expect(dropdown.className).not.toContain("top-full");
    expect(dropdown.style.maxHeight).toBe("892px");
  });
});

describe("PackageRow actions menu viewport flip", () => {
  it("flips its actions menu upward near the viewport bottom", () => {
    mockBottomEdge();
    render(
      <PackageRow
        displayName="pi-flows"
        source="npm:pi-flows"
        sourceType="npm"
        testId="pkg"
        onViewReadme={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("pkg-menu"));
    const menu = screen.getByText("View README").closest("div")!;
    expect(menu.className).toContain("bottom-full");
    expect(menu.className).not.toContain("top-full");
    expect(menu.style.maxHeight).toBe("892px");
  });
});
