import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  discoverPlugins,
  clearDiscoveryCache,
  loadServerEntries,
  getPluginStatusStore,
  clearStatusStore,
} from "../server/loader.js";
import type { DiscoveredPlugin } from "../server/loader.js";
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
    sendToSession: () => true,
    emitEventToSession: () => true,
    consumeAll: () => [],
    spawnSession: async () => ({ success: false }),
    abortSession: () => false,
    abortAutomationRun: async () => false,
    provide: () => {},
    consume: () => undefined,
    registerBrowserHandler: () => {},
    getPluginConfig: () => ({} as never),
    updatePluginConfig: async () => {},
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
