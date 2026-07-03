/**
 * Unit tests for `headlessPidRegistry.killByToken`. Kills a spawned-but-not-
 * yet-registered entry (no sessionId linked) by its stored `spawnToken`,
 * reusing the same SIGTERM → 2 s → SIGKILL ladder as `killBySessionId`.
 * See change: fix-automation-stop-zombie-runs.
 *
 * Mocks the shared `killProcess` helper so assertions cover dispatch shape
 * without spawning real subprocesses.
 */

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const killProcessMock = vi.hoisted(() => vi.fn(async () => ({ ok: true, forced: false })));
const killPidWithGroupMock = vi.hoisted(() => vi.fn(() => undefined));
const isProcessAliveMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", () => ({
  killProcess: killProcessMock,
  killPidWithGroup: killPidWithGroupMock,
  isProcessAlive: isProcessAliveMock,
}));

// eslint-disable-next-line import/first
import { createHeadlessPidRegistry } from "../headless-pid-registry.js";

function mockProcess(): ChildProcess {
  return new EventEmitter() as any;
}
function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pid-reg-token-"));
}

const KEEPER_PID = 55555;
const LEGACY_PID = 66666;

describe("headlessPidRegistry.killByToken", () => {
  beforeEach(() => {
    killProcessMock.mockReset();
    killProcessMock.mockResolvedValue({ ok: true, forced: false });
    killPidWithGroupMock.mockReset();
    isProcessAliveMock.mockReset();
    isProcessAliveMock.mockReturnValue(true);
  });

  it("kills a spawned-but-unlinked (no sessionId) entry by token — keeper mode", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    // Registered with a token but NO session_register yet (sessionId unset).
    reg.register(KEEPER_PID, "/proj", mockProcess(), "tok-prereg", {
      keeperPid: KEEPER_PID,
      keeperSockPath: "/tmp/x.sock",
    });

    const result = await reg.killByToken("tok-prereg");

    expect(result).toBe(true);
    // No piPid linked (bridge never connected) → keeper escalated directly.
    expect(killProcessMock).toHaveBeenCalledWith(KEEPER_PID, { timeoutMs: 2000 });
    expect(reg.size()).toBe(0);
  });

  it("kills a non-keeper (legacy) entry by token", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(LEGACY_PID, "/proj", mockProcess(), "tok-legacy");

    const result = await reg.killByToken("tok-legacy");

    expect(result).toBe(true);
    expect(killProcessMock).toHaveBeenCalledWith(LEGACY_PID, { timeoutMs: 2000 });
    expect(reg.size()).toBe(0);
  });

  it("returns false for an unknown token", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(LEGACY_PID, "/proj", mockProcess(), "tok-legacy");

    const result = await reg.killByToken("no-such-token");

    expect(result).toBe(false);
    expect(killProcessMock).not.toHaveBeenCalled();
  });

  it("returns false for an empty token", async () => {
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    expect(await reg.killByToken("")).toBe(false);
    expect(killProcessMock).not.toHaveBeenCalled();
  });

  it("already-dead PID (killProcess resolves ok:false) still counts as issued → true, entry removed", async () => {
    // killProcess RESOLVES {ok:false} for a dead PID (it does not reject).
    // killByToken mirrors killBySessionId's established contract: a
    // non-throwing kill of a KNOWN entry is "issued" → true, and the entry
    // is removed either way. (Only an unknown token returns false.)
    killProcessMock.mockResolvedValueOnce({ ok: false, forced: false });
    const reg = createHeadlessPidRegistry({ pidFilePath: join(makeTempDir(), "pids.json") });
    reg.register(LEGACY_PID, "/proj", mockProcess(), "tok-dead");

    const result = await reg.killByToken("tok-dead");

    expect(result).toBe(true);
    expect(reg.size()).toBe(0);
  });
});
