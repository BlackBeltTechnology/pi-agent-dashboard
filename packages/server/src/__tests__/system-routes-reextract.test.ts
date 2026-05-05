/**
 * Tests for POST /api/electron/reextract
 * See change: simplify-electron-bootstrap-derived-state (task 6.4 / 6.9).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSystemRoutes } from "../routes/system-routes.js";
import type { BootstrapStateStore, BootstrapState } from "../bootstrap-state.js";

function noGuard() {
  return async () => { /* allow all */ };
}

function makeBootstrapState(starter: string): BootstrapStateStore {
  return {
    get: () => ({
      status: "ready",
      starter: starter as any,
      installable: { total: 0, installed: 0, failed: [] },
    } as BootstrapState),
    set: () => {},
    subscribe: () => () => {},
  } as unknown as BootstrapStateStore;
}

function makeNoopDeps(bootstrapState?: BootstrapStateStore) {
  return {
    sessionManager: { listActive: () => [], listAll: () => [] } as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: noGuard(),
    bootstrapState,
  };
}

describe("POST /api/electron/reextract", () => {
  let fastify: FastifyInstance;

  beforeEach(async () => {
    fastify = Fastify();
  });

  afterEach(async () => {
    await fastify.close();
  });

  it("returns 403 when starter is Bridge", async () => {
    const deps = makeNoopDeps(makeBootstrapState("Bridge"));
    registerSystemRoutes(fastify, deps);
    await fastify.ready();

    const res = await fastify.inject({ method: "POST", url: "/api/electron/reextract" });
    expect(res.statusCode).toBe(403);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toBe("reextract_not_allowed");
    expect(body.starter).toBe("Bridge");
  });

  it("returns 403 when starter is Standalone", async () => {
    const deps = makeNoopDeps(makeBootstrapState("Standalone"));
    registerSystemRoutes(fastify, deps);
    await fastify.ready();

    const res = await fastify.inject({ method: "POST", url: "/api/electron/reextract" });
    expect(res.statusCode).toBe(403);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toBe("reextract_not_allowed");
    expect(body.starter).toBe("Standalone");
  });

  it("returns 202 when starter is Electron", async () => {
    const deps = makeNoopDeps(makeBootstrapState("Electron"));
    registerSystemRoutes(fastify, deps);
    await fastify.ready();

    const res = await fastify.inject({ method: "POST", url: "/api/electron/reextract" });
    expect(res.statusCode).toBe(202);
    const body = res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
  });

  it("returns 403 when no bootstrapState (defaults to Standalone)", async () => {
    const deps = makeNoopDeps(undefined);
    registerSystemRoutes(fastify, deps);
    await fastify.ready();

    const res = await fastify.inject({ method: "POST", url: "/api/electron/reextract" });
    expect(res.statusCode).toBe(403);
  });
});
