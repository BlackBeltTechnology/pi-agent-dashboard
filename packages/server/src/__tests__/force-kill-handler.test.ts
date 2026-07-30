/**
 * Tests for handleForceKill in session-action-handler.
 *
 * Behavior contract (see change: fix-stuck-session-stop-escalation):
 *  - kill routes through platform `killProcessTree` (tree/group kill), never
 *    `process.kill` directly (change: route-kill-paths-through-platform)
 *  - PID-reuse guard: `isProcessLikePi` mismatch aborts the kill, no signal
 *  - no-PID → `findPidByMarker` recovery; no match → honest `success:false`,
 *    NO `ended` stamp
 *  - `ended` stamped only after `isProcessAlive` verifies death
 *  - one structured log line per attempt with outcome field
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const killProcessTreeSpy = vi.fn(async (_pid: number, _opts?: any) => ({ ok: true, forced: false }));
const isProcessAliveSpy = vi.fn((_pid: number) => false);
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async () => {
  const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/process.js")>(
    "@blackbelt-technology/pi-dashboard-shared/platform/process.js",
  );
  return {
    ...actual,
    killProcessTree: (pid: number, opts?: any) => killProcessTreeSpy(pid, opts),
    isProcessAlive: (pid: number) => isProcessAliveSpy(pid),
  };
});

const isProcessLikePiSpy = vi.fn((_pid: number) => true);
const findPidByMarkerSpy = vi.fn((_marker: string): number[] => []);
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js", async () => {
  const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js")>(
    "@blackbelt-technology/pi-dashboard-shared/platform/process-identify.js",
  );
  return {
    ...actual,
    isProcessLikePi: (pid: number) => isProcessLikePiSpy(pid),
    findPidByMarker: (marker: string) => findPidByMarkerSpy(marker),
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
      register: vi.fn(),
    } as any,
    pendingResumeRegistry: {} as any,
    pendingDashboardSpawns: new Map(),
    pendingResumeIntents: { record: vi.fn() } as any,
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

let logSpy: ReturnType<typeof vi.spyOn>;

describe("handleForceKill", () => {
  beforeEach(() => {
    killProcessTreeSpy.mockClear();
    killProcessTreeSpy.mockImplementation(async () => ({ ok: true, forced: false }));
    isProcessAliveSpy.mockClear();
    isProcessAliveSpy.mockReturnValue(false); // dead after kill by default
    isProcessLikePiSpy.mockClear();
    isProcessLikePiSpy.mockReturnValue(true);
    findPidByMarkerSpy.mockClear();
    findPidByMarkerSpy.mockReturnValue([]);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("delegates termination to platform killProcessTree", async () => {
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(killProcessTreeSpy).toHaveBeenCalledTimes(1);
    expect(killProcessTreeSpy.mock.calls[0][0]).toBe(12345);
    expect(ctx.piGateway.closeSession).toHaveBeenCalledWith("sess-1");
    expect(ctx.sessionManager.update).toHaveBeenCalledWith("sess-1", expect.objectContaining({ status: "ended" }));

    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it("leaves a force-killed session ended instead of restarting it", async () => {
    const ctx = createMockContext({ pid: 12345, sessionFile: "/tmp/session.jsonl", model: "anthropic/claude-opus" });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.sessionManager.update).toHaveBeenCalledWith("sess-1", expect.objectContaining({ status: "ended" }));
    expect(ctx.pendingResumeIntents?.record).not.toHaveBeenCalled();
    expect(ctx.headlessPidRegistry.register).not.toHaveBeenCalled();
    expect(ctx.sent.some((m: any) => m.type === "resume_result")).toBe(false);
  });

  it("never calls process.kill directly (routes through platform)", async () => {
    const processKillSpy = vi.spyOn(process, "kill");
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(processKillSpy).not.toHaveBeenCalled();
    expect(killProcessTreeSpy).toHaveBeenCalledOnce();
    processKillSpy.mockRestore();
  });

  it("PID-reuse guard: aborts kill and reports failure when pid no longer looks like pi", async () => {
    isProcessLikePiSpy.mockReturnValue(false);
    isProcessAliveSpy.mockReturnValue(true); // recycled pid is alive
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(killProcessTreeSpy).not.toHaveBeenCalled();
    expect(ctx.piGateway.closeSession).not.toHaveBeenCalled();
    expect(ctx.sessionManager.update).not.toHaveBeenCalled();
    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/reuse|recycled|not.*pi/i);
  });

  it("no-PID: recovers the process via findPidByMarker and tree-kills it", async () => {
    findPidByMarkerSpy.mockReturnValue([54321]);
    const ctx = createMockContext({ pid: undefined, source: "dashboard" });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(findPidByMarkerSpy).toHaveBeenCalledWith("sess-1");
    expect(killProcessTreeSpy).toHaveBeenCalledWith(54321, expect.anything());
    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result.success).toBe(true);
  });

  it("no-PID + no marker match: honest failure, no ended stamp", async () => {
    const ctx = createMockContext({ pid: undefined });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.piGateway.closeSession).not.toHaveBeenCalled();
    expect(killProcessTreeSpy).not.toHaveBeenCalled();
    expect(ctx.sessionManager.update).not.toHaveBeenCalled();
    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not found|still be running/i);
  });

  it("does not discover a terminal session by marker", async () => {
    findPidByMarkerSpy.mockReturnValue([54321]);
    const ctx = createMockContext({ pid: undefined, source: "tui" });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(findPidByMarkerSpy).not.toHaveBeenCalled();
    expect(killProcessTreeSpy).not.toHaveBeenCalled();
    expect(ctx.piGateway.closeSession).not.toHaveBeenCalled();
  });

  it("verify-before-stamp: survivor keeps status and reports failure", async () => {
    killProcessTreeSpy.mockResolvedValueOnce({ ok: false, forced: true });
    isProcessAliveSpy.mockReturnValue(true); // survives verification
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.sessionManager.update).not.toHaveBeenCalled();
    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/surviv/i);
  });

  it("verify-before-stamp: verified death stamps ended and broadcasts", async () => {
    isProcessAliveSpy.mockReturnValue(false);
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.sessionManager.update).toHaveBeenCalledWith("sess-1", expect.objectContaining({ status: "ended" }));
    const update = ctx.broadcasts.find((m: any) => m.type === "session_updated");
    expect(update).toBeDefined();
    expect(update.updates.status).toBe("ended");
  });

  it("reports success when the process was already dead", async () => {
    killProcessTreeSpy.mockResolvedValueOnce({ ok: false, forced: false });
    isProcessAliveSpy.mockReturnValue(false); // dead
    const ctx = createMockContext({ pid: 2147483647 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result.success).toBe(true);
    expect(ctx.sessionManager.update).toHaveBeenCalledWith("sess-1", expect.objectContaining({ status: "ended" }));
  });

  it("emits exactly one structured log line with outcome per attempt", async () => {
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("force_kill"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/session=sess-1/);
    expect(lines[0]).toMatch(/pid=12345/);
    expect(lines[0]).toMatch(/outcome=(killed|tree_killed)/);
    expect(lines[0]).toMatch(/tookMs=\d+/);
  });

  it("logs not_found outcome for no-PID no-marker attempts", async () => {
    const ctx = createMockContext({ pid: undefined });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    const lines = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes("force_kill"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/pid=none/);
    expect(lines[0]).toMatch(/outcome=not_found/);
  });

  it("returns success: false when session not found", async () => {
    const ctx = createMockContext();
    (ctx.sessionManager.get as any).mockReturnValue(undefined);

    await handleForceKill({ type: "force_kill", sessionId: "unknown" }, ctx);

    const result = ctx.sent.find((m: any) => m.type === "force_kill_result");
    expect(result).toBeDefined();
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
    expect(ctx.piGateway.closeSession).not.toHaveBeenCalled();
  });

  it("closes the bridge WebSocket only after resolving a safe target", async () => {
    const ctx = createMockContext({ pid: 12345 });

    await handleForceKill({ type: "force_kill", sessionId: "sess-1" }, ctx);

    expect(ctx.piGateway.closeSession).toHaveBeenCalledWith("sess-1");
  });
});
