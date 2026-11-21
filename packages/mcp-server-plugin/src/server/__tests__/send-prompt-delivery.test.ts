/**
 * MCP `send_prompt` forwards the optional `delivery` mode through the REAL
 * plugin wiring (registerPlugin → /mcp → handler → ctx.sendToSession).
 * Covers test-plan #S10 #S11 #S12 #S15 #S17 #X2.
 * See change: add-rest-prompt-delivery-mode.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlugin } from "../index.js";
import { META_VERSION_KEY } from "../protocol.js";

const V = "2026-07-28";
let cfgDir: string;
beforeEach(() => {
  cfgDir = mkdtempSync(join(tmpdir(), "mcp-send-delivery-"));
  process.env.PI_CODING_AGENT_DIR = cfgDir;
});
afterEach(() => {
  delete process.env.PI_CODING_AGENT_DIR;
  rmSync(cfgDir, { recursive: true, force: true });
});

async function boot(sendResult = true) {
  const app = Fastify();
  const handlers = new Map<string, (msg: unknown, sessionId: string) => void>();
  const minted: Array<{ token: string }> = [];
  const sendToSession = vi.fn((..._a: unknown[]) => sendResult);
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    consume: () => undefined,
    provide: () => {},
    fastify: app,
    sessionManager: { listAll: () => [] },
    sendToSession,
    spawnSession: async () => ({}),
    abortSession: async () => false,
    onEvent: () => () => {},
    registerPiHandler: (type: string, h: (msg: unknown, sessionId: string) => void) => handlers.set(type, h),
    sendExtensionMessage: (_sid: string, msg: unknown) => {
      minted.push(msg as { token: string });
      return true;
    },
    onSessionEnded: () => {},
  } as unknown as ServerPluginContext;
  await registerPlugin(ctx);
  await app.ready();
  handlers.get("mcp/mint-token")?.({}, "A");
  const token = minted[0].token;
  const call = async (args: Record<string, unknown>) => {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${token}`, "mcp-protocol-version": V, "content-type": "application/json" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { _meta: { [META_VERSION_KEY]: V }, name: "send_prompt", arguments: args },
      },
    });
    return { status: res.statusCode, body: res.json() as any };
  };
  return { app, sendToSession, call };
}

describe("MCP send_prompt delivery", () => {
  it("#S10 forwards delivery:steer to sendToSession", async () => {
    const { app, sendToSession, call } = await boot();
    const r = await call({ sessionId: "S", text: "focus on X", delivery: "steer" });
    expect(r.status).toBe(200);
    expect(sendToSession).toHaveBeenCalledWith("S", "focus on X", { delivery: "steer" });
    await app.close();
  });

  it("#S11 an absent delivery is not defaulted", async () => {
    const { app, sendToSession, call } = await boot();
    await call({ sessionId: "S", text: "hello" });
    expect(sendToSession).toHaveBeenCalledTimes(1);
    const [, , opts] = sendToSession.mock.calls[0] as [string, string, { delivery?: string } | undefined];
    expect(opts?.delivery).toBeUndefined();
    await app.close();
  });

  it.each([["now"], ["Steer"], [5], [null]])("#S12 rejects delivery %j and never sends", async (bad) => {
    const { app, sendToSession, call } = await boot();
    const r = await call({ sessionId: "S", text: "hi", delivery: bad });
    expect(r.body.error?.code).toBe(-32602);
    expect(sendToSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("#S15 images stay ignored", async () => {
    const { app, sendToSession, call } = await boot();
    await call({ sessionId: "S", text: "hi", delivery: "steer", images: [{ type: "image" }] });
    expect(sendToSession).toHaveBeenCalledWith("S", "hi", { delivery: "steer" });
    await app.close();
  });

  it("#S17 the self-target guard still refuses (caller A → A)", async () => {
    const { app, sendToSession, call } = await boot();
    const r = await call({ sessionId: "A", text: "hi", delivery: "steer" });
    expect(r.status).toBe(403);
    expect(r.body.error.data.type).toBe("SelfTargetRefused");
    expect(sendToSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("#X2 a failed send reports delivered:false identically with and without delivery", async () => {
    const { app, call } = await boot(false);
    const withD = await call({ sessionId: "S", text: "hi", delivery: "steer" });
    const without = await call({ sessionId: "S", text: "hi" });
    expect(withD.status).toBe(without.status);
    expect(withD.body.result).toEqual(without.body.result);
    expect(JSON.stringify(withD.body.result)).toContain("false");
    await app.close();
  });
});
