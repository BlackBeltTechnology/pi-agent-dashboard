import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUiPrimitiveRegistry, registerUiPrimitive, UiPrimitiveProvider } from "../index.js";
import { intentStore } from "../intent-store.js";
import { PluginContextProvider } from "../plugin-context.js";
import {
  ComposerContextGroup,
  ComposerContextGroupSlot,
  ComposerPanelSlot,
  SessionCardActionBarSlot,
  SessionCardBadgeSlot,
  SessionCardMemorySlot,
  SettingsSectionByPluginSlot,
  SettingsSectionSlot,
  SidebarFolderSectionSlot,
  ToolbarGroup,
  ToolRendererSlot,
  useSlotHasAnyClaims,
  useSlotHasClaimsForSession,
  useSlotHasVisibleClaimsForSession,
  WorktreeCardSectionSlot,
} from "../slot-consumers.js";
import { createSlotRegistry } from "../slot-registry.js";

afterEach(cleanup);

function makeSession(id = "s1"): DashboardSession {
  return { id, cwd: "/repo", source: "tui", status: "active", startedAt: 0 };
}

// ── Error boundary tests ──────────────────────────────────────────────────────

describe("SessionCardBadgeSlot error boundary", () => {
  it("three plugins: second throws, first and third still render", () => {
    const registry = createSlotRegistry();

    registry.addClaim({
      pluginId: "a-plugin",
      priority: 100,
      slot: "session-card-badge",
      Component: () => <span data-testid="badge-a">A</span>,
    });
    registry.addClaim({
      pluginId: "b-plugin",
      priority: 200,
      slot: "session-card-badge",
      Component: () => { throw new Error("b-plugin crash"); },
    });
    registry.addClaim({
      pluginId: "c-plugin",
      priority: 300,
      slot: "session-card-badge",
      Component: () => <span data-testid="badge-c">C</span>,
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <PluginContextProvider registry={registry}>
        <SessionCardBadgeSlot session={makeSession()} />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("badge-a")).toBeDefined();
    expect(screen.queryByTestId("badge-b")).toBeNull();
    expect(screen.getByTestId("badge-c")).toBeDefined();

    // Error was logged with plugin id and slot id
    const errorCalls = consoleSpy.mock.calls.map(c => c.join(" "));
    expect(errorCalls.some(s => s.includes("b-plugin") && s.includes("session-card-badge"))).toBe(true);
    consoleSpy.mockRestore();
  });

  it("slot with one throwing plugin renders nothing without propagating to parent", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "crash-plugin",
      priority: 100,
      slot: "session-card-badge",
      Component: () => { throw new Error("crash"); },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Should not throw
    expect(() =>
      render(
        <PluginContextProvider registry={registry}>
          <div data-testid="parent">
            <SessionCardBadgeSlot session={makeSession()} />
          </div>
        </PluginContextProvider>,
      ),
    ).not.toThrow();

    expect(screen.getByTestId("parent")).toBeDefined();
    consoleSpy.mockRestore();
  });
});

// ── SettingsSectionSlot tab filtering ────────────────────────────────────────

describe("SettingsSectionSlot is inert", () => {
  // See change: plugin-settings-pages (design D3, test-plan #E20).
  it("renders no settings-section content for any tab", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "general-plugin",
      priority: 100,
      slot: "settings-section",
      tab: "general",
      Component: () => <div data-testid="general-section">General</div>,
    });
    registry.addClaim({
      pluginId: "security-plugin",
      priority: 100,
      slot: "settings-section",
      tab: "security",
      Component: () => <div data-testid="security-section">Security</div>,
    });

    for (const tab of ["general", "security", "providers"]) {
      const { container, unmount } = render(
        <PluginContextProvider registry={registry}>
          <SettingsSectionSlot tab={tab} />
        </PluginContextProvider>,
      );
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });

  it("no longer exports a tab filter helper", async () => {
    // `forTab` lost its last caller with the flip; deleting it stops future
    // code re-deriving tab routing. (test-plan #E20)
    const registryModule = await import("../slot-registry.js");
    expect("forTab" in registryModule).toBe(false);
  });
});

// ── SettingsSectionByPluginSlot — the single render path ─────────────────────

describe("SettingsSectionByPluginSlot", () => {
  // Every `tab` value routes identically: onto the owning plugin's page.
  // (test-plan #E13)
  it("renders claims regardless of their tab value", () => {
    const registry = createSlotRegistry();
    for (const [i, tab] of ["general", "security", undefined].entries()) {
      registry.addClaim({
        pluginId: "roles",
        priority: 100 + i,
        slot: "settings-section",
        ...(tab ? { tab } : {}),
        Component: () => <div data-testid={`sec-${tab ?? "none"}`}>x</div>,
      });
    }

    render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionByPluginSlot pluginId="roles" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("sec-general")).toBeDefined();
    expect(screen.getByTestId("sec-security")).toBeDefined();
    expect(screen.getByTestId("sec-none")).toBeDefined();
  });

  it("renders only the owning plugin's claims", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "roles",
      priority: 100,
      slot: "settings-section",
      Component: () => <div data-testid="roles-section">Roles</div>,
    });
    registry.addClaim({
      pluginId: "flows",
      priority: 100,
      slot: "settings-section",
      Component: () => <div data-testid="flows-section">Flows</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionByPluginSlot pluginId="roles" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("roles-section")).toBeDefined();
    expect(screen.queryByTestId("flows-section")).toBeNull();
  });

  // Ascending priority, per the registry comparator — NOT the descending order
  // the old comment claimed. (test-plan #E14)
  it("orders claims by ascending priority", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "roles",
      priority: 500,
      slot: "settings-section",
      Component: () => <div data-testid="p500">late</div>,
    });
    registry.addClaim({
      pluginId: "roles",
      priority: 10,
      slot: "settings-section",
      Component: () => <div data-testid="p10">early</div>,
    });

    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionByPluginSlot pluginId="roles" />
      </PluginContextProvider>,
    );

    const order = Array.from(container.querySelectorAll("[data-testid]")).map(
      (el) => el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["p10", "p500"]);
  });

  // Ties break on pluginId.localeCompare, not registration order.
  // (test-plan #E15)
  it("breaks equal priority by pluginId, not registration order", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "zeta",
      priority: 100,
      slot: "settings-section",
      Component: () => <div>z</div>,
    });
    registry.addClaim({
      pluginId: "alpha",
      priority: 100,
      slot: "settings-section",
      Component: () => <div>a</div>,
    });
    expect(
      registry.getClaims("settings-section").map((c) => c.pluginId),
    ).toEqual(["alpha", "zeta"]);
  });

  // A throwing plugin component is contained; the host chrome around this slot
  // is unaffected because the boundary sits inside it. (test-plan #X6)
  it("contains a throwing plugin component in a SlotErrorBoundary", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "boom",
      priority: 100,
      slot: "settings-section",
      Component: () => {
        throw new Error("plugin exploded");
      },
    });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <PluginContextProvider registry={registry}>
          <div data-testid="host-chrome">
            <SettingsSectionByPluginSlot pluginId="boom" />
          </div>
        </PluginContextProvider>,
      ),
    ).not.toThrow();
    expect(screen.getByTestId("host-chrome")).toBeDefined();
    spy.mockRestore();
  });

  it("renders nothing for a plugin with no contribution", () => {
    const registry = createSlotRegistry();
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionByPluginSlot pluginId="nobody" />
      </PluginContextProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── ToolRendererSlot ─────────────────────────────────────────────────────────

describe("ToolRendererSlot", () => {
  it("uses plugin component when toolName matches", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "demo",
      priority: 100,
      slot: "tool-renderer",
      toolName: "DashboardDemo",
      Component: () => <div data-testid="demo-renderer">Demo</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <ToolRendererSlot toolName="DashboardDemo" toolInput={{}} sessionId="s1" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("demo-renderer")).toBeDefined();
  });

  it("falls through to FallbackComponent when no claim matches", () => {
    const registry = createSlotRegistry();
    const Fallback = () => <div data-testid="fallback">Generic</div>;

    render(
      <PluginContextProvider registry={registry}>
        <ToolRendererSlot
          toolName="UnknownTool"
          toolInput={{}}
          sessionId="s1"
          FallbackComponent={Fallback}
        />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("fallback")).toBeDefined();
  });
});

// ── WorktreeCardSectionSlot (folder-scoped, on worktree session cards) ───────

describe("WorktreeCardSectionSlot", () => {
  it("renders folder-scoped claims with the worktree's cwd", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "kb",
      priority: 100,
      slot: "worktree-card-section",
      Component: ({ folder }: { folder: { cwd: string } }) => (
        <span data-testid="wt-kb">{folder.cwd}</span>
      ),
    });
    render(
      <PluginContextProvider registry={registry}>
        <WorktreeCardSectionSlot folder={{ cwd: "/repo/.worktrees/feat" }} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("wt-kb").textContent).toBe("/repo/.worktrees/feat");
  });

  it("passes placement=\"card\" to rendered claims", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "kb",
      priority: 100,
      slot: "worktree-card-section",
      Component: ({ placement }: { placement?: string }) => (
        <span data-testid="wt-placement">{placement ?? "(none)"}</span>
      ),
    });
    render(
      <PluginContextProvider registry={registry}>
        <WorktreeCardSectionSlot folder={{ cwd: "/repo/.worktrees/feat" }} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("wt-placement").textContent).toBe("card");
  });

  it("renders nothing when no claims target the slot", () => {
    const registry = createSlotRegistry();
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <WorktreeCardSectionSlot folder={{ cwd: "/repo/.worktrees/feat" }} />
      </PluginContextProvider>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing (no throw) outside a PluginContextProvider", () => {
    const { container } = render(
      <WorktreeCardSectionSlot folder={{ cwd: "/repo/.worktrees/feat" }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

// ── Outside provider: graceful degradation ───────────────────────────────────

describe("slot consumer outside PluginContextProvider", () => {
  it("renders nothing (no throw) when outside provider", () => {
    // Slot consumers gracefully render nothing when no provider is present
    // so existing component tests don't need wrapping.
    const { container } = render(<SessionCardBadgeSlot session={makeSession()} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── shouldRender semantics (auto-hide-empty-session-subcards) ───────────────

describe("useSlotHasClaimsForSession with shouldRender", () => {
  const wrap =
    (registry: ReturnType<typeof createSlotRegistry>) =>
    ({ children }: { children: React.ReactNode }) => (
      <PluginContextProvider registry={registry}>{children}</PluginContextProvider>
    );

  it("returns false when only claim's shouldRender returns false", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "closed",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>shouldnt-render</span>,
    });
    const { result } = renderHook(
      () => useSlotHasClaimsForSession("session-card-memory", makeSession()),
      { wrapper: wrap(registry) },
    );
    expect(result.current).toBe(false);
  });

  it("returns true when at least one claim's shouldRender returns true", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "closed",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>nope</span>,
    });
    registry.addClaim({
      pluginId: "open",
      priority: 200,
      slot: "session-card-memory",
      shouldRender: () => true,
      Component: () => <span data-testid="open">open</span>,
    });
    const { result } = renderHook(
      () => useSlotHasClaimsForSession("session-card-memory", makeSession()),
      { wrapper: wrap(registry) },
    );
    expect(result.current).toBe(true);
  });

  it("treats absent shouldRender as pass-through (true)", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "legacy",
      priority: 100,
      slot: "session-card-memory",
      Component: () => <span>legacy</span>,
    });
    const { result } = renderHook(
      () => useSlotHasClaimsForSession("session-card-memory", makeSession()),
      { wrapper: wrap(registry) },
    );
    expect(result.current).toBe(true);
  });

  it("returns false outside PluginContextProvider", () => {
    const { result } = renderHook(() =>
      useSlotHasClaimsForSession("session-card-memory", makeSession()),
    );
    expect(result.current).toBe(false);
  });
});

describe("SessionCardMemorySlot with shouldRender", () => {
  it("mounts only claims whose shouldRender returns true", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "closed",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span data-testid="closed-badge">closed</span>,
    });
    registry.addClaim({
      pluginId: "open",
      priority: 200,
      slot: "session-card-memory",
      shouldRender: () => true,
      Component: () => <span data-testid="open-badge">open</span>,
    });
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardMemorySlot session={makeSession()} />
      </PluginContextProvider>,
    );
    expect(screen.queryByTestId("closed-badge")).toBeNull();
    expect(screen.getByTestId("open-badge")).toBeDefined();
  });

  it("renders nothing when every claim is gated out", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "a",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>a</span>,
    });
    registry.addClaim({
      pluginId: "b",
      priority: 200,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>b</span>,
    });
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SessionCardMemorySlot session={makeSession()} />
      </PluginContextProvider>,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("ComposerPanelSlot", () => {
  it("renders a composer-panel claim and passes the read-only draft context", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "grammar",
      priority: 100,
      slot: "composer-panel",
      Component: (props: Record<string, unknown>) => (
        <span data-testid="panel">{`draft=${String(props.draft)} lang=${String(props.language)}`}</span>
      ),
    });
    render(
      <PluginContextProvider registry={registry}>
        <ComposerPanelSlot draft="teh cat" language="en" onApplyText={() => {}} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("panel").textContent).toBe("draft=teh cat lang=en");
  });

  it("renders nothing when no plugin claims composer-panel", () => {
    const registry = createSlotRegistry();
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <ComposerPanelSlot draft="anything" onApplyText={() => {}} />
      </PluginContextProvider>,
    );
    expect(container.textContent).toBe("");
  });
});

// ── composer-context-group (move-quota-to-context-strip) ─────────────────────

describe("ComposerContextGroupSlot", () => {
  it("E12: renders claims in ascending priority order (lower priority first)", () => {
    // The repo-wide `many`-slot comparator is ascending priority, tie-broken by
    // plugin id (see `compareClaims` + slot-registry.test.ts: "sorts by priority
    // asc"). The test-plan's E12 prose listed the two claims in the opposite
    // order; the established convention wins.
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "b",
      priority: 10,
      slot: "composer-context-group",
      Component: () => <span data-testid="ctx-b">B</span>,
    });
    registry.addClaim({
      pluginId: "a",
      priority: 20,
      slot: "composer-context-group",
      Component: () => <span data-testid="ctx-a">A</span>,
    });
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <ComposerContextGroupSlot session={makeSession()} />
      </PluginContextProvider>,
    );
    const order = Array.from(container.querySelectorAll<HTMLElement>("[data-testid^=ctx-]")).map(
      (el) => el.dataset.testid,
    );
    expect(order).toEqual(["ctx-b", "ctx-a"]);
  });

  it("E13: an empty contribution leaves no divider or label behind", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "empty",
      priority: 100,
      slot: "composer-context-group",
      Component: () => null,
    });
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <ComposerContextGroupSlot session={makeSession()} />
      </PluginContextProvider>,
    );
    expect(container.childElementCount).toBe(0);
  });

  it("E14: shouldRender filters by session", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "gate",
      priority: 100,
      slot: "composer-context-group",
      shouldRender: (s) => !!s && "id" in s && s.id === "s2",
      Component: () => <span data-testid="ctx-gated">gated</span>,
    });
    const { rerender } = render(
      <PluginContextProvider registry={registry}>
        <ComposerContextGroupSlot session={makeSession("s1")} />
      </PluginContextProvider>,
    );
    expect(screen.queryByTestId("ctx-gated")).toBeNull();
    rerender(
      <PluginContextProvider registry={registry}>
        <ComposerContextGroupSlot session={makeSession("s2")} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("ctx-gated")).toBeTruthy();
  });
});

describe("ComposerContextGroup primitive", () => {
  // Re-implemented over ToolbarGroup (info variant).
  // See change: redesign-composer-session-strip (D1).
  it("E15: renders one labelled info group — label first, children inside the content element", () => {
    render(
      <ComposerContextGroup label="Quota" testId="g">
        <span data-testid="g-child">child</span>
      </ComposerContextGroup>,
    );
    const root = screen.getByTestId("g");
    expect(root.getAttribute("role")).toBe("group");
    expect(root.getAttribute("data-group")).toBe("info");
    expect(root.className).toContain("border-dashed");
    const label = screen.getByTestId("g-label");
    expect(label.textContent).toBe("Quota");
    expect(label.className).toContain("uppercase");
    // Order: label → content (holding the child).
    expect(root.children[0]).toBe(label);
    const content = root.children[1]!;
    expect(content.hasAttribute("data-group-content")).toBe(true);
    expect(content.contains(screen.getByTestId("g-child"))).toBe(true);
  });

  // test-plan #E10
  it("E10: role group named by a string label and by a node label", () => {
    const { unmount } = render(
      <ComposerContextGroup label="Quota" testId="quota-context-group">
        <span>x</span>
      </ComposerContextGroup>,
    );
    expect(screen.getByRole("group", { name: "Quota" })).toBe(screen.getByTestId("quota-context-group"));
    expect(screen.getByTestId("quota-context-group-label").textContent).toBe("Quota");
    unmount();
    render(
      <ComposerContextGroup label={<b>Quota</b>} testId="quota-context-group">
        <span>x</span>
      </ComposerContextGroup>,
    );
    expect(screen.getByRole("group", { name: "Quota" })).toBeTruthy();
  });

  it("E10: without a testId no element gets data-testid=\"undefined-label\"", () => {
    const { container } = render(
      <ComposerContextGroup label="Quota">
        <span>x</span>
      </ComposerContextGroup>,
    );
    expect(container.querySelector('[data-testid="undefined-label"]')).toBeNull();
    expect(container.querySelector("[data-testid]")).toBeNull();
    expect(screen.getByRole("group", { name: "Quota" })).toBeTruthy();
  });
});

describe("ToolbarGroup primitive (2.1)", () => {
  it("actions variant: solid outline + label segment; labelTestId overrides the derived id", () => {
    render(
      <ToolbarGroup label="Git" testId="composer-git-container" labelTestId="composer-git-group-label">
        <button type="button">Push</button>
      </ToolbarGroup>,
    );
    const root = screen.getByTestId("composer-git-container");
    expect(root.getAttribute("data-group")).toBe("actions");
    expect(root.className).not.toContain("border-dashed");
    expect(screen.getByTestId("composer-git-group-label").textContent).toBe("Git");
    expect(screen.queryByTestId("composer-git-container-label")).toBeNull();
    expect(screen.getByRole("group", { name: "Git" })).toBe(root);
  });

  it("contentAs=fieldset: the primitive renders the content element with data-group-content + contentProps", () => {
    render(
      <ToolbarGroup label="Status" testId="c" contentAs="fieldset" contentProps={{ disabled: true, "data-testid": "composer-status-group" }}>
        <button type="button">x</button>
      </ToolbarGroup>,
    );
    const root = screen.getByTestId("c");
    expect(root.children).toHaveLength(2);
    const content = screen.getByTestId("composer-status-group");
    expect(content.tagName).toBe("FIELDSET");
    expect(content.hasAttribute("data-group-content")).toBe(true);
    expect((content as HTMLFieldSetElement).disabled).toBe(true);
    expect(root.querySelectorAll("[data-group-content]")).toHaveLength(1);
  });

  it("actions content draws hairlines between direct children and gives them ≥24 px targets", () => {
    render(
      <ToolbarGroup label="Git" testId="g">
        <button type="button">a</button>
      </ToolbarGroup>,
    );
    const content = screen.getByTestId("g").querySelector("[data-group-content]")!;
    expect(content.className).toContain("[&>*+*]:border-l");
    expect(content.className).toContain("[&>button]:min-h-6");
  });
});

// ── test-plan #X5: empty plugin contribution leaves no trace ────────────────

describe("ComposerContextGroupSlot — empty contribution (#X5)", () => {
  it("a claim rendering null leaves no container or label; other claims unaffected", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "empty",
      priority: 100,
      slot: "composer-context-group",
      Component: () => null,
    });
    registry.addClaim({
      pluginId: "quota",
      priority: 110,
      slot: "composer-context-group",
      Component: () => (
        <ComposerContextGroup label="Quota" testId="quota-context-group">
          <span>9%</span>
        </ComposerContextGroup>
      ),
    });
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <ComposerContextGroupSlot session={makeSession("s1")} />
      </PluginContextProvider>,
    );
    expect(container.querySelectorAll("[data-group]")).toHaveLength(1);
    expect(screen.getByTestId("quota-context-group-label")).toBeTruthy();
  });
});

// ── useSlotHasAnyClaims (configurable-session-card-sections) ────────────────

describe("useSlotHasAnyClaims", () => {
  const wrap =
    (registry: ReturnType<typeof createSlotRegistry>) =>
    ({ children }: { children: React.ReactNode }) => (
      <PluginContextProvider registry={registry}>{children}</PluginContextProvider>
    );

  it("returns false when no plugin claims the slot", () => {
    const registry = createSlotRegistry();
    const { result } = renderHook(() => useSlotHasAnyClaims("session-card-memory"), { wrapper: wrap(registry) });
    expect(result.current).toBe(false);
  });

  it("returns true when a claim exists, even if it would not render for a session", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "mem",
      priority: 100,
      slot: "session-card-memory",
      shouldRender: () => false,
      Component: () => <span>m</span>,
    });
    const { result } = renderHook(() => useSlotHasAnyClaims("session-card-memory"), { wrapper: wrap(registry) });
    expect(result.current).toBe(true);
  });

  it("returns false without a registry", () => {
    const { result } = renderHook(() => useSlotHasAnyClaims("session-card-memory"));
    expect(result.current).toBe(false);
  });
});

// ── isPluginVisible filter (add-focus-mode-and-card-block-toggles #E16) ──────

describe("isPluginVisible filter", () => {
  it("hides a legacy claim AND an intent of a hidden plugin; absent prop = unchanged", () => {
    intentStore.__resetForTests();
    const registry = createSlotRegistry();
    const prims = createUiPrimitiveRegistry();
    registerUiPrimitive(
      prims,
      "ui:action-list" as never,
      (({ actions }: { actions: { label: string }[] }) => <b>{actions.map((a) => a.label)}</b>) as never,
    );
    registry.addClaim({
      pluginId: "automation",
      priority: 1,
      slot: "session-card-badge",
      Component: () => <span data-testid="legacy">L</span>,
    });
    intentStore.set(
      { pluginId: "browser", sessionId: "s1", slot: "session-card-badge" },
      { primitive: "ui:action-list", props: { actions: [{ label: "intent-browser" }] } } as never,
    );
    const view = (isPluginVisible?: (id: string) => boolean) =>
      render(
        <UiPrimitiveProvider value={prims}>
          <PluginContextProvider registry={registry}>
            <SessionCardBadgeSlot session={makeSession()} isPluginVisible={isPluginVisible} />
          </PluginContextProvider>
        </UiPrimitiveProvider>,
      );
    let r = view((id) => id !== "automation" && id !== "browser");
    expect(screen.queryByTestId("legacy")).toBeNull();
    expect(r.container.textContent ?? "").not.toContain("intent-browser");
    r.unmount();
    r = view((id) => id !== "browser");
    expect(screen.getByTestId("legacy")).toBeDefined();
    expect(r.container.textContent ?? "").not.toContain("intent-browser");
    r.unmount();
    r = view();
    expect(screen.getByTestId("legacy")).toBeDefined();
    expect(r.container.textContent ?? "").toContain("intent-browser");
    intentStore.__resetForTests();
  });

  it("action bar and folder section honour the filter", () => {
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "goal", priority: 1, slot: "session-card-action-bar", Component: () => <i data-testid="ab" /> });
    registry.addClaim({ pluginId: "kb", priority: 1, slot: "sidebar-folder-section", Component: () => <i data-testid="fs" /> });
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardActionBarSlot session={makeSession()} isPluginVisible={() => false} />
        <SidebarFolderSectionSlot folder={{ cwd: "/repo" } as never} isPluginVisible={() => false} />
      </PluginContextProvider>,
    );
    expect(screen.queryByTestId("ab")).toBeNull();
    expect(screen.queryByTestId("fs")).toBeNull();
    cleanup();
    render(
      <PluginContextProvider registry={registry}>
        <SessionCardActionBarSlot session={makeSession()} isPluginVisible={() => true} />
        <SidebarFolderSectionSlot folder={{ cwd: "/repo" } as never} />
      </PluginContextProvider>,
    );
    expect(screen.getByTestId("ab")).toBeDefined();
    expect(screen.getByTestId("fs")).toBeDefined();
  });

  it("useSlotHasVisibleClaimsForSession reflects the filter", () => {
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "automation", priority: 1, slot: "session-card-badge", Component: () => null });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginContextProvider registry={registry}>{children}</PluginContextProvider>
    );
    const on = renderHook(() => useSlotHasVisibleClaimsForSession("session-card-badge", makeSession(), () => true), { wrapper });
    expect(on.result.current).toBe(true);
    const off = renderHook(() => useSlotHasVisibleClaimsForSession("session-card-badge", makeSession(), () => false), { wrapper });
    expect(off.result.current).toBe(false);
  });
});
