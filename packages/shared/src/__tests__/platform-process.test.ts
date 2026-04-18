/**
 * Tests for packages/shared/src/platform/process.ts.
 *
 * Every helper accepts injectable `platform`, `exec`, and `kill` parameters,
 * so no `Object.defineProperty(process, "platform", ...)` mutation is needed.
 * See change: consolidate-platform-handlers.
 */
import { describe, it, expect, vi } from "vitest";
import {
  findPortHolders,
  parseNetstatListeners,
  isProcessAlive,
  killProcess,
  killPidWithGroup,
} from "../platform/process.js";

describe("parseNetstatListeners", () => {
  const selfPid = 99999;

  it("parses a Windows netstat listener", () => {
    const output = [
      "  Proto  Local Address     Foreign Address   State       PID",
      "  TCP    0.0.0.0:8000      0.0.0.0:0         LISTENING   12345",
    ].join("\r\n");
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([12345]);
  });

  it("excludes non-LISTENING rows", () => {
    const output = "  TCP    0.0.0.0:8000    0.0.0.0:0    ESTABLISHED    1111";
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([]);
  });

  it("excludes current process PID", () => {
    const output = `  TCP    0.0.0.0:8000    0.0.0.0:0    LISTENING    ${selfPid}`;
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([]);
  });

  it("only matches the requested port", () => {
    const output = [
      "  TCP    0.0.0.0:8000     0.0.0.0:0    LISTENING    1111",
      "  TCP    0.0.0.0:18000    0.0.0.0:0    LISTENING    2222",
    ].join("\n");
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([1111]);
  });

  it("handles IPv6 addresses", () => {
    const output = "  TCP    [::]:8000    [::]:0    LISTENING    7777";
    expect(parseNetstatListeners(output, 8000, selfPid)).toEqual([7777]);
  });
});

describe("findPortHolders", () => {
  it("uses netstat when platform=win32 is injected", () => {
    const exec = vi.fn().mockReturnValue(
      "  TCP    0.0.0.0:8000    0.0.0.0:0    LISTENING    12345\n",
    );
    const result = findPortHolders(8000, { platform: "win32", exec });
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toMatch(/netstat/i);
    expect(result).toEqual([12345]);
  });

  it("uses lsof when platform=linux is injected", () => {
    const exec = vi.fn().mockReturnValue("12345\n67890\n");
    const result = findPortHolders(8000, { platform: "linux", exec });
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0][0]).toMatch(/lsof.*:8000/);
    expect(result.sort()).toEqual([12345, 67890]);
  });

  it("returns [] on exec failure (best-effort)", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    expect(findPortHolders(8000, { platform: "win32", exec })).toEqual([]);
  });
});

describe("isProcessAlive", () => {
  it("returns true when kill(pid, 0) succeeds", () => {
    const kill = vi.fn().mockReturnValue(undefined);
    expect(isProcessAlive(12345, { kill })).toBe(true);
    expect(kill).toHaveBeenCalledWith(12345, 0);
  });

  it("returns false when kill(pid, 0) throws", () => {
    const kill = vi.fn().mockImplementation(() => {
      throw new Error("ESRCH");
    });
    expect(isProcessAlive(12345, { kill })).toBe(false);
  });
});

describe("killProcess", () => {
  it("uses taskkill on Windows", async () => {
    const exec = vi.fn().mockReturnValue("");
    const kill = vi.fn().mockReturnValue(undefined); // isProcessAlive → true
    const result = await killProcess(12345, { platform: "win32", exec, kill });
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(/taskkill\s+\/F\s+\/T\s+\/PID\s+12345/),
      expect.any(Object),
    );
    expect(result).toEqual({ ok: true, forced: false });
  });

  it("returns { ok: false } when pid already dead", async () => {
    const kill = vi.fn().mockImplementation(() => {
      throw new Error("ESRCH");
    });
    const result = await killProcess(12345, { platform: "linux", kill });
    expect(result).toEqual({ ok: false, forced: false });
  });

  it("sends SIGTERM on Unix and reports clean stop when process dies", async () => {
    let aliveCount = 0;
    const kill = vi.fn().mockImplementation((_pid, sig) => {
      // isProcessAlive pre-check (signal 0) must succeed once to enter the branch
      if (sig === 0) {
        aliveCount++;
        if (aliveCount === 1) return; // alive
        throw new Error("ESRCH"); // dead after SIGTERM
      }
      if (sig === "SIGTERM") return;
      throw new Error("unexpected signal");
    });
    const result = await killProcess(12345, { platform: "linux", kill, timeoutMs: 500 });
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(result).toEqual({ ok: true, forced: false });
  });

  it("forces SIGKILL when process survives SIGTERM", async () => {
    const kill = vi.fn().mockImplementation((_pid, sig) => {
      if (sig === 0) return; // always alive during polling
      if (sig === "SIGTERM" || sig === "SIGKILL") return;
    });
    const result = await killProcess(12345, { platform: "linux", kill, timeoutMs: 300 });
    expect(kill).toHaveBeenCalledWith(12345, "SIGKILL");
    expect(result).toEqual({ ok: true, forced: true });
  });
});

describe("killPidWithGroup", () => {
  it("signals -pid on Unix (process group)", () => {
    const kill = vi.fn();
    killPidWithGroup(12345, "SIGTERM", { platform: "linux", kill });
    expect(kill).toHaveBeenCalledWith(-12345, "SIGTERM");
  });

  it("signals +pid on Windows (no process groups)", () => {
    const kill = vi.fn();
    killPidWithGroup(12345, "SIGTERM", { platform: "win32", kill });
    expect(kill).toHaveBeenCalledWith(12345, "SIGTERM");
  });

  it("signals -pid on macOS", () => {
    const kill = vi.fn();
    killPidWithGroup(99999, "SIGKILL", { platform: "darwin", kill });
    expect(kill).toHaveBeenCalledWith(-99999, "SIGKILL");
  });
});
