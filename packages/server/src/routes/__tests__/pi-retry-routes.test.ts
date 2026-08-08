import { describe, it, expect, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerPiRetryRoutes } from "../pi-retry-routes.js";

/**
 * PUT applies via a reload fan-out only on a SUCCESSFUL write; an invalid body
 * reloads nothing. Relies on the ephemeral HOME the test harness sets, so the
 * write lands in a sandbox, never the real ~/.pi.
 * See change: retry-forever-with-stop-control.
 */
function buildApp() {
  const app = Fastify();
  let reloadCalls = 0;
  const reloadConnectedSessions = () => {
    reloadCalls += 1;
    return 3; // pretend 3 sessions are connected
  };
  registerPiRetryRoutes(app, { networkGuard: async () => {}, reloadConnectedSessions });
  return { app, reloads: () => reloadCalls };
}

describe("PUT /api/pi-retry", () => {
  let app: FastifyInstance;
  let reloads: () => number;

  beforeEach(() => {
    ({ app, reloads } = buildApp());
  });

  it("writes a valid policy and reloads every connected session", async () => {
    const policy = {
      enabled: true,
      maxRetries: 24,
      baseDelayMs: 2000,
      provider: { maxRetries: 0, maxRetryDelayMs: 60000 },
    };
    const res = await app.inject({ method: "PUT", url: "/api/pi-retry", payload: policy });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.policy).toEqual(policy);
    expect(body.data.reloadedSessions).toBe(3);
    expect(reloads()).toBe(1);
    await app.close();
  });

  it("rejects an invalid policy and reloads NOTHING", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/pi-retry",
      payload: { enabled: true, maxRetries: -1, baseDelayMs: 2000, provider: { maxRetries: 0, maxRetryDelayMs: 60000 } },
    });
    const body = res.json();
    expect(body.success).toBe(false);
    expect(reloads()).toBe(0);
    await app.close();
  });

  it("GET returns a policy shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/pi-retry" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.enabled).toBe("boolean");
    expect(typeof body.data.maxRetries).toBe("number");
    expect(typeof body.data.baseDelayMs).toBe("number");
    expect(typeof body.data.provider.maxRetries).toBe("number");
    expect(typeof body.data.provider.maxRetryDelayMs).toBe("number");
    await app.close();
  });

  it("round-trips a saved policy through GET", async () => {
    const policy = {
      enabled: false,
      maxRetries: 12,
      baseDelayMs: 5000,
      provider: { timeoutMs: 3600000, maxRetries: 5, maxRetryDelayMs: 0 },
    };
    await app.inject({ method: "PUT", url: "/api/pi-retry", payload: policy });
    const res = await app.inject({ method: "GET", url: "/api/pi-retry" });
    expect(res.json().data).toEqual(policy);
    await app.close();
  });
});
