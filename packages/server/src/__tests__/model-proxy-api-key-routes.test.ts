/**
 * Tests for model proxy API key management routes (task 4.3).
 *
 * Covers:
 * - list: redaction, createdBy filter, admin sees all
 * - create: cleartext once, hashed storage, default scopes, custom scopes, past expiresAt → 400
 * - revoke: sets revokedAt, 404 on unknown, 403 non-owner non-admin, 204 admin on others
 * - purge (DELETE): removes entry, list excludes purged
 */

import type { ModelProxyConfig, ProxyApiKey } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it } from "vitest";
import { generateKey, hashKey, verifyKey } from "../model-proxy/api-key-store.js";
import { registerModelProxyApiKeyRoutes } from "../routes/model-proxy-api-key-routes.js";

// ── Test fixture ────────────────────────────────────────────────────────────

function makeEntry(id: string, label: string, createdBy: string, overrides: Partial<ProxyApiKey> = {}): ProxyApiKey {
  return {
    id,
    label,
    createdAt: Date.now(),
    hash: hashKey(generateKey()),
    scopes: ["all"],
    createdBy,
    ...overrides,
  };
}

async function buildApp(
  apiKeys: ProxyApiKey[] = [],
  userEmail = "alice@test.com",
  adminEmail?: string,
) {
  const app = Fastify({ logger: false });
  let config: ModelProxyConfig = {
    enabled: true,
    maxConcurrentStreams: 16,
    perKeyConcurrentStreams: 4,
    logRequests: false,
    apiKeys: [...apiKeys],
  };

  const writes: ProxyApiKey[][] = [];

  app.addHook("onRequest", async (req) => { (req as any).user = { email: userEmail }; });
  const networkGuard = async () => {};

  registerModelProxyApiKeyRoutes(app, {
    networkGuard,
    getModelProxyConfig: () => config,
    writeModelProxyApiKeys: async (keys) => { config = { ...config, apiKeys: keys }; writes.push(keys); },
    getAdminEmail: () => adminEmail,
  });

  await app.ready();
  return { app, writes, getConfig: () => config };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("list: GET /api/model-proxy/api-keys (task 4.3)", () => {
  it("hashes are redacted (shown as ***)", async () => {
    const key = makeEntry("k1", "Test", "alice@test.com");
    const { app } = await buildApp([key]);

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(res.body);
    expect(body.data.keys[0].hash).toBe("***");
  });

  it("filters list to createdBy === caller", async () => {
    const aliceKey = makeEntry("k1", "Alice", "alice@test.com");
    const bobKey = makeEntry("k2", "Bob", "bob@test.com");
    const { app } = await buildApp([aliceKey, bobKey], "alice@test.com");

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(res.body);
    const ids = body.data.keys.map((k: any) => k.id);
    expect(ids).toContain("k1");
    expect(ids).not.toContain("k2");
  });

  it("admin sees all keys", async () => {
    const aliceKey = makeEntry("k1", "Alice", "alice@test.com");
    const bobKey = makeEntry("k2", "Bob", "bob@test.com");
    const { app } = await buildApp([aliceKey, bobKey], "admin@test.com", "admin@test.com");

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(res.body);
    const ids = body.data.keys.map((k: any) => k.id);
    expect(ids).toContain("k1");
    expect(ids).toContain("k2");
  });

  it("revoked keys appear in revoked[] not keys[]", async () => {
    const active = makeEntry("k1", "Active", "alice@test.com");
    const revoked = makeEntry("k2", "Revoked", "alice@test.com", { revokedAt: Date.now() - 1000 });
    const { app } = await buildApp([active, revoked]);

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(res.body);
    expect(body.data.keys.map((k: any) => k.id)).toContain("k1");
    expect(body.data.revoked.map((k: any) => k.id)).toContain("k2");
    expect(body.data.keys.map((k: any) => k.id)).not.toContain("k2");
  });
});

describe("create: POST /api/model-proxy/api-keys (task 4.3)", () => {
  it("returns cleartext key once", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "My Key" }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.key).toMatch(/^pi-proxy-/);
  });

  it("persists hashed (not cleartext)", async () => {
    const { app, getConfig } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "My Key" }),
    });

    const created = JSON.parse(res.body).data;
    const stored = getConfig().apiKeys.find((k) => k.id === created.id);
    expect(stored).toBeDefined();
    expect(stored!.hash).not.toBe(created.key);
    // Verify the stored hash matches the cleartext key
    expect(verifyKey(created.key, stored!.hash)).toBe(true);
  });

  it("stamps createdBy from user email", async () => {
    const { app, getConfig } = await buildApp([], "creator@test.com");

    await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Key" }),
    });

    const stored = getConfig().apiKeys[0];
    expect(stored.createdBy).toBe("creator@test.com");
  });

  it("default scopes is [\"all\"]", async () => {
    const { app, getConfig } = await buildApp();

    await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Key" }),
    });

    expect(getConfig().apiKeys[0].scopes).toEqual(["all"]);
  });

  it("custom scopes are persisted", async () => {
    const { app, getConfig } = await buildApp();

    await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Key", scopes: ["models:list", "chat"] }),
    });

    expect(getConfig().apiKeys[0].scopes).toEqual(["models:list", "chat"]);
  });

  it("past expiresAt → 400", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Key", expiresAt: Date.now() - 1000 }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("missing label → 400", async () => {
    const { app } = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });
});

describe("revoke: POST /api/model-proxy/api-keys/:id/revoke (task 4.3)", () => {
  it("sets revokedAt", async () => {
    const key = makeEntry("k1", "Key", "alice@test.com");
    const { app, getConfig } = await buildApp([key]);

    const res = await app.inject({ method: "POST", url: "/api/model-proxy/api-keys/k1/revoke" });

    expect(res.statusCode).toBe(204);
    expect(getConfig().apiKeys[0].revokedAt).toBeDefined();
  });

  it("unknown id → 404", async () => {
    const { app } = await buildApp();

    const res = await app.inject({ method: "POST", url: "/api/model-proxy/api-keys/unknown/revoke" });
    expect(res.statusCode).toBe(404);
  });

  it("revoke other user's key as non-admin → 403", async () => {
    const bobKey = makeEntry("k1", "Bob Key", "bob@test.com");
    const { app } = await buildApp([bobKey], "alice@test.com");

    const res = await app.inject({ method: "POST", url: "/api/model-proxy/api-keys/k1/revoke" });
    expect(res.statusCode).toBe(403);
  });

  it("admin can revoke other user's key → 204", async () => {
    const bobKey = makeEntry("k1", "Bob Key", "bob@test.com");
    const { app } = await buildApp([bobKey], "admin@test.com", "admin@test.com");

    const res = await app.inject({ method: "POST", url: "/api/model-proxy/api-keys/k1/revoke" });
    expect(res.statusCode).toBe(204);
  });
});

describe("purge: DELETE /api/model-proxy/api-keys/:id (task 4.3)", () => {
  it("purge after revoke removes entry", async () => {
    const key = makeEntry("k1", "Key", "alice@test.com", { revokedAt: Date.now() });
    const { app, getConfig } = await buildApp([key]);

    const res = await app.inject({ method: "DELETE", url: "/api/model-proxy/api-keys/k1" });
    expect(res.statusCode).toBe(204);
    expect(getConfig().apiKeys.find((k) => k.id === "k1")).toBeUndefined();
  });

  it("list excludes purged keys", async () => {
    const key = makeEntry("k1", "Key", "alice@test.com");
    const { app, getConfig } = await buildApp([key]);

    await app.inject({ method: "DELETE", url: "/api/model-proxy/api-keys/k1" });

    const listRes = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(listRes.body);
    const allIds = [
      ...body.data.keys.map((k: any) => k.id),
      ...body.data.revoked.map((k: any) => k.id),
    ];
    expect(allIds).not.toContain("k1");
  });

  it("purge non-owner's key as non-admin → 403", async () => {
    const bobKey = makeEntry("k1", "Bob", "bob@test.com");
    const { app } = await buildApp([bobKey], "alice@test.com");

    const res = await app.inject({ method: "DELETE", url: "/api/model-proxy/api-keys/k1" });
    expect(res.statusCode).toBe(403);
  });
});
