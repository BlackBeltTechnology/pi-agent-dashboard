/**
 * Tests for the source-override `override` pill on `PackageRow`.
 *
 * See change: flag-package-source-overrides.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PackageRow } from "../packages/PackageRow.js";

beforeAll(() => {
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

const baseProps = {
  displayName: "pi-flows",
  source: "/home/dev/pi-flows",
  sourceType: "local" as const,
  currentVersion: "1.1.0",
  latestVersion: "1.3.0",
  updateAvailable: true,
  canUpdate: true,
  testId: "row",
};

describe("PackageRow override pill", () => {
  afterEach(() => cleanup());

  it("renders the override pill with an explanatory aria-label when isOverride", () => {
    render(<PackageRow {...baseProps} isOverride onUpdate={() => {}} />);
    const pill = screen.getByTestId("row-override");
    expect(pill.textContent).toBe("override");
    expect(pill.getAttribute("aria-label")).toBe(
      "Declared as npm:pi-flows but installed from a local source",
    );
  });

  it("does not render the pill when isOverride is falsy", () => {
    render(<PackageRow {...baseProps} onUpdate={() => {}} />);
    expect(screen.queryByTestId("row-override")).toBeNull();
  });

  it("leaves the Update button behavior unchanged on an override row", () => {
    // The override remark is informational only: an override row with an
    // available update still shows an active Update button.
    render(<PackageRow {...baseProps} isOverride onUpdate={() => {}} />);
    const btn = screen.getByTestId("row-update");
    expect(btn).not.toBeNull();
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });
});
