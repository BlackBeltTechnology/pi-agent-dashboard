/**
 * E23/E24/E25/X8 (test-plan expand-mcp-tiered-surface) — REST tier gate
 * decision table. See change: expand-mcp-tiered-surface (D1b).
 *
 * The gate is exercised against the REAL `createRouteTierGate` +
 * `registerBearerAuth` + `createNetworkGuard`, with fixture routes whose
 * patterns exist in `ROUTE_TIERS` (`/api/sessions`, `/api/session/:id/prompt`,
 * `/api/restart`, `/api/ws-ticket`) plus one unlisted `/api/fixture`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { createRouteTierGate, type TierRefusal } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";

let tmpDir: string;
const openApps: FastifyInstance[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tier-gate-"));
});

afterEach(async () => {
  for (const app of openApps.splice(0)) await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface App {
  app: FastifyInstance;
  tokens: { observe: string; control: string; operate: string };
  restartCalls: () => number;
  promptCalls: () => number;
  refusals: TierRefusal[];
}

async function mkApp(opts: { trusted?: string[] } = {}): Promise<App> {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const tokens = {
    observe: reg.add("o", "manual", "observe").token,
    control: reg.add("c", "manual", "control").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  let restart = 0;
  let prompt = 0;
  const refusals: TierRefusal[] = [];

  const app = Fastify();
  openApps.push(app);
  // A limiter so static analysis sees these fixture handlers as rate-limited
  // (the real routes inherit the server's global limiter the same way).
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  app.decorateRequest("isAuthenticated", false);
  // Fixture: a cookie-session request (models auth-plugin's `authVia: "session"`).
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-cookie"]) {
      (req as any).isAuthenticated = true;
      (req as any).authVia = "session";
    }
  });
  registerBearerAuth(app, { registry: reg });
  app.addHook(
    "onRequest",
    createRouteTierGate({
      getTrustedNetworks: () => opts.trusted ?? [],
      logRefusal: (d) => refusals.push(d),
    }),
  );
  const networkGuard = createNetworkGuard(opts.trusted ?? []);
  app.addHook("preHandler", networkGuard);

  app.get("/api/sessions", async () => ({ success: true }));
  app.post("/api/session/:id/prompt", async () => {
    prompt++;
    return { success: true };
  });
  app.post("/api/restart", async () => {
    restart++;
    return { ok: true };
  });
  app.post("/api/ws-ticket", async () => ({ success: true }));
  app.post("/api/fixture", async () => ({ success: true }));
  await app.ready();

  return { app, tokens, restartCalls: () => restart, promptCalls: () => prompt, refusals };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("E23 — tier gate decision table", () => {
  it("observe bearer off-host: reads within tier, refused above it", async () => {
    const { app, tokens } = await mkApp();
    const read = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.observe),
    });
    expect(read.statusCode).toBe(200);

    const restart = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.observe),
    });
    expect(restart.statusCode).toBe(403);
    expect(restart.headers["www-authenticate"]).toBe(
      'Bearer error="insufficient_scope", scope="operate"',
    );
    expect(restart.json()).toMatchObject({ success: false, error: "insufficient_scope", scope: "operate" });
  });

  it("control bearer off-host: meets control, refused at operate", async () => {
    const { app, tokens } = await mkApp();
    const prompt = await app.inject({
      method: "POST",
      url: "/api/session/s1/prompt",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.control),
    });
    expect(prompt.statusCode).toBe(200);

    // An observe bearer is below the control-tier prompt route.
    const observePrompt = await app.inject({
      method: "POST",
      url: "/api/session/s1/prompt",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.observe),
    });
    expect(observePrompt.statusCode).toBe(403);
    expect(observePrompt.headers["www-authenticate"]).toContain('scope="control"');
  });

  it("operate bearer off-host reaches operate routes", async () => {
    const { app, tokens } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.operate),
    });
    expect(res.statusCode).toBe(200);
  });

  it("cookie session off-host is never tier-refused", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "203.0.113.5",
      headers: { "x-test-cookie": "1" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("loopback observe bearer is not tier-refused (network position trusted)", async () => {
    const { app, tokens } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "127.0.0.1",
      headers: bearer(tokens.observe),
    });
    expect(res.statusCode).toBe(200);
  });

  it("trusted-network observe bearer is not tier-refused", async () => {
    const { app, tokens } = await mkApp({ trusted: ["10.0.0.0/8"] });
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "10.1.2.3",
      headers: bearer(tokens.observe),
    });
    expect(res.statusCode).toBe(200);
  });

  it("an unlisted route fails closed at operate", async () => {
    const { app, tokens } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/fixture",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.control),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().scope).toBe("operate");
  });
});

describe("E24 — gate never admits", () => {
  it("no credential off-host keeps the existing admission refusal", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "203.0.113.5",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("network_not_allowed");
  });
});

describe("E25 — ws-ticket is operate", () => {
  it("control bearer is refused 403 scope operate; operate bearer is served", async () => {
    const { app, tokens } = await mkApp();
    const control = await app.inject({
      method: "POST",
      url: "/api/ws-ticket",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.control),
    });
    expect(control.statusCode).toBe(403);
    expect(control.headers["www-authenticate"]).toContain('scope="operate"');

    const operate = await app.inject({
      method: "POST",
      url: "/api/ws-ticket",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.operate),
    });
    expect(operate.statusCode).toBe(200);
  });
});

describe("X8 — refusals are logged", () => {
  it("records deviceId, method, route pattern, principal and required tier; handler not called", async () => {
    const { app, tokens, restartCalls, refusals } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "203.0.113.5",
      headers: bearer(tokens.control),
    });
    expect(res.statusCode).toBe(403);
    expect(restartCalls()).toBe(0);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      method: "POST",
      route: "/api/restart",
      principalTier: "control",
      requiredTier: "operate",
    });
    expect(typeof refusals[0].deviceId).toBe("string");
  });
});
