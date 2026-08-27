/**
 * Funnel integration: `spawnPiSession` resolves + merges the cwd policy into
 * `options` BEFORE argv is built, for EVERY spawn (design B1). Drives the real
 * `spawnPiSession` headless path with an injected fake KeeperManager + resolver
 * (mirroring `process-manager-keeper-spawn.test.ts`) and a test-injected
 * `CwdPolicyRegistry`, then inspects the `piArgs` handed to the keeper.
 *
 * Covers CE12 (policy → argv), CE13 (no policy ⇒ byte-identical), CE14 (policy
 * tools allowlist reaches argv).
 *
 * See change: add-plugin-spawn-scope (Part B).
 */
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import type { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KeeperManager, KeeperSpawnResult } from "../rpc-keeper/keeper-manager.js";
import { CwdPolicyRegistry } from "../spawn-process/cwd-policy.js";
import {
  resetResolver,
  setCwdPolicyRegistry,
  setKeeperManager,
  setResolver,
  spawnPiSession,
} from "../spawn-process/process-manager.js";

function makeFakeResolver(piCmd: string[] | null = ["/usr/bin/pi"]): ToolResolver {
  return {
    resolvePi: () => piCmd,
    resolveNode: () => "/usr/bin/node",
    which: () => null,
    buildSpawnEnv: (env: NodeJS.ProcessEnv) => env,
  } as unknown as ToolResolver;
}

interface SpawnCall {
  piArgs?: string[];
}

function makeFakeKeeperManager(): { km: KeeperManager; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnResult: KeeperSpawnResult = {
    success: false,
    error: "test: capture-only (no real process)",
  };
  const km: KeeperManager = {
    sessionsDir: "/fake/sessions",
    spawnKeeperFor: async (_sessionId, _cwd, _env, piArgs) => {
      calls.push({ piArgs });
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
  tmpCwd = mkdtempSync(path.join("/tmp", "cwd-funnel-"));
  setResolver(makeFakeResolver());
});
afterEach(() => {
  setKeeperManager(null);
  setCwdPolicyRegistry(null);
  resetResolver();
  rmSync(tmpCwd, { recursive: true, force: true });
});

describe("spawnPiSession — cwd policy funnel", () => {
  it("CE12: a registered { noTools:true } policy reaches the assembled argv", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);
    const reg = new CwdPolicyRegistry({ recognizedRoots: () => [tmpCwd], caseInsensitive: false });
    reg.register("p1", tmpCwd, { noTools: true });
    setCwdPolicyRegistry(reg);

    await spawnPiSession(tmpCwd, { strategy: "headless" });

    expect(calls).toHaveLength(1);
    expect(calls[0].piArgs).toContain("--no-tools");
  });

  it("CE14: a policy tools allowlist reaches argv as --tools read,grep", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);
    const reg = new CwdPolicyRegistry({ recognizedRoots: () => [tmpCwd], caseInsensitive: false });
    reg.register("p1", tmpCwd, { tools: ["read", "grep"] });
    setCwdPolicyRegistry(reg);

    await spawnPiSession(tmpCwd, { strategy: "headless" });

    const piArgs = calls[0].piArgs ?? [];
    expect(piArgs).toContain("--tools");
    expect(piArgs[piArgs.indexOf("--tools") + 1]).toBe("read,grep");
  });

  it("CE15b: caller allowlist ∩ policy allowlist tightens through the funnel", async () => {
    const { km, calls } = makeFakeKeeperManager();
    setKeeperManager(km);
    const reg = new CwdPolicyRegistry({ recognizedRoots: () => [tmpCwd], caseInsensitive: false });
    reg.register("p1", tmpCwd, { tools: ["read", "grep"] });
    setCwdPolicyRegistry(reg);

    await spawnPiSession(tmpCwd, { strategy: "headless", tools: ["read", "grep", "write"] });

    const piArgs = calls[0].piArgs ?? [];
    expect(piArgs[piArgs.indexOf("--tools") + 1]).toBe("read,grep");
  });

  it("CE13: no matching policy ⇒ argv byte-identical to the no-registry path", async () => {
    // Baseline: no registry wired.
    const base = makeFakeKeeperManager();
    setKeeperManager(base.km);
    setCwdPolicyRegistry(null);
    await spawnPiSession(tmpCwd, { strategy: "headless" });

    // With a registry that has NO entry matching this cwd.
    const withReg = makeFakeKeeperManager();
    setKeeperManager(withReg.km);
    const reg = new CwdPolicyRegistry({ recognizedRoots: () => ["/some/other/root"], caseInsensitive: false });
    setCwdPolicyRegistry(reg);
    await spawnPiSession(tmpCwd, { strategy: "headless" });

    expect(withReg.calls[0].piArgs).toEqual(base.calls[0].piArgs);
  });
});
