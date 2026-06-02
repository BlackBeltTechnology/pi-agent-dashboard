import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseEtime, scanChildProcesses, captureChildPgids, scanTrackedProcesses, killProcessByPgid, scanWindowsProcesses, getOwnPgid, __resetOwnPgidCacheForTests, type SpawnSyncFn } from "../process-scanner.js";
import type { SpawnSyncReturns } from "node:child_process";

function mockResult(stdout: string, status = 0): SpawnSyncReturns<string> {
  return { status, stdout, stderr: "", pid: 0, output: [], signal: null };
}

function fail(): SpawnSyncReturns<string> {
  return mockResult("", 1);
}

/** Helper: ps -eo pid=,ppid= output for a set of pid→ppid pairs */
function psChildOutput(pairs: [number, number][]): string {
  return pairs.map(([pid, ppid]) => `  ${pid}  ${ppid}`).join("\n") + "\n";
}

describe("parseEtime", () => {
  it("parses mm:ss format", () => expect(parseEtime("02:15")).toBe(135000));
  it("parses hh:mm:ss format", () => expect(parseEtime("01:30:00")).toBe(5400000));
  it("parses dd-hh:mm:ss format", () => expect(parseEtime("2-03:00:00")).toBe(183600000));
  it("parses 00:05 as 5 seconds", () => expect(parseEtime("00:05")).toBe(5000));
  it("parses 1-00:00:00 as 1 day", () => expect(parseEtime("1-00:00:00")).toBe(86400000));
  it("returns 0 for empty string", () => expect(parseEtime("")).toBe(0));
  it("returns 0 for invalid format", () => expect(parseEtime("garbage")).toBe(0));
});

describe("captureChildPgids", () => {
  it("captures PGIDs of leaf children", () => {
    const mock: SpawnSyncFn = (cmd, args) => {
      // getChildPids for parent 100: finds child 200
      if (cmd === "ps" && args[0] === "-eo" && args[1] === "pid=,ppid=") {
        return mockResult(psChildOutput([[200, 100], [300, 999]]));
      }
      // getChildPids for child 200: no grandchildren (same ps call, no match)
      // ps -p 200 -o pgid=
      if (cmd === "ps" && args[0] === "-p" && args[1] === "200") {
        return mockResult("  200\n");
      }
      return fail();
    };
    const tracked = new Set<number>();
    captureChildPgids(100, tracked, { _spawnSync: mock });
    expect(tracked.has(200)).toBe(true);
  });

  it("does nothing on Windows", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const tracked = new Set<number>();
      captureChildPgids(100, tracked);
      expect(tracked.size).toBe(0);
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    }
  });
});

describe("scanTrackedProcesses", () => {
  it("returns alive processes matching tracked PGIDs", () => {
    const mock: SpawnSyncFn = (cmd) => {
      if (cmd === "ps") {
        return mockResult(
          "  300  200 02:00 node vitest\n  200  200 02:00 /bin/bash -c npm test\n  400  400 01:00 node vite\n"
        );
      }
      return fail();
    };
    const tracked = new Set([200]);
    const result = scanTrackedProcesses(tracked, 0, { _spawnSync: mock });
    expect(result.some((p) => p.command === "node vitest")).toBe(true);
    expect(result.some((p) => p.command.includes("bash"))).toBe(false);
    expect(result.some((p) => p.pgid === 400)).toBe(false);
  });

  it("removes dead PGIDs from tracked set", () => {
    const mock: SpawnSyncFn = (cmd) => {
      if (cmd === "ps") return mockResult("  500  500 01:00 node other\n");
      return fail();
    };
    const tracked = new Set([300]);
    scanTrackedProcesses(tracked, 0, { _spawnSync: mock });
    expect(tracked.has(300)).toBe(false);
  });

  it("filters by minElapsedMs", () => {
    const mock: SpawnSyncFn = (cmd) => {
      if (cmd === "ps") return mockResult("  300  200 00:05 node vitest\n");
      return fail();
    };
    const tracked = new Set([200]);
    const result = scanTrackedProcesses(tracked, 30000, { _spawnSync: mock });
    expect(result).toHaveLength(0);
  });

  it("returns empty on Windows", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const tracked = new Set([200]);
      expect(scanTrackedProcesses(tracked, 0)).toEqual([]);
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    }
  });
});

describe("scanChildProcesses (combined)", () => {
  it("captures and returns processes in one call", () => {
    let callCount = 0;
    const mock: SpawnSyncFn = (cmd, args) => {
      // Phase 1 (capture): getChildPids finds child 200 of parent 100
      if (cmd === "ps" && args[0] === "-eo" && args[1] === "pid=,ppid=") {
        callCount++;
        // First call: find children of 100 → 200
        // Second call: find children of 200 → none (leaf)
        if (callCount === 1) return mockResult(psChildOutput([[200, 100], [999, 888]]));
        if (callCount === 2) return mockResult(psChildOutput([[999, 888]])); // no children of 200
        // Phase 2: full process list
        return mockResult("  200  200 02:00 node vitest\n  999  888 01:00 unrelated\n");
      }
      // Phase 1: get PGID for captured PID 200
      if (cmd === "ps" && args[0] === "-p" && args[1] === "200" && args[2] === "-o" && args[3] === "pgid=") {
        return mockResult("  200\n");
      }
      // Phase 2: full scan
      if (cmd === "ps" && args[0] === "-eo" && args[1] === "pid=,pgid=,etime=,args=") {
        return mockResult("  200  200 02:00 node vitest\n  999  888 01:00 unrelated\n");
      }
      return fail();
    };

    const tracked = new Set<number>();
    const result = scanChildProcesses(100, tracked, 0, { _spawnSync: mock });
    expect(tracked.has(200)).toBe(true);
    expect(result.some(p => p.command === "node vitest")).toBe(true);
    expect(result.some(p => p.pgid === 888)).toBe(false); // unrelated PGID not tracked
  });

  it("returns empty on Windows", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const tracked = new Set<number>();
      expect(scanChildProcesses(100, tracked, 0)).toEqual([]);
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    }
  });
});

describe("excludedPgids exclusion set (tighten-process-list-ux)", () => {
  it("captureChildPgids refuses to track an excluded PGID", () => {
    const mock: SpawnSyncFn = (cmd, args) => {
      if (cmd === "ps" && args[0] === "-eo" && args[1] === "pid=,ppid=") {
        return mockResult(psChildOutput([[200, 100]]));
      }
      if (cmd === "ps" && args[0] === "-p" && args[1] === "200") {
        return mockResult("  200\n");
      }
      return fail();
    };
    const tracked = new Set<number>();
    const excluded = new Set<number>([200]);
    captureChildPgids(100, tracked, { _spawnSync: mock, excludedPgids: excluded });
    expect(tracked.has(200)).toBe(false);
    expect(tracked.size).toBe(0);
  });

  it("scanTrackedProcesses skips an alive process whose PGID is excluded (defense-in-depth)", () => {
    const mock: SpawnSyncFn = (cmd) => {
      if (cmd === "ps") {
        return mockResult("  300  200 02:00 node vitest\n");
      }
      return fail();
    };
    const tracked = new Set([200]);
    const excluded = new Set([200]);
    const result = scanTrackedProcesses(tracked, 0, { _spawnSync: mock, excludedPgids: excluded });
    expect(result).toHaveLength(0);
    // PGID is alive, so it stays in tracked (still alive) and excluded.
    expect(tracked.has(200)).toBe(true);
    expect(excluded.has(200)).toBe(true);
  });

  it("scanTrackedProcesses reaps a dead PGID from the excludedPgids set", () => {
    // ps output reports other processes only — the excluded PGID is dead.
    const mock: SpawnSyncFn = (cmd) => {
      if (cmd === "ps") {
        return mockResult("  500  500 01:00 node other\n");
      }
      return fail();
    };
    const tracked = new Set<number>();
    const excluded = new Set<number>([777]);
    scanTrackedProcesses(tracked, 0, { _spawnSync: mock, excludedPgids: excluded });
    expect(excluded.has(777)).toBe(false);
  });
});

describe("killProcessByPgid", () => {
  it("returns false for non-existent process group", () => {
    expect(killProcessByPgid(99999)).toBe(false);
  });

  it("uses taskkill on Windows", () => {
    const mockSpawn = vi.fn().mockReturnValue({ status: 0, stdout: "" });
    expect(killProcessByPgid(1234, { _spawnSync: mockSpawn, _platform: "win32" } as any)).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "1234", "/T", "/F"],
      expect.any(Object),
    );
  });
});

describe("Windows process scanning", () => {
  it("scanChildProcesses delegates to scanWindowsProcesses on win32", () => {
    const wmicOutput = [
      "CommandLine=node server.js",
      "CreationDate=20260410220000.000000+000",
      "ParentProcessId=100",
      "ProcessId=200",
      "",
    ].join("\n");
    const mockSpawn = vi.fn().mockReturnValue({ status: 0, stdout: wmicOutput });
    const tracked = new Set<number>();
    const result = scanChildProcesses(100, tracked, 0, { _spawnSync: mockSpawn, _platform: "win32" } as any);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].pid).toBe(200);
  });

  it("falls back to PowerShell when wmic fails", () => {
    const psOutput = JSON.stringify([{ ProcessId: 300, CommandLine: "npm test", CreationDate: new Date(Date.now() - 60000).toISOString() }]);
    const mockSpawn = vi.fn()
      .mockReturnValueOnce({ status: 1, stdout: "" }) // wmic fails
      .mockReturnValueOnce({ status: 0, stdout: psOutput }); // powershell succeeds
    const tracked = new Set<number>();
    const result = scanChildProcesses(100, tracked, 0, { _spawnSync: mockSpawn, _platform: "win32" } as any);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].pid).toBe(300);
  });

  it("returns empty when both wmic and PowerShell fail", () => {
    const mockSpawn = vi.fn().mockReturnValue({ status: 1, stdout: "" });
    const tracked = new Set<number>();
    const result = scanChildProcesses(100, tracked, 0, { _spawnSync: mockSpawn, _platform: "win32" } as any);
    expect(result).toEqual([]);
  });
});

describe("getOwnPgid (classify-process-list-entries)", () => {
  beforeEach(() => __resetOwnPgidCacheForTests());

  it("parses pi's own PGID from ps output", () => {
    const mock: SpawnSyncFn = (cmd, args) => {
      if (cmd === "ps" && args[0] === "-o" && args[1] === "pgid=" && args[2] === "-p" && args[3] === "40286") {
        return mockResult("  40131\n");
      }
      return fail();
    };
    expect(getOwnPgid({ _spawnSync: mock, _pid: 40286, _platform: "darwin" })).toBe(40131);
  });

  it("caches after first resolution (no second ps call)", () => {
    let calls = 0;
    const mock: SpawnSyncFn = () => { calls++; return mockResult("  77\n"); };
    expect(getOwnPgid({ _spawnSync: mock, _pid: 5, _platform: "linux" })).toBe(77);
    expect(getOwnPgid({ _spawnSync: mock, _pid: 5, _platform: "linux" })).toBe(77);
    expect(calls).toBe(1);
  });

  it("returns undefined on failure", () => {
    expect(getOwnPgid({ _spawnSync: () => fail(), _pid: 5, _platform: "linux" })).toBeUndefined();
  });

  it("returns undefined on Windows without spawning", () => {
    let calls = 0;
    const mock: SpawnSyncFn = () => { calls++; return mockResult("  1\n"); };
    expect(getOwnPgid({ _spawnSync: mock, _pid: 5, _platform: "win32" })).toBeUndefined();
    expect(calls).toBe(0);
  });
});

describe("pi own-PGID exclusion end-to-end (classify-process-list-entries)", () => {
  it("refuses pi's own pgid at capture and keeps a different-pgid child", () => {
    // pi pid=100 pgid=131. Two children: one shares pi's pgid (plumbing),
    // one has its own pgid (user/subagent task).
    const PI_PGID = 131;
    const mock: SpawnSyncFn = (cmd, args) => {
      // capture: children of 100 → 200 (shares pi pgid), 300 (own pgid)
      if (cmd === "ps" && args[0] === "-eo" && args[1] === "pid=,ppid=") {
        return mockResult(psChildOutput([[200, 100], [300, 100]]));
      }
      if (cmd === "ps" && args[0] === "-p" && args[1] === "200,300") {
        return mockResult(`  ${PI_PGID}\n  300\n`);
      }
      return fail();
    };
    const tracked = new Set<number>();
    const excluded = new Set<number>([PI_PGID]);
    captureChildPgids(100, tracked, { _spawnSync: mock, excludedPgids: excluded });
    expect(tracked.has(PI_PGID)).toBe(false);
    expect(tracked.has(300)).toBe(true);
  });
});
