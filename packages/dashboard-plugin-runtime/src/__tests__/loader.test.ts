import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraph, computeToggleImpact } from "../dependency-graph.js";
import {
  clearDiscoveryCache,
  clearStatusStore,
  discoverPlugins,
  getPluginStatusStore,
  loadServerEntries,
} from "../server/loader.js";
import type { ServerPluginContext } from "../server/server-context.js";

function makeFakeContext(): ServerPluginContext {
  return {
    fastify: {} as never,
    sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
    eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
    broadcastToSubscribers: () => {},
    registerPiHandler: () => {},
    onEvent: () => () => {},
    onSessionEnded: () => () => {},
    onSessionResolved: () => () => {},
    sendToSession: () => true,
    emitEventToSession: () => true,
    sendExtensionMessage: () => false,
    consumeAll: () => [],
    spawnSession: async () => ({ success: false }),
    abortSession: () => false,
    abortSpawnedRun: async () => false,
    registerCwdPolicy: () => {},
    unregisterCwdPolicy: () => {},
    provide: () => {},
    consume: () => undefined,
    registerBrowserHandler: () => {},
    getPluginConfig: () => ({} as never),
    updatePluginConfig: async () => {},
    mintSpawnToken: () => "tok-test",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: async () => {},
    onShutdown: () => () => {},
    registerWsRoute: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "loader-test-"));
  clearDiscoveryCache();
  clearStatusStore();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDiscoveryCache();
  clearStatusStore();
});

function writePlugin(name: string, manifest: Record<string, unknown>, serverCode?: string) {
  const pkgDir = path.join(tmpDir, "packages", name);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, "pi-dashboard-plugin": manifest }),
  );
  if (serverCode) {
    const entryPath = path.join(pkgDir, "server.mjs");
    fs.writeFileSync(entryPath, serverCode);
    return entryPath;
  }
  return undefined;
}

describe("discoverPlugins", () => {
  it("returns empty array when packages dir does not exist", () => {
    const plugins = discoverPlugins(path.join(tmpDir, "nonexistent"));
    expect(plugins).toEqual([]);
  });

  it("discovers a valid plugin manifest", () => {
    writePlugin("my-plugin", { id: "my-plugin", displayName: "My Plugin", claims: [] });
    const plugins = discoverPlugins(tmpDir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe("my-plugin");
  });

  it("skips packages without pi-dashboard-plugin field", () => {
    fs.mkdirSync(path.join(tmpDir, "packages", "utility"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "packages", "utility", "package.json"),
      JSON.stringify({ name: "utility" }),
    );
    const plugins = discoverPlugins(tmpDir);
    expect(plugins).toHaveLength(0);
  });

  it("skips packages with invalid manifests (and logs error)", () => {
    writePlugin("bad-plugin", { displayName: "Missing Id", claims: [] }); // missing id
    const plugins = discoverPlugins(tmpDir);
    expect(plugins).toHaveLength(0);
  });

  it("sorts by priority then id", () => {
    writePlugin("z-plugin", { id: "z-plugin", displayName: "Z", priority: 100, claims: [] });
    writePlugin("a-plugin", { id: "a-plugin", displayName: "A", priority: 100, claims: [] });
    writePlugin("m-plugin", { id: "m-plugin", displayName: "M", priority: 50, claims: [] });
    const plugins = discoverPlugins(tmpDir);
    expect(plugins.map(p => p.manifest.id)).toEqual(["m-plugin", "a-plugin", "z-plugin"]);
  });

  it("result is cached — same reference on second call", () => {
    writePlugin("cached-plugin", { id: "cached-plugin", displayName: "C", claims: [] });
    const first = discoverPlugins(tmpDir);
    const second = discoverPlugins(tmpDir);
    expect(first).toBe(second);
  });

  it("explicit repoRoot bypasses auto-discovery (test/build call path)", () => {
    // When repoRoot is passed, discoverPlugins uses ONLY <repoRoot>/packages
    // and does NOT additionally consult monorepo/installed/bundled dirs.
    writePlugin("explicit-plugin", {
      id: "explicit-plugin",
      displayName: "E",
      claims: [],
    });
    const plugins = discoverPlugins(tmpDir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe("explicit-plugin");
  });

  it("dedupes plugins by id when same id appears in multiple search dirs", () => {
    // Create the SAME plugin id in two different packages/ subdirs to
    // simulate monorepo + installed overlap. Both are under the same
    // tmpDir/packages root for this test, so simulate by writing two
    // packages with the SAME id.
    writePlugin("first-copy", { id: "shared-id", displayName: "First", claims: [] });
    writePlugin("second-copy", { id: "shared-id", displayName: "Second", claims: [] });
    const plugins = discoverPlugins(tmpDir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0].manifest.id).toBe("shared-id");
  });

  it("missing packages dir returns empty without crashing", () => {
    const plugins = discoverPlugins(path.join(tmpDir, "does", "not", "exist"));
    expect(plugins).toEqual([]);
  });

  it("unreadable packages dir returns empty gracefully", () => {
    // Pass a path that's a FILE, not a directory.
    const filePath = path.join(tmpDir, "file-not-dir");
    fs.writeFileSync(filePath, "content");
    const plugins = discoverPlugins(filePath);
    expect(plugins).toEqual([]);
  });
});

describe("loadServerEntries", () => {
  it("marks client-only plugin (no server entry) as loaded", async () => {
    writePlugin("client-only", { id: "client-only", displayName: "CO", claims: [] });
    await loadServerEntries({
      createContext: () => makeFakeContext(),
      isEnabled: () => true,
      repoRoot: tmpDir,
    });
    const store = getPluginStatusStore();
    const status = store.getStatus("client-only");
    expect(status?.loaded).toBe(true);
    expect(status?.enabled).toBe(true);
    // displayName from the manifest must be carried into status.
    // See change: add-plugin-activation-ui.
    expect(status?.displayName).toBe("CO");
  });

  it("marks disabled plugin as not loaded", async () => {
    writePlugin("disabled-plugin", { id: "disabled-plugin", displayName: "D", claims: [] });
    await loadServerEntries({
      createContext: () => makeFakeContext(),
      isEnabled: () => false,
      repoRoot: tmpDir,
    });
    const store = getPluginStatusStore();
    const status = store.getStatus("disabled-plugin");
    expect(status?.enabled).toBe(false);
    expect(status?.loaded).toBe(false);
  });

  it("catches plugin server-entry throw, marks failed, continues loading others", async () => {
    // We can't easily test real dynamic import of temp files in vitest without esm tricks,
    // so we test via a mock by checking that loadServerEntries handles the non-existent path
    writePlugin("bad-server", {
      id: "bad-server",
      displayName: "Bad",
      server: "./nonexistent-server.mjs",
      claims: [],
    });
    writePlugin("good-plugin", { id: "good-plugin", displayName: "Good", claims: [] });

    await loadServerEntries({
      createContext: () => makeFakeContext(),
      isEnabled: () => true,
      repoRoot: tmpDir,
    });

    const store = getPluginStatusStore();
    const badStatus = store.getStatus("bad-server");
    const goodStatus = store.getStatus("good-plugin");

    expect(badStatus?.loaded).toBe(false);
    expect(badStatus?.error).toBeTruthy();
    expect(goodStatus?.loaded).toBe(true);
  });
});

/**
 * The real-manifest `dependsOn` matrix (change extract-mcp-client-plugin, task
 * 4.3). apple-tools declares `dependsOn: ["mcp-client"]`, so the three facts the
 * change rests on are asserted against the ACTUAL id/priority/dependsOn values
 * read off disk, not a synthetic graph:
 *
 *   1. both enabled  → mcp-client is attempted BEFORE apple-tools
 *   2. mcp-client off → apple-tools reports `missingDeps: ["mcp-client"]` and
 *                       loads nothing
 *   3. toggling mcp-client off cascades onto apple-tools
 *
 * `listAll()` preserves the store's insertion order, which is exactly the
 * loader's iteration order — the topological order the loader computed.
 */
describe("dependsOn matrix — mcp-client → apple-tools (task 4.3)", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");

  /** The real manifests, with server/client entries stripped (temp dir has none). */
  function realManifest(pkg: string): Record<string, unknown> {
    const raw = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "packages", pkg, "package.json"), "utf8"),
    ) as { "pi-dashboard-plugin": Record<string, unknown> };
    const { server: _s, client: _c, ...manifest } = raw["pi-dashboard-plugin"];
    return manifest;
  }

  it("loads mcp-client before apple-tools when both are enabled", async () => {
    writePlugin("mcp-client", realManifest("mcp-client-plugin"));
    writePlugin("apple-tools", realManifest("apple-tools"));

    await loadServerEntries({
      createContext: () => makeFakeContext(),
      isEnabled: () => true,
      repoRoot: tmpDir,
    });

    const store = getPluginStatusStore();
    const order = store.listAll().map((s) => s.id);
    expect(order.indexOf("mcp-client")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("mcp-client")).toBeLessThan(order.indexOf("apple-tools"));

    expect(store.getStatus("mcp-client")?.loaded).toBe(true);
    expect(store.getStatus("apple-tools")?.loaded).toBe(true);
    expect(store.getStatus("apple-tools")?.missingDeps).toBeUndefined();
    // The inverse map the status row renders from.
    expect(store.getStatus("mcp-client")?.dependents).toEqual(["apple-tools"]);
  });

  it("refuses apple-tools with missingDeps when mcp-client is disabled", async () => {
    writePlugin("mcp-client", realManifest("mcp-client-plugin"));
    writePlugin("apple-tools", realManifest("apple-tools"));

    await loadServerEntries({
      createContext: () => makeFakeContext(),
      isEnabled: (id) => id !== "mcp-client",
      repoRoot: tmpDir,
    });

    const apple = getPluginStatusStore().getStatus("apple-tools");
    expect(apple?.loaded).toBe(false);
    expect(apple?.missingDeps).toEqual(["mcp-client"]);
    expect(getPluginStatusStore().getStatus("mcp-client")?.loaded).toBe(false);
  });

  it("names apple-tools as the cascading dependent when mcp-client is toggled off", () => {
    const manifests = [realManifest("mcp-client-plugin"), realManifest("apple-tools")].map((m) => ({
      id: m.id as string,
      dependsOn: (m.dependsOn as string[] | undefined) ?? [],
    }));
    const graph = buildGraph(manifests, () => true);
    expect(computeToggleImpact(graph, "mcp-client", false).cascadeDisable).toEqual(["apple-tools"]);
    // Enabling apple-tools while its dep is off cascades the dep back on.
    const offGraph = buildGraph(manifests, (id) => id !== "mcp-client");
    expect(computeToggleImpact(offGraph, "apple-tools", true).cascadeEnable).toEqual(["mcp-client"]);
  });
});
