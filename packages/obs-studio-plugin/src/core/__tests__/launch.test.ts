/**
 * E8 strike decision table (injected clock, real temp fs) and E9 process races
 * + quarantine retention + darwin argv. Triggered through `pi-obs launch`.
 * See change: add-obs-studio-plugin (test-plan E8, E9).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { launchArgv } from "../detect.js";
import { launchStateFile, quarantineDir } from "../launch.js";
import { baseDeps, runCli, tmpHome } from "./cli-harness.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

interface Fixture {
  state?: unknown;
  /** sentinel name → age in ms */
  sentinels?: Record<string, number>;
  log?: { text: string; mtime: number };
  running?: boolean[];
}

function setup(fx: Fixture) {
  const home = tmpHome();
  const config = path.join(home, "Library", "Application Support", "obs-studio");
  const state = path.join(home, ".pi", "dashboard", "plugins", "obs-studio");
  fs.mkdirSync(path.join(config, ".sentinel"), { recursive: true });
  fs.mkdirSync(path.join(config, "logs"), { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  if (fx.state !== undefined) fs.writeFileSync(launchStateFile(state), typeof fx.state === "string" ? fx.state : JSON.stringify(fx.state));
  for (const [n, age] of Object.entries(fx.sentinels ?? {})) {
    const p = path.join(config, ".sentinel", n);
    fs.writeFileSync(p, "");
    fs.utimesSync(p, (NOW - age) / 1000, (NOW - age) / 1000);
  }
  if (fx.log) {
    const p = path.join(config, "logs", "2026-10-15 18-00-00.txt");
    fs.writeFileSync(p, fx.log.text);
    fs.utimesSync(p, fx.log.mtime / 1000, fx.log.mtime / 1000);
  }
  const running = [...(fx.running ?? [])];
  const spawns: string[][] = [];
  const events: string[] = [];
  const deps = baseDeps(home, {
    now: () => NOW,
    exists: (p) => p === "/Applications/OBS.app" || fs.existsSync(p),
    run: async () => ({ code: 1, stdout: "" }),
    findObs: async () => ((running.length ? running.shift() : false) ? [4242] : []),
    spawnDetached: async (argv) => {
      events.push(`spawn; state=${fs.readFileSync(launchStateFile(state), "utf8").replace(/\s+/g, "")}`);
      spawns.push(argv);
    },
  });
  const readState = () => JSON.parse(fs.readFileSync(launchStateFile(state), "utf8"));
  const sentinelsLeft = () => fs.readdirSync(path.join(config, ".sentinel"));
  const quarantined = () => {
    const q = quarantineDir(state);
    return fs.existsSync(q) ? fs.readdirSync(q).flatMap((b) => fs.readdirSync(path.join(q, b))) : [];
  };
  return { run: (extra: string[] = []) => runCli(["launch", "--json", ...extra], deps), readState, sentinelsLeft, quarantined, spawns, events, state };
}

const launched = NOW - 30 * MIN;

describe("E8 strike decision table", () => {
  it("no leftover → strikes reset", async () => {
    const s = setup({ state: { strikes: 1, suspended: false, lastLaunchAt: launched } });
    expect((await s.run()).code).toBe(0);
    expect(s.readState()).toMatchObject({ strikes: 0, suspended: false, lastLaunchAt: NOW });
    expect(s.spawns).toHaveLength(1);
  });

  it("leftover + teardown log (plugin unloaded) → reset, sentinel quarantined", async () => {
    const s = setup({ state: { strikes: 1, suspended: false, lastLaunchAt: launched }, sentinels: { run_a: 5 * MIN }, log: { text: "[obs-backgroundremoval] plugin unloaded\n", mtime: launched + MIN } });
    expect((await s.run()).json()).toMatchObject({ verdict: "teardown-crash", quarantined: 1 });
    expect(s.readState().strikes).toBe(0);
    expect(s.quarantined()).toEqual(["run_a"]);
  });

  it("no unload lines, mtime − launch = 9 m 59 s → strike + 1", async () => {
    const s = setup({ state: { strikes: 0, suspended: false, lastLaunchAt: launched }, sentinels: { run_a: 5 * MIN }, log: { text: "running\n", mtime: launched + 10 * MIN - 1000 } });
    expect((await s.run()).json()).toMatchObject({ verdict: "early-crash" });
    expect(s.readState().strikes).toBe(1);
  });

  it("no unload lines, mtime − launch = 10 m 01 s → reset", async () => {
    const s = setup({ state: { strikes: 1, suspended: false, lastLaunchAt: launched }, sentinels: { run_a: 5 * MIN }, log: { text: "running\n", mtime: launched + 10 * MIN + 1000 } });
    expect((await s.run()).json()).toMatchObject({ verdict: "late-crash" });
    expect(s.readState().strikes).toBe(0);
  });

  it("sentinel age 59 s → ignored, strikes unchanged, not moved", async () => {
    const s = setup({ state: { strikes: 1, suspended: false, lastLaunchAt: launched }, sentinels: { run_young: 59_000 } });
    expect((await s.run()).json()).toMatchObject({ verdict: "young-only", quarantined: 0 });
    expect(s.readState().strikes).toBe(1);
    expect(s.sentinelsLeft()).toEqual(["run_young"]);
  });

  it("sentinel age 61 s → considered", async () => {
    const s = setup({ state: { strikes: 0, suspended: false, lastLaunchAt: launched }, sentinels: { run_old: 61_000 } });
    expect((await s.run()).json()).toMatchObject({ quarantined: 1 });
    expect(s.sentinelsLeft()).toEqual([]);
  });

  it("strikes 1 + early crash → suspended:true written BEFORE spawn, 0 moves", async () => {
    const s = setup({ state: { strikes: 1, suspended: false, lastLaunchAt: launched }, sentinels: { run_a: 5 * MIN }, log: { text: "x\n", mtime: launched + MIN } });
    expect((await s.run()).json()).toMatchObject({ recoverySuspended: true, quarantined: 0 });
    expect(s.events[0]).toMatch(/"suspended":true/);
    expect(s.sentinelsLeft()).toEqual(["run_a"]);
    expect(s.spawns).toHaveLength(1);
  });

  it("early crashes detected however late the relaunch (crash 1 min after launch, relaunch 30 min later)", async () => {
    const s = setup({ state: { strikes: 1, suspended: false, lastLaunchAt: NOW - 31 * MIN }, sentinels: { run_a: 30 * MIN }, log: { text: "x\n", mtime: NOW - 30 * MIN } });
    expect((await s.run()).json()).toMatchObject({ recoverySuspended: true });
  });

  it("suspended:true + no leftover → stays suspended", async () => {
    const s = setup({ state: { strikes: 2, suspended: true, lastLaunchAt: launched } });
    expect((await s.run()).json()).toMatchObject({ recoverySuspended: true });
    expect(s.readState().suspended).toBe(true);
  });

  it("corrupt JSON → rewritten suspended:true, 0 moves", async () => {
    const s = setup({ state: "{not json", sentinels: { run_a: 5 * MIN } });
    expect((await s.run()).json()).toMatchObject({ recoverySuspended: true, corruptState: true, quarantined: 0 });
    expect(s.readState().suspended).toBe(true);
    expect(s.sentinelsLeft()).toEqual(["run_a"]);
  });

  it("--reset-recovery clears suspended", async () => {
    const s = setup({ state: { strikes: 2, suspended: true, lastLaunchAt: launched }, sentinels: { run_a: 5 * MIN } });
    expect((await s.run(["--reset-recovery"])).json()).toMatchObject({ recoverySuspended: false, quarantined: 1 });
    expect(s.readState()).toMatchObject({ strikes: 0, suspended: false });
  });

  it("three teardown crashes in a row never suspend", async () => {
    const s = setup({ state: { strikes: 0, suspended: false, lastLaunchAt: launched } });
    for (let i = 0; i < 3; i++) {
      const cfg = path.join(s.state, "..", "..", "..", "..", "Library", "Application Support", "obs-studio");
      fs.writeFileSync(path.join(cfg, ".sentinel", `run_${i}`), "");
      fs.utimesSync(path.join(cfg, ".sentinel", `run_${i}`), (NOW - 5 * MIN) / 1000, (NOW - 5 * MIN) / 1000);
      fs.writeFileSync(path.join(cfg, "logs", "2026-10-15 18-00-00.txt"), "[obs-websocket] [obs_module_unload] Shutting down...\n");
      expect((await s.run()).json()).toMatchObject({ recoverySuspended: false });
    }
    expect(s.readState().strikes).toBe(0);
  });
});

describe("E9 process races + retention", () => {
  it("OBS running at start → 0 moves, 0 spawns", async () => {
    const s = setup({ sentinels: { run_a: 5 * MIN }, running: [true] });
    expect((await s.run()).json()).toMatchObject({ action: "already-running" });
    expect(s.spawns).toHaveLength(0);
    expect(s.sentinelsLeft()).toEqual(["run_a"]);
  });

  it("OBS appears after the move → 0 spawns, files stay quarantined", async () => {
    const s = setup({ sentinels: { run_a: 5 * MIN }, running: [false, true] });
    expect((await s.run()).json()).toMatchObject({ action: "appeared", quarantined: 1 });
    expect(s.spawns).toHaveLength(0);
    expect(s.quarantined()).toEqual(["run_a"]);
    expect(s.sentinelsLeft()).toEqual([]);
  });

  it("11 batches → the oldest is deleted, 10 remain", async () => {
    const s = setup({ sentinels: { run_a: 5 * MIN } });
    for (let i = 0; i < 10; i++) fs.mkdirSync(path.join(quarantineDir(s.state), String(NOW - (i + 1) * 1000)), { recursive: true });
    await s.run();
    const batches = fs.readdirSync(quarantineDir(s.state)).sort();
    expect(batches).toHaveLength(10);
    expect(batches).not.toContain(String(NOW - 10_000));
    expect(batches).toContain(String(NOW));
  });

  it("darwin argv = open -a <app> --args --minimize-to-tray --disable-updater", async () => {
    const s = setup({});
    await s.run();
    expect(s.spawns[0]).toEqual(["open", "-a", "/Applications/OBS.app", "--args", "--minimize-to-tray", "--disable-updater"]);
    expect(launchArgv({ found: true, executable: "/Applications/OBS.app", warnings: [] }, "darwin").argv).toEqual(s.spawns[0]);
  });
});
