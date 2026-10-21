/**
 * Multi-user key visibility and admin override tests (task 3.10).
 *
 * Tests the per-user isolation and admin override logic in the API key
 * management routes:
 * - Alice cannot see Bob's keys
 * - Admin sees all keys
 * - Admin can revoke any user's key
 *
 * Uses Fastify directly, injecting user context via request.user.
 */

import type { ModelProxyConfig, ProxyApiKey } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { generateKey, hashKey } from "../model-proxy/api-key-store.js";
import { registerModelProxyApiKeyRoutes } from "../routes/model-proxy-api-key-routes.js";

// ── Helpers ────────────────────────────────────────────────────────────────

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

interface SetupOpts {
  user: { email: string };
  adminEmail?: string;
  apiKeys?: ProxyApiKey[];
}

async function buildApp(opts: SetupOpts) {
  const { user, adminEmail, apiKeys = [] } = opts;

  let config: ModelProxyConfig = {
    enabled: true,
    maxConcurrentStreams: 16,
    perKeyConcurrentStreams: 4,
    logRequests: false,
    apiKeys: [...apiKeys],
  };

  const writes: ProxyApiKey[][] = [];

  const app = Fastify({ logger: false });

  // Inject user context (simulates JWT-decoded user)
  app.addHook("onRequest", async (req) => {
    (req as any).user = user;
  });

  // Passthrough networkGuard
  const networkGuard = async (_req: any, _reply: any) => {};

  registerModelProxyApiKeyRoutes(app, {
    networkGuard,
    getModelProxyConfig: () => config,
    writeModelProxyApiKeys: async (keys) => {
      config = { ...config, apiKeys: keys };
      writes.push(keys);
    },
    getAdminEmail: () => adminEmail,
  });

  await app.ready();
  return { app, writes, getConfig: () => config };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("multi-user key visibility (task 3.10)", () => {
  it("alice sees only her own keys", async () => {
    const aliceKey = makeEntry("k1", "Alice key", "alice@example.com");
    const bobKey = makeEntry("k2", "Bob key", "bob@example.com");

    const { app } = await buildApp({
      user: { email: "alice@example.com" },
      apiKeys: [aliceKey, bobKey],
    });

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    const allVisible = [...(body.data?.keys ?? []), ...(body.data?.revoked ?? [])];
    const ids = allVisible.map((k: any) => k.id);

    expect(ids).toContain("k1");
    expect(ids).not.toContain("k2");
  });

  it("bob sees only his own keys", async () => {
    const aliceKey = makeEntry("k1", "Alice key", "alice@example.com");
    const bobKey = makeEntry("k2", "Bob key", "bob@example.com");

    const { app } = await buildApp({
      user: { email: "bob@example.com" },
      apiKeys: [aliceKey, bobKey],
    });

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(res.body);
    const allVisible = [...(body.data?.keys ?? []), ...(body.data?.revoked ?? [])];
    const ids = allVisible.map((k: any) => k.id);

    expect(ids).toContain("k2");
    expect(ids).not.toContain("k1");
  });

  it("admin sees all keys", async () => {
    const aliceKey = makeEntry("k1", "Alice key", "alice@example.com");
    const bobKey = makeEntry("k2", "Bob key", "bob@example.com");

    const { app } = await buildApp({
      user: { email: "admin@example.com" },
      adminEmail: "admin@example.com",
      apiKeys: [aliceKey, bobKey],
    });

    const res = await app.inject({ method: "GET", url: "/api/model-proxy/api-keys" });
    const body = JSON.parse(res.body);
    const allVisible = [...(body.data?.keys ?? []), ...(body.data?.revoked ?? [])];
    const ids = allVisible.map((k: any) => k.id);

    expect(ids).toContain("k1");
    expect(ids).toContain("k2");
  });

  it("alice cannot revoke bob's key (403)", async () => {
    const bobKey = makeEntry("k2", "Bob key", "bob@example.com");

    const { app } = await buildApp({
      user: { email: "alice@example.com" },
      apiKeys: [bobKey],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys/k2/revoke",
    });

    expect(res.statusCode).toBe(403);
  });

  it("admin can revoke any user's key", async () => {
    const bobKey = makeEntry("k2", "Bob key", "bob@example.com");

    const { app, getConfig } = await buildApp({
      user: { email: "admin@example.com" },
      adminEmail: "admin@example.com",
      apiKeys: [bobKey],
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/model-proxy/api-keys/k2/revoke",
    });

    expect(res.statusCode).toBe(204);
    const revokedEntry = getConfig().apiKeys.find((k) => k.id === "k2");
    expect(revokedEntry?.revokedAt).toBeDefined();
  });
});
