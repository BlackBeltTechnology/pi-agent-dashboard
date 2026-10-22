/**
 * Host API compatibility gate (test-plan #E28; change: decouple-plugins-from-core).
 * Pure decision table plus a discovery/status integration pass. Host version is
 * the real `PLUGIN_HOST_API_VERSION` (1.0.0), so "newer than host" ranges are
 * `^1.1.0` / `^2.0.0`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectClientRegistryPlugins } from "../server/client-registry-set.js";
import { evaluateHostApi } from "../server/host-api-gate.js";
import {
  clearDiscoveryCache,
  clearStatusStore,
  discoverPlugins,
  getPluginStatusStore,
  loadServerEntries,
} from "../server/loader.js";
import type { ServerPluginContext } from "../server/server-context.js";

describe("evaluateHostApi — decision table", () => {
  const base = { hasClientBundle: false };

  it("pi-package / installed with an unsatisfied range: incompatible and refused", () => {
    for (const source of ["pi-package", "installed"] as const) {
      const v = evaluateHostApi({ ...base, source, range: "^2.0.0" });
      expect(v.status).toEqual({ range: "^2.0.0", compatible: false });
      expect(v.refuse).toBe(true);
      expect(v.reason).toContain("host-api");
      expect(v.reason).toContain("^2.0.0");
    }
  });

  it("a range that is newer than the host by a minor is incompatible", () => {
    expect(evaluateHostApi({ ...base, source: "installed", range: "^1.2.0" }).status?.compatible).toBe(false);
  });

  it("workspace / bundled with an unsatisfied range: warn, never refuse", () => {
    for (const source of ["workspace", "bundled"] as const) {
      const v = evaluateHostApi({ ...base, source, range: "^2.0.0" });
      expect(v.status).toEqual({ range: "^2.0.0", compatible: false });
      expect(v.refuse).toBe(false);
      expect(v.warn).toBe(true);
    }
  });

  it("a satisfied range is compatible and silent", () => {
    const v = evaluateHostApi({ ...base, source: "installed", range: "^1.0.0" });
    expect(v).toMatchObject({ status: { range: "^1.0.0", compatible: true }, refuse: false, warn: false });
  });

  it("pi-package without hostApi is incompatible and the reason names hostApi", () => {
    const v = evaluateHostApi({ ...base, source: "pi-package", range: undefined });
    expect(v.status).toEqual({ compatible: false });
    expect(v.refuse).toBe(true);
    expect(v.reason).toContain("hostApi");
  });

  it("installed without clientBundle and without hostApi: loads, no status", () => {
    const v = evaluateHostApi({ ...base, source: "installed", range: undefined });
    expect(v.status).toBeUndefined();
    expect(v.refuse).toBe(false);
  });

  it("installed clientBundle without hostApi: refused", () => {
    const v = evaluateHostApi({ hasClientBundle: true, source: "installed", range: undefined });
    expect(v.status).toEqual({ compatible: false });
    expect(v.refuse).toBe(true);
  });

  it("workspace clientBundle without hostApi: incompatible but only warned", () => {
    const v = evaluateHostApi({ hasClientBundle: true, source: "workspace", range: undefined });
    expect(v.status).toEqual({ compatible: false });
    expect(v.refuse).toBe(false);
    expect(v.warn).toBe(true);
  });
});

function makeFakeContext(): ServerPluginContext {
  return new Proxy({} as ServerPluginContext, { get: () => () => undefined });
}

describe("discovery + status — host API gate", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hag-"));
    clearDiscoveryCache();
    clearStatusStore();
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearDiscoveryCache();
    clearStatusStore();
    vi.restoreAllMocks();
  });

  function writePlugin(dir: string, name: string, manifest: Record<string, unknown>, withServer = false) {
    const pkgDir = path.join(dir, name);
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name, "pi-dashboard-plugin": manifest }));
    if (withServer) fs.writeFileSync(path.join(pkgDir, "server.mjs"), "export default async () => {};");
    return pkgDir;
  }

  it("records source per search dir and gates both halves by source", async () => {
    const installedDir = path.join(tmpDir, "installed");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    writePlugin(path.join(tmpDir, "packages"), "ws", { id: "ws", displayName: "WS", claims: [], server: "./server.mjs", client: "./c.tsx", hostApi: "^2.0.0" }, true);
    writePlugin(installedDir, "inst", { id: "inst", displayName: "Inst", claims: [], server: "./server.mjs", client: "./c.tsx", hostApi: "^2.0.0" }, true);
    writePlugin(installedDir, "inst-plain", { id: "inst-plain", displayName: "Plain", claims: [], server: "./server.mjs" }, true);
    writePlugin(installedDir, "inst-ok", { id: "inst-ok", displayName: "Ok", claims: [], hostApi: "^1.0.0" });

    const plugins = discoverPlugins(tmpDir, [{ dir: installedDir, source: "installed" }]);
    expect(Object.fromEntries(plugins.map((p) => [p.manifest.id, p.source]))).toEqual({
      ws: "workspace",
      inst: "installed",
      "inst-plain": "installed",
      "inst-ok": "installed",
    });
    // workspace mismatch warns naming plugin + range
    expect(warn.mock.calls.flat().join("\n")).toMatch(/ws.*\^2\.0\.0/s);

    // listing: the refused plugin is absent from the client registry selection
    const listed = selectClientRegistryPlugins(plugins, { isProd: false }).map((p) => p.manifest.id);
    expect(listed).not.toContain("inst");

    const created: string[] = [];
    await loadServerEntries({
      createContext: (p) => {
        created.push(p.manifest.id);
        return makeFakeContext();
      },
      isEnabled: () => true,
      repoRoot: tmpDir,
      // The discovery cache is keyed by the effective root set, so the load pass names the same roots.
      discovery: { extraSearchDirs: [{ dir: installedDir, source: "installed" }] },
    });
    const store = getPluginStatusStore();
    const inst = store.getStatus("inst");
    expect(inst).toMatchObject({
      source: "installed",
      loaded: false,
      hostApi: { range: "^2.0.0", compatible: false },
      client: { delivery: "refused", refusedReason: "host-api" },
    });
    expect(inst?.error).toContain("host-api");
    expect(created).not.toContain("inst");

    const ws = store.getStatus("ws");
    // The server entry IS attempted for workspace (vitest cannot import a tmp
    // file, so a later import error is expected; it must not be a host-api one).
    expect(ws).toMatchObject({ source: "workspace", hostApi: { range: "^2.0.0", compatible: false } });
    expect(ws?.error ?? "").not.toMatch(/^host-api:/);
    expect(ws?.client).toBeUndefined();
    expect(created).toContain("ws");

    // installed without hostApi / clientBundle: not gated, server entry attempted.
    expect(store.getStatus("inst-plain")).toMatchObject({ source: "installed" });
    expect(store.getStatus("inst-plain")?.error ?? "").not.toMatch(/^host-api:/);
    expect(store.getStatus("inst-plain")?.hostApi).toBeUndefined();
    expect(created).toContain("inst-plain");
    expect(store.getStatus("inst-ok")).toMatchObject({ loaded: true, hostApi: { range: "^1.0.0", compatible: true } });
  });

  it("an installed plugin with a clientBundle and no hostApi is refused", async () => {
    const installedDir = path.join(tmpDir, "installed");
    vi.spyOn(console, "error").mockImplementation(() => {});
    writePlugin(installedDir, "bundle", { id: "bundle", displayName: "B", claims: [], clientBundle: "./dist/client.js" });
    discoverPlugins(tmpDir, [{ dir: installedDir, source: "installed" }]);
    await loadServerEntries({
      createContext: () => makeFakeContext(),
      isEnabled: () => true,
      repoRoot: tmpDir,
      discovery: { extraSearchDirs: [{ dir: installedDir, source: "installed" }] },
    });
    expect(getPluginStatusStore().getStatus("bundle")).toMatchObject({
      loaded: false,
      client: { delivery: "refused", refusedReason: "host-api" },
    });
  });
});
