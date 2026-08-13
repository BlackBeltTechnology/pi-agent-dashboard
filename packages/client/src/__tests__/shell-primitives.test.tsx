/**
 * Shell-bound primitive registrations: a plugin passing ONLY contract props
 * still gets shell favorites + refresh-on-open, and a surface with no selected
 * session renders without error and requests nothing.
 *
 * See change: upgrade-model-selector-primitives (task 6.4).
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunConfigHarness, makeRunConfig } from "../test-support/runConfigHarness.js";
import {
  ModelSelectorPrimitive,
  ThinkingLevelSelectorPrimitive,
} from "../lib/plugins/shell-primitives.js";

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

const models = makeRunConfig().models!;

describe("ModelSelectorPrimitive (shell-bound)", () => {
  it("shows shell favorite state and fires the shell refresh on open", () => {
    const cfg = makeRunConfig({ favorites: ["openai/gpt-5.1-codex"] });
    render(
      <RunConfigHarness value={cfg}>
        <ModelSelectorPrimitive models={models} onSelect={() => {}} />
      </RunConfigHarness>,
    );
    fireEvent.click(screen.getByTestId("model-selector-button"));

    expect(cfg.refreshModels).toHaveBeenCalledTimes(1);
    const favRow = screen
      .getAllByTestId("model-row")
      .find((r) => r.textContent?.includes("gpt-5.1-codex"))!;
    expect(within(favRow).getByTestId("model-fav-toggle").getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles the shell-owned favorite from a plugin surface", () => {
    const cfg = makeRunConfig({ favorites: [] });
    render(
      <RunConfigHarness value={cfg}>
        <ModelSelectorPrimitive models={models} onSelect={() => {}} />
      </RunConfigHarness>,
    );
    fireEvent.click(screen.getByTestId("model-selector-button"));
    const row = screen.getAllByTestId("model-row")[0];
    fireEvent.click(within(row).getByTestId("model-fav-toggle"));

    expect(cfg.toggleFavorite).toHaveBeenCalledWith("anthropic/claude-sonnet-4-6", true);
  });

  it("renders with no session context, sending nothing", () => {
    render(<ModelSelectorPrimitive models={models} onSelect={() => {}} />);
    fireEvent.click(screen.getByTestId("model-selector-button"));

    expect(screen.getAllByTestId("model-row").length).toBe(models.length);
    expect(screen.queryByTestId("model-refresh-errors")).toBeNull();
  });
});

describe("ThinkingLevelSelectorPrimitive", () => {
  it("renders only the caller-supplied levels", () => {
    render(<ThinkingLevelSelectorPrimitive current="low" onSelect={() => {}} supportedLevels={["off", "low"]} />);
    fireEvent.click(within(screen.getByTestId("thinking-level-selector")).getByRole("button"));

    const text = screen.getByTestId("thinking-level-selector").textContent ?? "";
    expect(text).toContain("low");
    expect(text).not.toContain("xhigh");
  });
});
