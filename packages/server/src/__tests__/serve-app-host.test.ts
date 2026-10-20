/**
 * L1 — host trust gate for `ctx.serveApp` (design D2/D5; test-plan #E5 mount subset, #E13).
 * Exemplar: packages/server/src/identity/__tests__/resolver-registry.test.ts (trust-by-list).
 *
 * See change: add-plugin-capability-routes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearAppMountRegistry, createServerPluginContext, getAppMountRegistry, type ServerContextDeps } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostServeApp, isServeAppTrusted, readBundledPluginDirs } from "../auth/serve-app-host.js";

let tmp: string;
let app: FastifyInstance;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "serve-app-host-")));
  app = Fastify({ logger: false });
  clearAppMountRegistry();
});
afterEach(async () => {
  await app.close();
  clearAppMountRegistry();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function plugin(dirName: string, manifestId: string) {
  const packageDir = path.join(tmp, "packages", dirName);
  fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
  fs.writeFileSync(path.join(packageDir, "dist", "index.html"), `<p>${manifestId}</p>`);
  return { packageDir, manifestId, source: "workspace" as const };
}

const roots = () => [path.join(tmp, "packages")];

describe("readBundledPluginDirs", () => {
  it("lists package DIRECTORY names from the server package (not manifest ids)", () => {
    const dirs = readBundledPluginDirs();
    expect(dirs.has("goal-plugin")).toBe(true);
    expect(dirs.has("flows-plugin")).toBe(true);
    expect(dirs.has("goal")).toBe(false);
    expect(dirs.has("not-a-plugin")).toBe(false);
  });
});

describe("isServeAppTrusted (E5 trust table, serveApp subset)", () => {
  const bundledDirs = new Set(["voice-wall-plugin"]);
  it.each([
    ["dir bundled, id not configured", "voice-wall-plugin", "voice-wall", [], true],
    ["dir not bundled, id configured", "third-party", "tp", ["tp"], true],
    ["neither (priority is not trust)", "third-party", "tp", ["other"], false],
    ["id equal to a bundled DIR name does not count", "third-party", "voice-wall-plugin", [], false],
  ])("%s", (_n, dir, id, configured, expected) => {
    const p = plugin(dir as string, id as string);
    expect(isServeAppTrusted(p, { bundledDirs, configuredIds: configured as string[], bundledRoots: roots() })).toBe(expected);
  });
});

// test-plan #E52 (task 5.1): bundled app-mount trust is path-contained.
describe("isServeAppTrusted — path-contained bundled trust (E52)", () => {
  const bundledDirs = new Set(["goal-plugin", "craft-web-plugin"]);
  const dashPlugins = () => path.join(tmp, "dash", "plugins");
  const lists = () => ({ bundledDirs, configuredIds: [] as string[], bundledRoots: [path.join(tmp, "packages"), dashPlugins()] });
  const at = (packageDir: string, source: "workspace" | "installed" | "bundled" | "pi-package" | "local-detected") => {
    fs.mkdirSync(packageDir, { recursive: true });
    return { packageDir, manifestId: "x", source };
  };

  it("(a) a pi-package copy with a spoofed bundled basename is refused", () => {
    const evil = at(path.join(tmp, ".pi", "agent", "npm", "node_modules", "@evil", "goal-plugin"), "pi-package");
    expect(isServeAppTrusted(evil, lists())).toBe(false);
  });

  it("(a') even a bundled-looking source with a dir outside every root is refused", () => {
    expect(isServeAppTrusted(at(path.join(tmp, "elsewhere", "goal-plugin"), "installed"), lists())).toBe(false);
  });

  it("(b) an installed craft-web-plugin under the dashboard plugins dir is admitted as bundled", () => {
    expect(isServeAppTrusted(at(path.join(dashPlugins(), "craft-web-plugin"), "installed"), lists())).toBe(true);
  });

  it("(c) a symlink under the dashboard plugins dir pointing outside is refused (realpath)", () => {
    const target = path.join(tmp, "evil", "goal-plugin");
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(dashPlugins(), { recursive: true });
    const link = path.join(dashPlugins(), "goal-plugin");
    fs.symlinkSync(target, link);
    expect(isServeAppTrusted({ packageDir: link, manifestId: "x", source: "installed" }, lists())).toBe(false);
  });

  it("(d) a workspace copy under <repo>/packages is admitted", () => {
    expect(isServeAppTrusted(at(path.join(tmp, "packages", "goal-plugin"), "workspace"), lists())).toBe(true);
  });

  it("(e) a local-detected copy is never bundled, even in a root", () => {
    expect(isServeAppTrusted(at(path.join(tmp, "packages", "goal-plugin"), "local-detected"), lists())).toBe(false);
  });

  it("default roots: the real goal-plugin workspace copy is admitted, a same-named pi-package copy is not", () => {
    const real = path.resolve(__dirname, "../../../goal-plugin");
    const defaults = { bundledDirs: readBundledPluginDirs(), configuredIds: [] as string[] };
    expect(isServeAppTrusted({ packageDir: real, manifestId: "goal", source: "workspace" }, defaults)).toBe(true);
    expect(isServeAppTrusted({ packageDir: real, manifestId: "goal", source: "pi-package" }, defaults)).toBe(false);
  });

  it("a missing source fails closed", () => {
    const dir = path.join(tmp, "packages", "goal-plugin");
    fs.mkdirSync(dir, { recursive: true });
    expect(isServeAppTrusted({ packageDir: dir, manifestId: "x" }, lists())).toBe(false);
  });

  it("a configured id (auth.capabilityRoutePlugins) still admits a pi-package copy", () => {
    const evil = at(path.join(tmp, ".pi", "agent", "npm", "node_modules", "goal-plugin"), "pi-package");
    expect(isServeAppTrusted(evil, { ...lists(), configuredIds: ["x"] })).toBe(true);
  });
});

describe("createHostServeApp (E13)", () => {
  function ctxFor(p: ReturnType<typeof plugin>, configured: string[], bundled: string[]) {
    const deps = {
      fastify: app,
      sessionManager: { listActive: () => [], listAll: () => [], getSession: () => undefined },
      eventStore: { getEvents: () => [], getLatestEvent: () => undefined },
      broadcastToSubscribers: () => {},
      registerPiHandler: () => {},
      registerBrowserHandler: () => {},
      onEvent: () => () => {},
      onSessionEnded: () => () => {},
      onSessionResolved: () => () => {},
      sendToSession: () => false,
      emitEventToSession: () => false,
      sendExtensionMessage: () => false,
      spawnSession: async () => ({ success: false }),
      abortSession: () => false,
      abortSpawnedRun: async () => false,
      registerCwdPolicy: () => {},
      unregisterCwdPolicy: () => {},
      provide: () => {},
      consume: () => undefined,
      consumeAll: () => [],
      getPluginConfig: () => ({}),
      updatePluginConfig: async () => {},
      mintSpawnToken: () => "t",
      renameSession: () => false,
      assignSessionRef: () => false,
      networkGuard: async () => {},
      onShutdown: () => () => {},
      pluginDataDir: () => path.join(tmp, "data", p.manifestId),
      serveApp: createHostServeApp({ fastify: app, plugin: p, readConfiguredIds: () => configured, bundledDirs: new Set(bundled), bundledRoots: roots() }),
    } as ServerContextDeps;
    return createServerPluginContext(deps, p.manifestId);
  }

  it("untrusted plugin mounts nothing and warns once; a trusted mount of the same id then succeeds", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const evil = plugin("evil-plugin", "evil");
    const good = plugin("wall-plugin", "wall");
    const evilCtx = ctxFor(evil, [], []);
    evilCtx.serveApp({ dir: path.join(evil.packageDir, "dist"), csp: "default-src 'none'", appId: "wall" });
    evilCtx.serveApp({ dir: path.join(evil.packageDir, "dist"), csp: "default-src 'none'", appId: "wall" });
    expect(getAppMountRegistry().list()).toEqual([]);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("not trusted to mount an app"))).toHaveLength(1);

    const goodCtx = ctxFor(good, [], ["wall-plugin"]);
    goodCtx.serveApp({ dir: path.join(good.packageDir, "dist"), csp: "default-src 'none'", appId: "wall" });
    await app.ready();
    const res = await app.inject({ method: "GET", url: "/apps/wall/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<p>wall</p>");
    warn.mockRestore();
  });

  it("a plugin named in auth.capabilityRoutePlugins mounts; the list is read at call time", () => {
    const third = plugin("third-party", "tp");
    let configured: string[] = [];
    const live = createHostServeApp({ fastify: app, plugin: third, readConfiguredIds: () => configured, bundledDirs: new Set() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    live({ dir: path.join(third.packageDir, "dist"), csp: "x" }, { dataDir: path.join(tmp, "data", "tp") });
    expect(getAppMountRegistry().list()).toEqual([]);
    configured = ["tp"];
    live({ dir: path.join(third.packageDir, "dist"), csp: "x" }, { dataDir: path.join(tmp, "data", "tp") });
    expect(getAppMountRegistry().list().map((m) => m.appId)).toEqual(["tp"]);
    warn.mockRestore();
  });

  it("a trusted plugin: dir '/' throws, second mount of the same appId throws, nothing partial remains", () => {
    const good = plugin("wall-plugin", "wall");
    const ctx = ctxFor(good, [], ["wall-plugin"]);
    expect(() => ctx.serveApp({ dir: "/", csp: "x" })).toThrow(/inside the plugin package/);
    ctx.serveApp({ dir: path.join(good.packageDir, "dist"), csp: "x" });
    expect(() => ctx.serveApp({ dir: path.join(good.packageDir, "dist"), csp: "x" })).toThrow(/already mounted/);
    expect(getAppMountRegistry().list()).toHaveLength(1);
  });
});
