/**
 * Tests for packages/shared/src/platform/process.ts.
 *
 * Every helper accepts injectable `platform`, `exec`, and `kill` parameters,
 * so no `Object.defineProperty(process, "platform", ...)` mutation is needed.
 * See change: consolidate-platform-handlers.
 */
import { spawn } from "node:child_process";
import { describe, it, expect, vi } from "vitest";
import {
  findPortHolders,
  parseNetstatListeners,
  isProcessAlive,
  killProcess,
  killPidWithGroup,
  killProcessGroup,
  processStartedAt,
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

// (test-plan #E9) See change: fix-gateway-socket-stale-owner.
describe("processStartedAt", () => {
  const stat = (field22: number) =>
    // comm `(a) b)` holds a space and a paren; fields 3..21 are filler.
    `42 (a) b) S ${Array.from({ length: 18 }, () => "0").join(" ")} ${field22} 0 0`;
  const reader = (files: Record<string, string>) => (p: string) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };

  it("parses /proc field 22 after the last ')' plus btime", () => {
    const readFile = reader({ "/proc/42/stat": stat(12345), "/proc/stat": "cpu 1 2\nbtime 1700000000\n" });
    expect(processStartedAt(42, { platform: "linux", readFile })).toBe(1700000000 * 1000 + 123450);
  });

  it("returns null when /proc is unreadable", () => {
    expect(processStartedAt(42, { platform: "linux", readFile: reader({}) })).toBeNull();
  });

  it("parses `ps -o lstart=` output off Linux", () => {
    const exec = vi.fn((_cmd: string) => "Thu Oct  1 00:49:08 2026\n");
    expect(processStartedAt(42, { platform: "darwin", exec })).toBe(Date.parse("Thu Oct  1 00:49:08 2026"));
    expect(exec.mock.calls[0][0]).toContain("LC_ALL=C");
  });

  it("returns null when ps fails or prints garbage, and on win32", () => {
    expect(processStartedAt(42, { platform: "darwin", exec: () => { throw new Error("x"); } })).toBeNull();
    expect(processStartedAt(42, { platform: "darwin", exec: () => "nope" })).toBeNull();
    expect(processStartedAt(42, { platform: "win32" })).toBeNull();
  });

  it("reports this process within 5s of now - uptime", () => {
    const ms = processStartedAt(process.pid);
    expect(ms).not.toBeNull();
    expect(Math.abs((ms as number) - (Date.now() - process.uptime() * 1000))).toBeLessThan(5000);
  });
});

// ── killProcessGroup. See change: add-service-registry-core (E55–E57). ──────

/** Is any member of process group `pgid` alive (ESRCH = gone)? */
function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Spawn a detached group leader that forks one worker; both trap SIGTERM when
 * `stubborn`. Resolves once the worker pid is printed.
 */
async function spawnGroup(stubborn: boolean): Promise<{ leader: number; worker: number }> {
  const trap = stubborn ? "process.on('SIGTERM',()=>{});" : "";
  const workerSrc = `${trap}setInterval(()=>{},1000);`;
  const leaderSrc =
    `${trap}const {spawn}=require('node:child_process');` +
    `const w=spawn(process.execPath,['-e',${JSON.stringify(workerSrc)}],{stdio:'ignore'});` +
    "setTimeout(()=>process.stdout.write(String(w.pid)+'\\n'),300);setInterval(()=>{},1000);";
  const child = spawn(process.execPath, ["-e", leaderSrc], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
  const worker = await new Promise<number>((resolve, reject) => {
    child.stdout?.once("data", (d) => resolve(Number(String(d).trim())));
    child.once("error", reject);
  });
  child.unref();
  return { leader: child.pid as number, worker };
}

describe.skipIf(process.platform === "win32")("killProcessGroup — POSIX (real processes)", () => {
  it("E55: worker ignoring SIGTERM → SIGTERM then SIGKILL to -pid; group fully gone", async () => {
    const { leader, worker } = await spawnGroup(true);
    const signals: Array<[number, unknown]> = [];
    const kill = (pid: number, sig: NodeJS.Signals | number) => {
      if (sig !== 0) signals.push([pid, sig]);
      process.kill(pid, sig);
    };
    const result = await killProcessGroup(leader, { timeoutMs: 2000, kill });
    expect(result).toEqual({ ok: true, forced: true });
    expect(signals).toEqual([[-leader, "SIGTERM"], [-leader, "SIGKILL"]]);
    expect(groupAlive(leader)).toBe(false);
    expect(isProcessAlive(worker)).toBe(false);
  }, 15_000);

  it("E56: group exits on SIGTERM → no SIGKILL", async () => {
    const { leader } = await spawnGroup(false);
    const signals: unknown[] = [];
    const kill = (pid: number, sig: NodeJS.Signals | number) => {
      if (sig !== 0) signals.push(sig);
      process.kill(pid, sig);
    };
    const result = await killProcessGroup(leader, { timeoutMs: 2000, kill });
    expect(result).toEqual({ ok: true, forced: false });
    expect(signals).toEqual(["SIGTERM"]);
    expect(groupAlive(leader)).toBe(false);
  }, 15_000);

  it("already-gone group → { ok:false, forced:false } and no signal", async () => {
    const kill = vi.fn((_pid: number, sig: NodeJS.Signals | number) => {
      if (sig === 0) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    expect(await killProcessGroup(999_999, { platform: "linux", kill })).toEqual({ ok: false, forced: false });
    expect(kill.mock.calls.every((c) => c[1] === 0)).toBe(true);
  });
});

describe("killProcessGroup — win32 delegates to killProcess (E57)", () => {
  it("issues exactly taskkill /F /T /PID <pid>", async () => {
    const exec = vi.fn().mockReturnValue("");
    const kill = vi.fn();
    const viaGroup = await killProcessGroup(4242, { platform: "win32", exec, kill });
    const groupCalls = exec.mock.calls.map((c) => c[0]);
    exec.mockClear();
    const viaProcess = await killProcess(4242, { platform: "win32", exec, kill });
    expect(viaGroup).toEqual(viaProcess);
    expect(groupCalls).toEqual(["taskkill /F /T /PID 4242"]);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(groupCalls);
  });
});
