/**
 * `POST /api/plugins/flows/control` behind the REAL host tier gate, bearer
 * auth, network guard and plugin operate-authority predicate.
 * See change: update-flows-plugin (D2; test-plan E37, G4, G16).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../../../server/src/auth/bearer-auth.js";
import { createLocalTrustContext } from "../../../server/src/auth/local-proof.js";
import { createNetworkGuard } from "../../../server/src/auth/localhost-guard.js";
import { createRouteTierGate } from "../../../server/src/auth/route-tier-gate.js";
import { createPluginIdentity } from "../../../server/src/identity/plugin-identity.js";
import { PairedDeviceRegistry } from "../../../server/src/pairing/paired-devices.js";
import { registerFlowControlRoute } from "../server/flow-control.js";

const apps: FastifyInstance[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

async function mk() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flows-ctl-route-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "flows-ctl-home-"));
  const cwdOn = fs.mkdtempSync(path.join(os.tmpdir(), "flows-ctl-on-"));
  const cwdOff = fs.mkdtempSync(path.join(os.tmpdir(), "flows-ctl-off-"));
  dirs.push(dir, home, cwdOn, cwdOff);
  fs.mkdirSync(path.join(cwdOn, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwdOn, ".pi", "settings.json"), JSON.stringify({ flows: { editFlow: true } }));
  const reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
  const tokens = { observe: reg.add("o", "manual", "observe").token, operate: reg.add("p", "manual", "operate").token };
  const trusted = ["192.168.16.0/24"];
  const identity = createPluginIdentity("flows", {
    isEnforced: () => false,
    principalOfRequest: () => null,
    resolveUpgrade: async () => null,
    policy: { authorize: async () => true },
    pluginDataRoot: (id) => path.join(dir, id),
    localTrust: createLocalTrustContext("tok", () => false),
  });
  const sessions: Record<string, { id: string; cwd: string; driver?: string }> = {
    p1: { id: "p1", cwd: cwdOn },
    off: { id: "off", cwd: cwdOff },
    a1: { id: "a1", cwd: cwdOn, driver: "acp" },
  };
  const emitEventToSession = vi.fn(() => true);
  const recordRejectedAction = vi.fn();
  const app = Fastify();
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => trusted, logRefusal: () => {} }));
  await registerFlowControlRoute({
    fastify: app,
    networkGuard: createNetworkGuard(trusted) as never,
    hasOperateAuthority: (req) => identity.hasOperateAuthority(req),
    sessionManager: {
      listActive: () => Object.values(sessions),
      getSession: (id: string) => sessions[id],
    },
    broadcastToSubscribers: vi.fn(),
    emitEventToSession,
    home,
    logger: { info: vi.fn(), warn: vi.fn() },
    recordRejectedAction,
  });
  await app.ready();
  apps.push(app);
  const post = (body: Record<string, unknown>, auth?: "observe" | "operate", remoteAddress = "203.0.113.5") =>
    app.inject({
      method: "POST",
      url: "/api/plugins/flows/control",
      payload: body,
      remoteAddress,
      headers: auth ? { authorization: `Bearer ${tokens[auth]}` } : {},
    });
  const emits = () => emitEventToSession.mock.calls.map((c) => [c[0], c[1], c[2]]);
  return { post, emits, emitEventToSession, recordRejectedAction };
}

describe("flows control route (E37)", () => {
  it("operate abort → 200 + two emits", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "p1", action: "flow.abort" }, "operate");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ success: true });
    expect(t.emits()).toEqual([
      ["p1", "flow:abort", {}],
      ["p1", "flow:architect-abort", {}],
    ]);
  });

  it("run relays flowName + task", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "p1", action: "flow.run", flowName: "research", task: "Find bugs" }, "operate");
    expect(r.statusCode).toBe(200);
    expect(t.emits()).toEqual([["p1", "flow:run", { flowName: "research", task: "Find bugs" }]]);
  });

  it("set-edit-mode emits only when the effective value differs (G16)", async () => {
    const t = await mk();
    expect((await t.post({ sessionId: "p1", action: "flow.set-edit-mode", enabled: false }, "operate")).statusCode).toBe(200);
    expect(t.emits()).toEqual([["p1", "flow:set-edit-mode", { enabled: false }]]);
    t.emitEventToSession.mockClear();
    expect((await t.post({ sessionId: "off", action: "flow.set-edit-mode", enabled: false }, "operate")).statusCode).toBe(200);
    expect(t.emits()).toEqual([]);
  });

  it("unknown action → 400, nothing emitted", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "p1", action: "flow.rename" }, "operate");
    expect(r.statusCode).toBe(400);
    expect(t.emitEventToSession).not.toHaveBeenCalled();
    expect(t.recordRejectedAction).toHaveBeenCalledTimes(1);
  });

  it("observe bearer → 403 insufficient_scope (tier gate), nothing emitted", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "p1", action: "flow.abort" }, "observe");
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ error: "insufficient_scope" });
    expect(t.emitEventToSession).not.toHaveBeenCalled();
  });

  it("trusted-network caller without credentials → 403 (operate predicate), nothing emitted", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "p1", action: "flow.abort" }, undefined, "192.168.16.220");
    expect(r.statusCode).toBe(403);
    expect(t.emitEventToSession).not.toHaveBeenCalled();
  });

  it("ACP session → 409 unsupported_for_acp, nothing emitted", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "a1", action: "flow.abort" }, "operate");
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: "unsupported_for_acp" });
    expect(t.emitEventToSession).not.toHaveBeenCalled();
  });

  it("unknown session → 404, nothing emitted", async () => {
    const t = await mk();
    const r = await t.post({ sessionId: "nope", action: "flow.abort" }, "operate");
    expect(r.statusCode).toBe(404);
    expect(t.emitEventToSession).not.toHaveBeenCalled();
  });

  it("relay not delivered still answers 200 (G9, X6)", async () => {
    const t = await mk();
    t.emitEventToSession.mockReturnValue(false);
    const r = await t.post({ sessionId: "p1", action: "flow.abort" }, "operate");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ success: true });
  });
});
