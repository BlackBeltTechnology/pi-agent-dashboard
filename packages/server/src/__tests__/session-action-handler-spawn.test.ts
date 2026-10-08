/**
 * Tests for handleSpawnSession — preflight gate, watchdog arming, failure log.
 * See change: spawn-failure-diagnostics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

// Mock everything the handler depends on.
vi.mock("../spawn-process/spawn-preflight.js", () => ({
  preflightSpawn: vi.fn().mockReturnValue({ ok: true, reasons: [] }),
}));

vi.mock("../spawn-process/spawn-register-watchdog.js", () => ({
  getSpawnRegisterWatchdog: vi.fn().mockReturnValue({
    arm: vi.fn(),
  }),
}));

vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  appendSpawnFailure: vi.fn(),
}));

vi.mock("../spawn-process/process-manager.js", () => ({
  spawnPiSession: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    spawnStrategy: "headless",
    spawnRegisterTimeoutMs: 30000,
  }),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", () => ({
  ToolResolver: function MockToolResolver() {
    return {
      resolvePi: vi.fn().mockReturnValue(["pi"]),
      resolveNode: vi.fn().mockReturnValue("/usr/bin/node"),
    };
  },
}));

import { handleSpawnSession } from "../browser-handlers/session-action-handler.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";
import { appendSpawnFailure } from "../spawn-process/spawn-failure-log.js";
import { preflightSpawn } from "../spawn-process/spawn-preflight.js";
import { getSpawnRegisterWatchdog } from "../spawn-process/spawn-register-watchdog.js";

const mockSpawnPiSession = vi.mocked(spawnPiSession);
const mockPreflightSpawn = vi.mocked(preflightSpawn);
const mockAppendSpawnFailure = vi.mocked(appendSpawnFailure);

function makeCtx() {
  const messages: unknown[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => messages.push(JSON.parse(data))),
  } as unknown as WebSocket;

  const sendTo = vi.fn((_ws: WebSocket, msg: unknown) => messages.push(msg));

  return {
    ws,
    messages,
    sendTo,
    headlessPidRegistry: { register: vi.fn() } as never,
    pendingDashboardSpawns: new Map(),
    pendingAttachRegistry: { enqueue: vi.fn() } as never,
    sessionManager: {} as never,
    broadcast: vi.fn() as never,
    piGateway: {} as never,
  };
}

describe("handleSpawnSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preflight failure sends spawn_error with PREFLIGHT_FAILED", async () => {
    mockPreflightSpawn.mockReturnValue({
      ok: false,
      reasons: [{ code: "PI_NOT_FOUND", message: "pi not found" }],
    });

    const ctx = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);

    expect(mockSpawnPiSession).not.toHaveBeenCalled();
    const errorMsg = ctx.messages.find((m: any) => m.type === "spawn_error") as any;
    expect(errorMsg).toBeDefined();
    expect(errorMsg.code).toBe("PREFLIGHT_FAILED");
    expect(mockAppendSpawnFailure).toHaveBeenCalledWith(expect.objectContaining({ code: "PREFLIGHT_FAILED" }));
  });

  it("successful headless spawn arms watchdog with pid", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockResolvedValue({
      success: true,
      pid: 123,
      process: {} as never,
      dashboardSpawned: true,
      message: "spawned",
      logPath: "/tmp/pi-spawn.log",
    });

    const watchdog = { arm: vi.fn() };
    vi.mocked(getSpawnRegisterWatchdog).mockReturnValue(watchdog as never);

    const ctx = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);

    expect(watchdog.arm).toHaveBeenCalledWith(expect.objectContaining({
      pid: 123,
      cwd: "/p/x",
      logPath: "/tmp/pi-spawn.log",
    }));
  });

  it("failed spawn forwards code and appends log", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockResolvedValue({
      success: false,
      code: "PI_CRASHED" as never,
      message: "crashed",
      stderr: "error output",
    });

    const ctx = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);

    const errorMsg = ctx.messages.find((m: any) => m.type === "spawn_error") as any;
    expect(errorMsg.code).toBe("PI_CRASHED");
    expect(errorMsg.stderr).toBe("error output");
    expect(mockAppendSpawnFailure).toHaveBeenCalledWith(expect.objectContaining({
      code: "PI_CRASHED",
      stderrTail: "error output",
    }));
  });

  it("thrown exception appends SPAWN_ERRNO entry", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockRejectedValue(new Error("ENOENT"));

    const ctx = makeCtx();
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);

    expect(mockAppendSpawnFailure).toHaveBeenCalledWith(expect.objectContaining({ code: "SPAWN_ERRNO" }));
  });
});

describe("handleSpawnSession — owner stamping (§6.2 / D11)", () => {
  beforeEach(() => vi.clearAllMocks());

  const principal = { iss: "https://kc/realms/app", sub: "user-1", email: "u@x" };

  /** Build a ctx with an owner registry + resolver-active predicate + optional socket principal. */
  function ownerCtx(opts: { active: boolean; withPrincipal: boolean }) {
    const base = makeCtx();
    const owners = { file: vi.fn(), resolve: vi.fn(), remove: vi.fn(), size: vi.fn() };
    if (opts.withPrincipal) (base.ws as unknown as { principal?: unknown }).principal = principal;
    return {
      ...base,
      pendingPrincipalOwnerRegistry: owners as never,
      isResolverActive: () => opts.active,
      owners,
    };
  }

  it("files the owner (iss,sub only) + passes a spawnToken when active and principal present", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockResolvedValue({ success: true, pid: 1, process: {} as never, message: "ok" });
    const ctx = ownerCtx({ active: true, withPrincipal: true });
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);
    expect(ctx.owners.file).toHaveBeenCalledTimes(1);
    const [token, owner] = ctx.owners.file.mock.calls[0]!;
    expect(owner).toEqual({ iss: principal.iss, sub: principal.sub }); // no email
    expect(typeof token).toBe("string");
    // The same token rode the spawn so event-wiring can correlate on register.
    expect(mockSpawnPiSession).toHaveBeenCalledWith("/p/x", expect.objectContaining({ spawnToken: token }));
  });

  it("stamps no owner when the resolver is inert", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockResolvedValue({ success: true, pid: 1, process: {} as never, message: "ok" });
    const ctx = ownerCtx({ active: false, withPrincipal: true });
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);
    expect(ctx.owners.file).not.toHaveBeenCalled();
    expect(mockSpawnPiSession).toHaveBeenCalledWith("/p/x", expect.not.objectContaining({ spawnToken: expect.anything() }));
  });

  it("stamps no owner for a principal-less socket", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockResolvedValue({ success: true, pid: 1, process: {} as never, message: "ok" });
    const ctx = ownerCtx({ active: true, withPrincipal: false });
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);
    expect(ctx.owners.file).not.toHaveBeenCalled();
  });

  it("removes the pre-filed owner when the spawn fails", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockResolvedValue({ success: false, code: "PI_CRASHED" as never, message: "crashed" });
    const ctx = ownerCtx({ active: true, withPrincipal: true });
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);
    const [token] = ctx.owners.file.mock.calls[0]!;
    expect(ctx.owners.remove).toHaveBeenCalledWith(token);
  });

  it("removes the pre-filed owner when the spawn throws", async () => {
    mockPreflightSpawn.mockReturnValue({ ok: true, reasons: [] });
    mockSpawnPiSession.mockRejectedValue(new Error("ENOENT"));
    const ctx = ownerCtx({ active: true, withPrincipal: true });
    await handleSpawnSession({ type: "spawn_session", cwd: "/p/x" } as never, ctx as never);
    const [token] = ctx.owners.file.mock.calls[0]!;
    expect(ctx.owners.remove).toHaveBeenCalledWith(token);
  });
});
