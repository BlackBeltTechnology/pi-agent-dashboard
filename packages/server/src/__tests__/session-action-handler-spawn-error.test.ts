import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock spawnPiSession BEFORE importing the handler.
vi.mock("../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
}));
vi.mock("../../../shared/src/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30000 }),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: () => ({ spawnStrategy: "headless" as const, spawnRegisterTimeoutMs: 30000 }),
}));
// Preflight always passes in these tests so spawnPiSession is always reached.
vi.mock("../spawn-process/spawn-preflight.js", () => ({
  preflightSpawn: vi.fn().mockReturnValue({ ok: true, reasons: [] }),
}));
vi.mock("../spawn-process/spawn-register-watchdog.js", () => ({
  getSpawnRegisterWatchdog: vi.fn().mockReturnValue({ arm: vi.fn() }),
}));
vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", () => ({
  ToolResolver: function MockToolResolver() {
    return { resolvePi: vi.fn().mockReturnValue(["pi"]), resolveNode: vi.fn().mockReturnValue("/usr/bin/node") };
  },
}));

import { handleSpawnSession } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

type SentMessage = { type: string; [k: string]: unknown };

function makeCtx() {
  const sent: SentMessage[] = [];
  const ws = { readyState: 1 } as unknown as WebSocket;
  const ctx = {
    ws,
    headlessPidRegistry: { register: vi.fn() },
    pendingDashboardSpawns: new Map<string, number>(),
    sendTo: (_ws: unknown, msg: SentMessage) => { sent.push(msg); },
  } as any;
  return { ctx, sent };
}

describe("handleSpawnSession — error propagation", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("emits spawn_error when spawnPiSession throws", async () => {
    (spawnPiSession as any).mockRejectedValueOnce(new Error("ENOENT: pi not found"));
    const { ctx, sent } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "C:\\proj" } as any, ctx);
    const errMsg = sent.find(m => m.type === "spawn_error");
    const resMsg = sent.find(m => m.type === "spawn_result");
    expect(resMsg).toBeDefined();
    expect(resMsg!.success).toBe(false);
    expect(errMsg).toBeDefined();
    expect(errMsg!.cwd).toBe("C:\\proj");
    expect(errMsg!.strategy).toBe("headless");
    expect(errMsg!.message).toMatch(/ENOENT/);
  });

  it("emits spawn_error when spawnPiSession returns { success: false }", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: false, message: "tmux unavailable" });
    const { ctx, sent } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/app" } as any, ctx);
    const errMsg = sent.find(m => m.type === "spawn_error");
    expect(errMsg).toBeDefined();
    expect(errMsg!.message).toBe("tmux unavailable");
  });

  it("does NOT emit spawn_error on successful spawn", async () => {
    (spawnPiSession as any).mockResolvedValueOnce({ success: true, message: "ok", pid: 1234 });
    const { ctx, sent } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/app" } as any, ctx);
    expect(sent.some(m => m.type === "spawn_error")).toBe(false);
    expect(sent.some(m => m.type === "spawn_result" && m.success === true)).toBe(true);
  });

  it("includes stderr tail when thrown error carries one", async () => {
    const err = Object.assign(new Error("boom"), { stderr: "line1\nline2\nline3" });
    (spawnPiSession as any).mockRejectedValueOnce(err);
    const { ctx, sent } = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/x" } as any, ctx);
    const errMsg = sent.find(m => m.type === "spawn_error");
    expect(errMsg!.stderr).toContain("line3");
  });
});
