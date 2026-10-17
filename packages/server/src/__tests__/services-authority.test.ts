/**
 * canOperate, logs authority and route tiers for the Services pages
 * (add-services-settings-ui). Test-plan: E29, E31, X5.
 */
import fs from "node:fs";
import path from "node:path";
import { hasRouteTier, ROUTE_TIERS } from "@blackbelt-technology/pi-dashboard-shared/route-tiers.js";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createLocalTrustContext } from "../auth/local-proof.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { FakeDriver, makeManager, ociDef, tmpRoot, writeDefinitions } from "../services/__tests__/helpers.js";
import { registerServiceRoutes } from "../services/routes.js";

const TRUSTED = "198.51.100.0/24";
const apps: FastifyInstance[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

async function mkApp() {
  const root = tmpRoot("svc-auth-");
  roots.push(root);
  writeDefinitions(root, [ociDef()]);
  const reg = new PairedDeviceRegistry(path.join(root, "paired.json"));
  const tokens = {
    observe: reg.add("o", "manual", "observe").token,
    control: reg.add("c", "manual", "control").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  const localTrust = createLocalTrustContext("local-token-xyz", () => false);
  const { manager } = makeManager(root, { drivers: { "oci:docker": new FakeDriver("oci:docker") } });
  const app = Fastify();
  apps.push(app);
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  app.decorateRequest("isAuthenticated", false);
  // A login-session stand-in: `x-test-session: <tier>` marks the request like the auth plugin would.
  app.addHook("onRequest", async (req) => {
    const tier = req.headers["x-test-session"];
    if (typeof tier === "string") Object.assign(req, { authVia: "session", principalTier: tier, isAuthenticated: true });
  });
  registerBearerAuth(app, { registry: reg });
  const getTrustedNetworks = () => [TRUSTED];
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks, localTrust, logRefusal: () => {} }));
  registerServiceRoutes(app, {
    manager,
    networkGuard: createNetworkGuard([TRUSTED], { localTrust }),
    localTrust,
    loginAvailable: () => false,
    getTrustedNetworks,
  });
  await app.ready();
  return { app, tokens };
}

type Caller = { name: string; remote: string; headers: (t: Record<string, string>) => Record<string, string> };
const callers: Caller[] = [
  { name: "operate device bearer", remote: "203.0.113.5", headers: (t) => ({ authorization: `Bearer ${t.operate}` }) },
  { name: "observe device bearer", remote: "203.0.113.5", headers: (t) => ({ authorization: `Bearer ${t.observe}` }) },
  { name: "control login session", remote: "203.0.113.5", headers: () => ({ "x-test-session": "control" }) },
  { name: "operate login session", remote: "203.0.113.5", headers: () => ({ "x-test-session": "operate" }) },
  { name: "trusted-network, unauthenticated", remote: "198.51.100.7", headers: () => ({}) },
  { name: "local", remote: "127.0.0.1", headers: () => ({}) },
];

describe("E29 — canOperate equals whether a mutation is accepted", () => {
  const expected = [true, false, false, true, false, true];
  it.each(callers.map((c, i) => [c.name, c, expected[i]] as const))("%s → canOperate %s", async (_n, c, want) => {
    const { app, tokens } = await mkApp();
    const list = await app.inject({ method: "GET", url: "/api/services", remoteAddress: c.remote, headers: c.headers(tokens) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.canOperate).toBe(want);
    const start = await app.inject({ method: "POST", url: "/api/services/docling/pin", remoteAddress: c.remote, headers: c.headers(tokens) });
    expect(start.statusCode !== 403 && start.statusCode < 400).toBe(want);
  });
});

describe("X5 — logs need operate authority although they are a GET", () => {
  const logs = (app: FastifyInstance, remoteAddress: string, headers: Record<string, string>) =>
    app.inject({ method: "GET", url: "/api/services/docling/logs", remoteAddress, headers });

  it("observe bearer → 403 insufficient_scope", async () => {
    const { app, tokens } = await mkApp();
    const res = await logs(app, "203.0.113.5", { authorization: `Bearer ${tokens.observe}` });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
  });

  it("trusted-network unauthenticated → 403 operate_required with remedies, no output", async () => {
    const { app } = await mkApp();
    const res = await logs(app, "198.51.100.7", {});
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "operate_required", reason: "no-credential", remedies: ["use-host"] });
    expect(res.body).not.toContain("lines");
  });

  it("operate bearer → 200", async () => {
    const { app, tokens } = await mkApp();
    const res = await logs(app, "203.0.113.5", { authorization: `Bearer ${tokens.operate}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ available: false, reason: "no-output" });
  });
});

describe("E31 — route tiers", () => {
  it("logs, reset-data and prune carry tier operate", () => {
    const tier = (method: string, p: string) => ROUTE_TIERS.find((r) => r.method === method && r.path === p)?.tier;
    expect(tier("GET", "/api/services/:id/logs")).toBe("operate");
    expect(tier("POST", "/api/services/:id/reset-data")).toBe("operate");
    expect(tier("POST", "/api/services/prune")).toBe("operate");
    expect(hasRouteTier("GET", "/api/services/:id/logs")).toBe(true);
  });
});
