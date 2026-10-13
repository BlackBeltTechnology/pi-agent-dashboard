/**
 * ModelSelector — Variant C: capability badges (with confidence), favorites
 * group + filter, persistent provider filter.
 * See change: enrich-model-selector-capabilities-favorites.
 */

import type { ModelInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModelConfigProvider,
  type ModelConfigValue,
} from "../../lib/state/ModelConfigContext.js";
import { ModelSelector } from "../settings/ModelSelector.js";

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
    // Fallback gpt-3.5-turbo: assumed/unknown markers, worded "assumed" (no '?' overlay).
    // See change: retro-ux-model-selector.
    expect(titles(gpt35).some((t) => t.includes("assumed"))).toBe(true);
    expect(gpt35.textContent).toContain("assumed");
    expect(gpt35.textContent).not.toContain("?");
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

describe("ModelSelector partial-failure footer (thin count, D1-B)", () => {
  it("shows a count + Providers link, not provider names, and keeps models selectable", () => {
    const onSelect = vi.fn();
    render(
      <ModelSelector
        models={models}
        onSelect={onSelect}
        favorites={[]}
        refreshErrors={[{ provider: "openai", message: "catalog 503" }]}
        onOpenProviderSettings={() => {}}
      />,
    );
    open();
    const notice = screen.getByTestId("model-refresh-errors");
    expect(notice.textContent).toMatch(/1 provider unavailable/i);
    // Provider name and per-message text are NOT shown in the footer anymore.
    expect(notice.textContent).not.toContain("openai");
    expect(notice.textContent).not.toMatch(/last known/i);
    expect(within(notice).getByTestId("model-provider-settings-link")).toBeTruthy();
    fireEvent.click(screen.getAllByTestId("model-row")[0]);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("shows the total count for several failures without naming any provider", () => {
    render(
      <ModelSelector
        models={models}
        onSelect={() => {}}
        favorites={[]}
        refreshErrors={[
          { provider: "openai", message: "catalog 503" },
          { provider: "anthropic", message: "bad key" },
        ]}
        onOpenProviderSettings={() => {}}
      />,
    );
    open();
    const notice = screen.getByTestId("model-refresh-errors");
    expect(notice.textContent).toMatch(/2 providers unavailable/i);
    expect(notice.textContent).not.toContain("openai");
    expect(notice.textContent).not.toContain("anthropic");
  });

  it("renders no footer on a clean refresh", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    expect(screen.queryByTestId("model-refresh-errors")).toBeNull();
  });

  it("renders no footer for an empty error list", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} refreshErrors={[]} />);
    open();
    expect(screen.queryByTestId("model-refresh-errors")).toBeNull();
  });
});

describe("ModelSelector openable empty catalogue", () => {
  it("1.1 trigger is not disabled, opens with models:[], and shows the chevron", () => {
    render(<ModelSelector models={[]} onSelect={() => {}} favorites={[]} />);
    const trigger = screen.getByTestId("model-selector-button") as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);
    // Chevron affordance present in the empty state (control reads interactive).
    expect(trigger.querySelector("svg")).toBeTruthy();
    open();
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
  });

  it("1.2 fires exactly one request_models on open with models:[] + onRefresh", () => {
    const onRefresh = vi.fn();
    render(<ModelSelector models={[]} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} />);
    open();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("1.2 opens without throwing and sends nothing when no onRefresh is wired", () => {
    render(<ModelSelector models={[]} onSelect={() => {}} favorites={[]} />);
    expect(() => open()).not.toThrow();
    expect(screen.getByTestId("model-dropdown")).toBeTruthy();
  });

  it("1.3 while awaiting refresh shows the refreshing body and no recovery link", () => {
    render(<ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} />);
    open();
    expect(screen.getByTestId("model-empty-refreshing")).toBeTruthy();
    expect(screen.queryByTestId("model-provider-settings-link")).toBeNull();
  });

  it("1.3 after a post-open empty models_list shows the Open provider settings link", () => {
    const { rerender } = render(
      <ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} onOpenProviderSettings={() => {}} />,
    );
    open();
    // Simulate the post-open `models_list` arriving empty (fresh array identity).
    rerender(
      <ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} onOpenProviderSettings={() => {}} />,
    );
    expect(screen.queryByTestId("model-empty-refreshing")).toBeNull();
    expect(screen.getByTestId("model-provider-settings-link")).toBeTruthy();
  });

  it("1.4 empty + refreshErrors shows the Providers link, no inline Retry; reopen re-fires refresh", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <ModelSelector models={[]} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} onOpenProviderSettings={() => {}} />,
    );
    open();
    rerender(
      <ModelSelector
        models={[]}
        onSelect={() => {}}
        onRefresh={onRefresh}
        favorites={[]}
        refreshErrors={[{ provider: "openai", message: "catalog 503" }]}
        onOpenProviderSettings={() => {}}
      />,
    );
    expect(screen.getByTestId("model-provider-settings-link")).toBeTruthy();
    expect(screen.queryByTestId("model-empty-retry")).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    // close + reopen → a fresh open-triggered refresh.
    fireEvent.click(screen.getByTestId("model-selector-button"));
    open();
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("1.3b safety timeout with no models_list reveals the recovery link", () => {
    vi.useFakeTimers();
    try {
      render(
        <ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} onOpenProviderSettings={() => {}} />,
      );
      open();
      // Still awaiting: refreshing body, no link.
      expect(screen.getByTestId("model-empty-refreshing")).toBeTruthy();
      expect(screen.queryByTestId("model-provider-settings-link")).toBeNull();
      // No models_list ever arrives; the safety timeout elapses.
      act(() => { vi.advanceTimersByTime(10_000); });
      expect(screen.queryByTestId("model-empty-refreshing")).toBeNull();
      expect(screen.getByTestId("model-provider-settings-link")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("1.6 activating the recovery link calls the settings-open callback", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} onOpenProviderSettings={onOpen} />,
    );
    open();
    rerender(
      <ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} onOpenProviderSettings={onOpen} />,
    );
    fireEvent.click(screen.getByTestId("model-provider-settings-link"));
    expect(onOpen).toHaveBeenCalledTimes(1);
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

// ── Context fallback + ownership + no-source gating ───────────────────────
//
// Favorites become the `ModelSelector` default when a caller passes neither
// `favorites` nor `onToggleFavorite`: the pair is read from
// `useModelConfigOptional()`. Partial props (either one alone) mean the caller
// owns the pair — nothing is mixed with context. With no resolvable toggle the
// ★ buttons and ★ Favs filter disappear and a persisted favs-only state is
// ignored. See change: model-picker-everywhere-favorites (design D1).
describe("ModelSelector favorites context fallback (D1)", () => {
  const ab: ModelInfo[] = [
    { provider: "anthropic", id: "a" },
    { provider: "anthropic", id: "b" },
  ];

  function ctxValue(over: Partial<ModelConfigValue> = {}): ModelConfigValue {
    return {
      setModel: () => {},
      setThinkingLevel: () => {},
      toggleFavorite: () => {},
      refreshModels: () => {},
      openProviderSettings: () => {},
      notify: () => {},
      ...over,
    };
  }

  function wrapCtx(node: React.ReactElement, value: ModelConfigValue) {
    return <ModelConfigProvider value={value}>{node}</ModelConfigProvider>;
  }

  /** Row whose label is exactly `anthropic/<id>`. */
  function rowOf(id: string): HTMLElement {
    return screen
      .getAllByTestId("model-row")
      .find((r) => r.textContent?.trim() === `anthropic/${id}`)!;
  }

  it("E1: reads favorites + toggle from context when neither prop is passed", () => {
    const toggle = vi.fn();
    render(wrapCtx(
      <ModelSelector models={ab} onSelect={() => {}} />,
      ctxValue({ favorites: ["anthropic/a"], toggleFavorite: toggle }),
    ));
    open();
    expect(within(rowOf("a")).getByTestId("model-fav-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(within(rowOf("b")).getByTestId("model-fav-toggle").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("favs-only-toggle")).toBeTruthy();
    fireEvent.click(within(rowOf("a")).getByTestId("model-fav-toggle"));
    expect(toggle).toHaveBeenCalledWith("anthropic/a", false);
  });

  it("E2: explicit props win the whole pair; context is never used", () => {
    const ctxToggle = vi.fn();
    const propToggle = vi.fn();
    render(wrapCtx(
      <ModelSelector
        models={ab}
        onSelect={() => {}}
        favorites={["anthropic/b"]}
        onToggleFavorite={propToggle}
      />,
      ctxValue({ favorites: ["anthropic/a"], toggleFavorite: ctxToggle }),
    ));
    open();
    expect(within(rowOf("a")).getByTestId("model-fav-toggle").getAttribute("aria-pressed")).toBe("false");
    expect(within(rowOf("b")).getByTestId("model-fav-toggle").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(rowOf("b")).getByTestId("model-fav-toggle"));
    expect(propToggle).toHaveBeenCalledTimes(1);
    expect(ctxToggle).not.toHaveBeenCalled();
  });

  it("E3: favorites prop alone owns the pair — no stars, no Favs filter, context untouched", () => {
    const ctxToggle = vi.fn();
    render(wrapCtx(
      <ModelSelector models={ab} onSelect={() => {}} favorites={["anthropic/a"]} />,
      ctxValue({ favorites: ["anthropic/b"], toggleFavorite: ctxToggle }),
    ));
    open();
    expect(screen.queryAllByTestId("model-fav-toggle")).toHaveLength(0);
    expect(screen.queryByTestId("favs-only-toggle")).toBeNull();
    expect(ctxToggle).not.toHaveBeenCalled();
  });

  it("E4: handler prop alone owns the pair — stars render unpressed, prop fired", () => {
    const propToggle = vi.fn();
    render(wrapCtx(
      <ModelSelector models={ab} onSelect={() => {}} onToggleFavorite={propToggle} />,
      ctxValue({ favorites: ["anthropic/a"], toggleFavorite: vi.fn() }),
    ));
    open();
    const stars = screen.getAllByTestId("model-fav-toggle");
    expect(stars).toHaveLength(2);
    expect(stars.every((s) => s.getAttribute("aria-pressed") === "false")).toBe(true);
    fireEvent.click(within(rowOf("a")).getByTestId("model-fav-toggle"));
    expect(propToggle).toHaveBeenCalledWith("anthropic/a", true);
  });

  it("E5: no props and no provider — zero stars, no Favs toggle, both rows listed", () => {
    render(<ModelSelector models={ab} onSelect={() => {}} />);
    open();
    expect(screen.queryAllByTestId("model-fav-toggle")).toHaveLength(0);
    expect(screen.queryByTestId("favs-only-toggle")).toBeNull();
    expect(screen.getAllByTestId("model-row")).toHaveLength(2);
  });

  it("E6: persisted favs-only with no favorites source lists every model", () => {
    localStorage.setItem("modelselector.favOnly", "1");
    render(<ModelSelector models={ab} onSelect={() => {}} />);
    open();
    expect(screen.getAllByTestId("model-row")).toHaveLength(2);
    expect(screen.queryByText("No models match")).toBeNull();
  });

  it("E7: persisted favs-only with a zero-favorite source IS honoured (empty result)", () => {
    localStorage.setItem("modelselector.favOnly", "1");
    render(wrapCtx(
      <ModelSelector models={ab} onSelect={() => {}} />,
      ctxValue({ favorites: [], toggleFavorite: vi.fn() }),
    ));
    open();
    expect(screen.getByTestId("favs-only-toggle").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryAllByTestId("model-row")).toHaveLength(0);
    expect(screen.getByText("No models match")).toBeTruthy();
  });
});

// ── metadataSource union widening ("endpoint") ────────────────────────────
//
// The union gained a third member; `"endpoint"` is CONFIRMED capability (the
// provider advertised every field itself), and only `"fallback"` keeps the
// uncertain treatment. Pre-existing branches must be untouched.
// See change: fix-custom-provider-model-metadata (test-plan F3).

describe("ModelSelector — metadataSource 'endpoint' provenance (F3)", () => {
  const titles = (row: HTMLElement) =>
    Array.from(row.querySelectorAll("[title]")).map((e) => e.getAttribute("title") ?? "");

  it("renders endpoint provenance as confirmed, not uncertain", () => {
    const endpointModels: ModelInfo[] = [
      {
        provider: "proxy",
        id: "cc/claude-opus-5",
        reasoning: true,
        vision: true,
        contextWindow: 1_000_000,
        metadataSource: "endpoint",
      },
    ];
    render(<ModelSelector models={endpointModels} onSelect={() => {}} favorites={[]} />);
    open();
    const row = screen.getByTestId("model-row");
    expect(titles(row).some((t) => t.includes("Reasoning (confirmed)"))).toBe(true);
    expect(titles(row).some((t) => t.includes("Vision-capable (confirmed)"))).toBe(true);
    expect(titles(row).some((t) => t.includes("assumed"))).toBe(false);
    expect(row.textContent).not.toContain("?");
  });

  it.each([
    ["catalog", "catalog" as const],
    ["endpoint", "endpoint" as const],
    ["fallback", "fallback" as const],
    ["undefined", undefined],
  ])("renders without crashing for metadataSource %s", (_label, source) => {
    const one: ModelInfo[] = [
      { provider: "p", id: "m", reasoning: true, vision: true, metadataSource: source },
    ];
    expect(() =>
      render(<ModelSelector models={one} onSelect={() => {}} favorites={[]} />),
    ).not.toThrow();
    open();
    expect(screen.getByTestId("model-row")).toBeTruthy();
  });

  it("keeps the uncertain treatment exclusive to fallback (non-regression)", () => {
    const mixed: ModelInfo[] = [
      { provider: "p", id: "endpoint-model", reasoning: true, vision: true, metadataSource: "endpoint" },
      { provider: "p", id: "fallback-model", reasoning: false, vision: true, metadataSource: "fallback" },
    ];
    render(<ModelSelector models={mixed} onSelect={() => {}} favorites={[]} />);
    open();
    const rows = screen.getAllByTestId("model-row");
    const endpointRow = rows.find((r) => r.textContent?.includes("endpoint-model"))!;
    const fallbackRow = rows.find((r) => r.textContent?.includes("fallback-model"))!;
    expect(endpointRow.textContent).not.toContain("?");
    expect(fallbackRow.textContent).toContain("assumed");
    expect(endpointRow.textContent).not.toContain("assumed");
  });
});

// ── Role tab (add-role-aware-model-refs) ─────────────────────────────────
describe("ModelSelector Role tab", () => {
  const rolesBody = {
    object: "list",
    data: [
      {
        preset: null,
        active: true,
        roles: [
          { role: "fast", assigned: true, model: "anthropic/claude-haiku-4-5", thinkingLevel: "low" },
          { role: "nightly", assigned: true, model: "openai/gpt-5-mini" },
          { role: "research", assigned: false },
        ],
      },
    ],
  };
  const stubRoles = (status: number) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => rolesBody })),
    );
  afterEach(() => vi.unstubAllGlobals());

  it("E26: Role tab only when allowRoles AND /api/roles is 2xx", async () => {
    for (const [allow, status, expected] of [
      [undefined, 200, false],
      [true, 200, true],
      [true, 404, false],
      [undefined, 404, false],
    ] as const) {
      stubRoles(status);
      const { unmount } = render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles={allow} />);
      await act(async () => {});
      open();
      await act(async () => {});
      expect(screen.queryByTestId("model-tab-role") !== null).toBe(expected);
      unmount();
    }
  });

  it("E27: role pick emits @role once", async () => {
    stubRoles(200);
    const onSelect = vi.fn();
    render(<ModelSelector models={models} onSelect={onSelect} favorites={[]} allowRoles />);
    await act(async () => {});
    open();
    await act(async () => {});
    fireEvent.click(screen.getByTestId("model-tab-role"));
    fireEvent.click(within(screen.getByTestId("role-list")).getByText("@fast"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("@fast");
  });

  it("custom role is listed with its resolution", async () => {
    stubRoles(200);
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await act(async () => {});
    open();
    await act(async () => {});
    fireEvent.click(screen.getByTestId("model-tab-role"));
    const rows = screen.getAllByTestId("role-row");
    expect(rows.map((r) => r.getAttribute("data-role"))).toEqual(["fast", "nightly", "research"]);
    expect(rows[0]!.textContent).toContain("anthropic/claude-haiku-4-5");
    expect(rows[0]!.textContent).toContain("low");
  });

  it("E28: current=@fast opens Role tab; trigger shows role + resolution", async () => {
    stubRoles(200);
    render(<ModelSelector current="@fast" models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await act(async () => {});
    const trigger = screen.getByTestId("model-selector-button");
    expect(trigger.textContent).toContain("@fast");
    expect(trigger.textContent).toContain("anthropic/claude-haiku-4-5");
    open();
    await act(async () => {});
    expect(screen.getByTestId("model-tab-role").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("role-list")).toBeTruthy();
  });

  it("E29: unassigned role carries a marker", async () => {
    stubRoles(200);
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await act(async () => {});
    open();
    await act(async () => {});
    fireEvent.click(screen.getByTestId("model-tab-role"));
    const research = screen.getAllByTestId("role-row").find((r) => r.getAttribute("data-role") === "research")!;
    expect(within(research).getByTestId("role-unassigned")).toBeTruthy();
  });

  it("tablist: ArrowRight switches tab; aria-selected follows", async () => {
    stubRoles(200);
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await act(async () => {});
    open();
    await act(async () => {});
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByTestId("model-tab-role").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("model-tab-model").getAttribute("aria-selected")).toBe("false");
  });

  it("tablist: ArrowRight moves focus with the selection (WAI-ARIA tabs)", async () => {
    stubRoles(200);
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await act(async () => {});
    open();
    await act(async () => {});
    screen.getByTestId("model-tab-model").focus();
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByTestId("model-tab-role"));
  });
});

// ── retro-ux-model-selector: shared RoleRef, combobox + grid, UI-contract recipes ──
describe("ModelSelector retro-ux conformance", () => {
  const rolesBody = {
    object: "list",
    data: [
      {
        preset: null,
        active: true,
        roles: [
          { role: "fast", assigned: true, model: "anthropic/claude-haiku-4-5", thinkingLevel: "low" },
          { role: "nightly", assigned: true, model: "openai/gpt-5-mini" },
          { role: "research", assigned: false },
        ],
      },
    ],
  };
  const stubRoles = (status = 200, rolesData: unknown = rolesBody) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => rolesData })),
    );
  afterEach(() => vi.unstubAllGlobals());
  const flush = () => act(async () => {});
  const four: ModelInfo[] = [
    { provider: "anthropic", id: "a-one" },
    { provider: "anthropic", id: "a-two" },
    { provider: "anthropic", id: "a-sonnet" },
    { provider: "openai", id: "o-one" },
  ];

  it("E4: Roles tab is a tablist/tab/tabpanel with RoleRef rows, check + aria-current, unassigned pill", async () => {
    stubRoles();
    const onSelect = vi.fn();
    render(<ModelSelector current="@fast" models={models} onSelect={onSelect} favorites={[]} allowRoles />);
    await flush();
    open();
    await flush();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Models", "Roles"]);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(tabs[1]!.getAttribute("aria-controls")).toBeTruthy();
    const panel = screen.getByRole("tabpanel");
    expect(panel.id).toBe(tabs[1]!.getAttribute("aria-controls"));
    const rows = screen.getAllByTestId("role-row");
    const fast = rows.find((r) => r.getAttribute("data-role") === "fast")!;
    expect(fast.getAttribute("aria-current")).toBe("true");
    expect(fast.querySelector("svg")).toBeTruthy();
    expect(fast.querySelector("[data-role-ref]")).toBeTruthy();
    const research = rows.find((r) => r.getAttribute("data-role") === "research")!;
    expect(within(research).getByTestId("role-unassigned").textContent).toBe("No model assigned");
    expect(research.getAttribute("aria-current")).toBeNull();
    fireEvent.click(fast);
    expect(onSelect).toHaveBeenCalledWith("@fast");
  });

  it("E4: the Models panel is also a tabpanel controlled by its tab", async () => {
    stubRoles();
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await flush();
    open();
    await flush();
    const modelTab = screen.getByTestId("model-tab-model");
    expect(screen.getByRole("tabpanel").id).toBe(modelTab.getAttribute("aria-controls"));
    expect(modelTab.getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("model-tab-role").getAttribute("tabindex")).toBe("-1");
  });

  it("E5: trigger shows role token, short model, level chip; full ref in textContent; dialog popup", async () => {
    stubRoles();
    render(<ModelSelector current="@fast" models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await flush();
    const trigger = screen.getByTestId("model-selector-button");
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.querySelector("[data-role-ref-token]")?.textContent).toBe("@fast");
    expect(trigger.querySelector("[data-role-ref-level]")?.textContent).toContain("low");
    expect(trigger.textContent).toContain("anthropic/claude-haiku-4-5");
    expect(trigger.querySelector(".sr-only")?.textContent).toBe("anthropic/");
  });

  it("E5: trigger does not claim 'No model assigned' while roles are still loading", () => {
    stubRoles(404);
    render(<ModelSelector current="@fast" models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    const trigger = screen.getByTestId("model-selector-button");
    expect(trigger.textContent).toContain("@fast");
    expect(trigger.textContent).not.toContain("No model assigned");
  });

  it("E8: Favorites only toggle + translated star name + sizing + no amber", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={["anthropic/claude-haiku-4-5"]} onToggleFavorite={() => {}} />);
    open();
    const toggle = screen.getByTestId("favs-only-toggle");
    expect(toggle.textContent).toContain("Favorites only");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.className).toContain("--tint-blue-bg");
    expect(toggle.className).toContain("--tint-blue-border");
    const star = screen.getByTestId("model-fav-toggle");
    expect(star.getAttribute("aria-label")).toBe("Favorite Claude Haiku 4.5");
    expect(star.getAttribute("aria-pressed")).toBe("true");
    expect(star.className).toContain("min-w-[44px]");
    expect(star.className).toContain("sm:min-w-[32px]");
    expect(star.className).toContain("sm:min-h-[32px]");
    const dropdown = screen.getByTestId("model-dropdown");
    expect(dropdown.innerHTML).not.toMatch(/amber-/);
  });

  it("E9: fallback badge shows the word 'assumed' (title kept), catalog does not, absent shows none", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    open();
    const rows = screen.getAllByTestId("model-row");
    const byText = (s: string) => rows.find((r) => r.textContent?.includes(s))!;
    expect(byText("gpt-3.5-turbo").textContent).toContain("assumed");
    expect(byText("gpt-3.5-turbo").querySelector('[title*="assumed"]')).toBeTruthy();
    expect(byText("claude-opus-4-7").textContent).not.toContain("assumed");
    expect(byText("old-model").querySelector("[title]")).toBeNull();
    for (const r of rows) expect(r.textContent).not.toContain("?");
  });

  it("E10: refresh errors render a warning pill + ghost 'Open providers' button, no provider names", () => {
    const onOpen = vi.fn();
    render(
      <ModelSelector
        models={models}
        onSelect={() => {}}
        favorites={[]}
        refreshErrors={[{ provider: "openai", message: "503" }, { provider: "google", message: "401" }]}
        onOpenProviderSettings={onOpen}
      />,
    );
    open();
    const footer = screen.getByTestId("model-refresh-errors");
    expect(footer.textContent).toContain("2 providers unavailable");
    expect(footer.textContent).not.toContain("openai");
    expect(footer.innerHTML).toContain("--severity-warning-bg");
    const btn = within(footer).getByTestId("model-provider-settings-link");
    expect(btn.textContent).toBe("Open providers");
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("model-row").length).toBe(models.length);
  });

  it("E11: empty state has headline, help line and a secondary 'Open provider settings' button; no Retry", () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <ModelSelector models={[]} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} onOpenProviderSettings={() => {}} />,
    );
    open();
    expect(screen.getByRole("status").textContent).toContain("Refreshing models");
    for (const errors of [undefined, [{ provider: "openai", message: "503" }]]) {
      rerender(
        <ModelSelector models={[]} onSelect={() => {}} onRefresh={onRefresh} favorites={[]} refreshErrors={errors} onOpenProviderSettings={() => {}} />,
      );
      const empty = screen.getByTestId("model-empty");
      expect(empty.textContent).toContain("No models available");
      expect(empty.textContent).toMatch(/Close and reopen/);
      const btn = within(empty).getByTestId("model-provider-settings-link");
      expect(btn.textContent).toBe("Open provider settings");
      expect(btn.className).toContain("--border-secondary");
      expect(btn.querySelector("svg")).toBeTruthy();
      expect(screen.queryByText(/retry/i)).toBeNull();
    }
    fireEvent.click(screen.getByTestId("model-selector-button"));
    open();
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("E12: no-roles help, type recipes, and no palette/muted class in the dropdown", async () => {
    stubRoles(200, { object: "list", data: [{ preset: null, active: true, roles: [] }] });
    const { unmount } = render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await flush();
    open();
    await flush();
    fireEvent.click(screen.getByTestId("model-tab-role"));
    expect(screen.getByTestId("role-list").textContent).toContain("Settings → Roles");
    unmount();
    cleanup();
    render(<ModelSelector models={models} onSelect={() => {}} favorites={["anthropic/claude-opus-4-7"]} onToggleFavorite={() => {}} />);
    open();
    for (const h of screen.getAllByTestId("group-provider")) {
      expect(h.className).toContain("text-xs");
      expect(h.className).toContain("font-semibold");
      expect(h.className).toContain("--text-secondary");
    }
    const html = screen.getByTestId("model-dropdown").innerHTML;
    expect(html).not.toContain("--text-muted");
    expect(html).not.toMatch(/(text|bg|border)-(amber|red|green|blue|yellow|orange|purple|gray|slate)-\d/);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|rgba\(/i);
  });

  it("E12: the refreshing line is a role=status with a spinner", () => {
    render(<ModelSelector models={[]} onSelect={() => {}} onRefresh={vi.fn()} favorites={[]} />);
    open();
    const status = screen.getByRole("status");
    expect(status.querySelector("svg")).toBeTruthy();
    expect(status.getAttribute("data-testid")).toBe("model-empty-refreshing");
  });

  it("F1: filter is a combobox over a grid; ArrowDown ×2 + Enter selects row 3", () => {
    const onSelect = vi.fn();
    render(<ModelSelector models={four} onSelect={onSelect} favorites={[]} />);
    open();
    const filter = screen.getByTestId("model-filter");
    expect(filter.getAttribute("role")).toBe("combobox");
    expect(filter.getAttribute("aria-haspopup")).toBe("grid");
    expect(filter.getAttribute("aria-expanded")).toBe("true");
    const grid = screen.getByRole("grid");
    expect(filter.getAttribute("aria-controls")).toBe(grid.id);
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBe(4);
    const groups = screen.getAllByRole("rowgroup");
    expect(groups.length).toBe(2);
    for (const g of groups) {
      const header = document.getElementById(g.getAttribute("aria-labelledby")!);
      expect(header?.getAttribute("data-testid")).toBe("group-provider");
    }
    expect(filter.getAttribute("aria-activedescendant")).toBe(rows[0]!.id);
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    expect(filter.getAttribute("aria-activedescendant")).toBe(rows[1]!.id);
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    expect(filter.getAttribute("aria-activedescendant")).toBe(rows[2]!.id);
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("anthropic/a-sonnet");
  });

  it("F2: ArrowRight at the end reaches the ★ cell and Enter toggles once; mid-text only moves the caret", () => {
    const toggle = vi.fn();
    render(<ModelSelector models={four} onSelect={vi.fn()} favorites={[]} onToggleFavorite={toggle} />);
    open();
    const filter = screen.getByTestId("model-filter") as HTMLInputElement;
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    fireEvent.keyDown(filter, { key: "ArrowRight" });
    const star = document.getElementById(filter.getAttribute("aria-activedescendant")!)!;
    expect(star.getAttribute("role")).toBe("gridcell");
    expect(star.querySelector('[data-testid="model-fav-toggle"]')).toBeTruthy();
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledWith("anthropic/a-two", true);
    fireEvent.keyDown(filter, { key: "ArrowLeft" });
    expect(filter.getAttribute("aria-activedescendant")).toMatch(/-row-1$/);
    // mid-text: caret not at the end → ArrowRight does not move the active descendant
    fireEvent.change(filter, { target: { value: "sonnet" } });
    filter.setSelectionRange(3, 3);
    const before = filter.getAttribute("aria-activedescendant");
    fireEvent.keyDown(filter, { key: "ArrowRight" });
    expect(filter.getAttribute("aria-activedescendant")).toBe(before);
    expect(before).toMatch(/-row-0$/);
  });

  it("F3: ArrowRight on the tablist selects + focuses Roles; popover is dialog/aria-modal=false; Escape closes and refocuses the trigger", async () => {
    stubRoles();
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await flush();
    open();
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("false");
    expect(dialog.getAttribute("aria-label")).toBe("Choose a model");
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    await flush();
    expect(screen.getByTestId("model-tab-role").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("model-tab-role"));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("model-selector-button"));
  });

  it("F4: the current model is marked by aria-selected + a check icon, not accent colour", () => {
    render(<ModelSelector current="anthropic/claude-haiku-4-5" models={models} onSelect={() => {}} favorites={[]} />);
    open();
    const rows = screen.getAllByTestId("model-row");
    const current = rows.find((r) => r.textContent?.includes("claude-haiku-4-5"))!;
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(current.querySelector("svg")).toBeTruthy();
    for (const r of rows) {
      expect(r.className).not.toContain("--accent-blue");
      if (r !== current) expect(r.getAttribute("aria-selected")).toBe("false");
    }
  });

  it("X2: roles plugin absent (404) → no tablist, Models grid unchanged, no tabpanel", async () => {
    stubRoles(404);
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} allowRoles />);
    await flush();
    open();
    await flush();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.getAllByTestId("model-row").length).toBe(models.length);
  });

  it("trigger carries tap-target sizing (44 px below sm, 32 px from sm)", () => {
    render(<ModelSelector models={models} onSelect={() => {}} favorites={[]} />);
    expect(screen.getByTestId("model-selector-button").className).toContain("tap-target");
  });
});
