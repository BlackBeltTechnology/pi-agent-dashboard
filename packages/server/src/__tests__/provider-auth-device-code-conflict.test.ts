/**
 * Device-code OAuth completion over a stored credential of a DIFFERENT type
 * must surface the refusal on the flow's own surface: `flow.status = "error"`,
 * read by `GET /device-status/:flowId` (test-plan X3). The clobber guard lives
 * in `writeCredential` (D2); the poller's existing catch turns the thrown
 * refusal into the flow's error state.
 *
 * See change: redesign-providers-settings-page (D2).
 */
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../auth/provider-auth-storage.js", () => ({
  getOAuthProvidersMeta: () => [],
  getAuthStatus: () => [],
  writeCredential: () => {
    throw Object.assign(
      new Error('"anthropic" already holds an api_key credential. Remove it before writing a replacement.'),
      { code: "provider_auth.credential_type_conflict", storedType: "api_key", provider: "anthropic" },
    );
  },
  removeCredential: vi.fn(),
  resolveAuthJsonKey: (id: string) => id,
}));

vi.mock("../auth/provider-auth-handlers.js", () => ({
  getProviderHandler: (id: string) =>
    id === "github-copilot"
      ? {
          providerId: "github-copilot",
          displayName: "GitHub Copilot",
          flowType: "device_code",
          requestDeviceCode: async () => ({
            deviceCode: "device-1",
            userCode: "USER-1",
            verificationUri: "https://example.test/device",
            interval: 50,
            expiresIn: 900,
          }),
          pollForToken: async () => ({ type: "oauth", refresh: "r", access: "a", expires: 1 }),
        }
      : undefined,
  getAllHandlers: () => [],
  generatePKCE: vi.fn(),
  generateState: vi.fn(),
}));

import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

describe("device-code flow reports a cross-type refusal (X3)", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify();
    registerProviderAuthRoutes(app, {
      piGateway: { broadcast: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: () => [] } as any,
      browserGateway: { broadcastToAll: vi.fn() } as any,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("poll completing over a stored api_key ends as flow error with the refusal message", async () => {
    const started = await app.inject({
      method: "POST",
      url: "/api/provider-auth/device-code",
      payload: { provider: "github-copilot" },
    });
    expect(started.statusCode).toBe(200);
    const { flowId } = started.json() as { flowId: string };

    let status = "";
    let error = "";
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const res = await app.inject({
        method: "GET",
        url: `/api/provider-auth/device-status/${flowId}`,
      });
      const body = res.json() as { status: string; error?: string };
      status = body.status;
      error = body.error ?? "";
      if (status === "error") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(status).toBe("error");
    expect(error).toContain("api_key");
    expect(error).toMatch(/remove it before/i);
  });
});
