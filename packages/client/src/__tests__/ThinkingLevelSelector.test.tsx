/**
 * ThinkingLevelSelector filters its dropdown to a model's supported levels
 * (pi 0.72+ per-model thinkingLevelMap). Undefined/empty → all six levels.
 *
 * See change: adopt-pi-071-072-073-features (B.1).
 *
 * Dropdown assertions are scoped to `screen` (document.body), NOT the render
 * `container`: once the dropdown is portaled to the layer root
 * (add-overlay-layering-system) it renders outside `container`, and a
 * container-scoped query would go null. See change:
 * fix-composer-popover-layering.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingLevelSelector } from "../components/settings/ThinkingLevelSelector.js";

afterEach(() => cleanup());

const ALL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

function openDropdown() {
  fireEvent.click(screen.getByTestId("thinking-level-button"));
}

function dropdownLabels(): string[] {
  const dropdown = screen.getByTestId("thinking-level-dropdown");
  return Array.from(dropdown.querySelectorAll("button")).map((b) => b.textContent);
}

describe("ThinkingLevelSelector — supportedLevels filtering", () => {
  it("renders only the supported levels when supportedLevels is set", () => {
    render(<ThinkingLevelSelector current="high" onSelect={vi.fn()} supportedLevels={["medium", "high"]} />);
    openDropdown();
    expect(dropdownLabels()).toEqual(["medium", "high"]);
  });

  it("renders all six levels when supportedLevels is undefined", () => {
    render(<ThinkingLevelSelector current="off" onSelect={vi.fn()} />);
    openDropdown();
    expect(dropdownLabels()).toEqual(ALL_LEVELS);
  });

  it("renders all six levels when supportedLevels is empty", () => {
    render(<ThinkingLevelSelector current="off" onSelect={vi.fn()} supportedLevels={[]} />);
    openDropdown();
    expect(dropdownLabels()).toEqual(ALL_LEVELS);
  });

  // max is opt-in: renders only when supportedLevels explicitly includes it,
  // never in the undefined/empty fallback. See change: honor-native-models-json-metadata (E12).
  it("renders max only when supportedLevels includes it", () => {
    render(<ThinkingLevelSelector current="max" onSelect={vi.fn()} supportedLevels={["off", "max"]} />);
    openDropdown();
    expect(dropdownLabels()).toEqual(["off", "max"]);
  });

  it("never renders max in the undefined fallback set", () => {
    render(<ThinkingLevelSelector current="off" onSelect={vi.fn()} />);
    openDropdown();
    expect(dropdownLabels()).not.toContain("max");
  });
});

describe("ThinkingLevelSelector — portaled dropdown", () => {
  // Same red test as ModelSelector's (change: fix-composer-popover-layering):
  // the open dropdown must be portaled out of the component container and
  // carry the `z-popover` layer token, not a raw `z-*`.
  it("portals the open dropdown out of the component container with the z-popover layer token", () => {
    const { container } = render(<ThinkingLevelSelector current="high" onSelect={vi.fn()} />);
    openDropdown();
    const dropdown = screen.getByTestId("thinking-level-dropdown");
    expect(container.querySelector('[data-testid="thinking-level-dropdown"]')).toBeNull();
    expect(dropdown.className).toContain("z-popover");
    expect(dropdown.className).not.toMatch(/(^|\s)z-\d+(\s|$)/);
  });

  it("still closes on mousedown outside the dropdown", () => {
    render(<ThinkingLevelSelector current="high" onSelect={vi.fn()} />);
    openDropdown();
    expect(screen.getByTestId("thinking-level-dropdown")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("thinking-level-dropdown")).toBeNull();
  });
});
