/**
 * Server wiring of post-boot plugin discovery: local-scope detection reruns (session end /
 * registration / local package op) and the default-deny server-trust seam.
 * test-plan #E59 #E60 #E61 (default-deny half; the grant endpoint is task 6.12).
 *
 * See change: decouple-plugins-from-core (tasks 5.2, 5.5, 5.9).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearDiscoveryCache, clearStatusStore, getPluginStatusStore } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { PluginStatus } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/plugin-status.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPluginServerTrusted, isServerTrusted, readServerTrustEntries } from "../auth/plugin-server-trust.js";
import { createPluginDiscoveryWiring } from "../plugin-discovery-wiring.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-wiring-"));
  clearDiscoveryCache();
  clearStatusStore();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
  clearStatusStore();
});

function localPlugin(cwd: string, id: string): void {
  const dir = path.join(cwd, ".pi", "npm", "node_modules", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: id, "pi-dashboard-plugin": { id, displayName: id, claims: [] } }));
  fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ packages: [`npm:${id}`] }));
}

function wiring(cwds: string[]) {
  const broadcasts: PluginStatus[][] = [];
  const w = createPluginDiscoveryWiring({
    loadDeps: {
      createContext: () => ({}) as never,
      isEnabled: () => true,
      repoRoot: path.join(tmp, "root"),
      discovery: { piPackages: false },
    },
    readDeclaredBundledIds: () => undefined,
    listActiveCwds: () => cwds,
    broadcastPluginsChanged: (p) => broadcasts.push(p),
  });
  return { w, broadcasts };
}
const localRows = () => getPluginStatusStore().listAll().filter((s) => s.source === "local-detected");

describe("local-scope detection reruns (E59, E60)", () => {
  it("E60(a): session end prunes the row and broadcasts exactly one plugins_changed without it", () => {
    const cwd = path.join(tmp, "proj", "A");
    localPlugin(cwd, "quota");
    const cwds = [cwd];
    const { w, broadcasts } = wiring(cwds);
    w.onSessionRegistered(cwd);
    expect(localRows().map((r) => r.id)).toEqual(["quota"]);
    expect(broadcasts).toHaveLength(1);
    cwds.length = 0; // the session ended
    w.onSessionEnded();
    expect(localRows()).toEqual([]);
    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[1].some((s) => s.id === "quota")).toBe(false);
  });

  it("E60(b): two sessions share the cwd; one ends → row kept, no extra broadcast", () => {
    const cwd = path.join(tmp, "proj", "A");
    localPlugin(cwd, "quota");
    const cwds = [cwd, cwd];
    const { w, broadcasts } = wiring(cwds);
    w.onSessionRegistered(cwd);
    expect(broadcasts).toHaveLength(1);
    cwds.pop();
    w.onSessionEnded();
    expect(localRows().map((r) => r.id)).toEqual(["quota"]);
    expect(broadcasts).toHaveLength(1);
  });

  it("a registration for an already-scanned cwd does not rescan", () => {
    const cwd = path.join(tmp, "proj", "A");
    localPlugin(cwd, "quota");
    const { w, broadcasts } = wiring([cwd]);
    w.onSessionRegistered(cwd);
    fs.rmSync(path.join(cwd, ".pi"), { recursive: true });
    w.onSessionRegistered(cwd);
    expect(localRows()).toHaveLength(1);
    expect(broadcasts).toHaveLength(1);
  });

  it("rerunLocalDetection (after a local-scope package op) detects without a discovery refresh and broadcasts once", () => {
    const cwd = path.join(tmp, "proj", "A");
    const { w, broadcasts } = wiring([cwd]);
    expect(w.rerunLocalDetection()).toBe(false);
    expect(broadcasts).toHaveLength(0);
    localPlugin(cwd, "quota");
    expect(w.rerunLocalDetection()).toBe(true);
    expect(broadcasts).toHaveLength(1);
    expect(localRows()[0]).toMatchObject({ id: "quota", enabled: false, loaded: false });
  });

  it("refreshPluginDiscovery ends in exactly one plugins_changed", async () => {
    const { w, broadcasts } = wiring([]);
    await w.refreshPluginDiscovery();
    expect(broadcasts).toHaveLength(1);
  });
});

describe("pi-package server trust is default-deny (E61 a/b)", () => {
  it("pure decision: only an entry with server:true for the id grants", () => {
    expect(isPluginServerTrusted("quota", undefined)).toBe(false);
    expect(isPluginServerTrusted("quota", [])).toBe(false);
    expect(isPluginServerTrusted("quota", [{ id: "quota" }])).toBe(false);
    expect(isPluginServerTrusted("quota", [{ id: "quota", server: false }])).toBe(false);
    expect(isPluginServerTrusted("quota", [{ id: "other", server: true }])).toBe(false);
    expect(isPluginServerTrusted("quota", [{ id: "quota", server: true }])).toBe(true);
  });

  it("the live seam finds no grant without the config field", () => {
    expect(readServerTrustEntries()).toEqual([]);
    expect(isServerTrusted({ manifest: { id: "goal" } })).toBe(false);
  });
});
