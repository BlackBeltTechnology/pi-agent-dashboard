/**
 * E17 (host rows): the panel routes behind the REAL host tier gate + bearer
 * auth + network guard, with `hasOperateAuthority` from the REAL plugin
 * identity seam. Observe bearer → tier gate's `insufficient_scope`; a
 * trusted-network caller without credentials passes the tier gate and is
 * refused by the predicate; an operate bearer reaches the bridge.
 * See change: add-obs-studio-plugin (test-plan E17, E15 parity in situ).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { registerBearerAuth } from "../../../../server/src/auth/bearer-auth.js";
import { createLocalTrustContext } from "../../../../server/src/auth/local-proof.js";
import { createNetworkGuard } from "../../../../server/src/auth/localhost-guard.js";
import { createRouteTierGate } from "../../../../server/src/auth/route-tier-gate.js";
import { createPluginIdentity } from "../../../../server/src/identity/plugin-identity.js";
import { PairedDeviceRegistry } from "../../../../server/src/pairing/paired-devices.js";
import { obsApp } from "./helpers.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
});

async function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-host-gates-"));
  const reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
  const tokens = { observe: reg.add("o", "manual", "observe").token, operate: reg.add("p", "manual", "operate").token };
  const trusted = ["192.168.16.0/24"];
  const identity = createPluginIdentity("obs-studio", {
    isEnforced: () => false,
    principalOfRequest: () => null,
    resolveUpgrade: async () => null,
    policy: { authorize: async () => true },
    pluginDataRoot: (id) => path.join(dir, id),
    localTrust: createLocalTrustContext("tok", () => false),
  });
  const r = await obsApp({
    authority: (req) => identity.hasOperateAuthority(req),
    networkGuard: createNetworkGuard(trusted) as never,
    before: (app) => {
      app.decorateRequest("isAuthenticated", false);
      registerBearerAuth(app, { registry: reg });
      app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => trusted, logRefusal: () => {} }));
    },
  });
  apps.push(r.app);
  return { ...r, tokens };
}

describe("E17 behind the host gates", () => {
  it("observe bearer POST scene → 403 insufficient_scope (tier gate), 0 spawns", async () => {
    const { app, children, tokens } = await mk();
    const r = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/scene", payload: { sceneName: "A" }, remoteAddress: "203.0.113.5", headers: { authorization: `Bearer ${tokens.observe}` } });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
    expect(children).toHaveLength(0);
  });

  it("observe bearer GET screenshot → insufficient_scope; GET status → allowed", async () => {
    const { app, tokens } = await mk();
    const h = { authorization: `Bearer ${tokens.observe}` };
    expect((await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot", remoteAddress: "203.0.113.5", headers: h })).json()).toMatchObject({ error: "insufficient_scope" });
    expect((await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/status", remoteAddress: "203.0.113.5", headers: h })).statusCode).toBe(200);
  });

  it("trusted-network caller without credentials GET screenshot → operate_required (predicate), 0 spawns", async () => {
    const { app, children } = await mk();
    const r = await app.inject({ method: "GET", url: "/api/plugins/obs-studio/obs/screenshot", remoteAddress: "192.168.16.220" });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "operate_required" });
    expect(children).toHaveLength(0);
  });

  it("operate bearer reaches the bridge", async () => {
    const { app, children, tokens } = await mk();
    const r = await app.inject({ method: "POST", url: "/api/plugins/obs-studio/obs/record", payload: { on: true }, remoteAddress: "203.0.113.5", headers: { authorization: `Bearer ${tokens.operate}` } });
    expect(r.statusCode).toBe(200);
    expect(children).toHaveLength(1);
  });
});
