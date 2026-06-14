/**
 * Tests for session-sync: sendStateSync and handleSessionSwitch.
 */
import { describe, it, expect, vi } from "vitest";
import { sendStateSync, handleSessionChange } from "../session-sync.js";
import type { BridgeContext } from "../bridge-context.js";

function createMockBridgeContext(overrides?: Partial<BridgeContext>): BridgeContext {
  const sent: any[] = [];
  return {
    pi: {
      getSessionName: () => "test-session",
      getCommands: () => [],
    } as any,
    connection: {
      send: (msg: any) => sent.push(msg),
    } as any,
    sessionId: "sess-123",
    cachedCtx: {
      sessionManager: {
        getSessionFile: () => "/path/to/session.json",
        getSessionDir: () => "/path/to/session",
        getBranch: () => [{ role: "user", content: "hello" }],
        getEntries: () => [{ role: "user", content: "hello" }],
      },
    },
    cachedModelRegistry: null,
    cachedHasUI: true,
    lastModel: undefined,
    lastThinkingLevel: undefined,
    lastSessionFile: undefined,
    lastSessionDir: undefined,
    lastFirstMessage: undefined,
    lastGitBranch: undefined,
    lastGitPrNumber: undefined,
    lastSessionName: undefined,
    hasRegisteredOnce: false,
    dashboardSpawned: false,
    ...overrides,
    // Expose sent messages for assertions
    _sent: sent,
  } as any;
}

describe("sendStateSync", () => {
  it("should include pid in session_register message", () => {
    const bc = createMockBridgeContext();
    sendStateSync(bc, () => []);

    const sent = (bc as any)._sent;
    const registerMsg = sent.find((m: any) => m.type === "session_register");
    expect(registerMsg).toBeDefined();
    expect(registerMsg.pid).toBe(process.pid);
    expect(typeof registerMsg.pid).toBe("number");
    expect(registerMsg.pid).toBeGreaterThan(0);
  });

  // ── reattach-move-to-front ──

  it("first sendStateSync after boot tags registerReason: spawn", () => {
    const bc = createMockBridgeContext();
    expect(bc.hasRegisteredOnce).toBe(false);

    sendStateSync(bc, () => []);

    const sent = (bc as any)._sent;
    const registerMsg = sent.find((m: any) => m.type === "session_register");
    expect(registerMsg.registerReason).toBe("spawn");
    expect(bc.hasRegisteredOnce).toBe(true);
  });

  it("second sendStateSync (reconnect) tags registerReason: reattach", () => {
    const bc = createMockBridgeContext();

    sendStateSync(bc, () => []);
    // Clear sent, simulate reconnect
    (bc as any)._sent.length = 0;
    sendStateSync(bc, () => []);

    const sent = (bc as any)._sent;
    const registerMsg = sent.find((m: any) => m.type === "session_register");
    expect(registerMsg.registerReason).toBe("reattach");
    expect(bc.hasRegisteredOnce).toBe(true);
  });

  it("hasRegisteredOnce flips exactly once and stays true", () => {
    const bc = createMockBridgeContext();

    sendStateSync(bc, () => []);
    expect(bc.hasRegisteredOnce).toBe(true);

    sendStateSync(bc, () => []);
    expect(bc.hasRegisteredOnce).toBe(true);

    sendStateSync(bc, () => []);
    expect(bc.hasRegisteredOnce).toBe(true);
  });

  it("third+ sendStateSync continues to tag reattach", () => {
    const bc = createMockBridgeContext();

    sendStateSync(bc, () => []);
    sendStateSync(bc, () => []);
    (bc as any)._sent.length = 0;
    sendStateSync(bc, () => []);

    const sent = (bc as any)._sent;
    const registerMsg = sent.find((m: any) => m.type === "session_register");
    expect(registerMsg.registerReason).toBe("reattach");
  });
});

describe("handleSessionChange", () => {
  it("always tags registerReason: spawn even after reattach", () => {
    const bc = createMockBridgeContext({ hasRegisteredOnce: true } as any);

    const ctx = {
      cwd: "/proj",
      sessionManager: {
        getSessionId: () => "sess-new",
        getSessionFile: () => "/path/new.json",
        getSessionDir: () => "/path",
        getBranch: () => [],
        getEntries: () => [],
      },
    };

    handleSessionChange(bc, ctx as any, () => []);

    const sent = (bc as any)._sent;
    const registerMsg = sent.find((m: any) => m.type === "session_register");
    expect(registerMsg).toBeDefined();
    expect(registerMsg.sessionId).toBe("sess-new");
    expect(registerMsg.registerReason).toBe("spawn");
  });
});

// See change: spawn-correlation-token — bridge token inclusion contract.
describe("sendStateSync: spawnToken from env", () => {
  const ENV_VAR = "PI_DASHBOARD_SPAWN_TOKEN";

  function withEnvVar<T>(value: string | undefined, fn: () => T): T {
    const prior = process.env[ENV_VAR];
    if (value === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = value;
    try {
      return fn();
    } finally {
      if (prior === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = prior;
    }
  }

  it("first register includes spawnToken from env", () => {
    withEnvVar("tok_first", () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: false } as any);
      sendStateSync(bc, () => []);
      const sent = (bc as any)._sent;
      const registerMsg = sent.find((m: any) => m.type === "session_register");
      expect(registerMsg.spawnToken).toBe("tok_first");
      expect(registerMsg.registerReason).toBe("spawn");
    });
  });

  it("reattach register omits spawnToken (even when env still set)", () => {
    withEnvVar("tok_first", () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: true } as any);
      sendStateSync(bc, () => []);
      const sent = (bc as any)._sent;
      const registerMsg = sent.find((m: any) => m.type === "session_register");
      expect(registerMsg.spawnToken).toBeUndefined();
      expect(registerMsg.registerReason).toBe("reattach");
    });
  });

  it("first register without env var omits spawnToken", () => {
    withEnvVar(undefined, () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: false } as any);
      sendStateSync(bc, () => []);
      const sent = (bc as any)._sent;
      const registerMsg = sent.find((m: any) => m.type === "session_register");
      expect(registerMsg.spawnToken).toBeUndefined();
      expect(registerMsg.registerReason).toBe("spawn");
    });
  });

  // See change: fix-spawn-token-env-leak.
  it("first register emits token + dashboardSpawned:true and scrubs the env var", () => {
    withEnvVar("tok_first", () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: false, dashboardSpawned: true } as any);
      sendStateSync(bc, () => []);
      const registerMsg = (bc as any)._sent.find((m: any) => m.type === "session_register");
      expect(registerMsg.spawnToken).toBe("tok_first");
      expect(registerMsg.dashboardSpawned).toBe(true);
      // Single-use token scrubbed so descendants can't inherit it.
      expect(process.env.PI_DASHBOARD_SPAWN_TOKEN).toBeUndefined();
    });
  });

  it("second register (reattach) omits token but keeps dashboardSpawned:true via capture-once boolean", () => {
    // Env already scrubbed (token gone) but the captured boolean persists.
    withEnvVar(undefined, () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: true, dashboardSpawned: true } as any);
      sendStateSync(bc, () => []);
      const registerMsg = (bc as any)._sent.find((m: any) => m.type === "session_register");
      expect(registerMsg.spawnToken).toBeUndefined();
      expect(registerMsg.dashboardSpawned).toBe(true);
      expect(registerMsg.registerReason).toBe("reattach");
    });
  });

  it("descendant child (no token, dashboardSpawned:false) emits neither field", () => {
    withEnvVar(undefined, () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: false, dashboardSpawned: false } as any);
      sendStateSync(bc, () => []);
      const registerMsg = (bc as any)._sent.find((m: any) => m.type === "session_register");
      expect(registerMsg.spawnToken).toBeUndefined();
      expect(registerMsg.dashboardSpawned).toBeUndefined();
    });
  });

  it("handleSessionChange register omits spawnToken (in-process new/fork/resume)", () => {
    withEnvVar("tok_first", () => {
      const bc = createMockBridgeContext({ hasRegisteredOnce: true } as any);
      const ctx = {
        cwd: "/proj",
        sessionManager: {
          getSessionId: () => "sess-fork",
          getSessionFile: () => "/path/new.json",
          getSessionDir: () => "/path",
          getBranch: () => [],
          getEntries: () => [],
        },
      };
      handleSessionChange(bc, ctx as any, () => []);
      const sent = (bc as any)._sent;
      const registerMsg = sent.find((m: any) => m.type === "session_register" && m.sessionId === "sess-fork");
      expect(registerMsg).toBeDefined();
      expect(registerMsg.spawnToken).toBeUndefined();
      expect(registerMsg.registerReason).toBe("spawn");
    });
  });
});
