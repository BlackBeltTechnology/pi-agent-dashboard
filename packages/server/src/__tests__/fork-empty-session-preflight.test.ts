/**
 * Tests for the fork-empty-session silent-degrade path in `handleResumeSession`.
 *
 * When the source session has no on-disk JSONL, fork SHALL silently spawn a
 * fresh session in the same cwd, inherit the parent's `attachedProposal`,
 * and emit `resume_result` with `code: "FORK_DEGRADED_TO_NEW"`.
 *
 * See change: fix-fork-empty-session-silent-timeout.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import WebSocket from "ws";

// Spy on existsSync so we control the on-disk truth.
const existsSyncSpy = vi.fn();
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: (p: string) => existsSyncSpy(p),
  };
});

vi.mock("../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ spawnStrategy: "headless" }),
}));

import { handleResumeSession } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";

function makeMockWs(): { ws: WebSocket; messages: any[] } {
  const messages: any[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => messages.push(JSON.parse(data))),
  } as unknown as WebSocket;
  return { ws, messages };
}

function makeCtx(session: any, sentLog: any[]) {
  const { ws } = makeMockWs();
  const enqueue = vi.fn();
  const ctx = {
    ws,
    sessionManager: {
      get: () => session,
      update: vi.fn(),
    } as any,
    eventStore: {} as any,
    piGateway: {} as any,
    headlessPidRegistry: { register: vi.fn() } as any,
    pendingDashboardSpawns: new Map<string, number>(),
    pendingResumeRegistry: {} as any,
    pendingResumeIntents: { record: vi.fn() } as any,
    pendingForkRegistry: { recordFork: vi.fn() } as any,
    pendingClientCorrelations: { record: vi.fn() } as any,
    pendingAttachRegistry: { enqueue, consume: vi.fn(), size: vi.fn() } as any,
    sendTo: (_target: any, msg: any) => sentLog.push(msg),
    broadcast: vi.fn(),
    getSubscribers: vi.fn().mockReturnValue([]),
    trackUiRequest: vi.fn(),
    replayPendingUiRequests: vi.fn(),
    markReplaying: vi.fn(),
    clearReplaying: vi.fn(),
  } as any;
  return { ctx, enqueue };
}

describe("handleResumeSession: fork-empty-session silent-degrade", () => {
  beforeEach(() => {
    existsSyncSpy.mockReset();
    (spawnPiSession as any).mockReset();
  });

  it("degrades to fresh spawn when sessionFile does not exist", async () => {
    existsSyncSpy.mockReturnValue(false);
    (spawnPiSession as any).mockResolvedValue({
      success: true,
      message: "Pi session spawned headless (pid 999)",
      pid: 999,
      spawnToken: "tok_degrade",
      dashboardSpawned: true,
    });
    const session = {
      id: "S1",
      cwd: "/tmp",
      status: "active",
      sessionFile: "/path/that/does/not/exist.jsonl",
      resuming: false,
    };
    const sent: any[] = [];
    const { ctx } = makeCtx(session, sent);

    await handleResumeSession(
      { type: "resume_session", sessionId: "S1", mode: "fork", requestId: "rq_x" } as any,
      ctx,
    );

    // spawnPiSession IS called — fresh spawn (no sessionFile, no mode).
    expect(spawnPiSession).toHaveBeenCalledTimes(1);
    const callArgs = (spawnPiSession as any).mock.calls[0];
    expect(callArgs[0]).toBe("/tmp"); // cwd
    expect(callArgs[1]).toEqual({ strategy: "headless" }); // no sessionFile, no mode

    // resume_result carries success: true, the degradation code, and echoed requestId.
    expect(sent).toHaveLength(1);
    const result = sent[0];
    expect(result.type).toBe("resume_result");
    expect(result.success).toBe(true);
    expect(result.sessionId).toBe("S1");
    expect(result.code).toBe("FORK_DEGRADED_TO_NEW");
    expect(result.requestId).toBe("rq_x");
    expect(result.message).toMatch(/fresh session/i);
  });

  it("inherits attachedProposal from parent on degraded path", async () => {
    existsSyncSpy.mockReturnValue(false);
    (spawnPiSession as any).mockResolvedValue({
      success: true,
      message: "ok",
      pid: 1000,
      spawnToken: "tok_d2",
      dashboardSpawned: true,
    });
    const session = {
      id: "S2",
      cwd: "/proj",
      status: "active",
      sessionFile: "/proj/missing.jsonl",
      attachedProposal: "feature-x",
      resuming: false,
    };
    const sent: any[] = [];
    const { ctx, enqueue } = makeCtx(session, sent);

    await handleResumeSession(
      { type: "resume_session", sessionId: "S2", mode: "fork" } as any,
      ctx,
    );

    expect(enqueue).toHaveBeenCalledWith("/proj", "feature-x");
    expect(sent[0].code).toBe("FORK_DEGRADED_TO_NEW");
  });

  it("does NOT enqueue attachProposal when parent has none", async () => {
    existsSyncSpy.mockReturnValue(false);
    (spawnPiSession as any).mockResolvedValue({
      success: true,
      message: "ok",
      spawnToken: "tok_d3",
    });
    const session = {
      id: "S3",
      cwd: "/proj",
      status: "active",
      sessionFile: "/proj/missing.jsonl",
      attachedProposal: undefined,
      resuming: false,
    };
    const sent: any[] = [];
    const { ctx, enqueue } = makeCtx(session, sent);

    await handleResumeSession(
      { type: "resume_session", sessionId: "S3", mode: "fork" } as any,
      ctx,
    );

    expect(enqueue).not.toHaveBeenCalled();
    expect(sent[0].code).toBe("FORK_DEGRADED_TO_NEW");
  });

  it("proceeds normally (real fork) when sessionFile exists", async () => {
    existsSyncSpy.mockReturnValue(true);
    (spawnPiSession as any).mockResolvedValue({
      success: true,
      message: "Pi session spawned headless (pid 1234)",
      pid: 1234,
      spawnToken: "tok_real_fork",
      dashboardSpawned: true,
    });
    const session = {
      id: "S4",
      cwd: "/tmp",
      status: "active",
      sessionFile: "/path/that/exists.jsonl",
      resuming: false,
    };
    const sent: any[] = [];
    const { ctx } = makeCtx(session, sent);

    await handleResumeSession(
      { type: "resume_session", sessionId: "S4", mode: "fork", requestId: "rq_y" } as any,
      ctx,
    );

    // spawnPiSession called with real fork args (sessionFile + mode).
    expect(spawnPiSession).toHaveBeenCalledTimes(1);
    const callArgs = (spawnPiSession as any).mock.calls[0];
    expect(callArgs[1].sessionFile).toBe("/path/that/exists.jsonl");
    expect(callArgs[1].mode).toBe("fork");

    // No degradation code on real fork.
    const result = sent[sent.length - 1];
    expect(result.code).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it("continue mode is unaffected by the degradation path", async () => {
    existsSyncSpy.mockReturnValue(false); // file missing — but continue mode shouldn't check
    (spawnPiSession as any).mockResolvedValue({
      success: true,
      message: "ok",
      spawnToken: "tok_continue",
    });
    const session = {
      id: "S5",
      cwd: "/tmp",
      status: "ended",
      sessionFile: "/path/that/does/not/exist.jsonl",
      resuming: false,
    };
    const sent: any[] = [];
    const { ctx, enqueue } = makeCtx(session, sent);

    await handleResumeSession(
      { type: "resume_session", sessionId: "S5", mode: "continue", requestId: "rq_z" } as any,
      ctx,
    );

    expect(spawnPiSession).toHaveBeenCalledTimes(1);
    const callArgs = (spawnPiSession as any).mock.calls[0];
    expect(callArgs[1].mode).toBe("continue");
    expect(enqueue).not.toHaveBeenCalled();
    const result = sent[sent.length - 1];
    expect(result.code).toBeUndefined();
  });

  it("spawn failure on degraded path does NOT set FORK_DEGRADED_TO_NEW code", async () => {
    existsSyncSpy.mockReturnValue(false);
    (spawnPiSession as any).mockResolvedValue({
      success: false,
      message: "Directory does not exist: /tmp",
      code: "DIR_MISSING",
    });
    const session = {
      id: "S6",
      cwd: "/tmp",
      status: "active",
      sessionFile: "/missing.jsonl",
      resuming: false,
    };
    const sent: any[] = [];
    const { ctx } = makeCtx(session, sent);

    await handleResumeSession(
      { type: "resume_session", sessionId: "S6", mode: "fork" } as any,
      ctx,
    );

    const result = sent[0];
    expect(result.success).toBe(false);
    expect(result.code).toBeUndefined();
    expect(result.message).toMatch(/Directory does not exist/);
  });
});
