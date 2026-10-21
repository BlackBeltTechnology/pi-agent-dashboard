/**
 * Package-operation completion → plugin discovery. test-plan #E56 (decision table success × scope ×
 * manifest), #E57 (1/2/3 requests during a run coalesce into one follow-up), #E68 (a terminal
 * `pi install` is invisible until a restart). The listener is the real
 * `createPackageCompletionHandler` over the real discovery wiring; only broadcasts and probes are spies.
 *
 * Roots live under `node_modules` so vite-node externalises the server entries and the real
 * file-URL import runs.
 *
 * See change: decouple-plugins-from-core (tasks 5.7, 5.14; tests 8.73, 8.74, 8.87).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  clearDiscoveryCache,
  clearLoadedSnapshots,
  clearStatusStore,
  getPluginStatusStore,
  loadServerEntries,
  setDeclaredBundledPluginIds,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPackageCompletionHandler, createPluginDiscoveryWiring, type PluginDiscoveryWiring } from "../plugin-discovery-wiring.js";

type G = { __pkgSpy?: string[]; __pkgGate?: Promise<void> };
const g = globalThis as G;

interface Completion {
  success: boolean;
  scope: string;
  action?: string;
}

let tmp: string;
let root: string;
let agentDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pkg-op-discovery-"));
  root = path.join(tmp, "node_modules", "root");
  agentDir = path.join(tmp, "agent");
  fs.mkdirSync(path.join(root, "packages"), { recursive: true });
  fs.mkdirSync(agentDir, { recursive: true });
  clearDiscoveryCache();
  clearStatusStore();
  clearLoadedSnapshots();
  setDeclaredBundledPluginIds(undefined);
  g.__pkgSpy = [];
  delete g.__pkgGate;
  for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
  clearDiscoveryCache();
  clearStatusStore();
  clearLoadedSnapshots();
});

/** A workspace plugin with a recording (optionally gated) server entry. */
function writeWorkspacePlugin(id: string, gated = false) {
  const dir = path.join(root, "packages", `${id}-plugin`);
  fs.mkdirSync(dir, { recursive: true });
  const body = `(globalThis.__pkgSpy ||= []).push(${JSON.stringify(id)});${gated ? " await globalThis.__pkgGate;" : ""}`;
  fs.writeFileSync(path.join(dir, "server.mjs"), `export default async () => { ${body} };\n`);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: `${id}-plugin`, version: "1.0.0", "pi-dashboard-plugin": { id, displayName: id, claims: [], server: "./server.mjs" } }),
  );
}

function localPlugin(cwd: string, id: string): void {
  const dir = path.join(cwd, ".pi", "npm", "node_modules", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: id, "pi-dashboard-plugin": { id, displayName: id, claims: [] } }));
  fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [`npm:${id}`] }));
}

function harness(cwds: string[] = []) {
  const events: string[] = [];
  const snapshots: PluginStatus[][] = [];
  const readDeclaredBundledIds = vi.fn(() => undefined as readonly string[] | undefined);
  const wiring: PluginDiscoveryWiring = createPluginDiscoveryWiring({
    loadDeps: {
      createContext: () => ({}) as never,
      isEnabled: () => true,
      repoRoot: root,
      discovery: { piPackages: { agentDir, npmRoot: path.join(tmp, "no-global") } },
    },
    readDeclaredBundledIds,
    listActiveCwds: () => cwds,
    broadcastPluginsChanged: (p) => {
      events.push("plugins_changed");
      snapshots.push(p);
    },
  });
  const refreshProbes = vi.fn(async () => {});
  const listener = createPackageCompletionHandler<Completion>({
    broadcastComplete: () => events.push("package_operation_complete"),
    invalidateRecommendedCache: () => {},
    discovery: () => wiring,
    refreshProbes,
  });
  return { wiring, listener, events, snapshots, readDeclaredBundledIds, refreshProbes };
}
const settle = () => new Promise((r) => setTimeout(r, 50));
const count = (events: string[], name: string) => events.filter((e) => e === name).length;

describe("completion listener (E56)", () => {
  it("(a) success/global/manifest: 1 refresh, plugin visible, ONE plugins_changed AFTER package_operation_complete", async () => {
    const h = harness();
    writeWorkspacePlugin("fresh");
    h.listener({ success: true, scope: "global" });
    await vi.waitFor(() => expect(count(h.events, "plugins_changed")).toBe(1));
    expect(h.events).toEqual(["package_operation_complete", "plugins_changed"]);
    expect(h.readDeclaredBundledIds).toHaveBeenCalledTimes(1);
    expect(getPluginStatusStore().getStatus("fresh")).toMatchObject({ loaded: true });
    expect(h.snapshots[0].some((s) => s.id === "fresh")).toBe(true);
    expect(h.refreshProbes).toHaveBeenCalledTimes(1);
  });

  it("(b) success:false: 0 refresh, 0 plugins_changed, only the completion broadcast", async () => {
    const h = harness();
    h.listener({ success: false, scope: "global" });
    await settle();
    expect(h.events).toEqual(["package_operation_complete"]);
    expect(h.readDeclaredBundledIds).not.toHaveBeenCalled();
    expect(h.refreshProbes).not.toHaveBeenCalled();
  });

  it("(c) success/local in an active cwd: no discovery refresh, local row, ONE plugins_changed, probes still refreshed, nothing loaded", async () => {
    const cwd = path.join(tmp, "proj", "A");
    const h = harness([cwd]);
    localPlugin(cwd, "quota");
    h.listener({ success: true, scope: "local" });
    await vi.waitFor(() => expect(count(h.events, "plugins_changed")).toBe(1));
    await settle();
    expect(h.events).toEqual(["package_operation_complete", "plugins_changed"]);
    expect(h.readDeclaredBundledIds).not.toHaveBeenCalled();
    expect(h.snapshots[0].find((s) => s.id === "quota")).toMatchObject({ source: "local-detected", loaded: false, enabled: false });
    expect(g.__pkgSpy).toEqual([]);
    expect(h.refreshProbes).toHaveBeenCalledTimes(1);
  });

  it("(c') a local op that changes nothing still broadcasts exactly one plugins_changed", async () => {
    const h = harness([path.join(tmp, "proj", "empty")]);
    h.listener({ success: true, scope: "local" });
    await vi.waitFor(() => expect(count(h.events, "plugins_changed")).toBe(1));
    await settle();
    expect(count(h.events, "plugins_changed")).toBe(1);
  });

  it("(d) success/global/no manifest: refresh runs, snapshot equal, ONE broadcast", async () => {
    const h = harness();
    await loadServerEntries({ createContext: () => ({}) as never, isEnabled: () => true, repoRoot: root, discovery: { piPackages: false } });
    const before = JSON.stringify(getPluginStatusStore().listAll());
    h.listener({ success: true, scope: "global" });
    await vi.waitFor(() => expect(count(h.events, "plugins_changed")).toBe(1));
    expect(h.readDeclaredBundledIds).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.snapshots[0])).toBe(before);
  });

  it("a move (touches both scopes) takes the discovery-refresh path even when the destination is local", async () => {
    const h = harness();
    h.listener({ success: true, scope: "local", action: "move" });
    await vi.waitFor(() => expect(count(h.events, "plugins_changed")).toBe(1));
    expect(h.readDeclaredBundledIds).toHaveBeenCalledTimes(1);
  });
});

describe("two completions in quick succession (E57)", () => {
  it.each([1, 2, 3])("%i extra completion(s) during a running refresh produce exactly ONE follow-up", async (extra) => {
    let release!: () => void;
    g.__pkgGate = new Promise<void>((r) => {
      release = r;
    });
    const h = harness();
    writeWorkspacePlugin("slow", true);
    h.listener({ success: true, scope: "global" });
    await vi.waitFor(() => expect(g.__pkgSpy).toContain("slow"));
    for (let i = 0; i < extra; i++) h.listener({ success: true, scope: "global" });
    release();
    await vi.waitFor(() => expect(count(h.events, "plugins_changed")).toBe(2));
    await settle();
    expect(count(h.events, "plugins_changed")).toBe(2);
    expect(h.readDeclaredBundledIds).toHaveBeenCalledTimes(2);
  });
});

describe("installs outside the dashboard appear after a restart (E68)", () => {
  it("terminal `pi install`: no refresh / broadcast / row until a fresh discovery", async () => {
    const h = harness();
    await loadServerEntries({ createContext: () => ({}) as never, isEnabled: () => true, repoRoot: root, discovery: { piPackages: { agentDir, npmRoot: path.join(tmp, "no-global") } } });
    // `pi install` edits settings.json + the npm dir directly: no completion event reaches the listener.
    const pkgDir = path.join(agentDir, "npm", "node_modules", "pi-dashboard-quota");
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(
      path.join(pkgDir, "package.json"),
      JSON.stringify({ name: "pi-dashboard-quota", version: "1.0.0", "pi-dashboard-plugin": { id: "quota", displayName: "quota", claims: [], hostApi: "^1.0.0" } }),
    );
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages: ["npm:pi-dashboard-quota"] }));
    await settle();
    expect(h.readDeclaredBundledIds).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
    expect(getPluginStatusStore().getStatus("quota")).toBeUndefined();

    // Restart = a fresh process: empty store + fresh discovery.
    clearStatusStore();
    clearLoadedSnapshots();
    clearDiscoveryCache();
    await loadServerEntries({ createContext: () => ({}) as never, isEnabled: () => true, repoRoot: root, discovery: { piPackages: { agentDir, npmRoot: path.join(tmp, "no-global") } } });
    expect(getPluginStatusStore().getStatus("quota")).toMatchObject({ source: "pi-package" });
  });
});
