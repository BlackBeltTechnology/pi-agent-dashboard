/**
 * Hide/unhide placement (change: simplify-session-card-ordering).
 *   - hide   → moveToFront(resolvedKey) so the card tops the hidden tier.
 *   - unhide → clear hidden + moveToFront so the card tops the ended tier.
 *   - Both broadcast `sessions_reordered` keyed by the resolved group path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSessionOrderManager } from "../session/session-order-manager.js";
import { handleHideSession, handleUnhideSession } from "../browser-handlers/session-meta-handler.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function mockPrefs(order: Record<string, string[]> = {}, pinned: string[] = []): PreferencesStore {
  let o = { ...order };
  return {
    getSessionOrder: () => o,
    setSessionOrder: (n: Record<string, string[]>) => { o = n; },
    getPinnedDirectories: () => pinned,
  } as unknown as PreferencesStore;
}

function ctxFor(sessions: Record<string, Partial<DashboardSession>>, prefs: PreferencesStore) {
  const broadcasts: any[] = [];
  const updates: Record<string, any> = {};
  const sessionOrderManager = createSessionOrderManager(prefs);
  const ctx: any = {
    sessionManager: {
      get: (id: string) => (sessions[id] ? { id, ...sessions[id] } : undefined),
      update: (id: string, u: any) => { updates[id] = { ...(updates[id] ?? {}), ...u }; Object.assign(sessions[id], u); },
    },
    sessionOrderManager,
    preferencesStore: prefs,
    broadcast: (m: any) => broadcasts.push(m),
  };
  return { ctx, broadcasts, updates, sessionOrderManager };
}

describe("hide/unhide placement", () => {
  let prefs: PreferencesStore;

  beforeEach(() => {
    prefs = mockPrefs({ "/repo": ["a", "s2", "b"] });
  });

  it("hide moves the session to the front (top of hidden tier) and broadcasts", () => {
    const { ctx, broadcasts, updates, sessionOrderManager } = ctxFor(
      { s2: { cwd: "/repo", status: "ended" } },
      prefs,
    );
    handleHideSession({ type: "hide_session", sessionId: "s2" } as any, ctx);
    expect(updates.s2).toMatchObject({ hidden: true });
    expect(sessionOrderManager.getOrder("/repo")).toEqual(["s2", "a", "b"]);
    const reorder = broadcasts.find((b) => b.type === "sessions_reordered");
    expect(reorder).toMatchObject({ cwd: "/repo", sessionIds: ["s2", "a", "b"] });
  });

  it("unhide clears hidden, moves to front (top of ended tier), and broadcasts", () => {
    const { ctx, broadcasts, updates, sessionOrderManager } = ctxFor(
      { s2: { cwd: "/repo", status: "ended", hidden: true } },
      prefs,
    );
    handleUnhideSession({ type: "unhide_session", sessionId: "s2" } as any, ctx);
    expect(updates.s2).toMatchObject({ hidden: false });
    expect(sessionOrderManager.getOrder("/repo")).toEqual(["s2", "a", "b"]);
    expect(broadcasts.find((b) => b.type === "sessions_reordered")).toMatchObject({
      cwd: "/repo",
      sessionIds: ["s2", "a", "b"],
    });
  });

  it("keys by resolved group path for a worktree session (parent repo)", () => {
    const worktreePrefs = mockPrefs({ "/repo": ["a", "w"] });
    const { ctx, broadcasts, sessionOrderManager } = ctxFor(
      {
        w: {
          cwd: "/repo/.worktrees/feat-x",
          status: "ended",
          gitWorktree: { mainPath: "/repo", name: "feat-x" },
        },
      },
      worktreePrefs,
    );
    handleHideSession({ type: "hide_session", sessionId: "w" } as any, ctx);
    // Written under the PARENT key, not the worktree cwd.
    expect(sessionOrderManager.getOrder("/repo")).toEqual(["w", "a"]);
    expect(broadcasts.find((b) => b.type === "sessions_reordered").cwd).toBe("/repo");
  });
});
