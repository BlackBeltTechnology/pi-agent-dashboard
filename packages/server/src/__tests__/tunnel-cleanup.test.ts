/**
 * Tests that `cleanupStaleZrok` routes liveness + termination through the
 * shared platform module rather than raw `process.kill`.
 *
 * See change: route-kill-paths-through-platform.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const killProcessSpy = vi.fn(async (_pid: number, _opts?: any) => ({ ok: true, forced: false }));
const isProcessAliveSpy = vi.fn((_pid: number) => true);

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

const { cleanupStaleZrok, writeZrokPid, readZrokPid } = await import("../tunnel.js");

function pidFile(): string {
  return path.join(os.homedir(), ".pi", "dashboard", "zrok.pid");
}

describe("cleanupStaleZrok uses platform helpers", () => {
  const original = readZrokPid();

  beforeEach(() => {
    killProcessSpy.mockClear();
    killProcessSpy.mockImplementation(async () => ({ ok: true, forced: false }));
    isProcessAliveSpy.mockClear();
    isProcessAliveSpy.mockReturnValue(true);
  });

  afterEach(() => {
    // Restore prior PID file content if any.
    try {
      if (original !== null) writeZrokPid(original);
      else fs.unlinkSync(pidFile());
    } catch { /* ignore */ }
  });

  it("calls platform killProcess when a live stale PID exists", async () => {
    writeZrokPid(654321);
    isProcessAliveSpy.mockReturnValue(true);

    await cleanupStaleZrok();

    expect(isProcessAliveSpy).toHaveBeenCalledWith(654321);
    expect(killProcessSpy).toHaveBeenCalledOnce();
    expect(killProcessSpy).toHaveBeenCalledWith(654321, expect.any(Object));
    // PID file removed after cleanup
    expect(readZrokPid()).toBeNull();
  });

  it("skips killProcess when PID is already dead but still removes PID file", async () => {
    writeZrokPid(654322);
    isProcessAliveSpy.mockReturnValue(false);

    await cleanupStaleZrok();

    expect(killProcessSpy).not.toHaveBeenCalled();
    expect(readZrokPid()).toBeNull();
  });

  it("no-ops when no PID file exists", async () => {
    try { fs.unlinkSync(pidFile()); } catch { /* ignore */ }
    await cleanupStaleZrok();
    expect(killProcessSpy).not.toHaveBeenCalled();
    expect(isProcessAliveSpy).not.toHaveBeenCalled();
  });

  it("does not invoke process.kill directly", async () => {
    writeZrokPid(654323);
    isProcessAliveSpy.mockReturnValue(true);
    const processKillSpy = vi.spyOn(process, "kill");

    await cleanupStaleZrok();

    expect(processKillSpy).not.toHaveBeenCalled();
    processKillSpy.mockRestore();
  });
});
