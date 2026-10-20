/**
 * `refreshPluginDiscovery` + local-scope detection (Phase 4A).
 * test-plan #E58 (restart required), #X7 (failing entry visible), #E59/#E60 (local detection),
 * coalescing (#E57 mechanism). Roots live under `node_modules` so vite-node externalises the
 * server entries and the real file-URL import runs.
 *
 * See change: decouple-plugins-from-core (tasks 5.5, 5.6, 5.9).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoveryCache,
  clearLoadedSnapshots,
  clearStatusStore,
  getPluginStatusStore,
  loadServerEntries,
  setDeclaredBundledPluginIds,
} from "../server/loader.js";
import { createLocalScopeDetector, LOCAL_SCOPE_ERROR } from "../server/local-scope-detector.js";
import { createPluginRefresher } from "../server/plugin-refresh.js";
import type { ServerPluginContext } from "../server/server-context.js";

type G = { __refreshSpy?: string[]; __refreshGate?: Promise<void> };
const g = globalThis as G;

let tmp: string;
let root: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-refresh-"));
  root = path.join(tmp, "node_modules", "root");
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  clearDiscoveryCache();
  clearStatusStore();
  clearLoadedSnapshots();
  setDeclaredBundledPluginIds(undefined);
  g.__refreshSpy = [];
  delete g.__refreshGate;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
  clearDiscoveryCache();
  clearStatusStore();
  clearLoadedSnapshots();
});

function ctx(): ServerPluginContext {
  return {} as ServerPluginContext;
}

/** `kind`: ok = records + returns; throw = throws boom; gate = awaits g.__refreshGate. */
function writePlugin(id: string, opts: { kind?: "ok" | "throw" | "gate"; version?: string } = {}) {
  const dir = path.join(root, "packages", `${id}-plugin`);
  fs.mkdirSync(dir, { recursive: true });
  const body =
    opts.kind === "throw"
      ? `throw new Error("boom");`
      : opts.kind === "gate"
        ? `(globalThis.__refreshSpy ||= []).push(${JSON.stringify(id)}); await globalThis.__refreshGate;`
        : `(globalThis.__refreshSpy ||= []).push(${JSON.stringify(id)});`;
  fs.writeFileSync(path.join(dir, "server.mjs"), `export default async () => { ${body} };\n`);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: `${id}-plugin`,
      version: opts.version ?? "1.0.0",
      "pi-dashboard-plugin": { id, displayName: id, claims: [], server: "./server.mjs" },
    }),
  );
  return dir;
}

function setup(isEnabled: (id: string) => boolean = () => true) {
  const broadcasts: PluginStatus[][] = [];
  const loadDeps = { createContext: ctx, isEnabled, repoRoot: root, discovery: { piPackages: false as const } };
  const refresher = createPluginRefresher({ loadDeps, broadcast: (p) => broadcasts.push(p) });
  return { loadDeps, refresher, broadcasts };
}
const row = (id: string) => getPluginStatusStore().getStatus(id);

describe("refreshPluginDiscovery — additive load, restart required (E58)", () => {
  it("(c) a first install loads, sets no restartRequired, and does not re-run loaded entries", async () => {
    writePlugin("a");
    const { loadDeps, refresher, broadcasts } = setup();
    await loadServerEntries(loadDeps);
    writePlugin("b");
    await refresher.refreshPluginDiscovery();
    expect(g.__refreshSpy).toEqual(["a", "b"]);
    expect(row("b")).toMatchObject({ loaded: true });
    expect(row("b")?.restartRequired).toBeUndefined();
    expect(row("a")?.restartRequired).toBeUndefined();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].map((s) => s.id).sort()).toEqual(["a", "b"]);
  });

  it("(a) a loaded plugin whose package changed gets restartRequired and is not reloaded", async () => {
    const dir = writePlugin("a");
    const { loadDeps, refresher } = setup();
    await loadServerEntries(loadDeps);
    writePlugin("a", { version: "2.0.0" });
    expect(dir).toBeTruthy();
    await refresher.refreshPluginDiscovery();
    expect(row("a")).toMatchObject({ loaded: true, restartRequired: true });
    expect(g.__refreshSpy).toEqual(["a"]);
  });

  it("(b) a loaded plugin that vanished keeps its row with restartRequired", async () => {
    const dir = writePlugin("a");
    const { loadDeps, refresher } = setup();
    await loadServerEntries(loadDeps);
    fs.rmSync(dir, { recursive: true });
    await refresher.refreshPluginDiscovery();
    expect(row("a")).toMatchObject({ loaded: true, restartRequired: true });
  });

  it("(d) a never-loaded (disabled) plugin that vanished drops its row", async () => {
    const dir = writePlugin("d");
    writePlugin("keep");
    const { loadDeps, refresher } = setup((id) => id !== "d");
    await loadServerEntries(loadDeps);
    expect(row("d")).toMatchObject({ enabled: false, loaded: false });
    fs.rmSync(dir, { recursive: true });
    await refresher.refreshPluginDiscovery();
    expect(row("d")).toBeUndefined();
    expect(row("keep")?.loaded).toBe(true);
  });

  it("a disabled-at-boot plugin that is later enabled is NOT loaded by refresh (restart needed, D14)", async () => {
    writePlugin("late");
    let enabled = false;
    const { loadDeps, refresher } = setup(() => enabled);
    await loadServerEntries(loadDeps);
    enabled = true;
    await refresher.refreshPluginDiscovery();
    expect(g.__refreshSpy).toEqual([]);
    expect(row("late")).toMatchObject({ enabled: false, loaded: false });
  });
});

describe("refreshPluginDiscovery — failures and coalescing", () => {
  it("X7: a throwing server entry is recorded loaded:false with its error; the other loads; one broadcast", async () => {
    const { loadDeps, refresher, broadcasts } = setup();
    await loadServerEntries(loadDeps);
    writePlugin("bad", { kind: "throw" });
    writePlugin("good");
    await refresher.refreshPluginDiscovery();
    expect(row("bad")).toMatchObject({ loaded: false });
    expect(row("bad")?.error).toContain("boom");
    expect(row("good")).toMatchObject({ loaded: true });
    expect(broadcasts).toHaveLength(1);
  });

  it.each([1, 2, 3])("E57: %i extra request(s) while a run is in flight coalesce into exactly one follow-up", async (extra) => {
    let release!: () => void;
    g.__refreshGate = new Promise<void>((r) => {
      release = r;
    });
    const { refresher, broadcasts } = setup();
    writePlugin("slow", { kind: "gate" });
    const first = refresher.refreshPluginDiscovery();
    await vi.waitFor(() => expect(g.__refreshSpy).toContain("slow"));
    const followers = Array.from({ length: extra }, () => refresher.refreshPluginDiscovery());
    release();
    await Promise.all([first, ...followers]);
    expect(broadcasts).toHaveLength(2);
  });

  it("re-reads the declaration and clears the content-hash cache on every run", async () => {
    const readDeclaredBundledIds = vi.fn(() => ["a"] as readonly string[] | undefined);
    const clearContentHashCache = vi.fn();
    const refresher = createPluginRefresher({
      loadDeps: { createContext: ctx, isEnabled: () => true, repoRoot: root, discovery: { piPackages: false } },
      readDeclaredBundledIds,
      clearContentHashCache,
      broadcast: () => {},
    });
    await refresher.refreshPluginDiscovery();
    await refresher.refreshPluginDiscovery();
    expect(readDeclaredBundledIds).toHaveBeenCalledTimes(2);
    expect(clearContentHashCache).toHaveBeenCalledTimes(2);
  });
});

describe("local-scope detection (E59, E60)", () => {
  function localPkg(cwd: string, name: string, id: string) {
    const dir = path.join(cwd, ".pi", "npm", "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, "pi-dashboard-plugin": { id, displayName: id, claims: [], server: "./server.mjs" } }),
    );
    fs.writeFileSync(path.join(dir, "server.mjs"), `(globalThis.__refreshSpy ||= []).push("LOCAL-" + ${JSON.stringify(id)});\nexport default () => {};\n`);
    const settings = path.join(cwd, ".pi", "settings.json");
    const prev = fs.existsSync(settings) ? (JSON.parse(fs.readFileSync(settings, "utf8")).packages as string[]) : [];
    fs.writeFileSync(settings, JSON.stringify({ packages: [...prev, `npm:${name}`] }));
    return dir;
  }

  it("E59(a): a manifest-bearing local package is reported local-detected, never loaded", () => {
    const cwd = path.join(tmp, "proj", "A");
    const dir = localPkg(cwd, "quota", "quota");
    const detector = createLocalScopeDetector({ listCwds: () => [cwd] });
    expect(detector.rerun()).toBe(true);
    expect(row("quota")).toEqual({
      id: "quota",
      displayName: "quota",
      enabled: false,
      loaded: false,
      error: LOCAL_SCOPE_ERROR,
      claims: 0,
      source: "local-detected",
    });
    expect(LOCAL_SCOPE_ERROR).toBe(
      "Local-scope plugins are not loaded in this release. Install globally with --scope global to enable.",
    );
    expect(g.__refreshSpy).toEqual([]);
    expect(dir).toContain("quota");
  });

  it("E59(b): the same id also global and loaded → one row, local copy folded into shadowed", async () => {
    const cwd = path.join(tmp, "proj", "A");
    const dir = localPkg(cwd, "quota", "quota");
    writePlugin("quota");
    const { loadDeps } = setup();
    await loadServerEntries(loadDeps);
    createLocalScopeDetector({ listCwds: () => [cwd] }).rerun();
    expect(getPluginStatusStore().listAll().filter((s) => s.id === "quota")).toHaveLength(1);
    expect(row("quota")).toMatchObject({ loaded: true, source: "workspace", shadowed: [{ source: "local-detected", packageDir: dir }] });
    expect(g.__refreshSpy).toEqual(["quota"]);
  });

  it("a package without a manifest is ignored", () => {
    const cwd = path.join(tmp, "proj", "A");
    const dir = path.join(cwd, ".pi", "npm", "node_modules", "plain");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "plain" }));
    fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: ["npm:plain"] }));
    const detector = createLocalScopeDetector({ listCwds: () => [cwd] });
    expect(detector.rerun()).toBe(false);
    expect(getPluginStatusStore().listAll()).toEqual([]);
  });

  it("E60(a): session end prunes the row and reports a change exactly once", () => {
    const cwd = path.join(tmp, "proj", "A");
    localPkg(cwd, "quota", "quota");
    const cwds = [cwd];
    const detector = createLocalScopeDetector({ listCwds: () => cwds });
    expect(detector.rerun()).toBe(true);
    cwds.length = 0;
    expect(detector.rerun()).toBe(true);
    expect(row("quota")).toBeUndefined();
    expect(detector.rerun()).toBe(false);
  });

  it("E60(b): two sessions share the cwd; one ends → row kept, no change reported", () => {
    const cwd = path.join(tmp, "proj", "A");
    localPkg(cwd, "quota", "quota");
    const cwds = [cwd, cwd];
    const detector = createLocalScopeDetector({ listCwds: () => cwds });
    detector.rerun();
    cwds.pop();
    expect(detector.rerun()).toBe(false);
    expect(row("quota")?.source).toBe("local-detected");
  });

  it("refresh reapplies local detection after the load pass rewrote rows (shadowed survives)", async () => {
    const cwd = path.join(tmp, "proj", "A");
    const dir = localPkg(cwd, "quota", "quota");
    writePlugin("quota");
    const broadcasts: PluginStatus[][] = [];
    const loadDeps = { createContext: ctx, isEnabled: () => true, repoRoot: root, discovery: { piPackages: false as const } };
    const detector = createLocalScopeDetector({ listCwds: () => [cwd] });
    const refresher = createPluginRefresher({ loadDeps, localDetector: detector, broadcast: (p) => broadcasts.push(p) });
    await refresher.refreshPluginDiscovery();
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].find((s) => s.id === "quota")).toMatchObject({ loaded: true, shadowed: [{ source: "local-detected", packageDir: dir }] });
    await refresher.refreshPluginDiscovery();
    expect(row("quota")?.shadowed).toEqual([{ source: "local-detected", packageDir: dir }]);
  });
});
