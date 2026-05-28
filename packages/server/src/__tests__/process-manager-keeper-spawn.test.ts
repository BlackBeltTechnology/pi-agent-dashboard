/**
 * Tests for `spawnHeadless` going through the RPC keeper sidecar.
 *
 * As of change `enable-rpc-keeper-by-default`, the keeper is the only
 * spawn path for `--mode rpc` sessions; the previous flag-on / flag-off
 * matrix has collapsed to a single branch.
 *
 * Drives `spawnPiSession({strategy: "headless"})` with an injected fake
 * KeeperManager and verifies:
 *   - KeeperManager.spawnKeeperFor is called on every headless spawn
 *   - returned SpawnResult.pid is the keeper PID
 *   - env passed to the keeper includes `PI_DASHBOARD_SPAWN_TOKEN`
 *   - keeper failure surfaces as `PI_CRASHED` or `SPAWN_ERRNO`
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KeeperManager,
  KeeperSpawnResult,
} from "../rpc-keeper/keeper-manager.js";
import {
  setKeeperManager,
  setResolver,
  resetResolver,
  spawnPiSession,
} from "../process-manager.js";
import type { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

// Fake resolver returning a fixed pi argv so spawnHeadlessViaKeeper's
// resolvePiCommand() call succeeds. The PI_NOT_FOUND branch is exercised
// in a dedicated test below via `setResolver` with `resolvePi: () => null`.
function makeFakeResolver(piCmd: string[] | null = ["/usr/bin/pi"]): ToolResolver {
  return {
    resolvePi: () => piCmd,
    resolveNode: () => "/usr/bin/node",
    which: () => null,
    buildSpawnEnv: (env: NodeJS.ProcessEnv) => env,
  } as unknown as ToolResolver;
}

class FakeKeeperChild extends EventEmitter {
  pid: number;
  unref = vi.fn();
  kill = vi.fn();
  // Never emits "exit" → waitForNoCrash window completes cleanly.
  constructor(pid: number) { super(); this.pid = pid; }
}

interface FakeKeeperManagerState {
  spawnCalls: Array<{ sessionId: string; cwd: string; env: NodeJS.ProcessEnv; piArgs?: string[]; piCmd?: string[] }>;
  writeCalls: Array<{ sessionId: string; line: string }>;
  killCalls: string[];
  spawnResult: KeeperSpawnResult;
}

function makeFakeKeeperManager(
  state: Partial<FakeKeeperManagerState> & { spawnResult: KeeperSpawnResult },
): { km: KeeperManager; state: FakeKeeperManagerState } {
  const full: FakeKeeperManagerState = {
    spawnCalls: state.spawnCalls ?? [],
    writeCalls: state.writeCalls ?? [],
    killCalls: state.killCalls ?? [],
    spawnResult: state.spawnResult,
  };
  const km: KeeperManager = {
    sessionsDir: "/fake/sessions",
    spawnKeeperFor: async (sessionId, cwd, env, piArgs, piCmd) => {
      full.spawnCalls.push({ sessionId, cwd, env, piArgs, piCmd });
      return full.spawnResult;
    },
    writeRpc: async (sessionId, line) => {
      full.writeCalls.push({ sessionId, line });
      return true;
    },
    writeRpcToSockPath: async (_sockPath, _line) => true,
    killKeeper: (sessionId) => {
      full.killCalls.push(sessionId);
      return true;
    },
    discoverExistingKeepers: async () => [],
  };
  return { km, state: full };
}

let tmpCwd: string;

beforeEach(() => {
  tmpCwd = mkdtempSync(path.join("/tmp", "km-cwd-"));
  // Default: resolver returns a fixed pi argv so spawnHeadlessViaKeeper's
  // PI resolution succeeds. Individual tests override via setResolver.
  setResolver(makeFakeResolver());
});
afterEach(() => {
  setKeeperManager(null);
  resetResolver();
  rmSync(tmpCwd, { recursive: true, force: true });
});

describe("spawnHeadless (headless via keeper)", () => {
  it("routes through KeeperManager on every headless spawn", async () => {
    const fakeChild = new FakeKeeperChild(11111);
    const { km, state } = makeFakeKeeperManager({
      spawnResult: {
        success: true,
        pid: 11111,
        sockPath: "/fake/sessions/sid.rpc.sock",
        process: fakeChild as unknown as import("node:child_process").ChildProcess,
      },
    });
    setKeeperManager(km);

    const result = await spawnPiSession(tmpCwd, { strategy: "headless" });

    expect(result.success).toBe(true);
    expect(result.pid).toBe(11111);
    expect(state.spawnCalls).toHaveLength(1);
    expect(state.spawnCalls[0].cwd).toBe(tmpCwd);

    // spawnToken contract (task 5.3): the env passed to the keeper carries
    // PI_DASHBOARD_SPAWN_TOKEN, which the keeper forwards to pi via
    // process.env inheritance.
    expect(state.spawnCalls[0].env.PI_DASHBOARD_SPAWN_TOKEN).toBeDefined();
    expect(typeof state.spawnCalls[0].env.PI_DASHBOARD_SPAWN_TOKEN).toBe("string");
    expect(state.spawnCalls[0].env.PI_DASHBOARD_SPAWN_TOKEN!.length).toBeGreaterThan(0);

    // The returned spawnToken matches what was injected into env.
    expect(result.spawnToken).toBe(state.spawnCalls[0].env.PI_DASHBOARD_SPAWN_TOKEN);

    // Bare-spawn piArgs are at least `--mode rpc`.
    expect(state.spawnCalls[0].piArgs).toBeDefined();
    expect(state.spawnCalls[0].piArgs).toContain("--mode");
    expect(state.spawnCalls[0].piArgs).toContain("rpc");

    // SpawnResult.keeperSockPath populated so callers can pass it to
    // `headlessPidRegistry.register(..., {keeperPid, keeperSockPath})`
    // (Phase 6 contract). See change: add-rpc-stdin-dispatch-with-keeper-sidecar.
    expect(result.keeperSockPath).toBe("/fake/sessions/sid.rpc.sock");

    // Resolved pi argv is forwarded as the 5th positional to spawnKeeperFor
    // so the keeper can spawn pi via the absolute path. See change:
    // fix-rpc-keeper-pi-resolution.
    expect(state.spawnCalls[0].piCmd).toEqual(["/usr/bin/pi"]);
  });

  it("forwards resume flags (sessionFile / mode) to the keeper as piArgs", async () => {
    const fakeChild = new FakeKeeperChild(33333);
    const { km, state } = makeFakeKeeperManager({
      spawnResult: {
        success: true,
        pid: 33333,
        sockPath: "/fake/x.sock",
        process: fakeChild as unknown as import("node:child_process").ChildProcess,
      },
    });
    setKeeperManager(km);

    const sessionFile = "/tmp/sess-resume.jsonl";
    const result = await spawnPiSession(tmpCwd, {
      strategy: "headless",
      sessionFile,
      mode: "continue",
    });

    expect(result.success).toBe(true);
    expect(state.spawnCalls).toHaveLength(1);
    const piArgs = state.spawnCalls[0].piArgs ?? [];
    // piArgs MUST carry the session-file flag so resume actually resumes
    // (regression guard: in the first Phase-5 cut the keeper hardcoded
    // ["--mode","rpc"] and resume created a fresh session instead).
    expect(piArgs).toContain("--mode");
    expect(piArgs).toContain("rpc");
    // sessionFlagsToArgv emits the session-file path; the exact flag name
    // (`--session-file`) is verified in spawn-mechanism unit tests; here
    // we only assert the path token is present so we don't double-bind to
    // upstream argv shape.
    expect(piArgs).toContain(sessionFile);
  });

  it("returns SPAWN_ERRNO when KeeperManager.spawnKeeperFor reports !success", async () => {
    const { km } = makeFakeKeeperManager({
      spawnResult: { success: false, error: "EACCES on socket bind" },
    });
    setKeeperManager(km);

    const result = await spawnPiSession(tmpCwd, { strategy: "headless" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("SPAWN_ERRNO");
    expect(result.message).toMatch(/RPC keeper/);
    expect(result.message).toMatch(/EACCES/);
  });

  it("returns PI_CRASHED when keeper exits within the crash window", async () => {
    // A child that emits "exit" inside 300 ms triggers the waitForNoCrash gate.
    const fakeChild = new FakeKeeperChild(22222);
    setTimeout(() => fakeChild.emit("exit", 1, null), 20);

    const { km } = makeFakeKeeperManager({
      spawnResult: {
        success: true,
        pid: 22222,
        sockPath: "/fake/sessions/sid.rpc.sock",
        process: fakeChild as unknown as import("node:child_process").ChildProcess,
      },
    });
    setKeeperManager(km);

    const result = await spawnPiSession(tmpCwd, { strategy: "headless" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("PI_CRASHED");
    expect(result.message).toMatch(/crash window/);
  });

  it("returns PI_NOT_FOUND when resolver fails to resolve pi (keeper NOT spawned)", async () => {
    // See change: fix-rpc-keeper-pi-resolution. Mirrors the non-keeper
    // headless branch behavior: fail fast before any keeper-spawn side-effect.
    setResolver(makeFakeResolver(null));
    const { km, state } = makeFakeKeeperManager({
      spawnResult: { success: true, pid: 1, sockPath: "/fake/x.sock" },
    });
    setKeeperManager(km);

    const result = await spawnPiSession(tmpCwd, { strategy: "headless" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("PI_NOT_FOUND");
    expect(result.message).toMatch(/pi binary not found/);
    // Keeper subprocess MUST NOT be spawned when pi cannot be resolved.
    expect(state.spawnCalls).toEqual([]);
  });

});
