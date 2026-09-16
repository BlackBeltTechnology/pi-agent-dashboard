/**
 * E26/E27 (test-plan expand-mcp-tiered-surface) — session lifecycle REST route
 * and extension-ui-response twin. See change: expand-mcp-tiered-surface (D3).
 *
 * E26: `POST /api/session/:id/lifecycle` sits at `control`; the two destructive
 * verbs (`force_kill`, `kill_process`) additionally require `operate` from an
 * off-host device bearer, checked inside the handler (the action is in the body,
 * so the onRequest gate cannot see it).
 *
 * E27: the REST `extension-ui-response` route and the browser-WS case both
 * clear the gateway's pending-UI entry and forward through the same helper.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { handleExtensionUiResponse } from "../browser-handlers/directory-handler.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { registerSessionApi } from "../session/session-api.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpDir: string;
const openApps: FastifyInstance[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lifecycle-"));
});

afterEach(async () => {
  for (const app of openApps.splice(0)) await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface App {
  app: FastifyInstance;
  tokens: { control: string; operate: string };
  lifecycleCalls: Array<{ sessionId: string; action: string }>;
  clearUiRequest: ReturnType<typeof vi.fn>;
  sendToSession: ReturnType<typeof vi.fn>;
}

async function mkApp(opts: { guard?: (req: any, reply: any) => Promise<void> } = {}): Promise<App> {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const tokens = {
    control: reg.add("c", "manual", "control").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  const lifecycleCalls: Array<{ sessionId: string; action: string }> = [];
  const clearUiRequest = vi.fn();
  const sendToSession = vi.fn(() => true);
  const sessionManager = {
    get: (id: string) => (id === "S" ? { id } : undefined),
    update: vi.fn(),
    unregister: vi.fn(),
  };
  const piGateway = { sendToSession };
  const browserGateway = { clearUiRequest };

  const app = Fastify();
  openApps.push(app);
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  registerSessionApi(app, {
    sessionManager: sessionManager as never,
    piGateway: piGateway as never,
    browserGateway: browserGateway as never,
    handleLifecycle: async (sessionId, action) => {
      lifecycleCalls.push({ sessionId, action });
    },
    getTrustedNetworks: () => [],
    networkGuard: opts.guard,
  });
  await app.ready();
  return { app, tokens, lifecycleCalls, clearUiRequest, sendToSession };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (app: FastifyInstance, url: string, body: unknown, headers: Record<string, string> = {}, remoteAddress = "203.0.113.5") =>
  app.inject({ method: "POST", url, remoteAddress, headers: { "content-type": "application/json", ...headers }, payload: body as object });

describe("E26 — lifecycle action tier decision table", () => {
  it("control bearer off-host: force_kill/kill_process → 403 operate; others reach the handler", async () => {
    const { app, tokens, lifecycleCalls } = await mkApp();
    for (const action of ["force_kill", "kill_process"]) {
      const res = await post(app, "/api/session/S/lifecycle", { action }, bearer(tokens.control));
      expect(res.statusCode, action).toBe(403);
      expect(res.headers["www-authenticate"]).toContain('scope="operate"');
    }
    expect(lifecycleCalls).toHaveLength(0);

    for (const action of ["stop_after_turn", "retry"]) {
      const res = await post(app, "/api/session/S/lifecycle", { action }, bearer(tokens.control));
      expect(res.statusCode, action).toBe(200);
    }
    expect(lifecycleCalls).toEqual([
      { sessionId: "S", action: "stop_after_turn" },
      { sessionId: "S", action: "retry" },
    ]);
  });

  it("operate bearer reaches force_kill", async () => {
    const { app, tokens, lifecycleCalls } = await mkApp();
    const res = await post(app, "/api/session/S/lifecycle", { action: "force_kill" }, bearer(tokens.operate));
    expect(res.statusCode).toBe(200);
    expect(lifecycleCalls).toEqual([{ sessionId: "S", action: "force_kill" }]);
  });

  it("loopback caller reaches force_kill (network position trusted)", async () => {
    const { app, lifecycleCalls } = await mkApp();
    const res = await post(app, "/api/session/S/lifecycle", { action: "force_kill" }, {}, "127.0.0.1");
    expect(res.statusCode).toBe(200);
    expect(lifecycleCalls).toEqual([{ sessionId: "S", action: "force_kill" }]);
  });

  it("rejects an unknown action without invoking the handler", async () => {
    const { app } = await mkApp();
    const res = await post(app, "/api/session/S/lifecycle", { action: "nuke" });
    expect(res.statusCode).toBe(400);
  });
});

describe("E27 — extension-ui-response clears and forwards identically", () => {
  it("REST route clears the pending request and forwards the same payload the WS case does", async () => {
    const { app, clearUiRequest, sendToSession } = await mkApp();
    const res = await post(app, "/api/session/S/extension-ui-response", {
      requestId: "R1",
      result: { answers: ["yes"] },
    });
    expect(res.statusCode).toBe(200);
    expect(clearUiRequest).toHaveBeenCalledWith("S", "R1");

    // The WS case calls `handleExtensionUiResponse`, which now delegates to the
    // same `forwardExtensionUiResponse` helper.
    handleExtensionUiResponse(
      { type: "extension_ui_response", sessionId: "S", requestId: "R1", result: { answers: ["yes"] } } as never,
      { piGateway: { sendToSession } } as never,
    );

    expect(sendToSession).toHaveBeenCalledTimes(2);
    const [first, second] = sendToSession.mock.calls;
    expect(first).toEqual(second);
    expect(first).toEqual([
      "S",
      {
        type: "extension_ui_response",
        sessionId: "S",
        requestId: "R1",
        result: { answers: ["yes"] },
        cancelled: false,
      },
    ]);
  });

  it("requires a requestId", async () => {
    const { app, clearUiRequest } = await mkApp();
    const res = await post(app, "/api/session/S/extension-ui-response", {});
    expect(res.statusCode).toBe(400);
    expect(clearUiRequest).not.toHaveBeenCalled();
  });
});


describe("B2 — the destructive lifecycle route carries an admission guard", () => {
  it("a rejecting networkGuard stops the call before the handler", async () => {
    const guard = async (_req: unknown, reply: any) => {
      reply.code(403).send({ success: false, error: "network_not_allowed" });
    };
    const { app, lifecycleCalls } = await mkApp({ guard });
    const res = await post(app, "/api/session/S/lifecycle", { action: "force_kill" }, {}, "127.0.0.1");
    expect(res.statusCode).toBe(403);
    expect(lifecycleCalls).toHaveLength(0);
  });

  it("the extension-ui route carries the same guard", async () => {
    const guard = async (_req: unknown, reply: any) => {
      reply.code(403).send({ success: false, error: "network_not_allowed" });
    };
    const { app, clearUiRequest } = await mkApp({ guard });
    const res = await post(app, "/api/session/S/extension-ui-response", { requestId: "R" }, {}, "127.0.0.1");
    expect(res.statusCode).toBe(403);
    expect(clearUiRequest).not.toHaveBeenCalled();
  });
});
