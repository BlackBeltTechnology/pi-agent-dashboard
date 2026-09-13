/**
 * Server-entry wiring (change: add-browser-relay, tasks 2.1 / 2.10b).
 *
 * Verifies the composition root mounts every surface exactly once and that
 * `PI_BROWSER_RELAY_FAKE=1` seeds the `Fake` instance the harness renders.
 * Behaviour of each surface is tested in its own file.
 */
import type { ServerPluginContext, WsRouteRegistration } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerPlugin } from "../index.js";

interface Fake {
  ctx: ServerPluginContext;
  app: ReturnType<typeof Fastify>;
  wsRoutes: Map<string, WsRouteRegistration>;
  handlers: Map<string, (msg: unknown, ws: unknown) => void>;
  config: Record<string, unknown>;
  shutdown: Array<() => void>;
}

async function makeFake(config: Record<string, unknown> = { enabled: true, browsers: {} }): Promise<Fake> {
  const wsRoutes = new Map<string, WsRouteRegistration>();
  const handlers = new Map<string, (msg: unknown, ws: unknown) => void>();
  const shutdown: Array<() => void> = [];
  const app = Fastify();
  const ctx = {
    fastify: app,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    getPluginConfig: () => config,
    updatePluginConfig: async (partial: Record<string, unknown>) => {
      Object.assign(config, partial);
    },
    broadcastToSubscribers: () => {},
    onShutdown: (fn: () => void) => shutdown.push(fn),
    registerWsRoute: (scope: string, opts: WsRouteRegistration) => wsRoutes.set(scope, opts),
    registerBrowserHandler: (type: string, h: (msg: unknown, ws: unknown) => void) => handlers.set(type, h),
  } as unknown as ServerPluginContext;
  return { ctx, app, wsRoutes, handlers, config, shutdown };
}

const priorFake = process.env.PI_BROWSER_RELAY_FAKE;
afterEach(() => {
  if (priorFake === undefined) delete process.env.PI_BROWSER_RELAY_FAKE;
  else process.env.PI_BROWSER_RELAY_FAKE = priorFake;
});

describe("browser plugin server entry", () => {
  it("mounts both WS scopes, the three handlers and the REST routes", async () => {
    const f = await makeFake();
    await registerPlugin(f.ctx);
    await f.app.ready();
    try {
      expect([...f.wsRoutes.keys()].sort()).toEqual(["browser-cdp", "browser-ext"]);
      expect([...f.handlers.keys()].sort()).toEqual([
        "browser_relay_input",
        "browser_relay_subscribe",
        "browser_relay_unsubscribe",
      ]);
      const status = await f.app.inject({ method: "GET", url: "/api/browser/status" });
      expect(status.statusCode).toBe(200);
      expect(JSON.parse(status.body)).toMatchObject({ enabled: true });
      expect(f.shutdown).toHaveLength(1);
    } finally {
      await f.app.close();
    }
  });

  it("seeds no instance when PI_BROWSER_RELAY_FAKE is unset", async () => {
    delete process.env.PI_BROWSER_RELAY_FAKE;
    const f = await makeFake();
    await registerPlugin(f.ctx);
    await f.app.ready();
    try {
      const body = JSON.parse((await f.app.inject({ method: "GET", url: "/api/browser/profiles" })).body);
      expect(body.profiles.Fake).toBeUndefined();
    } finally {
      await f.app.close();
    }
  });

  it("seeds one Fake instance with a tab when PI_BROWSER_RELAY_FAKE=1", async () => {
    process.env.PI_BROWSER_RELAY_FAKE = "1";
    const f = await makeFake();
    await registerPlugin(f.ctx);
    await f.app.ready();
    try {
      const body = JSON.parse((await f.app.inject({ method: "GET", url: "/api/browser/profiles" })).body);
      expect(body.profiles.Fake).toMatchObject({ label: "Fake", installed: true });
      expect(body.profiles.Fake.instances).toHaveLength(1);
      expect(body.profiles.Fake.instances[0].tabs).toHaveLength(1);
    } finally {
      await f.app.close();
    }
  });
});
