/**
 * The spawn `env` map is an AUTHORIZATION channel — regression suite.
 *
 * A caller narrows a spawned session's tool surface by putting keys in the
 * spawn env (the consumer inside the session reads them LITERALLY and, when a
 * key is absent, falls back to its WIDER default). That fallback is silent:
 * drop or rename this channel and the session comes up with more tools than
 * intended, with no crash and no other failing test. These cases exist to make
 * that failure loud.
 *
 * Covered end to end (plugin options → mapper → spawn funnel → process env):
 *   - a caller env reaches the spawned process env, verbatim keys;
 *   - a host-managed key WINS a caller collision (a caller can never forge
 *     `PI_DASHBOARD_*` / `PI_EXT_*`), while distinct caller keys survive;
 *   - no caller env ⇒ no keys leak (byte-identical to a bare spawn);
 *   - the tool-narrowing key survives the FULL plugin path (the fail-open case).
 *
 * Drives `spawnPiSession` through an injected fake KeeperManager (the sole
 * headless spawn path) and inspects the env handed to the keeper — the last
 * observable boundary before pi inherits it.
 * See changes: scope-session-toolset-by-profile, add-plugin-spawn-scope.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginSpawnToSessionOptions } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { KeeperManager, KeeperSpawnResult } from "../rpc-keeper/keeper-manager.js";
import { setKeeperManager, setResolver, resetResolver, spawnPiSession } from "../spawn-process/process-manager.js";
import { GUARD_EXTENSION_PATH } from "../session-guard-extension.js";
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
  calls: Array<{ env: NodeJS.ProcessEnv; args: string[] }>;
} {
  const calls: Array<{ env: NodeJS.ProcessEnv; args: string[] }> = [];
  const spawnResult: KeeperSpawnResult = {
    success: true,
    pid: 42424,
    sockPath: "/fake/sid.rpc.sock",
    process: new FakeKeeperChild() as unknown as import("node:child_process").ChildProcess,
  };
  const km = {
    sessionsDir: "/fake/sessions",
    spawnKeeperFor: async (_sessionId: string, _cwd: string, env: NodeJS.ProcessEnv, piArgs?: string[]) => {
      calls.push({ env, args: piArgs ?? [] });
      return spawnResult;
    },
    writeRpc: async () => true,
    writeRpcToSockPath: async () => true,
    killKeeper: () => true,
    discoverExistingKeepers: async () => [],
    isKeeperAlive: () => false,
    sweepKeeperLogs: () => ({ removed: 0, reclaimedBytes: 0 }),
    getKeeperLogStats: () => ({ files: 0, totalBytes: 0 }),
  } as unknown as KeeperManager;
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
  rmSync(tmpCwd, { recursive: true, force: true });
});

describe("spawn env: caller env → process env", () => {
  it("a caller env reaches the spawned process env, keys verbatim", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    const res = await spawnPiSession(tmpCwd, {
      strategy: "headless",
      env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: "inv-7" },
    });

    expect(res.success).toBe(true);
    expect(calls).toHaveLength(1);
    // Verbatim, NOT namespaced: the consumer reads these exact key names.
    expect(calls[0]!.env.IB_TOOLSET).toBe("scoped-invoice");
    expect(calls[0]!.env.IB_INVOICE_ID).toBe("inv-7");
  });

  it("a host-managed key wins a caller collision; distinct caller keys survive", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(tmpCwd, {
      strategy: "headless",
      spawnToken: "host-token",
      extensionConfig: { guard: { allowedRoots: [tmpCwd] } },
      env: {
        // Both forgeries must lose: one host correlation key, one host-projected
        // extension-config key.
        PI_DASHBOARD_SPAWN_TOKEN: "forged",
        PI_EXT_GUARD_ALLOWED_ROOTS: "/hacked",
        IB_TOOLSET: "scoped-invoice",
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.env.PI_DASHBOARD_SPAWN_TOKEN).toBe("host-token");
    expect(calls[0]!.env.PI_EXT_GUARD_ALLOWED_ROOTS).toBe(JSON.stringify([tmpCwd]));
    // The caller's distinct key still survives.
    expect(calls[0]!.env.IB_TOOLSET).toBe("scoped-invoice");
  });

  it("no caller env ⇒ no scope keys reach the process (unscoped spawn unchanged)", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(tmpCwd, { strategy: "headless" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.env.IB_TOOLSET).toBeUndefined();
    expect(calls[0]!.env.IB_INVOICE_ID).toBeUndefined();
  });
});

describe("fail-open regression: the tool-narrowing key survives the whole plugin path", () => {
  it("a plugin-supplied narrowing key reaches the child process env", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    // The exact path a plugin spawn takes: PluginSpawnOptions → mapper →
    // spawnPiSession. If any hop drops the map, the session comes up on the
    // FULL tool surface and nothing else fails.
    const options = pluginSpawnToSessionOptions({
      cwd: tmpCwd,
      env: { IB_ALLOWED_TOOLS: "ib_status,ib_query", IB_TOOLSET: "ask" },
    });
    await spawnPiSession(tmpCwd, options);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.env.IB_ALLOWED_TOOLS).toBe("ib_status,ib_query");
    expect(calls[0]!.env.IB_TOOLSET).toBe("ask");
  });

  it("the narrowing key is NOT rewritten into the namespaced PI_EXT_* channel", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(tmpCwd, {
      strategy: "headless",
      env: { IB_ALLOWED_TOOLS: "ib_status" },
    });

    // Renaming the channel is the silent fail-open: the consumer reads the
    // literal key, so a namespaced-only delivery would read as "absent".
    expect(calls[0]!.env.IB_ALLOWED_TOOLS).toBe("ib_status");
    expect(calls[0]!.env.PI_EXT_IB_ALLOWED_TOOLS).toBeUndefined();
  });
});

describe("guard marker expands into capability scope at the spawn funnel", () => {
  it("guard: true ⇒ --no-builtin-tools + the guard extension + cwd containment", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(tmpCwd, pluginSpawnToSessionOptions({ cwd: tmpCwd, guard: true }));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toContain("--no-builtin-tools");
    expect(calls[0]!.args.join(" ")).toContain(`-e ${GUARD_EXTENSION_PATH}`);
    expect(calls[0]!.env.PI_EXT_GUARD_ALLOWED_ROOTS).toBe(JSON.stringify([path.resolve(tmpCwd)]));
  });

  it("caller-supplied roots are ADDED to the cwd, never replace it", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(
      tmpCwd,
      pluginSpawnToSessionOptions({
        cwd: tmpCwd,
        guard: true,
        // A drop/intake folder outside the session cwd — legitimate, and the
        // reason containment is not hard-wired to [cwd] alone.
        scope: { extensionConfig: { guard: { allowedRoots: ["/srv/intake"] } } },
      }),
    );

    expect(calls[0]!.env.PI_EXT_GUARD_ALLOWED_ROOTS).toBe(
      JSON.stringify([path.resolve(tmpCwd), path.resolve("/srv/intake")]),
    );
  });

  it("no guard marker ⇒ no guard flags and no guard env (unchanged)", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);

    await spawnPiSession(tmpCwd, pluginSpawnToSessionOptions({ cwd: tmpCwd }));

    expect(calls[0]!.args).not.toContain("--no-builtin-tools");
    expect(calls[0]!.env.PI_EXT_GUARD_ALLOWED_ROOTS).toBeUndefined();
  });
});
