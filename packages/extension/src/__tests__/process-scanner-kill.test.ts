/**
 * Tests that `killProcessByPgid` routes through the platform's
 * `killPidWithGroup` helper (not raw `process.kill`).
 *
 * See change: route-kill-paths-through-platform.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const killPidWithGroupSpy = vi.fn((_pid: number, _sig: any, _opts?: any) => undefined);

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/process.js", async () => {
  const actual = await vi.importActual<typeof import("@blackbelt-technology/pi-dashboard-shared/platform/process.js")>(
    "@blackbelt-technology/pi-dashboard-shared/platform/process.js",
  );
  return {
    ...actual,
    killPidWithGroup: (pid: number, sig: any, opts?: any) => killPidWithGroupSpy(pid, sig, opts),
  };
});

const { killProcessByPgid } = await import("../process-scanner.js");

describe("killProcessByPgid platform routing", () => {
  beforeEach(() => {
    killPidWithGroupSpy.mockClear();
  });

  it("invokes killPidWithGroup with the resolved platform on Unix", () => {
    const ok = killProcessByPgid(4242, { _platform: "linux" } as any);
    expect(ok).toBe(true);
    expect(killPidWithGroupSpy).toHaveBeenCalledTimes(1);
    const [pid, sig, opts] = killPidWithGroupSpy.mock.calls[0];
    expect(pid).toBe(4242);
    expect(sig).toBe("SIGTERM");
    expect(opts?.platform).toBe("linux");
  });

  it("invokes killPidWithGroup with platform=darwin for macOS pgids", () => {
    killProcessByPgid(9999, { _platform: "darwin" } as any);
    const [pid, , opts] = killPidWithGroupSpy.mock.calls[0];
    expect(pid).toBe(9999);
    expect(opts?.platform).toBe("darwin");
  });

  it("does NOT call process.kill directly on Unix", () => {
    const processKillSpy = vi.spyOn(process, "kill");
    try {
      killProcessByPgid(1234, { _platform: "linux" } as any);
    } catch { /* ignore */ }
    expect(processKillSpy).not.toHaveBeenCalled();
    processKillSpy.mockRestore();
  });

  it("reports failure if killPidWithGroup throws", () => {
    killPidWithGroupSpy.mockImplementationOnce(() => {
      throw new Error("ESRCH");
    });
    const ok = killProcessByPgid(4242, { _platform: "linux" } as any);
    expect(ok).toBe(false);
  });
});
