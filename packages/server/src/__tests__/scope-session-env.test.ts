/**
 * Caller-supplied spawn env → spawned process env, merged with the guard env.
 *
 * Drives `spawnPiSession` through an injected fake KeeperManager (the sole
 * headless spawn path) and inspects the env handed to the keeper — the last
 * observable boundary before pi inherits it. Proves:
 *   - a caller env reaches the spawned process env (task 1.1 / 4.1 boundary);
 *   - guard env wins on a key collision, caller distinct keys survive (1.2);
 *   - no caller env ⇒ no scope keys leak (1.3 / 4.2 regression).
 * See change: scope-session-toolset-by-profile.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeeperManager, KeeperSpawnResult } from "../rpc-keeper/keeper-manager.js";
import { setKeeperManager, setResolver, resetResolver, spawnPiSession } from "../spawn-process/process-manager.js";
import { registerGuardedDir, unregisterGuardedDir } from "../session-guard.js";
import type { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

function makeFakeResolver(): ToolResolver {
  return {
    resolvePi: () => ["/usr/bin/pi"],
    resolveNode: () => "/usr/bin/node",
    which: () => null,
    buildSpawnEnv: (env: NodeJS.ProcessEnv) => env,
  } as unknown as ToolResolver;
}

class FakeKeeperChild extends EventEmitter {
  pid = 42424;
  unref = vi.fn();
  kill = vi.fn();
}

function makeFakeKeeperManager(): {
  km: KeeperManager;
  calls: Array<{ env: NodeJS.ProcessEnv }>;
} {
  const calls: Array<{ env: NodeJS.ProcessEnv }> = [];
  const spawnResult: KeeperSpawnResult = {
    success: true,
    pid: 42424,
    sockPath: "/fake/sid.rpc.sock",
    process: new FakeKeeperChild() as unknown as import("node:child_process").ChildProcess,
  };
  const km: KeeperManager = {
    sessionsDir: "/fake/sessions",
    spawnKeeperFor: async (_sessionId, _cwd, env) => {
      calls.push({ env });
      return spawnResult;
    },
    writeRpc: async () => true,
    writeRpcToSockPath: async () => true,
    killKeeper: () => true,
    discoverExistingKeepers: async () => [],
    isKeeperAlive: () => false,
  };
  return { km, calls };
}

let tmpCwd: string;
beforeEach(() => {
  tmpCwd = mkdtempSync(path.join("/tmp", "scope-env-"));
  setResolver(makeFakeResolver());
});
afterEach(() => {
  setKeeperManager(null);
  resetResolver();
  unregisterGuardedDir(tmpCwd);
  rmSync(tmpCwd, { recursive: true, force: true });
});

describe("spawn env: caller env → process env", () => {
  it("a caller env reaches the spawned process env (scoped-invoice profile keys)", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    const res = await spawnPiSession(tmpCwd, {
      strategy: "headless",
      env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-7" },
    });

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].env.IB_TOOLSET).toBe("scoped-invoice");
    expect(calls[0].env.IB_INVOICE_ID).toBe("inv-7");
  });

  it("guard env wins on a key collision; distinct keys from both survive", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);
    // Guard the cwd with an explicit allowedRoots so the guard emits
    // IB_GUARD_ALLOWED_ROOTS — the key the caller will try to collide with.
    registerGuardedDir(tmpCwd, { allowedRoots: [tmpCwd] });

    await spawnPiSession(tmpCwd, {
      strategy: "headless",
      env: { IB_GUARD_ALLOWED_ROOTS: "/hacked", IB_TOOLSET: "scoped-invoice" },
    });

    expect(calls).toHaveLength(1);
    // Guard value wins over the caller-supplied collision.
    expect(calls[0].env.IB_GUARD_ALLOWED_ROOTS).toBe(path.resolve(tmpCwd));
    expect(calls[0].env.IB_GUARD_ALLOWED_ROOTS).not.toBe("/hacked");
    // The caller's distinct key still survives.
    expect(calls[0].env.IB_TOOLSET).toBe("scoped-invoice");
  });

  it("no caller env ⇒ no scope keys reach the process (Ask session unchanged)", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(tmpCwd, { strategy: "headless" });

    expect(calls).toHaveLength(1);
    expect(calls[0].env.IB_TOOLSET).toBeUndefined();
    expect(calls[0].env.IB_INVOICE_ID).toBeUndefined();
  });
});
