/**
 * Tests for the `applyReattachPolicy` helper and its pure
 * `decideReattachAction` decision function.
 *
 * Covers the matrix from `specs/session-ordering` ADDED Requirement
 * "Reattach placement policy applied on register":
 *   policy × session.status → moveToFront | preserve
 *
 * See change: reattach-move-to-front.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { BrowserGateway } from "../browser-gateway.js";
import { createMemorySessionManager, type SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import {
  applyReattachPolicy,
  decideReattachAction,
} from "../reattach-placement.js";
import { createSessionOrderManager, type SessionOrderManager } from "../session-order-manager.js";

function makePrefs(): PreferencesStore {
  let order: Record<string, string[]> = {};
  return {
    getSessionOrder: () => order,
    setSessionOrder: (o) => { order = o; },
    getPinnedDirectories: () => [],
    setPinnedDirectories: () => {},
    pinDirectory: () => {},
    unpinDirectory: () => {},
    reorderPinnedDirs: () => {},
    getFavoriteModels: () => [],
    setFavoriteModels: () => {},
    addFavoriteModel: () => {},
    removeFavoriteModel: () => {},
    getWorkspaces: () => [],
    createWorkspace: () => null,
    renameWorkspace: () => false,
    deleteWorkspace: () => false,
    setWorkspaceCollapsed: () => false,
    addFolderToWorkspace: () => false,
    removeFolderFromWorkspace: () => false,
    reorderWorkspaceFolders: () => false,
    reorderWorkspaces: () => false,
    flush: () => {},
    getDisplayPrefs: () => undefined,
    getOpenSpecUpdateSignature: () => undefined,
    getAutoInitWorktreeOnSpawn: () => false,
    getAutoNameSessions: () => true,
    setAutoNameSessions: () => {},
    getLiveServers: () => [],
    setLiveServers: () => {},
    setAutoInitWorktreeOnSpawn: () => {},
    setOpenSpecUpdateSignature: () => {},
    setDisplayPrefs: (p: any) => p,
    dispose: () => {},
  };
}

function makeBroadcastingGateway() {
  const broadcasts: any[] = [];
  const gateway = {
    broadcastToAll: (msg: any) => { broadcasts.push(msg); },
    // Other BrowserGateway members are unused by the helper.
  } as unknown as BrowserGateway;
  return { gateway, broadcasts };
}

describe("decideReattachAction (pure)", () => {
  it("'always' moves on any non-ended status", () => {
    expect(decideReattachAction("always", "active")).toBe("moveToFront");
    expect(decideReattachAction("always", "streaming")).toBe("moveToFront");
    expect(decideReattachAction("always", "idle")).toBe("moveToFront");
  });

  it("'streaming-only' moves only when status is 'streaming'", () => {
    expect(decideReattachAction("streaming-only", "streaming")).toBe("moveToFront");
    expect(decideReattachAction("streaming-only", "active")).toBe("preserve");
    expect(decideReattachAction("streaming-only", "idle")).toBe("preserve");
    expect(decideReattachAction("streaming-only", "ended")).toBe("preserve");
    expect(decideReattachAction("streaming-only", undefined)).toBe("preserve");
  });

  it("'preserve' never moves", () => {
    expect(decideReattachAction("preserve", "streaming")).toBe("preserve");
    expect(decideReattachAction("preserve", "active")).toBe("preserve");
  });
});

describe("applyReattachPolicy (I/O)", () => {
  const cwd = "/proj";
  let sessionManager: SessionManager;
  let sessionOrderManager: SessionOrderManager;
  let gateway: BrowserGateway;
  let broadcasts: any[];

  beforeEach(() => {
    sessionManager = createMemorySessionManager();
    sessionOrderManager = createSessionOrderManager(makePrefs());
    const gw = makeBroadcastingGateway();
    gateway = gw.gateway;
    broadcasts = gw.broadcasts;
  });

  function setupSession(id: string, status: "active" | "streaming" | "idle" | "ended" = "active") {
    sessionManager.register({ id, cwd, source: "tui" });
    if (status !== "active") sessionManager.update(id, { status });
  }

  it("'always' moves a buried session to index 0 and broadcasts", () => {
    setupSession("A");
    setupSession("B");
    setupSession("C");
    sessionOrderManager.reorder(cwd, ["A", "B", "C"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy("C", cwd, "always", {
      sessionManager,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("moveToFront");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["C", "A", "B"]);
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      type: "sessions_reordered",
      cwd,
      sessionIds: ["C", "A", "B"],
    });
  });

  it("'streaming-only' moves a streaming session", () => {
    setupSession("A");
    setupSession("B", "streaming");
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy("B", cwd, "streaming-only", {
      sessionManager,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("moveToFront");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["B", "A"]);
    expect(broadcasts).toHaveLength(1);
  });

  it("'streaming-only' does NOT move a non-streaming session", () => {
    setupSession("A");
    setupSession("B", "active");
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy("B", cwd, "streaming-only", {
      sessionManager,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("preserve");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "B"]);
    expect(broadcasts).toEqual([]);
  });

  it("'preserve' never moves regardless of status", () => {
    setupSession("A");
    setupSession("B", "streaming");
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy("B", cwd, "preserve", {
      sessionManager,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("preserve");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "B"]);
    expect(broadcasts).toEqual([]);
  });

  it("no-ops if session is missing from manager", () => {
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy("ghost", cwd, "always", {
      sessionManager,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("preserve");
    expect(broadcasts).toEqual([]);
  });

  it("'streaming-only' honors priorStatus when post-register status is 'active' (regression: register() coerces status)", () => {
    // Repro: pre-restart the session was streaming; the dashboard restarts;
    // the bridge re-registers; `register()` overwrites status to "active".
    // Without priorStatus, applyReattachPolicy would see status: "active"
    // and `streaming-only` would be a silent no-op.
    setupSession("A");
    setupSession("B"); // status defaults to "active" post-register
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    // Pass priorStatus: "streaming" (what register() saw before overwriting)
    const action = applyReattachPolicy(
      "B",
      cwd,
      "streaming-only",
      { sessionManager, sessionOrderManager, browserGateway: gateway },
      "streaming",
    );

    expect(action).toBe("moveToFront");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["B", "A"]);
    expect(broadcasts).toHaveLength(1);
  });

  it("'streaming-only' falls back to session.status when priorStatus is undefined", () => {
    setupSession("A");
    setupSession("B", "streaming");
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy(
      "B",
      cwd,
      "streaming-only",
      { sessionManager, sessionOrderManager, browserGateway: gateway },
      undefined,
    );

    expect(action).toBe("moveToFront");
  });

  it("no-ops if session has ended (defensive)", () => {
    setupSession("A");
    setupSession("B", "ended");
    sessionOrderManager.reorder(cwd, ["A", "B"]);
    broadcasts.length = 0;

    const action = applyReattachPolicy("B", cwd, "always", {
      sessionManager,
      sessionOrderManager,
      browserGateway: gateway,
    });

    expect(action).toBe("preserve");
    expect(sessionOrderManager.getOrder(cwd)).toEqual(["A", "B"]);
    expect(broadcasts).toEqual([]);
  });
});
