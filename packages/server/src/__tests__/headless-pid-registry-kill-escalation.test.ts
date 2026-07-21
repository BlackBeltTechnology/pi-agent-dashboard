/**
 * Regression tests for the SIGTERM → 2 s → SIGKILL escalation in
 * `headlessPidRegistry.killBySessionId`. See change: fix-keeper-kill-escalation.
 *
 * Mocks the shared `killProcess` helper so assertions cover the dispatch
 * shape (which PID, which timeout, in which order) without spawning real
 * subprocesses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

// Mock the platform helper BEFORE importing the registry so the registry's
// `import { killProcess } from ".../platform/process.js"` resolves to the spy.
const killProcessMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, forced: false })));
const killPidWithGroupMock = vi.hoisted(() => vi.fn(() => undefined));
const isProcessAliveMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", () => ({
  killProcess: killProcessMock,
  killPidWithGroup: killPidWithGroupMock,
  isProcessAlive: isProcessAliveMock,
}));

// eslint-disable-next-line import/first
import { createHeadlessPidRegistry } from "../spawn-process/headless-pid-registry.js";

function mockProcess(): ChildProcess {
  return new EventEmitter() as any;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pid-reg-esc-"));
}

const PI_PID = 11111;
const KEEPER_PID = 22222;
const LEGACY_PID = 33333;

describe("headlessPidRegistry.killBySessionId — SIGKILL escalation", () => {
  beforeEach(() => {
    killProcessMock.mockReset();
    killProcessMock.mockResolvedValue({ ok: true, forced: false });
    killPidWithGroupMock.mockReset();
    isProcessAliveMock.mockReset();
    isProcessAliveMock.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeper mode: escalates pi via killProcess (not bare killPidWithGroup)", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(KEEPER_PID, "/proj", mockProcess(), "tok", {
      keeperPid: KEEPER_PID,
      keeperSockPath: "/tmp/x.sock",
    });
    reg.linkByToken("tok", "S1", PI_PID);

    const result = await reg.killBySessionId("S1");

    expect(result).toBe(true);
    // killProcess called with pi's PID + 2 s timeout (SIGTERM→SIGKILL ladder).
    expect(killProcessMock).toHaveBeenCalledWith(PI_PID, { timeoutMs: 2000 });
    // The bare-SIGTERM legacy path on pi MUST NOT be used.
    expect(killPidWithGroupMock).not.toHaveBeenCalledWith(PI_PID, "SIGTERM");
    // Registry cleared after kill.
    expect(reg.size()).toBe(0);
  });

  it("keeper mode: cooperative pi (killProcess resolves ok=true, forced=false)", async () => {
    killProcessMock.mockResolvedValueOnce({ ok: true, forced: false });
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(KEEPER_PID, "/proj", mockProcess(), "tok", {
      keeperPid: KEEPER_PID,
      keeperSockPath: "/tmp/x.sock",
    });
    reg.linkByToken("tok", "S1", PI_PID);

    await reg.killBySessionId("S1");

    expect(killProcessMock).toHaveBeenCalledTimes(1);
    expect(killProcessMock).toHaveBeenCalledWith(PI_PID, { timeoutMs: 2000 });
  });

  it("keeper mode: hung pi escalates to SIGKILL (killProcess resolves forced=true)", async () => {
    killProcessMock.mockResolvedValueOnce({ ok: true, forced: true });
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(KEEPER_PID, "/proj", mockProcess(), "tok", {
      keeperPid: KEEPER_PID,
      keeperSockPath: "/tmp/x.sock",
    });
    reg.linkByToken("tok", "S1", PI_PID);

    const result = await reg.killBySessionId("S1");

    expect(result).toBe(true);
    // killProcess internally did SIGTERM → 2 s wait → SIGKILL; registry just
    // awaits the ladder. The {forced:true} return shape is informational —
    // killBySessionId's contract is "kill issued, entry removed".
    expect(killProcessMock).toHaveBeenCalledWith(PI_PID, { timeoutMs: 2000 });
  });

  it("keeper mode: keeper-fallback 200 ms SIGTERM still fires via killPidWithGroup", async () => {
    vi.useFakeTimers();
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(KEEPER_PID, "/proj", mockProcess(), "tok", {
      keeperPid: KEEPER_PID,
      keeperSockPath: "/tmp/x.sock",
    });
    reg.linkByToken("tok", "S1", PI_PID);

    const killPromise = reg.killBySessionId("S1");
    await vi.runOnlyPendingTimersAsync();
    await killPromise;

    // Keeper-fallback fires SIGTERM on the keeper PID after 200 ms.
    isProcessAliveMock.mockReturnValueOnce(true);
    vi.advanceTimersByTime(200);
    await Promise.resolve();
    expect(killPidWithGroupMock).toHaveBeenCalledWith(KEEPER_PID, "SIGTERM");
  });

  it("keeper mode without pi link: escalates keeper directly via killProcess", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(KEEPER_PID, "/proj", mockProcess(), "tok", {
      keeperPid: KEEPER_PID,
      keeperSockPath: "/tmp/x.sock",
    });
    // linkByToken WITHOUT piPid (bridge never connected).
    reg.linkByToken("tok", "S1");

    const result = await reg.killBySessionId("S1");

    expect(result).toBe(true);
    // Keeper-fallback path: killProcess(keeperPid, {timeoutMs:2000}).
    expect(killProcessMock).toHaveBeenCalledWith(KEEPER_PID, { timeoutMs: 2000 });
  });

  it("non-keeper legacy mode: escalates entry.pid via killProcess", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(LEGACY_PID, "/proj", mockProcess());
    reg.linkSession("S1", "/proj");

    const result = await reg.killBySessionId("S1");

    expect(result).toBe(true);
    expect(killProcessMock).toHaveBeenCalledWith(LEGACY_PID, { timeoutMs: 2000 });
    // Legacy bare-SIGTERM MUST NOT be used.
    expect(killPidWithGroupMock).not.toHaveBeenCalledWith(LEGACY_PID, "SIGTERM");
  });

  it("returns false when session is unknown", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    const result = await reg.killBySessionId("unknown");
    expect(result).toBe(false);
    expect(killProcessMock).not.toHaveBeenCalled();
  });
});
