import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseEtime,
  parseProcessSnapshot,
  scanFromSnapshot,
  scanChildProcesses,
  scanChildProcessesAsync,
  killProcessByPgid,
  getOwnPgid,
  __resetOwnPgidCacheForTests,
  type SpawnSyncFn,
} from "../process-scanner.js";
import { pollCost, __resetPollCostForTests } from "../poll-cost.js";
import type { SpawnSyncReturns } from "node:child_process";

function mockResult(stdout: string, status = 0): SpawnSyncReturns<string> {
  return { status, stdout, stderr: "", pid: 0, output: [], signal: null };
}

function fail(): SpawnSyncReturns<string> {
  return mockResult("", 1);
}

/** `ps -A -o pid=,ppid=,pgid=,etime=,args=` fixture rows: [pid, ppid, pgid, etime, args]. */
function snap(rows: Array<[number, number, number, string, string]>): string {
  return rows.map(([pid, ppid, pgid, etime, args]) => `  ${pid}  ${ppid}  ${pgid} ${etime} ${args}`).join("\n") + "\n";
}

/** Spawn mock that serves one snapshot and counts calls. */
function psMock(stdout: string) {
  const fn = vi.fn((cmd: string) => (cmd === "ps" ? mockResult(stdout) : fail()));
  return fn as unknown as SpawnSyncFn & ReturnType<typeof vi.fn>;
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

describe("single-snapshot Unix scan (optimize-polling-hot-paths)", () => {
  beforeEach(() => __resetPollCostForTests());

  it("E1: no children → [] after exactly one spawn", () => {
    const mock = psMock(snap([[1, 0, 1, "10:00", "/sbin/init"], [100, 1, 100, "05:00", "pi"]]));
    expect(scanChildProcesses(100, new Set(), 0, { _spawnSync: mock, _platform: "linux" })).toEqual([]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("E2: k=5 children (2 with grandchildren) → one spawn, leaf-only result", () => {
    const mock = psMock(snap([
      [100, 1, 100, "05:00", "pi"],
      [201, 100, 201, "01:00", "node a"],
      [202, 100, 202, "01:00", "node b"],
      [203, 100, 203, "01:00", "node c"],
      [204, 100, 204, "01:00", "bash wrapper1"],
      [205, 100, 205, "01:00", "bash wrapper2"],
      [304, 204, 204, "01:00", "node g1"],
      [305, 205, 205, "01:00", "node g2"],
    ]));
    const tracked = new Set<number>();
    const out = scanChildProcesses(100, tracked, 0, { _spawnSync: mock, _platform: "linux" });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(out.map((p) => p.pid).sort()).toEqual([201, 202, 203, 304, 305].sort());
    expect([...tracked].sort()).toEqual([201, 202, 203, 204, 205]);
  });

  it("E3: args with spaces stay intact", () => {
    const mock = psMock(snap([[100, 1, 100, "05:00", "pi"], [200, 100, 200, "01:10", "node /a b/c.js --flag x"]]));
    const out = scanChildProcesses(100, new Set(), 0, { _spawnSync: mock, _platform: "linux" });
    expect(out[0].command).toBe("node /a b/c.js --flag x");
  });

  it("E4: empty-args (zombie) row keeps the tree edge", () => {
    const text = "  100  1  100 05:00 pi\n  200  100  200 01:00\n  300  200  300 01:00 node real\n";
    const rows = parseProcessSnapshot(text);
    expect(rows.find((r) => r.pid === 200)?.args).toBe("");
    const out = scanFromSnapshot(rows, 100, new Set(), 0);
    expect(out.map((p) => p.pid)).toEqual([300]);
  });

  it("E5: excluded × tracked × alive decision table", () => {
    const rows = parseProcessSnapshot(snap([
      [100, 1, 100, "05:00", "pi"],
      [500, 100, 500, "01:00", "node server"],
    ]));
    const tracked = new Set([600]);
    const excluded = new Set([500, 700]);
    const out = scanFromSnapshot(rows, 100, tracked, 0, excluded);
    expect(out).toEqual([]);
    expect(tracked.has(500)).toBe(false); // refused at capture
    expect(tracked.has(600)).toBe(false); // dead tracked reaped
    expect(excluded.has(500)).toBe(true); // alive excluded kept
    expect(excluded.has(700)).toBe(false); // dead excluded reaped
  });

  it("E6: minElapsedMs boundary (00:04 / 00:05 / 00:06 at 5000)", () => {
    const rows = parseProcessSnapshot(snap([
      [100, 1, 100, "05:00", "pi"],
      [201, 100, 201, "00:04", "a"],
      [202, 100, 202, "00:05", "b"],
      [203, 100, 203, "00:06", "c"],
    ]));
    expect(scanFromSnapshot(rows, 100, new Set(), 5000).map((p) => p.pid)).toEqual([202, 203]);
  });

  it("tracked PGID survives reparenting to PID 1 and bash/sh wrappers are hidden", () => {
    const rows = parseProcessSnapshot(snap([
      [300, 1, 200, "02:00", "node vitest"],
      [200, 1, 200, "02:00", "/bin/bash -c npm test"],
      [400, 1, 400, "01:00", "node vite"],
    ]));
    const out = scanFromSnapshot(rows, 100, new Set([200]), 0);
    expect(out.map((p) => p.command)).toEqual(["node vitest"]);
  });

  it("X1: ps failure → [] and trackedPgids unchanged", () => {
    const tracked = new Set([42]);
    expect(scanChildProcesses(100, tracked, 0, { _spawnSync: () => fail(), _platform: "linux" })).toEqual([]);
    expect(scanChildProcesses(100, tracked, 0, { _spawnSync: () => { throw new Error("boom"); }, _platform: "linux" })).toEqual([]);
    expect([...tracked]).toEqual([42]);
  });

  it("E2/2.2: async variant gives the identical result and never rejects", async () => {
    const text = snap([[100, 1, 100, "05:00", "pi"], [200, 100, 200, "01:00", "node x"]]);
    const sync = scanChildProcesses(100, new Set(), 0, { _spawnSync: psMock(text), _platform: "linux" });
    const exec = vi.fn(async () => ({ stdout: text }));
    const async_ = await scanChildProcessesAsync(100, new Set(), 0, { _execFile: exec as any, _platform: "linux" });
    expect(async_).toEqual(sync);
    expect(exec).toHaveBeenCalledTimes(1);
    const bad = await scanChildProcessesAsync(100, new Set(), 0, { _execFile: (async () => { throw new Error("x"); }) as any, _platform: "linux" });
    expect(bad).toEqual([]);
  });

  it("1.2: two scans advance pollProcScanRuns/Spawns to 2", () => {
    const mock = psMock(snap([[100, 1, 100, "05:00", "pi"]]));
    scanChildProcesses(100, new Set(), 0, { _spawnSync: mock, _platform: "linux" });
    scanChildProcesses(100, new Set(), 0, { _spawnSync: mock, _platform: "linux" });
    expect(pollCost.pollProcScanRuns).toBe(2);
    expect(pollCost.pollProcScanSpawns).toBe(2);
  });
});

describe("single-snapshot Windows scan (optimize-polling-hot-paths)", () => {
  const NOW = 1_700_000_000_000;
  const cim = (rows: Array<{ pid: number; ppid: number; cmd: string; agoMs: number }>) =>
    JSON.stringify(rows.map((r) => ({
      ProcessId: r.pid, ParentProcessId: r.ppid, CommandLine: r.cmd,
      CreationDate: new Date(NOW - r.agoMs).toISOString(),
    })));
  const win = (stdout: string, extra: object = {}) => {
    const spawn = vi.fn().mockReturnValue({ status: 0, stdout });
    return { spawn, opts: { _spawnSync: spawn, _platform: "win32", _now: () => NOW, ...extra } as any };
  };

  it("E7: win32 never spawns ps; PowerShell once", () => {
    const { spawn, opts } = win(cim([{ pid: 200, ppid: 100, cmd: "node", agoMs: 120_000 }]));
    scanChildProcesses(100, new Set(), 0, opts);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(String(spawn.mock.calls[0][0]).toLowerCase()).toContain("powershell");
    expect(spawn.mock.calls.some((c: any[]) => c[0] === "ps")).toBe(false);
  });

  it("E8: single-object JSON is a one-element list", () => {
    const one = JSON.stringify({ ProcessId: 200, ParentProcessId: 100, CommandLine: "node", CreationDate: new Date(NOW - 60_000).toISOString() });
    const { opts } = win(one);
    expect(scanChildProcesses(100, new Set(), 0, opts).map((p) => p.pid)).toEqual([200]);
  });

  it("E9: tree + exclusion by PID; no wrapper-name filter", () => {
    const { spawn, opts } = win(
      cim([
        { pid: 200, ppid: 100, cmd: "cmd.exe", agoMs: 60_000 },
        { pid: 300, ppid: 200, cmd: "node leaf", agoMs: 60_000 },
        { pid: 400, ppid: 100, cmd: "node server", agoMs: 60_000 },
        { pid: 500, ppid: 100, cmd: "bash.exe", agoMs: 60_000 },
      ]),
      { excludedPgids: new Set([400]) },
    );
    const out = scanChildProcesses(100, new Set(), 0, opts);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(out.map((p) => p.pid).sort()).toEqual([300, 500]);
  });

  it("E9b: dead excluded PIDs are reaped", () => {
    const excluded = new Set([900]);
    const { opts } = win(cim([{ pid: 200, ppid: 100, cmd: "node", agoMs: 60_000 }]), { excludedPgids: excluded });
    scanChildProcesses(100, new Set(), 0, opts);
    expect(excluded.has(900)).toBe(false);
  });

  it("E10: minElapsedMs boundary (29 s / 31 s at 30000)", () => {
    const { opts } = win(cim([
      { pid: 201, ppid: 100, cmd: "a", agoMs: 29_000 },
      { pid: 202, ppid: 100, cmd: "b", agoMs: 31_000 },
    ]));
    expect(scanChildProcesses(100, new Set(), 30_000, opts).map((p) => p.pid)).toEqual([202]);
  });

  it("X2: non-zero exit, malformed JSON, throw → []", () => {
    for (const spawn of [
      vi.fn().mockReturnValue({ status: 1, stdout: "" }),
      vi.fn().mockReturnValue({ status: 0, stdout: "not json" }),
      vi.fn().mockImplementation(() => { throw new Error("ETIMEDOUT"); }),
    ]) {
      expect(scanChildProcesses(100, new Set(), 0, { _spawnSync: spawn, _platform: "win32" } as any)).toEqual([]);
    }
  });

  it("async win32 variant matches the sync result", async () => {
    const text = cim([{ pid: 200, ppid: 100, cmd: "node", agoMs: 60_000 }]);
    const sync = scanChildProcesses(100, new Set(), 0, win(text).opts);
    const asyncOut = await scanChildProcessesAsync(100, new Set(), 0, {
      _execFile: (async () => ({ stdout: text })) as any, _platform: "win32", _now: () => NOW,
    });
    expect(asyncOut).toEqual(sync);
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
