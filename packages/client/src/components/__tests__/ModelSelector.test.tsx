/**
 * ModelSelector — Variant C: capability badges (with confidence), favorites
 * group + filter, persistent provider filter.
 * See change: enrich-model-selector-capabilities-favorites.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ModelSelector } from "../settings/ModelSelector.js";
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

describe("ModelSelector refresh on open (upgrade-model-selector-primitives)", () => {
  it("renders no manual refresh button and no busy indicator", () => {
    render(<ModelSelector models={models} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} />);
    open();
    expect(screen.queryByTestId("model-refresh")).toBeNull();
  });

  it("fires onRefresh exactly once on the open transition", () => {
    const onRefresh = vi.fn();
    render(<ModelSelector models={models} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} />);
    open();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when no refresh handler is wired, and still renders the list", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    expect(screen.getAllByTestId("model-row").length).toBeGreaterThan(0);
  });
});

describe("ModelSelector provider refresh failures", () => {
  it("names the failing provider and keeps models selectable", () => {
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        favorites={[]}
        refreshErrors={[{ provider: "openai", message: "catalog 503" }]}
      />,
    );
    open();
    const notice = screen.getByTestId("model-refresh-errors");
    expect(notice.textContent).toContain("openai");
    expect(notice.textContent).toMatch(/last known/i);
    fireEvent.click(screen.getAllByTestId("model-row")[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("names every failing provider", () => {
    render(
      <ModelSelector
        models={models}
        onSelect={() => {}}
        favorites={[]}
        refreshErrors={[
          { provider: "openai", message: "catalog 503" },
          { provider: "anthropic", message: "bad key" },
        ]}
      />,
    );
    open();
    const notice = screen.getByTestId("model-refresh-errors");
    expect(notice.textContent).toContain("openai");
    expect(notice.textContent).toContain("anthropic");
  });

  it("renders no notice on a clean refresh", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    expect(screen.queryByTestId("model-refresh-errors")).toBeNull();
  });

  it("renders no notice for an empty error list", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} refreshErrors={[]} />);
    open();
    expect(screen.queryByTestId("model-refresh-errors")).toBeNull();
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
