import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGraph, computeToggleImpact } from "../dependency-graph.js";
import {
  clearDiscoveryCache,
  clearStatusStore,
  deterministicSerializePlugins,
  discoverPlugins,
  getPluginStatusStore,
  loadServerEntries,
  pluginServerAllowed,
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
    shutdownSession: async () => false,
    openEditorTab: () => {},
    registerFileValidator: () => {},
    abortSpawnedRun: async () => false,
    registerSessionCloser: () => {},
    requestSessionClose: async () => false,
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
    listWorkspaces: () => [],
    onWorkspacesChanged: () => () => {},
    registerWsRoute: () => {},
    serveApp: () => {},
    dataDir: "",
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

  // test-plan #E18 (change: add-project-scoped-apps)
  it("preserves projectTypes through discovery", () => {
    const projectTypes = [{ type: "judo", markers: ["model/*.judo", "judo.yaml"] }];
    writePlugin("typed-plugin", { id: "typed-plugin", displayName: "Typed", claims: [], projectTypes });
    const plugins = discoverPlugins(tmpDir);
    expect(plugins[0].manifest.projectTypes).toEqual(projectTypes);
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

// See change: promote-model-roles-settings (test-plan #E9, #X4).
describe("settings-section nav hint — loader", () => {
  const plugin = (label: string) => ({
    manifest: {
      id: "roles",
      displayName: "Roles",
      priority: 1000,
      claims: [
        { slot: "settings-section" as const, component: "RolesSettings", nav: { group: "models", label } },
      ],
    },
  });

  it("E9: nav participates in the registry serialisation", () => {
    expect(deterministicSerializePlugins([plugin("A")])).not.toBe(
      deterministicSerializePlugins([plugin("B")]),
    );
    expect(deterministicSerializePlugins([plugin("A")])).toBe(
      deterministicSerializePlugins([plugin("A")]),
    );
  });

  it("X4: a malformed nav never unloads the plugin at discovery", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      writePlugin("nav-plugin", {
        id: "nav-plugin",
        displayName: "Nav",
        claims: [
          { slot: "settings-section", component: "A", nav: null },
          { slot: "settings-section", component: "B" },
        ],
      });
      const plugins = discoverPlugins(tmpDir);
      expect(plugins).toHaveLength(1);
      expect(plugins[0].manifest.claims).toHaveLength(2);
      expect(plugins[0].manifest.claims[0].nav).toBeUndefined();
      const navWarnings = warn.mock.calls.filter((c) => String(c[0]).includes("nav"));
      expect(navWarnings).toHaveLength(1);
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

// ── Discovery sources, winners, shadowing, keyed cache (Phase 4A) ───────────
// See change: decouple-plugins-from-core (tasks 5.2-5.4; test-plan #E53 #X6 #E54 #E55 #E61)

describe("discovery sources (pi-package 4th source, winners, shadowing)", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = path.join(tmpDir, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    delete (globalThis as { __loadSpy?: string[] }).__loadSpy;
  });

  const SPY_ENTRY = (tag: string) =>
    `export default () => { (globalThis.__loadSpy ||= []).push(${JSON.stringify(tag)}); };\n`;

  /** A plugin package dir with a manifest, an optional server entry spy, at an explicit path. */
  function writeAt(dir: string, id: string, extra: Record<string, unknown> = {}, tag?: string) {
    fs.mkdirSync(dir, { recursive: true });
    const manifest: Record<string, unknown> = { id, displayName: id, claims: [], hostApi: "^1.0.0", ...extra };
    if (tag) {
      manifest.server = "./server.mjs";
      fs.writeFileSync(path.join(dir, "server.mjs"), SPY_ENTRY(tag));
    }
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: path.basename(dir), version: "1.0.0", "pi-dashboard-plugin": manifest }),
    );
  }
  // Server entries are imported by file URL; vite-node only resolves them when the path is externalised
  // (under node_modules), so a root whose workspace entries must really load lives there.
  const wsRoot = () => path.join(tmpDir, "node_modules", "ws-root");
  const piOpts = () => ({ agentDir, npmRoot: path.join(tmpDir, "no-global") });
  const settings = (packages: unknown[]) =>
    fs.writeFileSync(path.join(agentDir, "settings.json"), JSON.stringify({ packages }));
  const spy = () => (globalThis as { __loadSpy?: string[] }).__loadSpy ?? [];

  it("E53: a pi-installed plugin is source pi-package; files and manifest-less dirs are skipped silently", () => {
    writeAt(path.join(agentDir, "npm", "node_modules", "@acme", "pi-dashboard-quota"), "quota");
    fs.mkdirSync(path.join(agentDir, "npm", "node_modules", "plain"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "npm", "node_modules", "plain", "package.json"), JSON.stringify({ name: "plain" }));
    fs.writeFileSync(path.join(tmpDir, "ext.ts"), "export default () => {}");
    settings(["npm:@acme/pi-dashboard-quota", "npm:plain", path.join(tmpDir, "ext.ts"), "npm:@acme/not-installed"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugins = discoverPlugins(tmpDir, [], { piPackages: piOpts() });
    expect(plugins.map((p) => [p.manifest.id, p.source])).toEqual([["quota", "pi-package"]]);
    expect(plugins[0].packageDir).toBe(path.join(agentDir, "npm", "node_modules", "@acme", "pi-dashboard-quota"));
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });

  it("X6: an unreadable settings.json warns once and does not abort the other sources", () => {
    writePlugin("ws-plugin", { id: "ws", displayName: "WS", claims: [] });
    const installed = path.join(tmpDir, "installed");
    writeAt(path.join(installed, "inst-plugin"), "inst");
    fs.writeFileSync(path.join(agentDir, "settings.json"), "{bad json");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const plugins = discoverPlugins(tmpDir, [{ dir: installed, source: "installed" }], { piPackages: piOpts() });
    expect(plugins.map((p) => p.manifest.id).sort()).toEqual(["inst", "ws"]);
    expect(warn.mock.calls.filter((c) => /failed to read/.test(String(c[0])))).toHaveLength(1);
    warn.mockRestore();
  });

  describe("E54 winner rules", () => {
    const flows = (root: string, tag: string) => writeAt(path.join(root, "flows-plugin"), "flows", { priority: 10 }, tag);

    it("(1) undeclared: installed beats bundled", () => {
      const installed = path.join(tmpDir, "installed");
      const bundled = path.join(tmpDir, "bundled");
      flows(installed, "installed");
      flows(bundled, "bundled");
      const [p] = discoverPlugins(tmpDir, [
        { dir: bundled, source: "bundled" },
        { dir: installed, source: "installed" },
      ]);
      expect(p.source).toBe("installed");
      expect(p.shadowed).toEqual([{ source: "bundled", packageDir: path.join(bundled, "flows-plugin") }]);
    });

    it("(2) declared flows: the bundled copy wins, installed is shadowed", () => {
      const installed = path.join(tmpDir, "installed");
      const bundled = path.join(tmpDir, "bundled");
      flows(installed, "installed");
      flows(bundled, "bundled");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const [p] = discoverPlugins(
        tmpDir,
        [
          { dir: installed, source: "installed" },
          { dir: bundled, source: "bundled" },
        ],
        { bundledPluginIds: ["flows"] },
      );
      expect(p.source).toBe("bundled");
      expect(p.shadowed).toEqual([{ source: "installed", packageDir: path.join(installed, "flows-plugin") }]);
      // warn names both paths
      const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("shadows"));
      expect(line).toContain(path.join(bundled, "flows-plugin"));
      expect(line).toContain(path.join(installed, "flows-plugin"));
      warn.mockRestore();
    });

    it("(3) Electron root: goal only bundled, mcp-client in packages/ → bundled and workspace", () => {
      const bundled = path.join(tmpDir, "bundled");
      writeAt(path.join(bundled, "goal-plugin"), "goal");
      writeAt(path.join(tmpDir, "packages", "mcp-client-plugin"), "mcp-client");
      const out = discoverPlugins(tmpDir, [{ dir: bundled, source: "bundled" }], { bundledPluginIds: ["goal", "mcp-client"] });
      expect(Object.fromEntries(out.map((p) => [p.manifest.id, p.source]))).toEqual({ goal: "bundled", "mcp-client": "workspace" });
    });

    it("(4) npm-global, declared goal only installed → installed by plain priority", () => {
      const installed = path.join(tmpDir, "installed");
      writeAt(path.join(installed, "goal-plugin"), "goal");
      const [p] = discoverPlugins(tmpDir, [{ dir: installed, source: "installed" }], { bundledPluginIds: ["goal"] });
      expect(p.source).toBe("installed");
      expect(p.shadowed).toBeUndefined();
    });

    it("(5) workspace + pi-package: workspace wins, pi-package shadowed; only the winner's entry runs", async () => {
      writeAt(path.join(wsRoot(), "packages", "subagents-plugin"), "subagents", {}, "workspace");
      const piDir = path.join(agentDir, "npm", "node_modules", "pi-subagents");
      writeAt(piDir, "subagents", {}, "pi-package");
      settings(["npm:pi-subagents"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const discovery = { piPackages: piOpts() };
      const [p] = discoverPlugins(wsRoot(), [], discovery);
      expect(p.source).toBe("workspace");
      expect(p.shadowed).toEqual([{ source: "pi-package", packageDir: piDir }]);
      expect(warn.mock.calls.some((c) => String(c[0]).includes(piDir) && String(c[0]).includes(path.join(wsRoot(), "packages", "subagents-plugin")))).toBe(true);
      await loadServerEntries({ createContext: () => makeFakeContext(), isEnabled: () => true, repoRoot: wsRoot(), discovery });
      expect(spy()).toEqual(["workspace"]);
      expect(getPluginStatusStore().getStatus("subagents")?.shadowed).toEqual([{ source: "pi-package", packageDir: piDir }]);
      expect(getPluginStatusStore().listAll().filter((s) => s.id === "subagents")).toHaveLength(1);
      warn.mockRestore();
    });

    it("a pi-package entry pointing at the workspace dir itself is not its own shadow", () => {
      writeAt(path.join(tmpDir, "packages", "x-plugin"), "x");
      settings([path.join(tmpDir, "packages", "x-plugin")]);
      const [p] = discoverPlugins(tmpDir, [], { piPackages: piOpts() });
      expect(p.shadowed).toBeUndefined();
    });
  });

  describe("E61 pi-package server entries are default-deny", () => {
    it("(a) a pi-package with server + bridge, no grant: not loaded, server-untrusted, sentinel not written", async () => {
      const dir = path.join(agentDir, "npm", "node_modules", "pi-evil");
      writeAt(dir, "evil", { bridge: "./bridge.mjs" }, "evil-server");
      settings(["npm:pi-evil"]);
      const err = vi.spyOn(console, "warn").mockImplementation(() => {});
      await loadServerEntries({ createContext: () => makeFakeContext(), isEnabled: () => true, repoRoot: tmpDir, discovery: { piPackages: piOpts() } });
      const st = getPluginStatusStore().getStatus("evil");
      expect(st).toMatchObject({ loaded: false, error: "server-untrusted", source: "pi-package" });
      expect(spy()).toEqual([]);
      err.mockRestore();
    });

    it("(b) a pi-package copy of a first-party id with no build copy is refused the same way", async () => {
      writeAt(path.join(agentDir, "npm", "node_modules", "pi-goal"), "goal", {}, "pi-goal");
      settings(["npm:pi-goal"]);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await loadServerEntries({ createContext: () => makeFakeContext(), isEnabled: () => true, repoRoot: tmpDir, discovery: { piPackages: piOpts(), bundledPluginIds: ["goal"] } });
      expect(getPluginStatusStore().getStatus("goal")).toMatchObject({ loaded: false, error: "server-untrusted" });
      expect(spy()).toEqual([]);
      warn.mockRestore();
    });

    it("the bridge gate (pluginServerAllowed): pi-package needs the grant, other sources never ask", () => {
      const mk = (source: "pi-package" | "workspace" | "installed" | "bundled") => ({ source, manifest: { id: "x" } }) as never;
      expect(pluginServerAllowed(mk("pi-package"))).toBe(false);
      expect(pluginServerAllowed(mk("pi-package"), () => false)).toBe(false);
      expect(pluginServerAllowed(mk("pi-package"), () => true)).toBe(true);
      for (const src of ["workspace", "installed", "bundled"] as const) expect(pluginServerAllowed(mk(src))).toBe(true);
    });

    it("(c) an operator grant (isServerTrusted) loads it; workspace sources never ask", async () => {
      writeAt(path.join(agentDir, "npm", "node_modules", "pi-ok"), "ok", {}, "ok");
      writeAt(path.join(wsRoot(), "packages", "ws"), "ws", {}, "ws");
      settings(["npm:pi-ok"]);
      const asked: string[] = [];
      await loadServerEntries({
        createContext: () => makeFakeContext(),
        isEnabled: () => true,
        repoRoot: wsRoot(),
        discovery: { piPackages: piOpts() },
        isServerTrusted: (p) => (asked.push(p.manifest.id), p.manifest.id === "ok"),
      });
      expect(asked).toEqual(["ok"]);
      expect(spy().sort()).toEqual(["ok", "ws"]);
      expect(getPluginStatusStore().getStatus("ok")?.loaded).toBe(true);
    });
  });
});

describe("E55 keyed discovery cache", () => {
  function plug(root: string, name: string, id: string, priority?: number) {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, "package.json"),
      JSON.stringify({ name, "pi-dashboard-plugin": { id, displayName: id, claims: [], ...(priority ? { priority } : {}) } }),
    );
  }

  it("globs once per root set; separate results per set; re-globs after clear", () => {
    plug(path.join(tmpDir, "packages"), "a", "a");
    const extra = path.join(tmpDir, "extra");
    plug(extra, "b", "b");
    const readdir = vi.spyOn(fs, "readdirSync");
    const first = discoverPlugins(tmpDir);
    discoverPlugins(tmpDir);
    const globsFirstSet = readdir.mock.calls.length;
    expect(globsFirstSet).toBe(1);
    const second = discoverPlugins(tmpDir, [{ dir: extra, source: "installed" }]);
    expect(second).not.toBe(first);
    expect(second.map((p) => p.manifest.id)).toEqual(["a", "b"]);
    expect(first.map((p) => p.manifest.id)).toEqual(["a"]);
    clearDiscoveryCache();
    discoverPlugins(tmpDir);
    expect(readdir.mock.calls.length).toBe(globsFirstSet + 2 + 1);
    readdir.mockRestore();
  });

  it("a changed declared-id digest keys a new entry and picks different winners; clear clears every key", () => {
    const installed = path.join(tmpDir, "installed");
    const bundled = path.join(tmpDir, "bundled");
    plug(installed, "flows-plugin", "flows");
    plug(bundled, "flows-plugin", "flows");
    const dirs = [
      { dir: installed, source: "installed" as const },
      { dir: bundled, source: "bundled" as const },
    ];
    const undeclared = discoverPlugins(tmpDir, dirs);
    const declared = discoverPlugins(tmpDir, dirs, { bundledPluginIds: ["flows"] });
    expect(undeclared[0].source).toBe("installed");
    expect(declared[0].source).toBe("bundled");
    expect(discoverPlugins(tmpDir, dirs)).toBe(undeclared);
    expect(discoverPlugins(tmpDir, dirs, { bundledPluginIds: ["flows"] })).toBe(declared);
    // digest ignores order and duplicates
    expect(discoverPlugins(tmpDir, dirs, { bundledPluginIds: ["flows", "flows"] })).toBe(declared);
    clearDiscoveryCache();
    expect(discoverPlugins(tmpDir, dirs)).not.toBe(undeclared);
    expect(discoverPlugins(tmpDir, dirs, { bundledPluginIds: ["flows"] })).not.toBe(declared);
  });

  it("order is deterministic: priority asc, id asc, whatever order readdir returns", () => {
    const root = path.join(tmpDir, "packages");
    plug(root, "zz", "b-late", 500);
    plug(root, "aa", "z-early", 100);
    plug(root, "mm", "a-late", 500);
    const real = fs.readdirSync;
    const shuffled = vi.spyOn(fs, "readdirSync").mockImplementation(((p: fs.PathLike, o?: unknown) =>
      (real as (a: fs.PathLike, b?: unknown) => string[])(p, o).reverse()) as never);
    expect(discoverPlugins(tmpDir).map((p) => p.manifest.id)).toEqual(["z-early", "a-late", "b-late"]);
    shuffled.mockRestore();
  });
});
