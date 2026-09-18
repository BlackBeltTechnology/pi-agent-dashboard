/**
 * Device-code completion must not report `complete` before the credential it
 * promises has actually been persisted (test-plan X5).
 *
 * Making `writeCredential` async turns a previously-ordered call into an
 * unawaited one the moment a caller forgets `await`; the poller would then flip
 * the flow to `complete` while the write is still in flight (or never lands).
 * This pins the ordering with a deferred write.
 *
 * See change: fix-provider-auth-lock-contention.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify from "fastify";

const h = vi.hoisted(() => {
  const state = {
    releases: [] as Array<() => void>,
    writes: 0,
  };
  return {
    state,
    /** A write that only settles when the test says so. */
    writeCredential: () => {
      state.writes++;
      return new Promise<void>((resolve) => state.releases.push(resolve));
    },
  };
});

vi.mock("../auth/provider-auth-storage.js", () => ({
  getOAuthProvidersMeta: () => [],
  getAuthStatus: () => [],
  writeCredential: h.writeCredential,
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
          pollForToken: async () => ({ type: "api_key", key: "sk-device" }),
        }
      : undefined,
  getAllHandlers: () => [],
  generatePKCE: vi.fn(),
  generateState: vi.fn(),
}));

import { registerProviderAuthRoutes } from "../routes/provider-auth-routes.js";

async function waitFor(check: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor: condition never became true");
}

describe("device-code completion awaits the credential write", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    h.state.writes = 0;
    h.state.releases = [];
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

  it("flips to complete only after the write resolves", async () => {
    const started = await app.inject({
      method: "POST",
      url: "/api/provider-auth/device-code",
      payload: { provider: "github-copilot" },
    });
    expect(started.statusCode).toBe(200);
    const { flowId } = started.json() as { flowId: string };

    await waitFor(() => h.state.writes === 1);

    const during = await app.inject({
      method: "GET",
      url: `/api/provider-auth/device-status/${flowId}`,
    });
    expect((during.json() as { status: string }).status).toBe("pending");

    h.state.releases.shift()!();

    let status = "pending";
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const res = await app.inject({
        method: "GET",
        url: `/api/provider-auth/device-status/${flowId}`,
      });
      status = (res.json() as { status: string }).status;
      if (status === "complete") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(status).toBe("complete");
  });
});
