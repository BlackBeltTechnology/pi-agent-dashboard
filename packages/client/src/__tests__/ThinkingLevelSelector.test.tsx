/**
 * ThinkingLevelSelector filters its dropdown to a model's supported levels
 * (pi 0.72+ per-model thinkingLevelMap). Undefined/empty → all six levels.
 *
 * See change: adopt-pi-071-072-073-features (B.1).
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingLevelSelector } from "../components/settings/ThinkingLevelSelector.js";

afterEach(() => cleanup());

const ALL_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

function openDropdown(container: HTMLElement) {
  const btn = container.querySelector('[data-testid="thinking-level-button"]') as HTMLElement;
  fireEvent.click(btn);
}

describe("ThinkingLevelSelector — supportedLevels filtering", () => {
  it("renders only the supported levels when supportedLevels is set", () => {
    const { container } = render(
      <ThinkingLevelSelector current="high" onSelect={vi.fn()} supportedLevels={["medium", "high"]} />,
    );
    openDropdown(container);
    const dropdown = container.querySelector('[data-testid="thinking-level-dropdown"]')!;
    const labels = Array.from(dropdown.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["medium", "high"]);
  });

  it("renders all six levels when supportedLevels is undefined", () => {
    const { container } = render(<ThinkingLevelSelector current="off" onSelect={vi.fn()} />);
    openDropdown(container);
    const dropdown = container.querySelector('[data-testid="thinking-level-dropdown"]')!;
    const labels = Array.from(dropdown.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(ALL_LEVELS);
  });

  it("renders all six levels when supportedLevels is empty", () => {
    const { container } = render(
      <ThinkingLevelSelector current="off" onSelect={vi.fn()} supportedLevels={[]} />,
    );
    openDropdown(container);
    const dropdown = container.querySelector('[data-testid="thinking-level-dropdown"]')!;
    const labels = Array.from(dropdown.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(ALL_LEVELS);
  });

  // max is opt-in: renders only when supportedLevels explicitly includes it,
  // never in the undefined/empty fallback. See change: honor-native-models-json-metadata (E12).
  it("renders max only when supportedLevels includes it", () => {
    const { container } = render(
      <ThinkingLevelSelector current="max" onSelect={vi.fn()} supportedLevels={["off", "max"]} />,
    );
    openDropdown(container);
    const dropdown = container.querySelector('[data-testid="thinking-level-dropdown"]')!;
    const labels = Array.from(dropdown.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["off", "max"]);
  });

  it("never renders max in the undefined fallback set", () => {
    const { container } = render(<ThinkingLevelSelector current="off" onSelect={vi.fn()} />);
    openDropdown(container);
    const dropdown = container.querySelector('[data-testid="thinking-level-dropdown"]')!;
    const labels = Array.from(dropdown.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).not.toContain("max");
  });
});
