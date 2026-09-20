/**
 * GET /api/provider-auth/catalogue-ready — the catalogue availability signal
 * (D5, test-plan E18). `ready` answers "does a pushed provider catalogue
 * exist", which is what lets the client distinguish "no api-key credentials"
 * from "the api-key provider list is unavailable". The signal is a separate
 * route on purpose: it must NOT ride on `GET /api/provider-auth/status` (bare
 * array, pinned by provider-auth-ui) nor on a response header.
 *
 * Route-level states here; the disconnect-driven transition lives in
 * `catalogue-invalidation.test.ts`. See change:
 * redesign-providers-settings-page (D5).
 */
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import {
  _resetForTests,
  setCatalogueForSession,
} from "../package/provider-catalogue-cache.js";

beforeEach(() => _resetForTests());
afterEach(() => _resetForTests());

async function buildApp() {
  const app = Fastify({ logger: false });
  registerProviderAuthRoutes(app, {
    piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any,
    browserGateway: { broadcastToAll: vi.fn() } as any,
  });
  await app.ready();
  return app;
}

describe("GET /api/provider-auth/catalogue-ready (E18)", () => {
  it("state 1: no catalogue pushed since server start → { ready: false }", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: false });
    await app.close();
  });

  it("state 2: a session has pushed a catalogue → { ready: true }", async () => {
    setCatalogueForSession("s1", [
      { id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false },
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/catalogue-ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true });
    await app.close();
  });
});
