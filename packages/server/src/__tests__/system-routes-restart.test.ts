/**
 * Tests for `/api/restart` and `/api/shutdown` `server_restarting` broadcast.
 * See change: fix-restart-bridge-auto-start-race.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSystemRoutes } from "../routes/system-routes.js";
import type { PiGateway } from "../pi-gateway.js";
import type { ServerToExtensionMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

function noGuard() {
  return async () => { /* allow all */ };
}

function makeNoopDeps() {
  return {
    sessionManager: {} as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: noGuard(),
  };
}

function makeFakeGateway(): { gateway: PiGateway; broadcasts: ServerToExtensionMessage[] } {
  const broadcasts: ServerToExtensionMessage[] = [];
  const gateway: PiGateway = {
    broadcast(msg: ServerToExtensionMessage) { broadcasts.push(msg); },
    sendToSession() { return false; },
    isSessionConnected() { return false; },
    connectionCount() { return 0; },
    onSessionRegistered() { /* no-op */ },
    onConnectionClosed() { /* no-op */ },
    close() { /* no-op */ },
  } as unknown as PiGateway;
  return { gateway, broadcasts };
}

describe("POST /api/restart broadcasts server_restarting", () => {
  let fastify: FastifyInstance;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let broadcasts: ServerToExtensionMessage[];

  beforeEach(() => {
    fastify = Fastify();
    const fake = makeFakeGateway();
    broadcasts = fake.broadcasts;
    // process.exit is deferred via setTimeout(...,200); silence it for the test
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: string | number | null) => undefined as never) as (code?: string | number | null | undefined) => never);
    registerSystemRoutes(fastify, { ...makeNoopDeps(), piGateway: fake.gateway });
  });

  afterEach(async () => {
    // Wait long enough for the route's deferred setTimeout(process.exit, 200)
    // to fire WHILE the spy is still active, so the mock absorbs it instead
    // of leaking to the real process.exit after mockRestore.
    await new Promise((r) => setTimeout(r, 300));
    await fastify.close();
    exitSpy.mockRestore();
  });

  it("sends server_restarting with reason=restart and quiesceMs=5000 to bridges before exit", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/restart", payload: {} });
    // The handler returns ok:true synchronously (orchestrator + exit are deferred).
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({
      type: "server_restarting",
      reason: "restart",
      quiesceMs: 5000,
    });
  });
});

describe("POST /api/shutdown broadcasts server_restarting", () => {
  let fastify: FastifyInstance;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let broadcasts: ServerToExtensionMessage[];

  beforeEach(() => {
    fastify = Fastify();
    const fake = makeFakeGateway();
    broadcasts = fake.broadcasts;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: string | number | null) => undefined as never) as (code?: string | number | null | undefined) => never);
    registerSystemRoutes(fastify, { ...makeNoopDeps(), piGateway: fake.gateway });
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await fastify.close();
    exitSpy.mockRestore();
  });

  it("sends server_restarting with reason=shutdown and quiesceMs=60000", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/shutdown", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toEqual({
      type: "server_restarting",
      reason: "shutdown",
      quiesceMs: 60000,
    });
  });
});

describe("POST /api/restart echoes requestId into the browser broadcast", () => {
  let fastify: FastifyInstance;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let browserMsgs: ServerToBrowserMessage[];

  beforeEach(() => {
    fastify = Fastify();
    browserMsgs = [];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: string | number | null) => undefined as never) as (code?: string | number | null | undefined) => never);
    registerSystemRoutes(fastify, {
      ...makeNoopDeps(),
      browserGateway: { broadcastToAll: (m: ServerToBrowserMessage) => { browserMsgs.push(m); } },
    });
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await fastify.close();
    exitSpy.mockRestore();
  });

  it("broadcasts server_restarting with the client requestId to browsers", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/restart", payload: { requestId: "abc" } });
    expect(res.statusCode).toBe(200);
    expect(browserMsgs).toHaveLength(1);
    expect(browserMsgs[0]).toEqual({
      type: "server_restarting",
      reason: "restart",
      quiesceMs: 5000,
      requestId: "abc",
    });
  });

  it("omits requestId (undefined) when the client sends none", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/restart", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(browserMsgs).toHaveLength(1);
    expect(browserMsgs[0]).toMatchObject({ type: "server_restarting", reason: "restart" });
    expect((browserMsgs[0] as { requestId?: string }).requestId).toBeUndefined();
  });

  it("drops a non-string or oversized requestId (bounds untrusted input)", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/restart",
      payload: { requestId: "x".repeat(200) },
    });
    expect(res.statusCode).toBe(200);
    expect(browserMsgs).toHaveLength(1);
    expect((browserMsgs[0] as { requestId?: string }).requestId).toBeUndefined();
  });
});

describe("/api/restart works without piGateway (no-op broadcast)", () => {
  let fastify: FastifyInstance;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fastify = Fastify();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: string | number | null) => undefined as never) as (code?: string | number | null | undefined) => never);
    registerSystemRoutes(fastify, makeNoopDeps()); // no piGateway
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 300));
    await fastify.close();
    exitSpy.mockRestore();
  });

  it("does not throw when there is no gateway", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/restart", payload: {} });
    expect(res.statusCode).toBe(200);
  });
});
