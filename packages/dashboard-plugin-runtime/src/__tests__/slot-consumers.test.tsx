import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { render, renderHook, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { PluginContextProvider } from "../plugin-context.js";
import {
  SessionCardBadgeSlot,
  SessionCardMemorySlot,
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

describe("SettingsSectionSlot", () => {
  it("filters claims by tab", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "security-plugin",
      priority: 100,
      slot: "settings-section",
      tab: "security",
      Component: () => <div data-testid="security-section">Security</div>,
    });
    registry.addClaim({
      pluginId: "general-plugin",
      priority: 100,
      slot: "settings-section",
      tab: "general",
      Component: () => <div data-testid="general-section">General</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionSlot tab="security" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("security-section")).toBeDefined();
    expect(screen.queryByTestId("general-section")).toBeNull();
  });

  it("claim without tab defaults to general", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "no-tab-plugin",
      priority: 100,
      slot: "settings-section",
      // no tab field → defaults to "general"
      Component: () => <div data-testid="no-tab-section">NoTab</div>,
    });

    render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionSlot tab="general" />
      </PluginContextProvider>,
    );

    expect(screen.getByTestId("no-tab-section")).toBeDefined();
  });

  it("renders nothing when no claims match tab", () => {
    const registry = createSlotRegistry();
    const { container } = render(
      <PluginContextProvider registry={registry}>
        <SettingsSectionSlot tab="providers" />
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
