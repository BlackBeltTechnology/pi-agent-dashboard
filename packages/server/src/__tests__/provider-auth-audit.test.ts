/**
 * B18 — provider-auth audit lines (harden-auth-credentials D2; test-plan AE29,
 * AE30, AE31, AX11(b)).
 *
 * A sibling of `provider-auth-routes.test.ts`: that file's `vi.mock` of the
 * storage module has no `readAuthJson`, and the Radius MCP route needs a mocked
 * `configureRadiusMcp`. The session is simulated as the auth plugin tags one
 * (`authVia` + `sessionPayload.sub`).
 */

import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { writeCredential, removeCredential, auth } = vi.hoisted(() => {
  // What the fake store holds: the DELETE route audits only a removal of an existing credential, signalled by the
  // storage layer's `onRemoved` hook (it fires inside the real storage lock).
  const auth = { data: {} as Record<string, unknown> };
  return {
    writeCredential: vi.fn(async () => {}),
    removeCredential: vi.fn(async (provider: string, _kind?: string, opts?: { onRemoved?: () => void }) => {
      if (auth.data[provider] !== undefined) {
        delete auth.data[provider];
        opts?.onRemoved?.();
      }
    }),
    auth,
  };
});

vi.mock("../auth/provider-auth-storage.js", () => ({
  CredentialTypeConflictError: class CredentialTypeConflictError extends Error {},
  getAuthStatus: () => [],
  getOAuthProvidersMeta: () => [],
  oauthIdSet: () => new Set<string>(),
  readAuthJson: () => auth.data,
  removeCredential,
  resolveAuthJsonKey: (id: string) => id,
  writeCredential,
}));

vi.mock("../auth/radius-mcp.js", () => ({
  configureRadiusMcp: vi.fn(async () => ({ status: 200, body: { configured: true, written: true, name: "radius" } })),
  readRadiusMcpStatus: vi.fn(() => ({ status: 200, body: {} })),
}));

vi.mock("../model-proxy/registry-singleton.js", () => ({
  refreshModelRegistry: () => Promise.resolve(),
}));

import type { OAuthRegistryEntry } from "../auth/pi-oauth-types.js";
import { abortAllFlows } from "../auth/provider-auth-adapter.js";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";
import { anthropicFlow, type FakeOAuthFlow, resetFakeFlows } from "./helpers/fake-oauth-flow.js";

const spies: { mockRestore(): void }[] = [];
let captured: string[];
let app: Awaited<ReturnType<typeof buildApp>>;

function registryFor(make: () => FakeOAuthFlow): OAuthRegistryEntry[] {
  return [
    {
      id: "anthropic",
      name: "anthropic display",
      flowType: "auth_code",
      auth: { name: "anthropic display", login: (interaction) => make().login(interaction) },
    },
  ];
}

async function buildApp() {
  const fastify = Fastify();
  fastify.addHook("onRequest", async (req) => {
    if (req.headers["x-test-session"] === "1") {
      const r = req as unknown as { authVia: string; sessionPayload: { sub: string } };
      r.authVia = "session";
      r.sessionPayload = { sub: "alice@example.com" };
    }
  });
  registerProviderAuthRoutes(fastify, {
    piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as never,
    browserGateway: { broadcastToAll: vi.fn() } as never,
    oauthRegistry: registryFor(anthropicFlow),
    oauthReady: Promise.resolve(),
    radiusMcp: { service: () => ({}) as never, reload: async () => 0 },
  });
  await fastify.ready();
  return fastify;
}

const SESSION = { "x-test-session": "1" };
const lines = (needle: string) => captured.filter((l) => l.includes(needle));

beforeEach(async () => {
  captured = [];
  resetFakeFlows();
  abortAllFlows();
  writeCredential.mockClear();
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    spies.push(
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      }),
    );
  }
  app = await buildApp();
});

afterEach(async () => {
  for (const s of spies.splice(0)) s.mockRestore();
  await app.close();
  abortAllFlows();
});

describe("AE29 — provider credential write and delete are logged", () => {
  it("AE29: key_set and removed lines; the api key is absent from every captured stream", async () => {
    const KEY = "sk-test-CANARY-1234567890";
    auth.data = { openrouter: { type: "api_key", key: KEY } };
    const put = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      remoteAddress: "203.0.113.9",
      headers: SESSION,
      payload: { provider: "openrouter", key: KEY },
    });
    expect(put.statusCode).toBe(200);
    const del = await app.inject({
      method: "DELETE",
      url: "/api/provider-auth/openrouter",
      remoteAddress: "203.0.113.9",
      headers: SESSION,
    });
    expect(del.statusCode).toBe(200);
    const set = lines("[provider-auth] key_set");
    expect(set).toHaveLength(1);
    expect(set[0]).toBe("[provider-auth] key_set provider=openrouter actor=session:alice_ex ip=203.0.113.9");
    const removed = lines("[provider-auth] removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe("[provider-auth] removed provider=openrouter actor=session:alice_ex ip=203.0.113.9");
    expect(captured.join("\n")).not.toContain(KEY);
  });
});

describe("AE29b — removal of an absent provider is not audited", () => {
  it("DELETE for a provider with no stored credential succeeds and emits no `removed` line", async () => {
    auth.data = {};
    const del = await app.inject({
      method: "DELETE",
      url: "/api/provider-auth/openrouter",
      remoteAddress: "203.0.113.9",
      headers: SESSION,
    });
    expect(del.statusCode).toBe(200);
    expect(lines("[provider-auth] removed")).toHaveLength(0);
  });
});

describe("AE30 — flow value input logged without the value", () => {
  it("AE30: `flow_input flow=<id8> actor=… ip=…`; the submitted code is absent from all output", async () => {
    const started = await app.inject({
      method: "POST",
      url: "/api/provider-auth/start",
      remoteAddress: "203.0.113.9",
      headers: SESSION,
      payload: { provider: "anthropic" },
    });
    const { flowId } = JSON.parse(started.payload) as { flowId: string };
    captured.length = 0;
    const res = await app.inject({
      method: "POST",
      url: `/api/provider-auth/flow/${flowId}/input`,
      remoteAddress: "203.0.113.9",
      headers: SESSION,
      payload: { value: "http://localhost:1455/cb?code=CODE-CANARY-abcdef" },
    });
    expect(res.statusCode).toBe(202);
    const found = lines("[provider-auth] flow_input");
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(
      `[provider-auth] flow_input flow=${flowId.slice(0, 8)} actor=session:alice_ex ip=203.0.113.9`,
    );
    expect(captured.join("\n")).not.toContain("CODE-CANARY-abcdef");
  });
});

describe("AE31 — OAuth start and Radius MCP configure are logged", () => {
  it("AE31: oauth_start and radius_mcp lines; a Bearer header on the request never reaches the log", async () => {
    const headers = { ...SESSION, authorization: "Bearer RADIUS-CANARY-777" };
    const start = await app.inject({
      method: "POST",
      url: "/api/provider-auth/start",
      remoteAddress: "203.0.113.9",
      headers,
      payload: { provider: "anthropic" },
    });
    expect(start.statusCode).toBe(200);
    const mcp = await app.inject({
      method: "POST",
      url: "/api/provider-auth/radius/mcp",
      remoteAddress: "203.0.113.9",
      headers,
      payload: { headers: { Authorization: "Bearer RADIUS-CANARY-777" } },
    });
    expect(mcp.statusCode).toBe(200);
    expect(lines("[provider-auth] oauth_start")).toEqual([
      "[provider-auth] oauth_start provider=anthropic actor=session:alice_ex ip=203.0.113.9",
    ]);
    const radius = lines("[provider-auth] radius_mcp");
    expect(radius).toHaveLength(1);
    expect(radius[0]).toMatch(/^\[provider-auth\] radius_mcp written=true actor=session:alice_ex ip=203\.0\.113\.9$/);
    expect(captured.join("\n")).not.toContain("RADIUS-CANARY-777");
  });
});

describe("AX11 — a rejected mutation leaves no success line", () => {
  it("AX11 (b): an empty-key PUT is 400 with no `key_set` line and no write", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      remoteAddress: "203.0.113.9",
      headers: SESSION,
      payload: { provider: "openrouter", key: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(lines("key_set")).toHaveLength(0);
    expect(writeCredential).not.toHaveBeenCalled();
  });
});
