/**
 * Tests for killProcessTree + its pure helpers (parsePsTree,
 * collectDescendants) in packages/shared/src/platform/process.ts.
 *
 * POSIX force-kill must terminate detached children living in their own
 * process groups (pi spawns bash tools `detached: true`), so the kill
 * walks the `ps -eo pid,ppid,pgid` tree and signals process GROUPS.
 * See change: fix-stuck-session-stop-escalation (design D1/D2).
 */
import { describe, it, expect, vi } from "vitest";
import {
  parsePsTree,
  collectDescendants,
  killProcessTree,
} from "../platform/process.js";

// ps -eo pid,ppid,pgid style output. Root pi = 100 (pgid 100),
// child bash = 200 (own group 200, detached), grandchild sleep = 300
// (inherits group 200). Unrelated process = 900.
const PS_OUTPUT = [
  "  PID  PPID  PGID",
  "  100     1   100",
  "  200   100   200",
  "  300   200   200",
  "  900     1   900",
].join("\n");

/** ps output after every tree member died. */
const PS_OUTPUT_EMPTY = ["  PID  PPID  PGID", "  900     1   900"].join("\n");

describe("parsePsTree", () => {
  it("parses pid/ppid/pgid rows, skipping the header", () => {
    expect(parsePsTree(PS_OUTPUT)).toEqual([
      { pid: 100, ppid: 1, pgid: 100 },
      { pid: 200, ppid: 100, pgid: 200 },
      { pid: 300, ppid: 200, pgid: 200 },
      { pid: 900, ppid: 1, pgid: 900 },
    ]);
  });

  it("returns [] for garbage input", () => {
    expect(parsePsTree("not ps output")).toEqual([]);
  });
});

describe("collectDescendants", () => {
  const rows = parsePsTree(PS_OUTPUT);

  it("BFS from root includes root, children, grandchildren", () => {
    const result = collectDescendants(100, rows);
    expect(result.map((r) => r.pid).sort()).toEqual([100, 200, 300]);
  });

  it("excludes unrelated processes", () => {
    const result = collectDescendants(100, rows);
    expect(result.some((r) => r.pid === 900)).toBe(false);
  });

  it("returns only the root row when it has no children", () => {
    expect(collectDescendants(900, rows)).toEqual([{ pid: 900, ppid: 1, pgid: 900 }]);
  });

  it("returns [] when root pid absent from snapshot", () => {
    expect(collectDescendants(555, rows)).toEqual([]);
  });
});

describe("killProcessTree (POSIX)", () => {
  it("SIGTERMs each unique descendant process group (negative pid)", async () => {
    const killed: Array<[number, NodeJS.Signals | number]> = [];
    let dead = false;
    const exec = vi.fn().mockImplementation(() => (dead ? PS_OUTPUT_EMPTY : PS_OUTPUT));
    const kill = vi.fn().mockImplementation((pid: number, sig: NodeJS.Signals | number) => {
      if (sig === 0 && dead) throw new Error("ESRCH");
      if (sig !== 0) {
        killed.push([pid, sig]);
        dead = true; // everything dies on first real signal
      }
    });
    const result = await killProcessTree(100, {
      platform: "linux",
      exec,
      kill,
      ownPgid: 50,
      timeoutMs: 250,
    });
    // Groups 100 and 200 SIGTERMed as groups (negative pgid)
    expect(killed).toContainEqual([-100, "SIGTERM"]);
    expect(killed).toContainEqual([-200, "SIGTERM"]);
    // Unrelated group 900 untouched
    expect(killed.some(([p]) => p === -900 || p === 900)).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.forced).toBe(false);
  });

  it("never signals the server's own process group", async () => {
    const killed: Array<[number, NodeJS.Signals | number]> = [];
    let dead = false;
    const exec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes("-p") && cmd.includes("pgid=")) return "100\n";
      return dead ? PS_OUTPUT_EMPTY : PS_OUTPUT;
    });
    const kill = vi.fn().mockImplementation((pid: number, sig: NodeJS.Signals | number) => {
      if (sig === 0 && dead) throw new Error("ESRCH");
      if (sig !== 0) {
        killed.push([pid, sig]);
        dead = true;
      }
    });
    // Server shares group 100 with the root (pathological) — default own-PGID
    // detection must skip it, or force_kill kills the dashboard/test runner.
    await killProcessTree(100, { platform: "linux", exec, kill, timeoutMs: 250 });
    expect(killed.some(([p]) => p === -100)).toBe(false);
    // Other group still killed
    expect(killed).toContainEqual([-200, "SIGTERM"]);
  });

  it("SIGKILLs surviving groups after the grace window", async () => {
    const killed: Array<[number, NodeJS.Signals | number]> = [];
    let sigkilled = false;
    const exec = vi.fn().mockImplementation(() => (sigkilled ? PS_OUTPUT_EMPTY : PS_OUTPUT));
    const kill = vi.fn().mockImplementation((pid: number, sig: NodeJS.Signals | number) => {
      if (sig === 0 && sigkilled) throw new Error("ESRCH");
      if (sig !== 0) killed.push([pid, sig]);
      if (sig === "SIGKILL") sigkilled = true; // survives SIGTERM, dies on SIGKILL
    });
    const result = await killProcessTree(100, {
      platform: "linux",
      exec,
      kill,
      ownPgid: 50,
      timeoutMs: 250,
    });
    expect(killed).toContainEqual([-100, "SIGKILL"]);
    expect(killed).toContainEqual([-200, "SIGKILL"]);
    expect(result.ok).toBe(true);
    expect(result.forced).toBe(true);
  });

  it("swallows ESRCH from already-dead groups", async () => {
    const exec = vi.fn().mockReturnValue(PS_OUTPUT);
    const kill = vi.fn().mockImplementation((_pid: number, sig: NodeJS.Signals | number) => {
      if (sig !== 0) throw new Error("ESRCH");
      // signal 0 (liveness): root stays alive
    });
    await expect(
      killProcessTree(100, { platform: "linux", exec, kill, ownPgid: 50, timeoutMs: 250 }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("reports ok:false when the root survives everything", async () => {
    const exec = vi.fn().mockReturnValue(PS_OUTPUT);
    const kill = vi.fn(); // never throws → always alive
    const result = await killProcessTree(100, {
      platform: "linux",
      exec,
      kill,
      ownPgid: 50,
      timeoutMs: 250,
    });
    expect(result.ok).toBe(false);
  });

  it("falls back to single-PID kill when ps snapshot fails", async () => {
    const killed: Array<[number, NodeJS.Signals | number]> = [];
    let dead = false;
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("ps unavailable");
    });
    const kill = vi.fn().mockImplementation((pid: number, sig: NodeJS.Signals | number) => {
      if (sig === 0 && dead) throw new Error("ESRCH");
      if (sig !== 0) {
        killed.push([pid, sig]);
        dead = true;
      }
    });
    const result = await killProcessTree(100, {
      platform: "linux",
      exec,
      kill,
      ownPgid: 50,
      timeoutMs: 250,
    });
    // No group kills possible; root single-PID kill still runs
    expect(killed).toContainEqual([100, "SIGTERM"]);
    expect(result.ok).toBe(true);
  });
});

describe("killProcessTree (win32)", () => {
  it("delegates to taskkill /F /T", async () => {
    const exec = vi.fn().mockReturnValue("");
    const kill = vi.fn(); // isProcessAlive pre-check → alive
    const result = await killProcessTree(12345, { platform: "win32", exec, kill });
    expect(exec).toHaveBeenCalledWith(
      expect.stringMatching(/taskkill\s+\/F\s+\/T\s+\/PID\s+12345/),
      expect.any(Object),
    );
    expect(result.ok).toBe(true);
  });

  it("reports ok:false when taskkill fails", async () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("taskkill failed");
    });
    const kill = vi.fn();
    const result = await killProcessTree(12345, { platform: "win32", exec, kill });
    expect(result.ok).toBe(false);
  });
});
