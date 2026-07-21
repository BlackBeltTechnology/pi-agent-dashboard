import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import React from "react";
import { HiddenModelsSection } from "../HiddenModelsSection.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { STORAGE_KEY } from "../../lib/model-visibility.js";

const sampleModels: ModelInfo[] = [
  { provider: "openai", id: "gpt-4o" },
  { provider: "openai", id: "gpt-4o-mini" },
  { provider: "anthropic", id: "claude-opus-4" },
  { provider: "anthropic", id: "claude-sonnet-4" },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function read(): { hiddenProviders: string[]; hiddenModels: string[] } | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** Open the Individual Models subsection AND a specific provider group. */
function openGroup(provider: string): void {
  if (screen.queryByTestId("models-search") == null) {
    fireEvent.click(screen.getByTestId("models-subsection-toggle"));
  }
  fireEvent.click(screen.getByTestId(`group-toggle-${provider}`));
}

describe("HiddenModelsSection", () => {
  it("renders summary with zero counts on first mount", () => {
    render(<HiddenModelsSection models={sampleModels} />);
    expect(screen.getByTestId("hidden-models-summary").textContent).toMatch(
      /0 models hidden across 0 providers/,
    );
  });

  it("renders summary reflecting persisted state", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        hiddenProviders: ["openai"],
        hiddenModels: [],
      }),
    );
    render(<HiddenModelsSection models={sampleModels} />);
    expect(screen.getByTestId("hidden-models-summary").textContent).toMatch(
      /2 models hidden across 1 provider/,
    );
  });

  it("toggling a provider persists hiddenProviders", () => {
    render(<HiddenModelsSection models={sampleModels} />);
    fireEvent.click(screen.getByTestId("providers-subsection-toggle"));
    fireEvent.click(screen.getByTestId("provider-toggle-openai"));

    expect(read()?.hiddenProviders).toEqual(["openai"]);
  });

  it("toggling a provider that is already hidden removes it", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ hiddenProviders: ["openai", "anthropic"], hiddenModels: [] }),
    );
    render(<HiddenModelsSection models={sampleModels} />);
    fireEvent.click(screen.getByTestId("providers-subsection-toggle"));
    fireEvent.click(screen.getByTestId("provider-toggle-openai"));

    expect(read()?.hiddenProviders).toEqual(["anthropic"]);
  });

  it("subsections are collapsed by default", () => {
    render(<HiddenModelsSection models={sampleModels} />);
    expect(screen.queryByTestId("models-search")).toBeNull();
    expect(screen.queryByTestId("provider-toggle-openai")).toBeNull();
  });

  describe("Individual Models — provider groups", () => {
    it("renders one group header per provider, all collapsed by default", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      expect(screen.getByTestId("group-openai")).toBeTruthy();
      expect(screen.getByTestId("group-anthropic")).toBeTruthy();

      // Models are NOT rendered until their group opens.
      expect(screen.queryByTestId("model-row-openai/gpt-4o")).toBeNull();
      expect(screen.queryByTestId("model-row-anthropic/claude-opus-4")).toBeNull();
    });

    it("clicking a group header reveals its models", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      openGroup("openai");

      expect(screen.queryByTestId("model-row-openai/gpt-4o")).not.toBeNull();
      expect(screen.queryByTestId("model-row-openai/gpt-4o-mini")).not.toBeNull();
      // anthropic group still closed
      expect(screen.queryByTestId("model-row-anthropic/claude-opus-4")).toBeNull();
    });

    it("toggling a single model checkbox persists hiddenModels", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      openGroup("openai");
      fireEvent.click(screen.getByTestId("model-checkbox-openai/gpt-4o-mini"));

      expect(read()?.hiddenModels).toEqual(["openai/gpt-4o-mini"]);
    });

    it("model rows in a hidden provider render disabled + muted", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hiddenProviders: ["openai"], hiddenModels: [] }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      openGroup("openai");

      const checkbox = screen.getByTestId(
        "model-checkbox-openai/gpt-4o-mini",
      ) as HTMLInputElement;
      expect(checkbox.disabled).toBe(true);

      const row = screen.getByTestId("model-row-openai/gpt-4o-mini");
      expect(row.className).toMatch(/opacity-50/);
    });

    it("clicking a disabled model checkbox does NOT mutate state", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hiddenProviders: ["openai"], hiddenModels: [] }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      openGroup("openai");

      fireEvent.click(screen.getByTestId("model-checkbox-openai/gpt-4o-mini"));
      expect(read()?.hiddenModels).toEqual([]);
    });
  });

  describe("Group select-all checkbox (tri-state)", () => {
    it("renders unchecked + non-indeterminate when no model in the group is hidden", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      const cb = screen.getByTestId("group-select-all-openai") as HTMLInputElement;
      expect(cb.checked).toBe(false);
      expect(cb.indeterminate).toBe(false);
    });

    it("renders indeterminate when SOME models in the group are hidden", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hiddenProviders: [], hiddenModels: ["openai/gpt-4o"] }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      const cb = screen.getByTestId("group-select-all-openai") as HTMLInputElement;
      expect(cb.checked).toBe(false);
      expect(cb.indeterminate).toBe(true);
    });

    it("renders checked when ALL models in the group are hidden", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          hiddenProviders: [],
          hiddenModels: ["openai/gpt-4o", "openai/gpt-4o-mini"],
        }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      const cb = screen.getByTestId("group-select-all-openai") as HTMLInputElement;
      expect(cb.checked).toBe(true);
      expect(cb.indeterminate).toBe(false);
    });

    it("clicking unchecked select-all hides every model in the group", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      fireEvent.click(screen.getByTestId("group-select-all-openai"));

      const persisted = read()!;
      expect(persisted.hiddenModels.sort()).toEqual([
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
      ]);
      // anthropic untouched
      expect(persisted.hiddenModels).not.toContain("anthropic/claude-opus-4");
    });

    it("clicking checked select-all unhides every model in the group", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          hiddenProviders: [],
          hiddenModels: ["openai/gpt-4o", "openai/gpt-4o-mini", "anthropic/claude-opus-4"],
        }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      fireEvent.click(screen.getByTestId("group-select-all-openai"));

      const persisted = read()!;
      expect(persisted.hiddenModels).toEqual(["anthropic/claude-opus-4"]);
    });

    it("clicking indeterminate select-all hides ALL remaining models in the group", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hiddenProviders: [], hiddenModels: ["openai/gpt-4o"] }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      fireEvent.click(screen.getByTestId("group-select-all-openai"));

      const persisted = read()!;
      expect(persisted.hiddenModels.sort()).toEqual([
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
      ]);
    });

    it("select-all is disabled when the provider is already hidden", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hiddenProviders: ["openai"], hiddenModels: [] }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));

      const cb = screen.getByTestId("group-select-all-openai") as HTMLInputElement;
      expect(cb.disabled).toBe(true);
    });
  });

  describe("Search and bulk actions", () => {
    it("auto-expands groups that have search matches", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      // groups closed initially → no model rows
      expect(screen.queryByTestId("model-row-openai/gpt-4o-mini")).toBeNull();

      const search = screen.getByTestId("models-search") as HTMLInputElement;
      fireEvent.change(search, { target: { value: "mini" } });

      expect(screen.queryByTestId("model-row-openai/gpt-4o-mini")).not.toBeNull();
      // anthropic group has no matches → its row stays absent
      expect(screen.queryByTestId("group-anthropic")).toBeNull();
    });

    it("multi-token AND search across groups", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      const search = screen.getByTestId("models-search") as HTMLInputElement;
      fireEvent.change(search, { target: { value: "anthropic opus" } });

      expect(screen.queryByTestId("model-row-anthropic/claude-opus-4")).not.toBeNull();
      expect(screen.queryByTestId("model-row-anthropic/claude-sonnet-4")).toBeNull();
      expect(screen.queryByTestId("group-openai")).toBeNull();
    });

    it("'Hide all matching' button hides every model in the filtered set", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      const search = screen.getByTestId("models-search") as HTMLInputElement;
      fireEvent.change(search, { target: { value: "openai" } });

      fireEvent.click(screen.getByTestId("hide-all-matching"));
      expect(read()?.hiddenModels.sort()).toEqual([
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
      ]);
    });

    it("'Unhide all matching' button unhides every model in the filtered set", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          hiddenProviders: [],
          hiddenModels: ["openai/gpt-4o", "anthropic/claude-opus-4"],
        }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      const search = screen.getByTestId("models-search") as HTMLInputElement;
      fireEvent.change(search, { target: { value: "openai" } });

      fireEvent.click(screen.getByTestId("unhide-all-matching"));
      // anthropic kept; openai cleared
      expect(read()?.hiddenModels).toEqual(["anthropic/claude-opus-4"]);
    });

    it("bulk actions never mutate provider-hidden models", () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ hiddenProviders: ["openai"], hiddenModels: [] }),
      );
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      const search = screen.getByTestId("models-search") as HTMLInputElement;
      fireEvent.change(search, { target: { value: "" } }); // all
      // search row hidden when empty; manually trigger via 'Hide all matching' won't render
      // so use a search that matches everything
      fireEvent.change(search, { target: { value: "claude opus anthropic" } });
      fireEvent.click(screen.getByTestId("hide-all-matching"));

      // openai stayed in hiddenProviders, not pushed into hiddenModels
      expect(read()?.hiddenProviders).toEqual(["openai"]);
      expect(read()?.hiddenModels).toEqual(["anthropic/claude-opus-4"]);
    });

    it("bulk-action buttons hidden when search is empty", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      expect(screen.queryByTestId("hide-all-matching")).toBeNull();
      expect(screen.queryByTestId("unhide-all-matching")).toBeNull();
    });

    it("bulk-action buttons hidden when search has no matches", () => {
      render(<HiddenModelsSection models={sampleModels} />);
      fireEvent.click(screen.getByTestId("models-subsection-toggle"));
      const search = screen.getByTestId("models-search") as HTMLInputElement;
      fireEvent.change(search, { target: { value: "zzz-no-match" } });
      expect(screen.queryByTestId("hide-all-matching")).toBeNull();
      expect(screen.getByText(/No models match your search/)).toBeTruthy();
    });
  });
});
