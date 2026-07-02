/**
 * ModelSelector — Variant C: capability badges (with confidence), favorites
 * group + filter, persistent provider filter.
 * See change: enrich-model-selector-capabilities-favorites.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";
import { ModelSelector } from "../ModelSelector.js";
import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-opus-4-7", name: "Claude Opus 4.7", reasoning: true, vision: true, contextWindow: 1_000_000, metadataSource: "catalog" },
  { provider: "anthropic", id: "claude-haiku-4-5", name: "Claude Haiku 4.5", reasoning: false, vision: true, contextWindow: 200_000, metadataSource: "catalog" },
  { provider: "proxy", id: "gh/gpt-3.5-turbo", reasoning: false, vision: true, contextWindow: 128_000, metadataSource: "fallback" },
  { provider: "legacy", id: "old-model" }, // old bridge: no capability fields
];

beforeEach(() => { localStorage.clear(); });
afterEach(() => cleanup());

function open() {
  fireEvent.click(screen.getByTestId("model-selector-button"));
}

describe("ModelSelector capability badges", () => {
  const titles = (row: HTMLElement) =>
    Array.from(row.querySelectorAll("[title]")).map((e) => e.getAttribute("title") ?? "");

  it("renders confident icons for catalog, ? for fallback, none for absent", () => {
    render(<ModelSelector current="anthropic/claude-opus-4-7" models={models} onSelect={() => {}} favorites={[]} />);
    open();
    const rows = screen.getAllByTestId("model-row");
    const opus = rows.find((r) => r.textContent?.includes("claude-opus-4-7"))!;
    const gpt35 = rows.find((r) => r.textContent?.includes("gpt-3.5-turbo"))!;
    const legacy = rows.find((r) => r.textContent?.includes("old-model"))!;
    // Catalog opus: confirmed reasoning + vision icons, no '?'
    expect(titles(opus).some((t) => t.includes("Reasoning (confirmed)"))).toBe(true);
    expect(titles(opus).some((t) => t.includes("Vision-capable (confirmed)"))).toBe(true);
    expect(opus.textContent).not.toContain("?");
    // Fallback gpt-3.5-turbo: assumed/unknown markers with '?'
    expect(titles(gpt35).some((t) => t.includes("assumed"))).toBe(true);
    expect(gpt35.textContent).toContain("?");
    // Legacy (no metadataSource, no flags): no capability icons, no '?'
    expect(legacy.textContent).not.toContain("?");
    expect(titles(legacy).some((t) => /confirmed|assumed|unknown/.test(t))).toBe(false);
  });

  it("catalog model with vision:false shows brain but no eye", () => {
    const noVision: ModelInfo[] = [
      { provider: "x", id: "text-only", reasoning: true, vision: false, metadataSource: "catalog" },
    ];
    render(<ModelSelector models={noVision} onSelect={() => {}} favorites={[]} />);
    open();
    const row = screen.getByTestId("model-row");
    expect(titles(row).some((t) => t.includes("Reasoning (confirmed)"))).toBe(true);
    expect(titles(row).some((t) => t.includes("Vision-capable"))).toBe(false);
  });
});

describe("ModelSelector favorites", () => {
  it("toggles favorite via the per-row star (no separate favorites group)", () => {
    const onToggle = vi.fn();
    render(<ModelSelector models={models} onSelect={() => {}} favorites={["anthropic/claude-opus-4-7"]} onToggleFavorite={onToggle} />);
    open();
    // No pinned favorites group — favorites live inline under their provider.
    expect(screen.queryByTestId("group-favorites")).toBeNull();
    // Clicking a favorited model's star unfavorites it.
    const opusRow = screen.getAllByTestId("model-row").find((r) => r.textContent?.includes("claude-opus-4-7"))!;
    fireEvent.click(within(opusRow).getByTestId("model-fav-toggle"));
    expect(onToggle).toHaveBeenCalledWith("anthropic/claude-opus-4-7", false);
  });

  it("favs-only filter narrows to favorites", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={["anthropic/claude-haiku-4-5"]} onToggleFavorite={() => {}} />);
    open();
    fireEvent.click(screen.getByTestId("favs-only-toggle"));
    const rows = screen.getAllByTestId("model-row");
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain("claude-haiku-4-5");
  });
});

describe("ModelSelector refresh control (refresh-model-selector-models)", () => {
  it("calls onRefresh and enters busy (disabled) state on activation", () => {
    const onRefresh = vi.fn();
    render(<ModelSelector models={models} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} />);
    open();
    const btn = screen.getByTestId("model-refresh");
    expect(btn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Busy: control disabled while awaiting a new models list.
    expect(screen.getByTestId("model-refresh").hasAttribute("disabled")).toBe(true);
  });

  it("does not render the refresh control when onRefresh is undefined", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    expect(screen.queryByTestId("model-refresh")).toBeNull();
  });

  it("clears busy state when the models prop identity changes", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<ModelSelector models={models} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} />);
    open();
    fireEvent.click(screen.getByTestId("model-refresh"));
    expect(screen.getByTestId("model-refresh").hasAttribute("disabled")).toBe(true);
    // A fresh models_list arrives => new array identity.
    rerender(<ModelSelector models={[...models]} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} />);
    expect(screen.getByTestId("model-refresh").hasAttribute("disabled")).toBe(false);
  });

  it("clears busy state on the safety timeout when no new list arrives", () => {
    vi.useFakeTimers();
    try {
      const onRefresh = vi.fn();
      render(<ModelSelector models={models} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} />);
      open();
      fireEvent.click(screen.getByTestId("model-refresh"));
      expect(screen.getByTestId("model-refresh").hasAttribute("disabled")).toBe(true);
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.getByTestId("model-refresh").hasAttribute("disabled")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ModelSelector provider filter persistence", () => {
  it("persists provider filter to localStorage and restores on remount", () => {
    const { unmount } = render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    fireEvent.change(screen.getByTestId("provider-filter"), { target: { value: "proxy" } });
    expect(localStorage.getItem("modelselector.providerFilter")).toBe("proxy");
    unmount();

    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    expect((screen.getByTestId("provider-filter") as HTMLSelectElement).value).toBe("proxy");
    // Only proxy rows visible.
    const rows = screen.getAllByTestId("model-row");
    expect(rows.every((r) => r.textContent?.includes("gpt-3.5-turbo"))).toBe(true);
  });

  it("text filter clears on reopen but provider filter persists", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    fireEvent.change(screen.getByTestId("provider-filter"), { target: { value: "anthropic" } });
    fireEvent.change(screen.getByTestId("model-filter"), { target: { value: "opus" } });
    // close + reopen
    fireEvent.click(screen.getByTestId("model-selector-button"));
    open();
    expect((screen.getByTestId("model-filter") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("provider-filter") as HTMLSelectElement).value).toBe("anthropic");
  });
});
