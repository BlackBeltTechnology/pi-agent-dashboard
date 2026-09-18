import type { AuthContext, ResolverOutcome } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerResolverHook } from "../resolver-hook.js";
import { BUNDLED_RESOLVER_PLUGIN_ID, ResolverRegistry } from "../resolver-registry.js";

const future = Date.now() + 3_600_000;

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function build(
  registry: ResolverRegistry,
  opts: { deviceAuthed?: boolean } = {},
): Promise<FastifyInstance> {
  app = Fastify();
  app.decorateRequest("isAuthenticated", false);
  // Simulate the device-bearer branch that runs BEFORE the resolver hook.
  if (opts.deviceAuthed) {
    app.addHook("onRequest", async (req) => {
      (req as { isAuthenticated?: boolean }).isAuthenticated = true;
      (req as { authVia?: string }).authVia = "device";
    });
  }
  registerResolverHook(app, {
    registry,
    timeoutMs: 1000,
    getPublicBase: () => "https://ext.example.com",
  });
  app.get("/probe", async (req) => ({
    principal: (req as { principal?: unknown }).principal ?? null,
    principalExpiresAt: (req as { principalExpiresAt?: unknown }).principalExpiresAt ?? null,
    isAuthenticated: (req as { isAuthenticated?: boolean }).isAuthenticated ?? false,
    authVia: (req as { authVia?: string }).authVia ?? null,
  }));
  await app.ready();
  return app;
}

const claimResolver = (sub: string) => async (_ctx: AuthContext): Promise<ResolverOutcome> => ({
  principal: { iss: "https://kc", sub },
  expiresAt: future,
});

describe("registerResolverHook — inert (§4.3 / D1)", () => {
  it("makes no claim and leaves request unchanged when no resolver registered", async () => {
    const a = await build(new ResolverRegistry([]));
    const res = await a.inject({ method: "GET", url: "/probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ principal: null, principalExpiresAt: null, isAuthenticated: false, authVia: null });
  });
});

describe("registerResolverHook — active (§4.3)", () => {
  it("a bearer request with no cookie is authenticated, not 401'd", async () => {
    const reg = new ResolverRegistry([]);
    reg.register({ pluginId: BUNDLED_RESOLVER_PLUGIN_ID, priority: 100, resolve: claimResolver("u1") });
    const a = await build(reg);
    const res = await a.inject({ method: "GET", url: "/probe", headers: { authorization: "Bearer x" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.principal).toEqual({ iss: "https://kc", sub: "u1" });
    expect(body.principalExpiresAt).toBe(future);
    expect(body.isAuthenticated).toBe(true);
    expect(body.authVia).toBe("principal");
  });

  it("a reject returns 401 immediately", async () => {
    const reg = new ResolverRegistry([]);
    reg.register({
      pluginId: BUNDLED_RESOLVER_PLUGIN_ID,
      priority: 100,
      resolve: async () => ({ reject: true, reason: "bad sig" }),
    });
    const a = await build(reg);
    const res = await a.inject({ method: "GET", url: "/probe", headers: { authorization: "Bearer bad" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("registerResolverHook — device bearer (§4.5)", () => {
  it("device-authed request stays isAuthenticated with principal === null (no resolver claims it)", async () => {
    const reg = new ResolverRegistry([]);
    // Even a buggy resolver that would claim everything must not reinterpret
    // an already-verified device bearer as a human principal.
    reg.register({
      pluginId: BUNDLED_RESOLVER_PLUGIN_ID,
      priority: 100,
      resolve: claimResolver("must-not-appear"),
    });
    const a = await build(reg, { deviceAuthed: true });
    const res = await a.inject({ method: "GET", url: "/probe", headers: { authorization: "Bearer device-tok" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.principal).toBeNull();
    expect(body.isAuthenticated).toBe(true);
    expect(body.authVia).toBe("device");
  });
});
