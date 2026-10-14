import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

const lockfile = createRequire(import.meta.url)("proper-lockfile") as typeof import("proper-lockfile");

describe("PUT /api/pi-retry", () => {
  let app: FastifyInstance;
  let reloads: () => number;
  let agentDir: string;
  let prevAgentDir: string | undefined;
  const settingsFile = () => join(agentDir, "settings.json");
  const goodPolicy = {
    enabled: true,
    maxRetries: 24,
    baseDelayMs: 2000,
    provider: { maxRetries: 0, maxRetryDelayMs: 60000 },
  };

  beforeEach(() => {
    // Sandbox pi's agent dir regardless of the developer's PI_CODING_AGENT_DIR.
    agentDir = mkdtempSync(join(tmpdir(), "pi-retry-"));
    prevAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    ({ app, reloads } = buildApp());
  });

  afterEach(() => {
    if (prevAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prevAgentDir;
  });

  // See change: edit-pi-agent-settings (spec `pi-retry-settings`).
  it("E39 unparseable settings file → 400, byte-identical, no reload", async () => {
    writeFileSync(settingsFile(), '{ "packages": [');
    const res = await app.inject({ method: "PUT", url: "/api/pi-retry", payload: goodPolicy });
    expect(res.statusCode).toBe(400);
    expect(res.json().success).toBe(false);
    expect(readFileSync(settingsFile(), "utf-8")).toBe('{ "packages": [');
    expect(reloads()).toBe(0);
    await app.close();
  });

  it("E40 keeps packages/extensions/dashboardPluginBridges and unknown retry keys", async () => {
    const before = {
      packages: ["npm:x"],
      extensions: ["/x/bridge.js"],
      dashboardPluginBridges: [{ id: "flows" }],
      retry: { someFutureKnob: 1, provider: { futureProviderKnob: 2 } },
    };
    writeFileSync(settingsFile(), JSON.stringify(before));
    const res = await app.inject({ method: "PUT", url: "/api/pi-retry", payload: goodPolicy });
    expect(res.statusCode).toBe(200);
    const after = JSON.parse(readFileSync(settingsFile(), "utf-8"));
    expect(after.packages).toEqual(before.packages);
    expect(after.extensions).toEqual(before.extensions);
    expect(after.dashboardPluginBridges).toEqual(before.dashboardPluginBridges);
    expect(after.retry.someFutureKnob).toBe(1);
    expect(after.retry.provider.futureProviderKnob).toBe(2);
    expect(after.retry.maxRetries).toBe(24);
    await app.close();
  });

  it("X3 held lock beyond the budget → 503, byte-identical, no reload", async () => {
    writeFileSync(settingsFile(), '{"a":1}');
    const release = await lockfile.lock(settingsFile(), { realpath: false, stale: 10_000 });
    try {
      const res = await app.inject({ method: "PUT", url: "/api/pi-retry", payload: goodPolicy });
      expect(res.statusCode).toBe(503);
      expect(res.json().success).toBe(false);
    } finally {
      await release();
    }
    expect(readFileSync(settingsFile(), "utf-8")).toBe('{"a":1}');
    expect(reloads()).toBe(0);
    await app.close();
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
