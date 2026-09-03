/**
 * `subscriptions/listen` over a REAL listening server.
 *
 * `app.inject()` cannot exercise this path: the route calls `reply.hijack()` and
 * writes to `reply.raw`, so the response never goes through Fastify's normal
 * serialisation. Every other streaming test therefore stops at the refusal
 * paths, which means a regression that dropped `hijack()`, `flushHeaders()`, or
 * the teardown binding would pass CI.
 *
 * These tests bind a real port and speak HTTP over a socket to close that gap.
 *
 * Covers S1 (delivery), S2 (isolation), S4 (clean close releases), S5 (abort
 * releases) and the header-flush behaviour.
 */
import http from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { META_VERSION_KEY } from "../protocol.js";
import { mountMcpRoutes } from "../routes.js";
import { SubscriptionRegistry } from "../streaming.js";
import { McpTokenRegistry } from "../tokens.js";

const V = "2026-07-28";
let apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.map((a) => a.close()));
  apps = [];
});

async function listeningHarness() {
  const app = Fastify();
  apps.push(app);
  const tokens = new McpTokenRegistry();
  const registry = new SubscriptionRegistry();
  const handlers = new Set<(sessionId: string, payload: unknown) => void>();

  await mountMcpRoutes(app, {
    tokens,
    verifyDeviceToken: () => null,
    invokeTool: async () => ({}),
    serverInfo: { name: "pi-dashboard", version: "0.7.0" },
    log: { info: () => {}, warn: () => {}, error: () => {} },
    streaming: {
      registry,
      source: {
        onEvent(handler) {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      },
    },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    app,
    port,
    tokens,
    registry,
    emit: (sessionId: string, payload: unknown) => {
      for (const h of [...handlers]) h(sessionId, payload);
    },
    get listenerCount() {
      return handlers.size;
    },
  };
}

/** Open a listen stream and collect NDJSON lines as they arrive. */
function openStream(port: number, token: string, sessionIds: string[]) {
  const lines: string[] = [];
  let headersSeen: http.IncomingHttpHeaders | null = null;
  let status = 0;

  const req = http.request({
    host: "127.0.0.1",
    port,
    path: "/mcp",
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "mcp-protocol-version": V,
    },
  });

  const headersPromise = new Promise<void>((resolve) => {
    req.on("response", (res) => {
      status = res.statusCode ?? 0;
      headersSeen = res.headers;
      resolve();
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk.toString();
        const parts = buf.split("\n");
        buf = parts.pop() ?? "";
        for (const p of parts) if (p.trim()) lines.push(p);
      });
    });
  });

  req.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "subscriptions/listen",
      params: { sessionIds, _meta: { [META_VERSION_KEY]: V } },
    }),
  );
  req.end();

  return {
    req,
    lines,
    headersPromise,
    get status() {
      return status;
    },
    get headers() {
      return headersSeen;
    },
  };
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

describe("subscriptions/listen over a real socket", () => {
  it("flushes headers BEFORE any event arrives", async () => {
    const h = await listeningHarness();
    const token = h.tokens.mintForSession("session-a");
    const stream = openStream(h.port, token, ["session-a"]);

    // No event has been emitted. Headers must still arrive — otherwise a
    // client blocks (or times out) waiting on an idle but healthy stream.
    await stream.headersPromise;

    expect(stream.status).toBe(200);
    expect(stream.headers?.["content-type"]).toContain("application/x-ndjson");
    expect(stream.lines).toHaveLength(0);

    stream.req.destroy();
  });

  it("S1 — delivers a subscribed session's event on the open response", async () => {
    const h = await listeningHarness();
    const token = h.tokens.mintForSession("session-a");
    const stream = openStream(h.port, token, ["session-a"]);
    await stream.headersPromise;
    await settle();

    h.emit("session-a", { type: "message", text: "hello" });
    await settle();

    expect(stream.lines.map((l) => JSON.parse(l))).toEqual([
      { sessionId: "session-a", payload: { type: "message", text: "hello" } },
    ]);

    stream.req.destroy();
  });

  it("S2 — does NOT deliver an unsubscribed session's event", async () => {
    const h = await listeningHarness();
    const token = h.tokens.mintForSession("session-a");
    const stream = openStream(h.port, token, ["session-a"]);
    await stream.headersPromise;
    await settle();

    h.emit("session-b", { secret: "must not leak" });
    await settle();

    expect(stream.lines).toHaveLength(0);

    stream.req.destroy();
  });

  it("registers exactly one live subscription while open", async () => {
    const h = await listeningHarness();
    const token = h.tokens.mintForSession("session-a");
    expect(h.registry.size).toBe(0);

    const stream = openStream(h.port, token, ["session-a"]);
    await stream.headersPromise;
    await settle();

    expect(h.registry.size).toBe(1);
    expect(h.listenerCount).toBe(1);

    stream.req.destroy();
  });

  it("S5 — an aborted transport releases the subscription", async () => {
    const h = await listeningHarness();
    const token = h.tokens.mintForSession("session-a");
    const stream = openStream(h.port, token, ["session-a"]);
    await stream.headersPromise;
    await settle();
    expect(h.registry.size).toBe(1);

    // Abort without a clean close — the S5 fault.
    stream.req.destroy();
    await settle(250);

    expect(h.registry.size).toBe(0);
    expect(h.listenerCount).toBe(0);
  });

  it("S6 — repeated open/abort churn returns to baseline", async () => {
    const h = await listeningHarness();
    const token = h.tokens.mintForSession("session-a");

    for (let i = 0; i < 10; i += 1) {
      const stream = openStream(h.port, token, ["session-a"]);
      await stream.headersPromise;
      stream.req.destroy();
      await settle(40);
    }
    await settle(250);

    expect(h.registry.size).toBe(0);
    expect(h.listenerCount).toBe(0);
  });
});
