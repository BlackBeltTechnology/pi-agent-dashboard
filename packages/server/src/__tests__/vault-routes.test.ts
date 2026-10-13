/**
 * Vault route authority: management routes need operate or a locally trusted
 * caller (reads included); the session binding-state read follows session-read
 * authority; no response carries a value.
 * See change: add-credential-vault (test-plan X12).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createLocalTrustContext } from "../auth/local-proof.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { createVaultImport } from "../vault/vault-import.js";
import { registerVaultRoutes } from "../vault/vault-routes.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";

let dir: string;
let store: VaultStore;
const apps: FastifyInstance[] = [];
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-routes-")); store = createVaultStore(path.join(dir, "vault.json")); });
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const TRUSTED = "198.51.100.0/24";

async function mkApp(strict: boolean, opts: { loginAvailable?: () => boolean; trusted?: string } = {}) {
  const trusted = opts.trusted ?? TRUSTED;
  const reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
  const tokens = {
    observe: reg.add("o", "manual", "observe").token,
    control: reg.add("c", "manual", "control").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  const localTrust = createLocalTrustContext("local-token-xyz", () => strict);
  const app = Fastify();
  apps.push(app);
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  // Test-only: stamp a session / principal marker the real auth plugin / identity
  // resolver would set, so admission of those callers is exercised without them.
  app.addHook("onRequest", async (request) => {
    const via = request.headers["x-test-auth-via"];
    if (typeof via === "string") (request as unknown as { authVia?: string }).authVia = via;
  });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [trusted], localTrust, logRefusal: () => {} }));
  registerVaultRoutes(app, {
    store,
    importer: createVaultImport({ store, candidates: () => [] }),
    networkGuard: createNetworkGuard([trusted], { localTrust }),
    localTrust,
    loginAvailable: opts.loginAvailable ?? (() => false),
    getSessionBindingState: (id) => (id === "s1" ? { bindings: [{ name: "GEMINI_API_KEY", state: "delivered" }], lastContactAt: 1 } : undefined),
  });
  await app.ready();
  return { app, tokens, reg };
}

const add = { provider: "gemini", label: "personal", value: "abcdefgh12" };

describe("X12 — who may use the vault", () => {
  it.each([
    ["loopback", false, "127.0.0.1", undefined, true],
    ["loopback under strict mode without proof", true, "127.0.0.1", undefined, false],
    ["observe bearer, off-host", false, "203.0.113.5", "observe", false],
    ["observe bearer on loopback (tier-gate exempt)", false, "127.0.0.1", "observe", false],
    ["operate bearer", false, "203.0.113.5", "operate", true],
  ] as const)("%s → %s", async (_l, strict, remoteAddress, tier, allowed) => {
    const { app, tokens } = await mkApp(strict);
    const headers = tier ? { authorization: `Bearer ${tokens[tier]}` } : {};
    const list = await app.inject({ method: "GET", url: "/api/vault", remoteAddress, headers });
    const create = await app.inject({ method: "POST", url: "/api/vault/accounts", remoteAddress, headers, payload: add });
    if (allowed) {
      expect(list.statusCode, list.body).toBe(200);
      expect(create.statusCode, create.body).toBe(200);
      expect(list.body + create.body).not.toContain("abcdefgh12");
      expect((await store.listAccounts())).toHaveLength(1);
    } else {
      expect([401, 403]).toContain(list.statusCode);
      expect([401, 403]).toContain(create.statusCode);
      expect(fs.existsSync(store.filePath)).toBe(false);
    }
  });

  it("an observe bearer may read a session's binding state", async () => {
    const { app, tokens } = await mkApp(false);
    const res = await app.inject({
      method: "GET", url: "/api/session/s1/vault-bindings", remoteAddress: "203.0.113.5",
      headers: { authorization: `Bearer ${tokens.observe}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toEqual({ bindings: [{ name: "GEMINI_API_KEY", state: "delivered" }], lastContactAt: 1 });
    const none = await app.inject({
      method: "GET", url: "/api/session/zz/vault-bindings", remoteAddress: "203.0.113.5",
      headers: { authorization: `Bearer ${tokens.observe}` },
    });
    expect(none.statusCode).toBe(404);
  });
});

describe("vault routes — management surface", () => {
  it("full lifecycle never returns a value", async () => {
    const { app } = await mkApp(false);
    const send = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
      app.inject({ method, url, remoteAddress: "127.0.0.1", payload: payload as object | undefined });
    const acc = (await send("POST", "/api/vault/accounts", add)).json().data as { id: string };
    expect((await send("POST", "/api/vault/bindings", { name: "GEMINI_API_KEY", defaultAccountId: acc.id })).statusCode).toBe(200);
    expect((await send("POST", "/api/vault/bindings", { name: "PATH" })).statusCode).toBe(400);
    expect((await send("POST", "/api/vault/grants", { subject: "dir:hub:/p", bindingName: "GEMINI_API_KEY" })).statusCode).toBe(200);
    expect((await send("PUT", `/api/vault/accounts/${acc.id}/value`, { value: "rotated-value-1" })).statusCode).toBe(200);
    const all = await send("GET", "/api/vault");
    expect(all.body).not.toContain("abcdefgh12");
    expect(all.body).not.toContain("rotated-value-1");
    expect(store.getKeyValue(acc.id)).toBe("rotated-value-1");
    expect((await send("DELETE", `/api/vault/accounts/${acc.id}`)).statusCode).toBe(200);
    const after = (await send("GET", "/api/vault")).json().data as { grants: Array<{ state: string }> };
    expect(after.grants[0].state).toBe("no-account");
  });

  it("a corrupt vault answers 503-style status without content", async () => {
    fs.writeFileSync(store.filePath, '{"a":"sk-live-ABCDEFGH');
    const { app } = await mkApp(false);
    const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: "127.0.0.1" });
    expect(res.json().data.status.state).toBe("corrupt");
    expect(res.body).not.toContain("sk-live");
    const write = await app.inject({ method: "POST", url: "/api/vault/accounts", remoteAddress: "127.0.0.1", payload: add });
    expect(write.statusCode).toBe(409);
    expect(write.body).not.toContain("sk-live");
  });
});

// ── surface-operate-required-remedy ───────────────────────────────────────
// The refusal carries a reason and remedies; admission is unchanged.
describe("operate_required refusal body", () => {
  const LAN = "198.51.100.7";
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  const vaultNoCred = "the vault needs an operate-tier credential or a locally trusted caller";
  const vaultLow = "the vault needs an operate-tier credential; this device's credential has a lower tier";

  it("E5 trusted-network browser, no credential → no-credential / use-host, no data", async () => {
    const { app } = await mkApp(false);
    const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: LAN });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ success: false, error: "operate_required", message: vaultNoCred, reason: "no-credential", remedies: ["use-host"] });
  });

  it("E6 trusted-network control bearer → tier-too-low / use-host + re-pair", async () => {
    const { app, tokens } = await mkApp(false);
    const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: LAN, headers: bearer(tokens.control) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "operate_required", message: vaultLow, reason: "tier-too-low", remedies: ["use-host", "re-pair"] });
  });

  it("E7 observe bearer on the host → tier-too-low / re-pair only", async () => {
    const { app, tokens } = await mkApp(false);
    const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: "127.0.0.1", headers: bearer(tokens.observe) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ reason: "tier-too-low", remedies: ["re-pair"] });
  });

  it("E8 a revoked bearer counts as no credential", async () => {
    const { app, reg } = await mkApp(false);
    const { device, token } = reg.add("gone", "manual", "operate");
    reg.revoke(device.id);
    const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: LAN, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ reason: "no-credential", remedies: ["use-host"] });
  });

  it("E9 off-network low tier keeps the insufficient_scope refusal", async () => {
    const { app, tokens } = await mkApp(false);
    for (const t of ["observe", "control"] as const) {
      const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: "203.0.113.5", headers: bearer(tokens[t]) });
      expect(res.statusCode).toBe(403);
      expect(res.headers["www-authenticate"]).toContain("insufficient_scope");
      expect(res.body).not.toContain("operate_required");
      expect(res.json()).not.toHaveProperty("remedies");
    }
  });

  it("E10 sign-in follows the real composition: empty clientId → none, then a usable provider", async () => {
    const { buildLoginAvailable } = await import("../auth/auth-plugin.js");
    let usable = false;
    const loginAvailable = buildLoginAvailable(() => usable, null, { enforced: () => false, loginConfigs: () => [] });
    const { app } = await mkApp(false, { loginAvailable });
    const first = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: LAN });
    expect(first.json().remedies).toEqual(["use-host"]);
    usable = true; // live: no restart, same app
    const second = await app.inject({ method: "GET", url: "/api/vault", remoteAddress: LAN });
    expect(second.json().remedies).toEqual(["use-host", "sign-in"]);
  });

  it("E11 admission unchanged: operate bearer, session, principal, loopback all get 200", async () => {
    const { app, tokens } = await mkApp(false);
    const cases: Array<[string, string, Record<string, string>]> = [
      ["operate bearer", LAN, bearer(tokens.operate)],
      ["operator session (claim-less)", LAN, { "x-test-auth-via": "session" }],
      ["identity principal", LAN, { "x-test-auth-via": "principal" }],
      ["loopback, strict off", "127.0.0.1", {}],
    ];
    for (const [label, remoteAddress, headers] of cases) {
      const res = await app.inject({ method: "GET", url: "/api/vault", remoteAddress, headers });
      expect(res.statusCode, label).toBe(200);
      expect(res.json().data, label).toHaveProperty("accounts");
    }
  });

  it("E13 every guarded vault family refuses with remedies; the session read is unaffected", async () => {
    const { app } = await mkApp(false);
    const families: Array<[("GET" | "POST" | "PUT" | "DELETE"), string]> = [
      ["GET", "/api/vault"],
      ["POST", "/api/vault/accounts"],
      ["PUT", "/api/vault/accounts/a1/value"],
      ["DELETE", "/api/vault/accounts/a1"],
      ["POST", "/api/vault/bindings"],
      ["PUT", "/api/vault/bindings/X/default"],
      ["DELETE", "/api/vault/bindings/X"],
      ["POST", "/api/vault/grants"],
      ["DELETE", "/api/vault/grants"],
      ["POST", "/api/vault/confirmations"],
      ["DELETE", "/api/vault/confirmations"],
      ["PUT", "/api/vault/plugin-approvals/p/X"],
      ["DELETE", "/api/vault/plugin-approvals/p/X"],
      ["GET", "/api/vault/import/candidates"],
      ["POST", "/api/vault/import/propose"],
      ["POST", "/api/vault/import/confirm"],
    ];
    for (const [method, url] of families) {
      const res = await app.inject({ method, url, remoteAddress: LAN, payload: method === "GET" || method === "DELETE" ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json(), `${method} ${url}`).toMatchObject({ error: "operate_required", remedies: ["use-host"] });
    }
    const read = await app.inject({ method: "GET", url: "/api/session/s1/vault-bindings", remoteAddress: LAN });
    expect(read.statusCode).toBe(200);
  });

  it("X1 the body discloses nothing beyond the five keys and the caller's own position", async () => {
    const { app, tokens, reg } = await mkApp(false, { trusted: "192.168.16.0/24", loginAvailable: () => true });
    const { device, token } = reg.add("robson-mbp", "manual", "control");
    expect(device.id).toBeTruthy();
    await store.addAccount({ provider: "gemini", label: "work-account-label", value: "abcdefgh12" });
    const bodies = [
      await app.inject({ method: "GET", url: "/api/vault", remoteAddress: "192.168.16.220" }),
      await app.inject({ method: "GET", url: "/api/vault", remoteAddress: "192.168.16.220", headers: bearer(token) }),
      await app.inject({ method: "GET", url: "/api/vault", remoteAddress: "192.168.16.220", headers: bearer(tokens.control) }),
    ];
    for (const res of bodies) {
      expect(res.statusCode).toBe(403);
      expect(Object.keys(res.json()).sort()).toEqual(["error", "message", "reason", "remedies", "success"]);
      for (const leak of ["192.168.", "/24", "localhost", device.id, "robson-mbp", "work-account-label", "abcdefgh12", "GEMINI_API_KEY"]) {
        expect(res.body).not.toContain(leak);
      }
    }
  });
});
