/**
 * Tests for handleForceKill in session-action-handler.
 *
 * Kill-path routing (see change: route-kill-paths-through-platform):
 * we verify that the handler delegates to the platform `killProcess`
 * helper rather than calling `process.kill(...)` directly. Cross-OS
 * behavior of `killProcess` itself is covered in
 * `packages/shared/src/__tests__/platform-process.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Spy on the platform module so we can assert the handler routes through it.
const killProcessSpy = vi.fn(async (_pid: number, _opts?: any) => ({ ok: true, forced: false }));
const isProcessAliveSpy = vi.fn((_pid: number) => false);
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async () => {
  const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/process.js")>(
    "@blackbelt-technology/pi-dashboard-shared/platform/process.js",
  );
  return {
    ...actual,
    killProcess: (pid: number, opts?: any) => killProcessSpy(pid, opts),
    isProcessAlive: (pid: number) => isProcessAliveSpy(pid),
  };
});

const { handleForceKill } = await import("../browser-handlers/session-action-handler.js");
type BrowserHandlerContext = import("../browser-handlers/handler-context.js").BrowserHandlerContext;

function createMockContext(sessionOverrides?: Record<string, any>): BrowserHandlerContext & { sent: any[]; broadcasts: any[] } {
  const sent: any[] = [];
  const broadcasts: any[] = [];
  return {
    ws: {} as any,
    sessionManager: {
      get: vi.fn().mockReturnValue({
        id: "sess-1",
        cwd: "/test",
        status: "streaming",
        pid: 99999,
        ...sessionOverrides,
      }),
      update: vi.fn(),
    } as any,
    eventStore: {} as any,
    piGateway: {
      closeSession: vi.fn().mockReturnValue(true),
      sendToSession: vi.fn().mockReturnValue(true),
    } as any,
    pendingForkRegistry: undefined,
    headlessPidRegistry: {
      killBySessionId: vi.fn().mockReturnValue(false),
    } as any,
    pendingResumeRegistry: {} as any,
    sendTo: vi.fn((_ws, msg) => sent.push(msg)),
    broadcast: vi.fn((msg) => broadcasts.push(msg)),
    getSubscribers: vi.fn().mockReturnValue([]),
    trackUiRequest: vi.fn(),
    replayPendingUiRequests: vi.fn(),
    markReplaying: vi.fn(),
    clearReplaying: vi.fn(),
    sent,
    broadcasts,
  } as any;
}

describe("handleForceKill", () => {
  beforeEach(() => {
    killProcessSpy.mockClear();
    killProcessSpy.mockImplementation(async () => ({ ok: true, forced: false }));
    isProcessAliveSpy.mockClear();
    isProcessAliveSpy.mockReturnValue(false);
  });

  it("should close bridge WebSocket and mark session ended when no PID", async () => {
    const ctx = createMockContext({ pid: undefined });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.piGateway.closeSession).toHaveBeenCalledWith("sess-1");
    expect(ctx.sessionManager.update).toHaveBeenCalledWith("sess-1", expect.objectContaining({ status: "ended" }));
    
    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.message).toContain("no PID");
  });

  it("should delegate termination to platform killProcess with 2s timeout", async () => {
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(killProcessSpy).toHaveBeenCalledTimes(1);
    expect(killProcessSpy).toHaveBeenCalledWith(12345, expect.objectContaining({ timeoutMs: 2000 }));

    expect(ctx.piGateway.closeSession).toHaveBeenCalledWith("sess-1");
    expect(ctx.sessionManager.update).toHaveBeenCalledWith("sess-1", expect.objectContaining({ status: "ended" }));

    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("should report already-exited when killProcess reports pid not alive", async () => {
    killProcessSpy.mockResolvedValueOnce({ ok: false, forced: false });
    const ctx = createMockContext({ pid: 2147483647 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("should not call process.kill directly (must route through platform)", async () => {
    const processKillSpy = vi.spyOn(process, "kill");
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    // handleForceKill must NOT invoke process.kill; all termination goes
    // through killProcess from the platform module.
    expect(processKillSpy).not.toHaveBeenCalled();
    expect(killProcessSpy).toHaveBeenCalledOnce();
    processKillSpy.mockRestore();
  });

  it("should broadcast session_updated with ended status", async () => {
    const ctx = createMockContext({ pid: undefined });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    const update = ctx.broadcasts.find((m: any) => m.type === "session_updated");
    expect(update).toBeDefined();
    expect(update.updates.status).toBe("ended");
  });

  it("should always close the bridge WebSocket", async () => {
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.piGateway.closeSession).toHaveBeenCalledWith("sess-1");
  });

  it("should return success: false when session not found", async () => {
    const ctx = createMockContext();
    (ctx.sessionManager.get as any).mockReturnValue(undefined);

    await handleForceKill({ type: "force_kill", sessionId: "unknown" }, ctx);

    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(ctx.piGateway.closeSession).not.toHaveBeenCalled();
  });
});
