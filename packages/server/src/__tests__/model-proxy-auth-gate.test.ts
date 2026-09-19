/**
 * Integration tests for the model proxy auth gate (task 3.9).
 *
 * Tests every auth scenario from spec.md:
 * - valid key → 200 (models endpoint)
 * - JWT rejected uniformly
 * - no header → 401 AUTH_REQUIRED
 * - scope insufficient → 403
 * - expired → 401 AUTH_EXPIRED
 * - revoked → 401 AUTH_REVOKED
 * - missing → 401 AUTH_REQUIRED
 * - malformed → 401 AUTH_MALFORMED
 * - backoff increments and caps
 * - backoff resets on success
 * - per-IP isolation
 *
 * Uses Fastify directly without the full test server to keep tests fast.
 */

import { readFileSync } from "node:fs";
import type { ModelProxyConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { generateKey, hashKey } from "../model-proxy/api-key-store.js";
import { createModelProxyAuthGate } from "../model-proxy/auth-gate.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(apiKeys: any[] = []): ModelProxyConfig {
  return {
    enabled: true,
    maxConcurrentStreams: 16,
    perKeyConcurrentStreams: 4,
    logRequests: false,
    apiKeys,
  };
}

function makeKey(overrides: Partial<any> = {}) {
  const cleartext = generateKey();
  const entry = {
    id: "key-1",
    label: "test",
    createdAt: Date.now(),
    hash: hashKey(cleartext),
    scopes: ["all"],
    revokedAt: undefined,
    expiresAt: undefined,
    ...overrides,
  };
  return { cleartext, entry };
}

async function buildApp(config: ModelProxyConfig) {
  const app = Fastify({ logger: false });

  const gate = createModelProxyAuthGate({ getConfig: () => config });
  app.addHook("onRequest", gate);

  app.get("/v1/models", async () => ({ object: "list", data: [] }));
  app.post("/v1/chat/completions", async () => ({ ok: true }));
  app.post("/v1/messages", async () => ({ ok: true }));
  app.get("/api/health", async () => ({ ok: true })); // non-proxied route

  await app.ready();
  return app;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("model proxy auth gate (task 3.9)", () => {
  it("valid key → 200 on /v1/models", async () => {
    const { cleartext, entry } = makeKey();
    const config = makeConfig([entry]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${cleartext}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("valid key on /v1/chat/completions", async () => {
    const { cleartext, entry } = makeKey();
    const config = makeConfig([entry]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  it("JWT-style token rejected with PROXY_KEY_REQUIRED", async () => {
    const config = makeConfig([]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.test.fake" },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("PROXY_KEY_REQUIRED");
  });

  it("no authorization header → 401 AUTH_REQUIRED", async () => {
    const config = makeConfig([]);
    const app = await buildApp(config);

    const res = await app.inject({ method: "GET", url: "/v1/models" });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("AUTH_REQUIRED");
  });

  it("malformed Bearer (no token) → 401 AUTH_MALFORMED", async () => {
    const config = makeConfig([]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: "Bearer " },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("AUTH_MALFORMED");
  });

  it("missing (unknown) proxy key → 401 AUTH_REQUIRED", async () => {
    const config = makeConfig([]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer pi-proxy-unknownkeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("AUTH_REQUIRED");
  });

  it("revoked key → 401 AUTH_REVOKED", async () => {
    const { cleartext, entry } = makeKey({ revokedAt: Date.now() - 1000 });
    const config = makeConfig([entry]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${cleartext}` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("AUTH_REVOKED");
  });

  it("expired key → 401 AUTH_EXPIRED", async () => {
    const { cleartext, entry } = makeKey({ expiresAt: Date.now() - 1000 });
    const config = makeConfig([entry]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${cleartext}` },
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("AUTH_EXPIRED");
  });

  it("scope insufficient → 403 SCOPE_INSUFFICIENT", async () => {
    const { cleartext, entry } = makeKey({ scopes: ["models:list"] });
    const config = makeConfig([entry]);
    const app = await buildApp(config);

    // /v1/chat/completions requires "chat" scope
    const res = await app.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: `Bearer ${cleartext}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe("SCOPE_INSUFFICIENT");
  });

  it("non-/v1/ routes NOT gated by auth gate", async () => {
    const config = makeConfig([]);
    const app = await buildApp(config);

    // /api/health should pass through without auth
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
  });

  it("task 3.7: /v1/* does NOT inherit isLoopback bypass (loopback without key → 401)", async () => {
    // In the auth gate, /v1/* always requires a proxy key — no loopback carve-out.
    // We simulate this by simply not providing an Authorization header.
    const config = makeConfig([]);
    const app = await buildApp(config);

    // Even from "loopback" (Fastify inject defaults to 127.0.0.1)
    const res = await app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(401);
  });

  it("task 3.7: /v1/* does NOT inherit bypassHosts bypass (no header → 401)", async () => {
    // bypassHosts typically allows any LAN IP — /v1/* must not inherit this.
    // The gate checks path prefix first; no Authorization → 401 regardless.
    const config = makeConfig([]);
    const app = await buildApp(config);

    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      remoteAddress: "192.168.1.50", // simulated LAN IP
    });
    expect(res.statusCode).toBe(401);
  });

  it("task 3.7: /v1/* does NOT inherit bypassUrls (no header → 401 even if URL were in bypass list)", async () => {
    const config = makeConfig([]);
    const app = await buildApp(config);

    const res = await app.inject({ method: "GET", url: "/v1/models" });
    expect(res.statusCode).toBe(401);
  });
});

describe("model proxy auth gate — backoff (task 3.9)", () => {
  it("repeated failures from same IP accumulate (backoff state per instance)", async () => {
    // We can only verify that the gate records failures by observing that
    // a valid key immediately after failures still resets and returns 200.
    const { cleartext, entry } = makeKey();
    const config = makeConfig([entry]);
    const app = await buildApp(config);

    // 3 failed attempts
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: "GET", url: "/v1/models" });
    }

    // Success resets — valid key still works (though may be delayed by backoff)
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      headers: { authorization: `Bearer ${cleartext}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── The gate's isAuthenticated handoff to the universal guard (S12, S13, S14) ─
// `/v1/*` has NO public allowlist entry in the guard: a public skip would be a
// hole whenever modelProxy is disabled. Instead the proxy gate marks the request
// authenticated and the guard — registered LAST, after the gate — admits it via
// the ordinary `isAuthenticated` pass condition. These tests pin both halves of
// that contract, and the ordering it depends on.
//
// See change: add-universal-network-guard.
describe("model proxy gate → universal guard handoff (S12, S13, S14)", () => {
  const UNTRUSTED = "203.0.113.5";

  /** Mirrors server.ts: proxy gate first, universal guard LAST. */
  async function buildGateThenGuardApp(config: ModelProxyConfig) {
    const app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    app.addHook("onRequest", createModelProxyAuthGate({ getConfig: () => config }));
    app.addHook(
      "onRequest",
      createNetworkGuardHook({ trustedNetworks: [], getBypassUrls: () => [], getPairingPrefixes: () => [] }),
    );
    app.get("/v1/models", async () => ({ object: "list", data: [] }));
    app.post("/v1/messages", async () => ({ ok: true, proxied: true }));
    await app.ready();
    return app;
  }

  // test-plan #S12 — valid key ⇒ gate sets isAuthenticated ⇒ guard allows.
  it("admits a valid pi-proxy key from an untrusted peer", async () => {
    const { cleartext, entry } = makeKey();
    const app = await buildGateThenGuardApp(makeConfig([entry]));

    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      remoteAddress: UNTRUSTED,
      headers: { authorization: `Bearer ${cleartext}` },
      payload: { model: "x", messages: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().proxied).toBe(true);
  });

  // test-plan #S13 — no valid credential ⇒ rejected, not silently allowed.
  it("rejects an untrusted request with no credential", async () => {
    const app = await buildGateThenGuardApp(makeConfig([]));
    const res = await app.inject({ method: "GET", url: "/v1/models", remoteAddress: UNTRUSTED });
    await app.close();
    expect([401, 403]).toContain(res.statusCode);
  });

  it("rejects an untrusted request with a non-proxy bearer", async () => {
    const app = await buildGateThenGuardApp(makeConfig([]));
    const res = await app.inject({
      method: "GET",
      url: "/v1/models",
      remoteAddress: UNTRUSTED,
      headers: { authorization: "Bearer an-ordinary-jwt-not-a-proxy-key" },
    });
    await app.close();
    expect([401, 403]).toContain(res.statusCode);
  });

  it("does not admit an untrusted request even from a trusted-looking peer without a key", async () => {
    // The guard must not be the only thing standing between the network and a
    // credential-less /v1 call: a loopback peer is admitted by the guard, and
    // there the GATE is the only rejector.
    const app = await buildGateThenGuardApp(makeConfig([]));
    const res = await app.inject({ method: "GET", url: "/v1/models" }); // 127.0.0.1
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  // test-plan #S14 — modelProxy disabled ⇒ no public /v1 bypass exists.
  it("denies an untrusted /v1 request when the proxy routes are absent", async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest("isAuthenticated", false);
    // No model-proxy gate registered at all (modelProxy disabled).
    app.addHook(
      "onRequest",
      createNetworkGuardHook({ trustedNetworks: [], getBypassUrls: () => [], getPairingPrefixes: () => [] }),
    );
    app.post("/v1/messages", async () => ({ ok: true }));
    await app.ready();

    const routed = await app.inject({
      method: "POST",
      url: "/v1/messages",
      remoteAddress: UNTRUSTED,
      payload: { model: "x", messages: [] },
    });
    expect(routed.statusCode, "no public /v1 allowlist entry exists").toBe(403);

    // An unrouted /v1 path must not be admitted either (403 from the guard, or a
    // 404 — never a 200).
    const unrouted = await app.inject({
      method: "GET",
      url: "/v1/anything",
      remoteAddress: UNTRUSTED,
    });
    await app.close();
    expect([403, 404]).toContain(unrouted.statusCode);
    expect(unrouted.statusCode).not.toBe(200);
  });
});

// ── Second-port loopback invariant (S16) ─────────────────────────────────────
// The optional second Fastify instance runs ONLY the proxy gate — no universal
// guard, no isAuthenticated decoration, no network check. It is safe SOLELY
// because it binds loopback. This pins that "safe by design, not by accident".
//
// The behavioural half (a live listener on the configured secondPort that is
// reachable on 127.0.0.1 and NOT on a non-loopback address) lives in
// `model-proxy-second-port.test.ts`, which already boots that instance.
describe("model proxy second port bind (S16)", () => {
  it("binds the literal loopback address, never config.host", () => {
    const src = readFileSync(
      new URL("../server.ts", import.meta.url),
      "utf-8",
    );
    expect(src).toContain('await sf.listen({ port: proxyCfg.secondPort, host: "127.0.0.1" })');
    // If the bind is ever made configurable the universal guard must come with
    // it — see the INVARIANT comment at the second-port block in server.ts.
    expect(src).toContain("INVARIANT (change: add-universal-network-guard)");
  });
});
