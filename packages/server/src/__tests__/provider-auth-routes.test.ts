import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the storage and handlers to avoid touching real auth.json
vi.mock("../auth/provider-auth-storage.js", () => ({
  getOAuthProvidersMeta: () => [
    { id: "anthropic", name: "Anthropic", flowType: "auth_code" },
    { id: "github-copilot", name: "GitHub Copilot", flowType: "device_code" },
  ],
  getAuthStatus: () => [
    { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: false },
    { id: "github-copilot", name: "GitHub Copilot", flowType: "device_code", authenticated: true, expires: Date.now() + 86400000 },
  ],
  writeCredential: vi.fn(),
  removeCredential: vi.fn(),
  resolveAuthJsonKey: (id: string) => id,
}));

// Mock the callback server to avoid opening real ports
vi.mock("../auth/oauth-callback-server.js", () => ({
  startCallbackServer: vi.fn().mockResolvedValue({
    closed: new Promise(() => {}),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock child_process.exec to avoid opening a browser
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

import Fastify from "fastify";
import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

function createMockPiGateway() {
  return {
    broadcast: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    connectionCount: () => 0,
    findSessionByCwd: () => undefined,
    getConnectedSessionIds: () => [],
    isSessionConnected: () => false,
  } as any;
}

function createMockBrowserGateway() {
  return {
    broadcastToAll: vi.fn(),
  } as any;
}

describe("provider-auth-routes", () => {
  let app: ReturnType<typeof Fastify>;
  let piGateway: ReturnType<typeof createMockPiGateway>;
  let browserGateway: ReturnType<typeof createMockBrowserGateway>;

  beforeEach(async () => {
    app = Fastify();
    piGateway = createMockPiGateway();
    browserGateway = createMockBrowserGateway();
    registerProviderAuthRoutes(app, { piGateway, browserGateway });
    await app.ready();
  });

  it("GET /api/provider-auth/providers returns OAuth provider list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/providers" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toHaveLength(2);
    expect(data[0].id).toBe("anthropic");
  });

  it("GET /api/provider-auth/handlers returns the driveable handler ids", async () => {
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/handlers" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.ids).toEqual(["anthropic", "openai-codex", "github-copilot"]);
  });

  it("GET /api/provider-auth/status returns all provider statuses", async () => {
    const res = await app.inject({ method: "GET", url: "/api/provider-auth/status" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data).toHaveLength(2);
    expect(data[0].authenticated).toBe(false);
    expect(data[1].authenticated).toBe(true);
  });

  it("POST /api/provider-auth/authorize returns authUrl with correct redirect URI", async () => {
    const { startCallbackServer } = await import("../auth/oauth-callback-server.js");
    const res = await app.inject({
      method: "POST",
      url: "/api/provider-auth/authorize",
      payload: { provider: "anthropic" },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.payload);
    expect(data.flowId).toBeTruthy();
    expect(data.authUrl).toContain("claude.ai/oauth/authorize");
    // Verify redirect URI uses the registered callback port/path
    expect(data.authUrl).toContain(encodeURIComponent("http://localhost:53692/callback"));
    // Verify callback server was started
    expect(startCallbackServer).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        port: 53692,
        path: "/callback",
      }),
    );
  });

  it("POST /api/provider-auth/authorize rejects unknown provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/provider-auth/authorize",
      payload: { provider: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });

  // /exchange endpoint removed — token exchange happens in the callback server's onCode

  // notifyBridges semantics changed: it now ONLY broadcasts
  // `credentials_updated` to bridges. The previous `models_refreshed`
  // broadcast to browsers was removed because the per-session
  // `models_list` channel is self-healing: each bridge pushes a fresh
  // models_list for its session on credentials_updated, and browsers
  // update modelsMap[sid] incrementally without a global wipe. See
  // change: simplify-model-selection-channels.
  it("PUT /api/provider-auth/api-key saves and broadcasts credentials_updated to bridges", async () => {
    const { writeCredential } = await import("../auth/provider-auth-storage.js");
    const res = await app.inject({
      method: "PUT",
      url: "/api/provider-auth/api-key",
      payload: { provider: "openai", key: "sk-test" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).ok).toBe(true);
    expect(writeCredential).toHaveBeenCalledWith("openai", { type: "api_key", key: "sk-test" });
    expect(piGateway.broadcast).toHaveBeenCalledWith({ type: "credentials_updated" });
    // No models_refreshed broadcast — see simplify-model-selection-channels.
    expect(browserGateway.broadcastToAll).not.toHaveBeenCalledWith({ type: "models_refreshed" });
  });

  it("DELETE /api/provider-auth/:provider removes and broadcasts credentials_updated", async () => {
    const { removeCredential } = await import("../auth/provider-auth-storage.js");
    const res = await app.inject({
      method: "DELETE",
      url: "/api/provider-auth/anthropic",
    });
    expect(res.statusCode).toBe(200);
    expect(removeCredential).toHaveBeenCalledWith("anthropic");
    expect(piGateway.broadcast).toHaveBeenCalledWith({ type: "credentials_updated" });
    expect(browserGateway.broadcastToAll).not.toHaveBeenCalledWith({ type: "models_refreshed" });
  });

  // /callback/:provider route removed — temp callback server handles this directly

  it("POST /api/provider-auth/device-code rejects auth_code provider", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/provider-auth/device-code",
      payload: { provider: "anthropic" },
    });
    expect(res.statusCode).toBe(400);
  });
});
