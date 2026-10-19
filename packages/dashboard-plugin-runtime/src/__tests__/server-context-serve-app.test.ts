/**
 * L1 — `ServerPluginContext.dataDir` + `serveApp` binding (tasks 3.3, 3.3a of
 * add-plugin-capability-routes). Spec scenarios "Data-directory mount appears
 * after provisioning" and "Directory outside package and data directory refused".
 *
 * The host trust gate lives in packages/server (serve-app-host.ts); here the dep
 * is bound straight to `mountApp`, as a trusted host does.
 *
 * See change: add-plugin-capability-routes, edit-office-in-pane-with-craft-web.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppMountRegistry, mountApp } from "../server/app-mount.js";
import { createServerPluginContext, type ServerContextDeps } from "../server/server-context.js";

function baseDeps(fastify: FastifyInstance): ServerContextDeps {
  return {
    fastify,
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
    mintSpawnToken: () => "tok-test",
    renameSession: () => false,
    assignSessionRef: () => false,
    networkGuard: async () => {},
    onShutdown: () => () => {},
  };
}

let home: string;
let origHome: string | undefined;
let pkgRoot: string;
let app: FastifyInstance;
let registry: AppMountRegistry;

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ctx-serveapp-")));
  origHome = process.env.HOME;
  process.env.HOME = home;
  pkgRoot = path.join(home, "pkg", "craft-web-plugin");
  fs.mkdirSync(pkgRoot, { recursive: true });
  app = Fastify({ logger: false });
  registry = new AppMountRegistry();
});

afterEach(async () => {
  await app.close();
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  fs.rmSync(home, { recursive: true, force: true });
});

function trustedDeps(pluginId: string): ServerContextDeps {
  return {
    ...baseDeps(app),
    serveApp: (opts, env) =>
      mountApp(
        { fastify: app, pluginId, packageRoot: pkgRoot, dataDir: env.dataDir, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, registry },
        opts,
      ),
  };
}

describe("ServerPluginContext.dataDir", () => {
  it("is ~/.pi/dashboard/plugin-data/<pluginId>, created 0700 on first access only", () => {
    const ctx = createServerPluginContext(baseDeps(app), "craft-web");
    const expected = path.join(home, ".pi", "dashboard", "plugin-data", "craft-web");
    expect(fs.existsSync(expected)).toBe(false);
    expect(ctx.dataDir).toBe(expected);
    expect(fs.statSync(expected).mode & 0o777).toBe(0o700);
    expect(ctx.dataDir).toBe(expected); // memoized, stable
  });

  it("tightens a pre-existing wider directory to 0700", () => {
    const expected = path.join(home, ".pi", "dashboard", "plugin-data", "craft-web");
    fs.mkdirSync(expected, { recursive: true, mode: 0o755 });
    fs.chmodSync(expected, 0o755);
    createServerPluginContext(baseDeps(app), "craft-web").dataDir;
    expect(fs.statSync(expected).mode & 0o777).toBe(0o700);
  });

  it("honours the host override", () => {
    const custom = path.join(home, "custom-data");
    const ctx = createServerPluginContext({ ...baseDeps(app), pluginDataDir: () => custom }, "craft-web");
    expect(ctx.dataDir).toBe(custom);
    expect(fs.statSync(custom).isDirectory()).toBe(true);
  });
});

describe("ServerPluginContext.serveApp", () => {
  it("throws on a host that does not wire it", () => {
    const ctx = createServerPluginContext(baseDeps(app), "craft-web");
    expect(() => ctx.serveApp({ dir: pkgRoot, csp: "default-src 'none'" })).toThrow(/not available/);
  });

  it("forwards options and the plugin's dataDir to the host binding", () => {
    const seen: unknown[] = [];
    const ctx = createServerPluginContext({ ...baseDeps(app), serveApp: (o, e) => seen.push(o, e) }, "craft-web");
    const opts = { dir: "/x", csp: "c", appId: "a", crossOriginFrame: true };
    ctx.serveApp(opts);
    expect(seen).toEqual([opts, { dataDir: ctx.dataDir }]);
  });

  it("refuses ~/.ssh and `/` and mounts nothing", () => {
    const ctx = createServerPluginContext(trustedDeps("craft-web"), "craft-web");
    for (const dir of [path.join(home, ".ssh"), "/"]) {
      expect(() => ctx.serveApp({ dir, csp: "default-src 'none'" }), dir).toThrow(/inside the plugin package or its data directory/);
    }
    expect(registry.list()).toEqual([]);
  });

  it("data-dir mount answers 503 before provisioning and the build after, with no re-registration", async () => {
    const ctx = createServerPluginContext(trustedDeps("craft-web"), "craft-web");
    const dir = path.join(ctx.dataDir, "wordcraft-web", "current");
    ctx.serveApp({ dir, appId: "craft-wordcraft", csp: "default-src 'none'" });
    await app.ready();
    expect((await app.inject({ method: "GET", url: "/apps/craft-wordcraft/" })).statusCode).toBe(503);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.html"), "<p>built</p>");
    const res = await app.inject({ method: "GET", url: "/apps/craft-wordcraft/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("<p>built</p>");
  });
});
