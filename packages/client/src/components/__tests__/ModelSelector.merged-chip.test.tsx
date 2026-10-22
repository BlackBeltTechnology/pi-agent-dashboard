/**
 * ModelSelector as the composer's merged model · thinking chip, plus the plain
 * model and thinking-level selector behaviours that used to be exercised through
 * the retired StatusBar test file.
 * See change: add-composer-dock (D8, task 7.3).
 */
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelSelector } from "../settings/ModelSelector.js";
import { ThinkingLevelSelector } from "../settings/ThinkingLevelSelector.js";

afterEach(() => cleanup());

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-4", supportedThinkingLevels: ["off", "low", "high"] } as ModelInfo,
  { provider: "openai", id: "gpt-4.1" },
];

describe("ModelSelector (plain)", () => {
  it("renders current model", () => {
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} />);
    expect(screen.getByTestId("model-selector-button").textContent).toContain("anthropic/claude-4");
  });

  it("opens dropdown on click, filters models and selects one", () => {
    const onSelect = vi.fn();
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
    fireEvent.change(screen.getByTestId("model-filter"), { target: { value: "gpt" } });
    const rows = screen.getAllByTestId("model-row");
    expect(rows).toHaveLength(1);
    fireEvent.click(rows[0]!);
    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4.1");
  });

  it("has no level, no level group and no aria-label override without onSelectLevel", () => {
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} level="high" />);
    const trigger = screen.getByTestId("model-selector-button");
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(screen.queryByTestId("model-chip-level")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByTestId("model-level-group")).toBeNull();
  });

  it("stays openable when no models are available", () => {
    render(<ModelSelector current="anthropic/claude-4" onSelect={() => {}} />);
    expect(screen.getByTestId("model-selector-button").hasAttribute("disabled")).toBe(false);
  });

  it("requests a refresh on the open transition", () => {
    const onRefresh = vi.fn();
    render(<ModelSelector current="anthropic/claude-4" models={models} onSelect={() => {}} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});

describe("ModelSelector (merged chip, onSelectLevel)", () => {
  const merged = (extra: Partial<React.ComponentProps<typeof ModelSelector>> = {}) =>
    render(
      <ModelSelector
        current="anthropic/claude-4"
        models={models}
        onSelect={() => {}}
        level="low"
        supportedLevels={["off", "low", "high"]}
        onSelectLevel={() => {}}
        {...extra}
      />,
    );

  it("appends `· level` to the face, container-hidden below 26.25rem, and names both", () => {
    merged();
    const trigger = screen.getByTestId("model-selector-button");
    expect(trigger.textContent).toContain("anthropic/claude-4");
    expect(screen.getByTestId("model-chip-level").textContent).toContain("low");
    expect(screen.getByTestId("model-chip-level").className).toContain("@[26.25rem]:inline-flex");
    expect(trigger.getAttribute("aria-label")).toBe("Model anthropic/claude-4, thinking low");
  });

  it("falls back to `off` when the model is set and the level is not", () => {
    merged({ level: undefined });
    expect(screen.getByTestId("model-chip-level").textContent).toContain("off");
  });

  it("level group lists the supported levels, marks the current one, and picks", () => {
    const onSelectLevel = vi.fn();
    merged({ onSelectLevel });
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const radios = Array.from(screen.getByRole("radiogroup", { name: "Thinking level" }).querySelectorAll<HTMLElement>('[role="radio"]'));
    expect(radios.map((r) => r.dataset.level)).toEqual(["off", "low", "high"]);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.click(radios[2]!);
    expect(onSelectLevel).toHaveBeenCalledWith("high");
    expect(screen.queryByTestId("model-dropdown")).toBeNull();
  });

  it("arrow keys move focus within the level group", () => {
    merged();
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const group = screen.getByRole("radiogroup", { name: "Thinking level" });
    const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]'));
    radios[1]!.focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(document.activeElement).toBe(radios[0]);
  });

  it("keeps the level group beside the empty-catalogue state", () => {
    merged({ models: [] });
    fireEvent.click(screen.getByTestId("model-selector-button"));
    expect(screen.getByTestId("model-empty")).toBeTruthy();
    expect(screen.getByTestId("model-level-group")).toBeTruthy();
  });
});

describe("ThinkingLevelSelector", () => {
  it("renders current thinking level", () => {
    render(<ThinkingLevelSelector current="high" onSelect={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("high");
  });

  it("shows 'off' when no thinking level set", () => {
    render(<ThinkingLevelSelector onSelect={() => {}} />);
    expect(screen.getByTestId("thinking-level-button").textContent).toContain("off");
  });

  it("opens dropdown and calls onSelect", () => {
    const onSelect = vi.fn();
    render(<ThinkingLevelSelector onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("thinking-level-button"));
    expect(screen.getByTestId("thinking-level-dropdown")).toBeTruthy();
    const buttons = screen.getByTestId("thinking-level-dropdown").querySelectorAll("button");
    fireEvent.click(buttons[4]!);
    expect(onSelect).toHaveBeenCalledWith("high");
  });
});
