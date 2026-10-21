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
import { admissionTrustedNetworks } from "../auth/trust-mode.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { registerPluginRuntimeClientRoutes } from "../routes/plugin-runtime-client-routes.js";
import { useTrustModeHome } from "../test-support/trust-mode-home.js";

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

async function mkApp(opts: { trusted?: string[] | (() => string[]) } = {}): Promise<App> {
  // A fixed list, or a live thunk (the server passes `admissionTrustedNetworks`).
  const fixed = opts.trusted;
  const readTrusted: () => string[] = typeof fixed === "function" ? fixed : () => fixed ?? [];
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
      // add-passkey-user-auth: the auth plugin sets the session's tier claim.
      const tier = req.headers["x-test-tier"];
      if (typeof tier === "string") (req as any).principalTier = tier;
    }
  });
  registerBearerAuth(app, { registry: reg });
  app.addHook(
    "onRequest",
    createRouteTierGate({
      getTrustedNetworks: readTrusted,
      logRefusal: (d) => refusals.push(d),
    }),
  );
  const networkGuard = createNetworkGuard(readTrusted);
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
  // Live-preview HTTP proxy patterns (live-server-proxy.ts). See change: add-passkey-user-auth.
  app.all("/live/:id/*", async () => ({ ok: true }));
  app.all("/live/:id", async () => ({ ok: true }));
  // The REAL runtime-client routes (decouple-plugins-from-core 6.11/6.12), behind the same gate + guard.
  registerPluginRuntimeClientRoutes(app, { networkGuard, broadcast: () => {}, log: { info: () => {} } });
  await app.ready();

  return { app, tokens, restartCalls: () => restart, promptCalls: () => prompt, refusals };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("E81 — runtime-client routes: tiers and the local-only trust grant", () => {
  const REMOTE = "203.0.113.5";

  it("observe bearer reads the listing but is refused DELETE trust at operate", async () => {
    const { app, tokens } = await mkApp();
    const list = await app.inject({ method: "GET", url: "/api/plugins/runtime-clients", remoteAddress: REMOTE, headers: bearer(tokens.observe) });
    expect(list.statusCode).toBe(200);
    const del = await app.inject({ method: "DELETE", url: "/api/plugins/ext/trust", remoteAddress: REMOTE, headers: bearer(tokens.observe) });
    expect(del.statusCode).toBe(403);
    expect(del.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
  });

  it("control bearer is refused POST trust by the tier gate (operate)", async () => {
    const { app, tokens } = await mkApp();
    const res = await app.inject({ method: "POST", url: "/api/plugins/ext/trust", remoteAddress: REMOTE, headers: bearer(tokens.control), payload: { server: true } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
  });

  it("a REMOTE operate bearer is refused POST trust by the handler (local_only), but may DELETE", async () => {
    const { app, tokens } = await mkApp();
    const post = await app.inject({ method: "POST", url: "/api/plugins/ext/trust", remoteAddress: REMOTE, headers: bearer(tokens.operate), payload: { server: true } });
    expect(post.statusCode).toBe(403);
    expect(post.json()).toMatchObject({ success: false, error: "local_only" });
    const del = await app.inject({ method: "DELETE", url: "/api/plugins/ext/trust", remoteAddress: REMOTE, headers: bearer(tokens.operate) });
    expect(del.statusCode).toBe(200);
  });

  it("a tunnel-relayed loopback request (forwarding header) is not local either", async () => {
    const { app, tokens } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/ext/trust",
      remoteAddress: "127.0.0.1",
      headers: { ...bearer(tokens.operate), "x-forwarded-for": "198.51.100.9" },
      payload: { server: true },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "local_only" });
  });
});

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

  // See change: add-passkey-user-auth (oauth-authentication › Session tier claim).
  it("observe cookie session off-host is refused on an operate route", async () => {
    const { app, refusals } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "203.0.113.5",
      headers: { "x-test-cookie": "1", "x-test-tier": "observe" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
    expect(refusals).toHaveLength(1);
  });

  it("observe cookie session off-host still reads observe routes", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/sessions",
      remoteAddress: "203.0.113.5",
      headers: { "x-test-cookie": "1", "x-test-tier": "observe" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("observe session off-host is refused on the /live/ HTTP proxy (needs control)", async () => {
    const { app } = await mkApp();
    for (const url of ["/live/abc", "/live/abc/index.html"]) {
      const res = await app.inject({
        method: "GET",
        url,
        remoteAddress: "203.0.113.5",
        headers: { "x-test-cookie": "1", "x-test-tier": "observe" },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "control" });
    }
  });

  it("control session off-host reaches the /live/ HTTP proxy", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "GET",
      url: "/live/abc/app.js",
      remoteAddress: "203.0.113.5",
      headers: { "x-test-cookie": "1", "x-test-tier": "control" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("operate cookie session off-host reaches operate routes", async () => {
    const { app } = await mkApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "203.0.113.5",
      headers: { "x-test-cookie": "1", "x-test-tier": "operate" },
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

// test-plan #E10 — a relayed-loopback device bearer is NOT exempt from the
// tier gate by a loopback trusted entry. See change: fix-trusted-network-tunnel-bypass.
describe("E10 — device-tier exemption refused for relayed loopback", () => {
  it("relayed loopback + trusted [127.0.0.1]: observe bearer refused at operate", async () => {
    const { app, tokens, restartCalls, refusals } = await mkApp({ trusted: ["127.0.0.1"] });
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "127.0.0.1",
      headers: { ...bearer(tokens.observe), "x-forwarded-for": "203.0.113.9" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
    expect(restartCalls()).toBe(0);
    expect(refusals).toHaveLength(1);
  });

  it("LAN peer in trusted CIDR stays exempt (control)", async () => {
    const { app, tokens, restartCalls } = await mkApp({ trusted: ["192.168.16.0/24"] });
    const res = await app.inject({
      method: "POST",
      url: "/api/restart",
      remoteAddress: "192.168.16.20",
      headers: bearer(tokens.observe),
    });
    expect(res.statusCode).toBe(200);
    expect(restartCalls()).toBe(1);
  });
});

// test-plan #E9 (tier leg) / #E10 — the tier gate's trusted-network exemption
// reads the LIVE admission list: empty under `pair`, so a listed LAN peer's
// observe bearer is tier-refused; under `legacy` it stays exempt.
// See change: retire-trusted-networks-bypass (D1).
describe("E9/E10 — tier exemption follows the trust mode", () => {
  const LIST = ["192.168.16.0/24"];
  const LISTED = "192.168.16.20";
  let th: ReturnType<typeof useTrustModeHome>;
  beforeEach(() => {
    th = useTrustModeHome();
  });
  afterEach(() => {
    th.restore();
  });

  const restart = (app: FastifyInstance, token: string) =>
    app.inject({ method: "POST", url: "/api/restart", remoteAddress: LISTED, headers: bearer(token) });

  it("E9: pair — listed peer's observe bearer on POST /api/restart → 403 insufficient_scope", async () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    const { app, tokens, restartCalls, refusals } = await mkApp({ trusted: () => admissionTrustedNetworks() });
    const res = await restart(app, tokens.observe);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "insufficient_scope", scope: "operate" });
    expect(res.headers["www-authenticate"]).toContain("insufficient_scope");
    expect(restartCalls()).toBe(0);
    expect(refusals).toHaveLength(1);
  });

  it("E9: legacy — listed peer's observe bearer is NOT tier-refused (exempt)", async () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    const { app, tokens, restartCalls, refusals } = await mkApp({ trusted: () => admissionTrustedNetworks() });
    const res = await restart(app, tokens.observe);
    expect(res.statusCode).toBe(200);
    expect(restartCalls()).toBe(1);
    expect(refusals).toHaveLength(0);
  });

  it("E9: pair — an operate bearer from the listed peer is still admitted (tier suffices)", async () => {
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    const { app, tokens } = await mkApp({ trusted: () => admissionTrustedNetworks() });
    expect((await restart(app, tokens.operate)).statusCode).toBe(200);
  });

  it("E10: a mode change applies to the next request on the same app (no restart)", async () => {
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    const { app, tokens } = await mkApp({ trusted: () => admissionTrustedNetworks() });
    expect((await restart(app, tokens.observe)).statusCode).toBe(200);
    th.setTrustConfig({ trustMode: "pair", trustedNetworks: LIST });
    expect((await restart(app, tokens.observe)).statusCode).toBe(403);
    th.setTrustConfig({ trustMode: "legacy", trustedNetworks: LIST });
    expect((await restart(app, tokens.observe)).statusCode).toBe(200);
  });
});
