import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { render, renderHook, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { PluginContextProvider } from "../plugin-context.js";
import {
  ComposerPanelSlot,
  SessionCardBadgeSlot,
  SessionCardMemorySlot,
  SettingsSectionByPluginSlot,
  SettingsSectionSlot,
  ToolRendererSlot,
  useSlotHasClaimsForSession,
  WorktreeCardSectionSlot,
} from "../slot-consumers.js";
import { createSlotRegistry } from "../slot-registry.js";

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
