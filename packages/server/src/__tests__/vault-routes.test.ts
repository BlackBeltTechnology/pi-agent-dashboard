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

async function mkApp(strict: boolean) {
  const reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
  const tokens = {
    observe: reg.add("o", "manual", "observe").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  const localTrust = createLocalTrustContext("local-token-xyz", () => strict);
  const app = Fastify();
  apps.push(app);
  await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [TRUSTED], localTrust, logRefusal: () => {} }));
  registerVaultRoutes(app, {
    store,
    importer: createVaultImport({ store, candidates: () => [] }),
    networkGuard: createNetworkGuard([TRUSTED], { localTrust }),
    localTrust,
    getSessionBindingState: (id) => (id === "s1" ? { bindings: [{ name: "GEMINI_API_KEY", state: "delivered" }], lastContactAt: 1 } : undefined),
  });
  await app.ready();
  return { app, tokens };
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
