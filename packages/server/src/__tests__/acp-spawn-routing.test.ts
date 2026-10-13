/**
 * ACP spawn routing (WS + REST share `spawnAcpSession`) and durable/non-durable
 * host selection. See change: add-acp-session-driver (test-plan #E44, #E48).
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeeperManager, KeeperSpawnResult } from "../rpc-keeper/keeper-manager.js";
import { acpAgentsForClient, setLocalAcpHost, spawnAcpSession, validateAcpAgent } from "../spawn-process/acp-spawn.js";
import { resetResolver, setKeeperManager, setResolver, spawnPiSession } from "../spawn-process/process-manager.js";

let home: string;
let origHome: string;
let cwd: string;

function writeConfig(cfg: Record<string, unknown>): void {
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(cfg));
}

class FakeKeeperChild extends EventEmitter {
  pid = 4321;
  unref = vi.fn();
  kill = vi.fn();
}

function fakeKeeper() {
  const calls: Array<{ cwd: string; env: NodeJS.ProcessEnv; piArgs?: string[]; piCmd?: string[] }> = [];
  const result: KeeperSpawnResult = { success: true, pid: 4321, sockPath: "/fake/k.sock", process: new FakeKeeperChild() as never };
  const km = {
    sessionsDir: "/fake",
    spawnKeeperFor: async (_id: string, c: string, env: NodeJS.ProcessEnv, piArgs?: string[], piCmd?: string[]) => {
      calls.push({ cwd: c, env, piArgs, piCmd });
      return result;
    },
    killKeeper: () => true,
    discoverExistingKeepers: async () => [],
    isKeeperAlive: () => false,
    sweepKeeperLogs: () => ({ scanned: 0, reclaimedFiles: 0, reclaimedBytes: 0, skippedLive: 0 }),
    getKeeperLogStats: () => ({ totalBytes: 0, fileCount: 0, largestBytes: 0, reclaimedBytes: 0, runawayFiles: 0, launchLogFiles: 0, launchLogBytes: 0 }),
  } as unknown as KeeperManager;
  return { km, calls };
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "acp-spawn-"));
  origHome = process.env.HOME as string;
  process.env.HOME = home;
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "acp-cwd-"));
  // pi is NOT resolvable: an ACP spawn must never need it.
  setResolver({ resolvePi: () => null, resolveNode: () => "/usr/bin/node", which: () => null, buildSpawnEnv: (e: NodeJS.ProcessEnv) => e } as never);
});

afterEach(() => {
  process.env.HOME = origHome;
  setKeeperManager(null);
  setLocalAcpHost(null);
  resetResolver();
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

describe("validation + projection", () => {
  it("no agents configured → error; unknown → error; known → ok", () => {
    writeConfig({});
    expect(validateAcpAgent("qmt")).toEqual({ ok: false, message: "No ACP agents are configured" });
    writeConfig({ acpAgents: [{ id: "qmt", name: "querymt", command: "q" }] });
    expect(validateAcpAgent("nope")).toMatchObject({ ok: false });
    expect(validateAcpAgent("qmt")).toMatchObject({ ok: true });
    expect(validateAcpAgent(5)).toMatchObject({ ok: false });
  });

  it("the client projection is {id,name} only — never command/args/env", () => {
    writeConfig({ acpAgents: [{ id: "qmt", name: "querymt", command: "/secret/path", args: ["--key"], env: { K: "sk-x" } }] });
    const proj = acpAgentsForClient();
    expect(proj).toEqual([{ id: "qmt", name: "querymt" }]);
    expect(JSON.stringify(proj)).not.toMatch(/secret|sk-x|--key/);
  });
});

describe("spawnAcpSession routing", () => {
  it("E44: durable agent → headless keeper, child = [node, bin/acp-bridge.mjs, --agent, id], no pi resolution", async () => {
    writeConfig({ spawnStrategy: "tmux", acpAgents: [{ id: "qmt", name: "q", command: "q", durable: true }] });
    const { km, calls } = fakeKeeper();
    setKeeperManager(km);
    const r = await spawnAcpSession(cwd, { agent: "qmt" });
    expect(r.success).toBe(true);
    expect(r.code).not.toBe("PI_NOT_FOUND");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.piCmd).toEqual([process.execPath]);
    expect(calls[0]?.piArgs?.[0]).toMatch(/bin[\\/]acp-bridge\.mjs$/);
    expect(calls[0]?.piArgs?.slice(1)).toEqual(["--agent", "qmt"]);
    expect(calls[0]?.piArgs).not.toContain("--mode");
    expect(typeof calls[0]?.env.PI_DASHBOARD_SPAWN_TOKEN).toBe("string");
    expect(r.spawnToken).toBe(calls[0]?.env.PI_DASHBOARD_SPAWN_TOKEN);
  });

  it("E48: durable absent/false → in-process (no keeper); true → keeper", async () => {
    const start = vi.fn(() => ({ success: true, message: "ok", pid: 777, process: {} as never }));
    vi.doMock("../acp-bridge/local-host.js", () => ({ startLocalAcpSession: start }));
    vi.resetModules();
    const mod = await import("../spawn-process/acp-spawn.js");
    const pm = await import("../spawn-process/process-manager.js");
    const { km, calls } = fakeKeeper();
    pm.setKeeperManager(km);
    mod.setLocalAcpHost({ attachLocalConnection: () => {}, log: () => {} });
    for (const durable of [undefined, false]) {
      writeConfig({ acpAgents: [{ id: "qmt", name: "q", command: "q", ...(durable === undefined ? {} : { durable }) }] });
      const r = await mod.spawnAcpSession(cwd, { agent: "qmt" });
      expect(r.success).toBe(true);
      expect(r.pid).toBe(777);
      expect(r.dashboardSpawned).toBe(true);
    }
    expect(calls).toHaveLength(0);
    expect(start).toHaveBeenCalledTimes(2);
    writeConfig({ acpAgents: [{ id: "qmt", name: "q", command: "q", durable: true }] });
    await mod.spawnAcpSession(cwd, { agent: "qmt" });
    expect(calls).toHaveLength(1);
    expect(start).toHaveBeenCalledTimes(2);
    pm.setKeeperManager(null);
    vi.doUnmock("../acp-bridge/local-host.js");
    vi.resetModules();
  });

  it("unknown agent / missing in-process host / missing cwd are structured failures", async () => {
    writeConfig({ acpAgents: [{ id: "qmt", name: "q", command: "q" }] });
    expect((await spawnAcpSession(cwd, { agent: "ghost" })).success).toBe(false);
    const noHost = await spawnAcpSession(cwd, { agent: "qmt" });
    expect(noHost.success).toBe(false);
    expect(noHost.message).toMatch(/in-process/i);
    expect((await spawnAcpSession("/definitely/not/here", { agent: "qmt" })).code).toBe("DIR_MISSING");
  });

  it("a spawn without `agent` (plain spawnPiSession) is untouched: pi still resolves and needs PI", async () => {
    writeConfig({ acpAgents: [{ id: "qmt", name: "q", command: "q", durable: true }] });
    const { km, calls } = fakeKeeper();
    setKeeperManager(km);
    const r = await spawnPiSession(cwd, { strategy: "headless" });
    expect(r.success).toBe(false);
    expect(r.code).toBe("PI_NOT_FOUND");
    expect(calls).toHaveLength(0);
  });
});
