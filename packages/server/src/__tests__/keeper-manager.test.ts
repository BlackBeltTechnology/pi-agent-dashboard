/**
 * KeeperManager unit tests (task 4.6).
 *
 * Mocks `spawnDetached` and `net.createConnection` to assert:
 *   - spawnKeeperFor argv / spawn options shape
 *   - writeRpc retry-then-succeed and retry-then-fail behavior
 *   - killKeeper sends SIGTERM to the tracked PID via killPidWithGroup
 *   - discoverExistingKeepers correctly classifies live / stale / orphan
 *
 * Integration of the real keeper.cjs binary is exercised in
 * `rpc-keeper/__tests__/keeper.test.ts`; this file stays at unit-level.
 */
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SpawnDetachedOptions,
  SpawnDetachedResult,
} from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import type { ChildProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import {
  createKeeperManager,
  pidPathFor,
  sockPathFor,
  type KeeperManagerOptions,
} from "../rpc-keeper/keeper-manager.js";

// ── Fake spawnDetached ───────────────────────────────────────────────────────

class FakeChildProcess extends EventEmitter {
  pid: number | undefined;
  unref = vi.fn();
  kill = vi.fn();
  stdio = [null, null, null] as const;
  constructor(pid: number | undefined) {
    super();
    this.pid = pid;
  }
}

function makeFakeSpawnDetached(opts: { pid?: number; ok?: boolean; error?: string } = {}): {
  spawn: (opts: SpawnDetachedOptions) => Promise<SpawnDetachedResult>;
  calls: SpawnDetachedOptions[];
  lastChild: { current: FakeChildProcess | null };
} {
  const calls: SpawnDetachedOptions[] = [];
  const lastChild = { current: null as FakeChildProcess | null };
  const spawn = async (spawnOpts: SpawnDetachedOptions): Promise<SpawnDetachedResult> => {
    calls.push(spawnOpts);
    if (opts.ok === false) return { ok: false, error: opts.error ?? "forced fail" };
    const c = new FakeChildProcess(opts.pid);
    lastChild.current = c;
    return { ok: true, pid: opts.pid, process: c as unknown as ChildProcess };
  };
  return { spawn, calls, lastChild };
}

// ── Fake net.createConnection ────────────────────────────────────────────────

interface FakeConnectionConfig {
  attempts: Array<"connect-ok" | "error" | "timeout">;
}

class FakeSocket extends EventEmitter {
  destroyed = false;
  end = vi.fn((_data: unknown, _enc: unknown, cb?: () => void) => {
    if (cb) setImmediate(cb);
  });
  destroy = vi.fn(() => { this.destroyed = true; });
}

function makeFakeCreateConnection(cfg: FakeConnectionConfig): {
  createConnection: typeof net.createConnection;
  connectCount: () => number;
  pathsCalled: string[];
} {
  let i = 0;
  const pathsCalled: string[] = [];
  const fn = ((arg: string | net.NetConnectOpts) => {
    const p = typeof arg === "string" ? arg : (arg as net.IpcNetConnectOpts).path;
    if (typeof p === "string") pathsCalled.push(p);
    const sock = new FakeSocket();
    const behavior = cfg.attempts[i++] ?? "error";
    setImmediate(() => {
      if (behavior === "connect-ok") sock.emit("connect");
      else if (behavior === "error") sock.emit("error", new Error("ECONNREFUSED"));
      // "timeout" → do nothing; KeeperManager's per-attempt timer fires.
    });
    return sock as unknown as net.Socket;
  }) as typeof net.createConnection;
  return { createConnection: fn, connectCount: () => i, pathsCalled };
}

// ── Common setup ─────────────────────────────────────────────────────────────

const KNOWN_DEAD_PID = 99999999; // far above max_pid; process.kill returns ESRCH

let tmpRoot: string;
let sessionsDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join("/tmp", "km-"));
  sessionsDir = path.join(tmpRoot, ".pi", "dashboard", "sessions");
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function baseOpts(extra: Partial<KeeperManagerOptions> = {}): KeeperManagerOptions {
  return {
    sessionsDir,
    keeperPath: path.resolve(__dirname, "..", "rpc-keeper", "keeper.cjs"),
    nodeBinary: "/usr/bin/node",
    platform: process.platform,
    ...extra,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("KeeperManager.spawnKeeperFor", () => {
  it("delegates to spawnDetached with `node <keeper.cjs> <sessionId>`", async () => {
    const { spawn, calls } = makeFakeSpawnDetached({ pid: 12345 });
    const km = createKeeperManager(baseOpts({ spawnDetached: spawn }));

    const result = await km.spawnKeeperFor("sess-1", "/some/cwd", { FOO: "bar" });

    expect(result.success).toBe(true);
    expect(result.pid).toBe(12345);
    expect(result.sockPath).toBe(sockPathFor(sessionsDir, "sess-1"));

    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe("/usr/bin/node");
    expect(calls[0].args).toEqual([baseOpts().keeperPath!, "sess-1"]);
    expect(calls[0].cwd).toBe("/some/cwd");
    expect(calls[0].stdinMode).toBe("ignore");
    expect(calls[0].detach).toBe(true);
    expect((calls[0].env as { FOO?: string } | undefined)?.FOO).toBe("bar");
  });

  it("returns success: false when spawnDetached reports !ok", async () => {
    const { spawn } = makeFakeSpawnDetached({ ok: false, error: "no pid available" });
    const km = createKeeperManager(baseOpts({ spawnDetached: spawn }));
    const result = await km.spawnKeeperFor("sess-x", "/cwd", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no pid/);
  });

  it("returns success: false when keeper.cjs path does not exist", async () => {
    const { spawn } = makeFakeSpawnDetached({ pid: 1 });
    const km = createKeeperManager(
      baseOpts({ spawnDetached: spawn, keeperPath: "/does/not/exist/keeper.cjs" }),
    );
    const result = await km.spawnKeeperFor("sess-x", "/cwd", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/keeper\.cjs not found/);
  });

  it("forwards piCmd to the keeper env as JSON-encoded PI_KEEPER_PI_CMD", async () => {
    // See change: fix-rpc-keeper-pi-resolution.
    const { spawn, calls } = makeFakeSpawnDetached({ pid: 7777 });
    const km = createKeeperManager(baseOpts({ spawnDetached: spawn }));

    const result = await km.spawnKeeperFor(
      "sess-cmd",
      "/cwd",
      { FOO: "bar" },
      ["--mode", "rpc"],
      ["/abs/path/pi"],
    );

    expect(result.success).toBe(true);
    const envOut = calls[0].env as Record<string, string | undefined>;
    expect(envOut.PI_KEEPER_PI_CMD).toBe(JSON.stringify(["/abs/path/pi"]));
    expect(envOut.PI_KEEPER_PI_ARGS).toBe(JSON.stringify(["--mode", "rpc"]));
    // Caller's env entries preserved alongside the new vars.
    expect(envOut.FOO).toBe("bar");
  });

  it("omits PI_KEEPER_PI_CMD when piCmd is undefined or empty", async () => {
    // Preserves bare-`"pi"` fallback path in the keeper (manual / test invocation).
    // See change: fix-rpc-keeper-pi-resolution.
    const { spawn, calls } = makeFakeSpawnDetached({ pid: 7778 });
    const km = createKeeperManager(baseOpts({ spawnDetached: spawn }));

    await km.spawnKeeperFor("sess-a", "/cwd", {}, ["--mode", "rpc"]);
    expect((calls[0].env as Record<string, string | undefined>).PI_KEEPER_PI_CMD).toBeUndefined();

    await km.spawnKeeperFor("sess-b", "/cwd", {}, ["--mode", "rpc"], []);
    expect((calls[1].env as Record<string, string | undefined>).PI_KEEPER_PI_CMD).toBeUndefined();
  });
});

describe("KeeperManager.writeRpc", () => {
  it("writes line on first successful attempt and returns true", async () => {
    const cfg: FakeConnectionConfig = { attempts: ["connect-ok"] };
    const { createConnection, connectCount, pathsCalled } = makeFakeCreateConnection(cfg);
    const km = createKeeperManager(baseOpts({ createConnection }));

    const ok = await km.writeRpc("sess-1", '{"x":1}');
    expect(ok).toBe(true);
    expect(connectCount()).toBe(1);
    expect(pathsCalled[0]).toBe(sockPathFor(sessionsDir, "sess-1"));
  });

  it("retries after error and succeeds on attempt 2", async () => {
    const cfg: FakeConnectionConfig = { attempts: ["error", "connect-ok"] };
    const { createConnection, connectCount } = makeFakeCreateConnection(cfg);
    const km = createKeeperManager(baseOpts({ createConnection }));

    const ok = await km.writeRpc("sess-1", '{"x":1}');
    expect(ok).toBe(true);
    expect(connectCount()).toBe(2);
  });

  it("returns false after 3 failed attempts", async () => {
    const cfg: FakeConnectionConfig = { attempts: ["error", "error", "error"] };
    const { createConnection, connectCount } = makeFakeCreateConnection(cfg);
    const km = createKeeperManager(baseOpts({ createConnection }));

    const ok = await km.writeRpc("sess-1", '{"x":1}');
    expect(ok).toBe(false);
    expect(connectCount()).toBe(3);
  });

  it("appends trailing newline if missing", async () => {
    let captured = "";
    const fn = ((arg: unknown) => {
      const sock = new FakeSocket();
      sock.end = vi.fn((data: unknown, _enc: unknown, cb?: () => void) => {
        captured = String(data);
        if (cb) setImmediate(cb);
      }) as unknown as FakeSocket["end"];
      setImmediate(() => sock.emit("connect"));
      return sock as unknown as net.Socket;
    }) as typeof net.createConnection;

    const km = createKeeperManager(baseOpts({ createConnection: fn }));
    await km.writeRpc("sess-1", '{"x":1}');
    expect(captured).toBe('{"x":1}\n');
  });

  it("does NOT append a second newline if line already ends with \\n", async () => {
    let captured = "";
    const fn = ((arg: unknown) => {
      const sock = new FakeSocket();
      sock.end = vi.fn((data: unknown, _enc: unknown, cb?: () => void) => {
        captured = String(data);
        if (cb) setImmediate(cb);
      }) as unknown as FakeSocket["end"];
      setImmediate(() => sock.emit("connect"));
      return sock as unknown as net.Socket;
    }) as typeof net.createConnection;

    const km = createKeeperManager(baseOpts({ createConnection: fn }));
    await km.writeRpc("sess-1", '{"x":1}\n');
    expect(captured).toBe('{"x":1}\n');
  });
});

describe("KeeperManager.killKeeper", () => {
  it("returns false when no spawn has been tracked for sessionId", () => {
    const km = createKeeperManager(baseOpts());
    expect(km.killKeeper("never-spawned")).toBe(false);
  });

  it("sends SIGTERM to the tracked PID after a successful spawn", async () => {
    const { spawn } = makeFakeSpawnDetached({ pid: 77777 });
    const km = createKeeperManager(baseOpts({ spawnDetached: spawn }));
    await km.spawnKeeperFor("sess-k", "/cwd", {});

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const ok = km.killKeeper("sess-k");
    expect(ok).toBe(true);
    const target = process.platform === "win32" ? 77777 : -77777; // platform-branch-ok
    expect(killSpy).toHaveBeenCalledWith(target, "SIGTERM");
    killSpy.mockRestore();
  });
});

describe("KeeperManager.discoverExistingKeepers", () => {
  it("returns empty list when sessions dir is missing", async () => {
    const km = createKeeperManager(baseOpts({ sessionsDir: path.join(tmpRoot, "nope") }));
    const r = await km.discoverExistingKeepers();
    expect(r).toEqual([]);
  });

  it("returns live entry when keeper PID and pi PID are both alive", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-live";
    const pidFile = pidPathFor(sessionsDir, sid);
    writeFileSync(pidFile, String(process.pid));

    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => true }));
    const r = await km.discoverExistingKeepers();
    expect(r).toHaveLength(1);
    expect(r[0].sessionId).toBe(sid);
    expect(r[0].keeperPid).toBe(process.pid);
    expect(existsSync(pidFile)).toBe(true);
  });

  it("unlinks sidecar when keeper PID is dead", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-dead-keeper";
    const pidFile = pidPathFor(sessionsDir, sid);
    writeFileSync(pidFile, String(KNOWN_DEAD_PID));

    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => true }));
    const r = await km.discoverExistingKeepers();
    expect(r).toEqual([]);
    expect(existsSync(pidFile)).toBe(false);
  });

  it("kills keeper and unlinks sidecar when pi is dead but keeper is alive", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-orphan-keeper";
    const pidFile = pidPathFor(sessionsDir, sid);
    writeFileSync(pidFile, String(process.pid));

    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => false }));
    const r = await km.discoverExistingKeepers();
    expect(r).toEqual([]);
    const target = process.platform === "win32" ? process.pid : -process.pid; // platform-branch-ok
    const sigtermCalls = killSpy.mock.calls.filter((c) => c[1] === "SIGTERM");
    expect(sigtermCalls).toContainEqual([target, "SIGTERM"]);
    expect(existsSync(pidFile)).toBe(false);
    killSpy.mockRestore();
  });
});

// See change: fix-keeper-session-identity-and-reattach.
// discoverExistingKeepers surfaces pi's PID from the pi-PID sidecar (live only),
// ignores pi-PID sidecars as keeper sidecars, and the default liveness probe
// maps an absent/unparseable sidecar to alive and only a present-dead PID to dead.
import { piPidPathFor } from "../rpc-keeper/keeper-manager.js";

describe("KeeperManager pi-PID sidecar discovery", () => {
  it("E12: a pi-PID sidecar is never treated as a keeper sidecar (no phantom)", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-phantom";
    // Only a pi-PID sidecar present — no keeper .pid. Must not be discovered.
    writeFileSync(piPidPathFor(sessionsDir, sid), String(process.pid));
    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => true }));
    const r = await km.discoverExistingKeepers();
    expect(r).toEqual([]);
    // No session id of the form "<sid>.pi" (or any pi-derived id) is emitted.
    expect(r.some((e) => e.sessionId.endsWith(".pi"))).toBe(false);
  });

  it("E14: live pi-PID sidecar surfaces piPid on the discovery result", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-live-pi";
    writeFileSync(pidPathFor(sessionsDir, sid), String(process.pid));
    writeFileSync(piPidPathFor(sessionsDir, sid), String(process.pid)); // live
    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => true }));
    const r = await km.discoverExistingKeepers();
    expect(r).toHaveLength(1);
    expect(r[0].piPid).toBe(process.pid);
  });

  it("X4: a dead pi-PID sidecar is not surfaced (piPid undefined)", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-dead-pi";
    writeFileSync(pidPathFor(sessionsDir, sid), String(process.pid));
    writeFileSync(piPidPathFor(sessionsDir, sid), String(KNOWN_DEAD_PID));
    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => true }));
    const r = await km.discoverExistingKeepers();
    expect(r).toHaveLength(1);
    expect(r[0].piPid).toBeUndefined();
  });

  it("X3: healthy keeper with NO pi-PID sidecar survives the default scan", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-no-sidecar";
    const pidFile = pidPathFor(sessionsDir, sid);
    writeFileSync(pidFile, String(process.pid));
    // Default probe (no injection): absent sidecar → alive → keeper survives.
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const km = createKeeperManager(baseOpts());
    const r = await km.discoverExistingKeepers();
    expect(r).toHaveLength(1);
    expect(r[0].sessionId).toBe(sid);
    expect(r[0].piPid).toBeUndefined();
    expect(existsSync(pidFile)).toBe(true); // not unlinked
    // No SIGTERM to the keeper.
    const target = process.platform === "win32" ? process.pid : -process.pid; // platform-branch-ok
    expect(killSpy.mock.calls.filter((c) => c[0] === target && c[1] === "SIGTERM")).toHaveLength(0);
    killSpy.mockRestore();
  });

  it("X2: default liveness probe returns alive when the pi-PID sidecar is absent", async () => {
    // Probe is exercised through discoverExistingKeepers: an absent sidecar
    // must NOT classify pi as dead (which would SIGTERM the keeper).
    mkdirSync(sessionsDir, { recursive: true });
    const sid = "sess-probe-absent";
    writeFileSync(pidPathFor(sessionsDir, sid), String(process.pid));
    const km = createKeeperManager(baseOpts()); // default probe
    const r = await km.discoverExistingKeepers();
    expect(r).toHaveLength(1); // survived → probe returned alive
  });

  it("E9: only a padded valid live PID is accepted; every other partition is rejected", async () => {
    mkdirSync(sessionsDir, { recursive: true });
    const partitions: Array<{ sid: string; write?: string; expectPiPid: number | undefined }> = [
      { sid: "p-absent", expectPiPid: undefined },                 // no sidecar
      { sid: "p-empty", write: "", expectPiPid: undefined },
      { sid: "p-abc", write: "abc", expectPiPid: undefined },
      { sid: "p-suffix", write: "123junk", expectPiPid: undefined },   // numeric prefix — parseInt would take 123
      { sid: "p-exp", write: "1e3", expectPiPid: undefined },          // exponent notation
      { sid: "p-dec", write: "12.5", expectPiPid: undefined },         // decimal notation
      { sid: "p-zero", write: "0", expectPiPid: undefined },
      { sid: "p-neg", write: "-1", expectPiPid: undefined },
      { sid: "p-padded", write: `  ${process.pid}  `, expectPiPid: process.pid }, // padded valid + live
      { sid: "p-max", write: String(KNOWN_DEAD_PID), expectPiPid: undefined },     // above real pids / not alive
    ];
    for (const p of partitions) {
      writeFileSync(pidPathFor(sessionsDir, p.sid), String(process.pid));
      if (p.write !== undefined) writeFileSync(piPidPathFor(sessionsDir, p.sid), p.write);
    }
    const km = createKeeperManager(baseOpts({ isPiAliveForSession: () => true }));
    const r = await km.discoverExistingKeepers();
    for (const p of partitions) {
      const entry = r.find((e) => e.sessionId === p.sid);
      expect(entry, `partition ${p.sid} should be discovered`).toBeDefined();
      expect(entry!.piPid, `partition ${p.sid}`).toBe(p.expectPiPid);
    }
  });
});
