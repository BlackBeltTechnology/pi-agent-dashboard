/**
 * Route-level conformance and the auth boundary, against a real Fastify
 * instance with a not-found handler that mimics the dev-mode SPA fallback.
 *
 * Covers E1/E2/E4 (405), E5/E6 (Mcp-Session-Id ignored), E7 (Last-Event-ID),
 * E17 (malformed bodies), A1-A4/A7/A9 (auth), A8 (the negative control), X7
 * (concurrency) and X11 (oversized bodies).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PairedDeviceRegistry } from "../../../../server/src/pairing/paired-devices.js";
import { META_VERSION_KEY } from "../protocol.js";
import { MCP_BODY_LIMIT_BYTES, mountMcpRoutes, REJECTED_METHODS } from "../routes.js";
import { SubscriptionRegistry } from "../streaming.js";
import { McpTokenRegistry } from "../tokens.js";

const V = "2026-07-28";
const meta = { _meta: { [META_VERSION_KEY]: V } };

const SPA_HTML = "<!doctype html><html><body>dashboard SPA</body></html>";

import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { GeneratedTool } from "../generated/tools.js";

interface Harness {
  app: FastifyInstance;
  tokens: McpTokenRegistry;
  deviceTokens: Map<string, string>;
  invokeTool: ReturnType<typeof vi.fn>;
}

let open: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(open.map((a) => a.close()));
  open = [];
});

async function harness(
  opts: {
    withAuth?: boolean;
    tools?: readonly GeneratedTool[];
    tiers?: Map<string, { id: string; tier: Tier }>;
  } = {},
): Promise<Harness> {
  const app = Fastify();
  open.push(app);
  const tokens = new McpTokenRegistry();
  const deviceTokens = new Map<string, string>();
  const invokeTool = vi.fn(async () => ({ ok: true }));

  // Mimics the real server: an unmatched method falls through here, and in
  // --dev this returns the SPA with a 200. Any route that reaches it is a
  // conformance failure disguised as success.
  app.setNotFoundHandler((_req, reply) => {
    reply.code(200).type("text/html").send(SPA_HTML);
  });

  const deps = {
    tokens,
    verifyDeviceToken: (t: string) => deviceTokens.get(t) ?? null,
    verifyDeviceTokenTier: opts.tiers ? (t: string) => opts.tiers!.get(t) ?? null : undefined,
    tools: opts.tools,
    invokeTool,
    serverInfo: { name: "pi-dashboard", version: "0.7.0" },
    openSubscription: async (ids: string[]) => ({ subscribed: ids }),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  if (opts.withAuth === false) {
    // A8's negative control: the same routes with the credential check
    // removed. Used to prove the auth assertions actually bite.
    await mountMcpRoutes(app, { ...deps, verifyDeviceToken: () => "anyone", tokens: { resolve: () => ({ kind: "device", deviceId: "anyone", tier: "operate" }) } });
  } else {
    await mountMcpRoutes(app, deps);
  }

  await app.ready();
  return { app, tokens, deviceTokens, invokeTool };
}

const rpc = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: { ...meta, ...params },
});

const authed = (token: string) => ({
  authorization: `Bearer ${token}`,
  "mcp-protocol-version": V,
  "content-type": "application/json",
});

describe("E1/E2/E4 — non-POST methods return 405, never the SPA", () => {
  it.each(REJECTED_METHODS)("%s /mcp returns 405", async (method) => {
    const { app } = await harness();
    const res = await app.inject({ method, url: "/mcp" });
    expect(res.statusCode).toBe(405);
  });

  it.each(REJECTED_METHODS)("%s /mcp body is not the SPA document", async (method) => {
    const { app } = await harness();
    const res = await app.inject({ method, url: "/mcp" });
    expect(res.body).not.toContain("dashboard SPA");
    expect(res.body).not.toContain("<!doctype html");
  });

  it("E3 — a GET with no Accept header still 405s and never reaches the not-found handler", async () => {
    // The dev-mode shape: a bare GET is exactly what a browser or a probing
    // client sends, and it is the request most likely to be answered with HTML.
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/mcp", headers: {} });
    expect(res.statusCode).toBe(405);
    expect(res.body).not.toContain("dashboard SPA");
  });

  it("advertises POST in the Allow header", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/mcp" });
    expect(res.headers.allow).toBe("POST");
  });

  it("S8 — there is no standalone GET event stream", async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: "GET",
      url: "/mcp",
      headers: { accept: "text/event-stream" },
    });
    expect(res.statusCode).toBe(405);
  });

  it("proves the fallback is real — an unrelated path DOES hit the SPA handler", async () => {
    // Without this, the 405 assertions above could pass on a server that has
    // no fallback at all, making them vacuous.
    const { app } = await harness();
    const res = await app.inject({ method: "GET", url: "/some/other/path" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("dashboard SPA");
  });

  it("REGRESSION — mounting /mcp does not hijack the host's error handling", async () => {
    // `setErrorHandler` is global on the instance it is called on. Registering
    // ours directly on the shared ctx.fastify replaced the DASHBOARD's handler
    // and turned every SPA route into a 500 (caught by spa-fallback.test.ts).
    // The routes now live in an encapsulated scope; this asserts the isolation
    // rather than trusting it.
    const app = Fastify();
    open.push(app);
    let hostHandlerRan = false;
    app.setErrorHandler((_err, _req, reply) => {
      hostHandlerRan = true;
      reply.code(200).type("text/html").send(SPA_HTML);
    });
    app.get("/host-route", async () => {
      throw new Error("host route exploded");
    });

    await mountMcpRoutes(app, {
      tokens: new McpTokenRegistry(),
      verifyDeviceToken: () => null,
      invokeTool: async () => ({}),
      serverInfo: { name: "pi-dashboard", version: "0.7.0" },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/host-route" });

    expect(hostHandlerRan).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("dashboard SPA");
  });
});

describe("A1-A4, A7, A9 — the auth boundary", () => {
  it("A1 — a request with no Authorization is refused and no tool runs", async () => {
    const { app, invokeTool } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": V },
      payload: rpc("tools/call", { name: "list_sessions", arguments: {} }),
    });
    expect(res.statusCode).toBe(401);
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it.each([
    ["garbage", "Bearer not-a-real-token"],
    ["a well-formed unknown token", "Bearer mcp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  ])("A2 — %s is refused", async (_label, authorization) => {
    const { app, invokeTool } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization, "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(401);
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["bare scheme", "Bearer"],
    ["scheme with trailing space only", "Bearer "],
    ["a different scheme", "Basic dXNlcjpwYXNz"],
    ["a very long token", `Bearer ${"a".repeat(100_000)}`],
    ["scheme only, wrong case", "bearer"],
  ])("A9 — a malformed Authorization (%s) is refused without crashing", async (_l, authorization) => {
    const { app } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization, "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("A3 — a valid session token authenticates (the positive control)", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(200);
  });

  it("A4 — a cookie carrying a valid dashboard token does not authenticate /mcp", async () => {
    const { app } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { cookie: "pi_dash_token=totally-valid", "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(401);
  });

  it("A7 — the credential is per-request; a second request without it is refused", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const first = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: rpc("tools/list"),
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(second.statusCode).toBe(401);
  });

  it("A6 — a revoked token stops working immediately", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    expect(
      (await app.inject({ method: "POST", url: "/mcp", headers: authed(token), payload: rpc("tools/list") }))
        .statusCode,
    ).toBe(200);

    tokens.revokeSession("session-a");

    expect(
      (await app.inject({ method: "POST", url: "/mcp", headers: authed(token), payload: rpc("tools/list") }))
        .statusCode,
    ).toBe(401);
  });

  it("M5 — a device token authenticates but carries no originating session", async () => {
    const { app, deviceTokens } = await harness();
    deviceTokens.set("device-token", "device-1");
    // A device caller has no session, so a self-target is impossible: this call
    // targeting any session must be permitted.
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed("device-token"),
      payload: rpc("tools/call", { name: "abort", arguments: { sessionId: "anything" } }),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("A8 — the negative control proves the auth assertions bite", () => {
  it("FAILS closed: with the credential check defeated, an unauthenticated POST succeeds", async () => {
    // If this assertion ever flips to 401, the auth tests above are no longer
    // detecting anything and A1/A2/A4 have become vacuous.
    const { app } = await harness({ withAuth: false });
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer anything-at-all", "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("E5/E6/E7 — headers this revision must ignore", () => {
  it("E5 — an inbound Mcp-Session-Id is ignored and never echoed", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...authed(token), "mcp-session-id": "abc" },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["mcp-session-id"]).toBeUndefined();
  });

  it("E6 — an empty Mcp-Session-Id raises no error on its own account", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...authed(token), "mcp-session-id": "" },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(200);
  });

  it("E7 — Last-Event-ID is ignored and a fresh result is returned", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const withHeader = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...authed(token), "last-event-id": "42" },
      payload: rpc("tools/list"),
    });
    const without = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: rpc("tools/list"),
    });
    expect(withHeader.statusCode).toBe(200);
    expect(withHeader.json()).toEqual(without.json());
  });
});

describe("E17/X11 — malformed and oversized bodies", () => {
  it("E17 — invalid JSON becomes a JSON-RPC parse error, not a 500", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32700 } });
  });

  it("E17 — valid JSON that is not JSON-RPC is an invalid-request error", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: { hello: "world" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: -32600 } });
  });

  it("E17 — a tool rejection becomes -32603, never a 500 with a stack", async () => {
    const app = Fastify();
    open.push(app);
    const tokens = new McpTokenRegistry();
    await mountMcpRoutes(app, {
      tokens,
      verifyDeviceToken: () => null,
      invokeTool: async () => {
        throw new Error("handler exploded");
      },
      serverInfo: { name: "pi-dashboard", version: "0.7.0" },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    await app.ready();
    const token = tokens.mintForSession("session-a");

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: rpc("tools/call", { name: "list_sessions", arguments: {} }),
    });
    expect(res.json()).toMatchObject({ error: { code: -32603, message: "Internal error" } });
    expect(res.body).not.toContain("handler exploded");
  });

  it("X11 — a body over the limit is rejected in bounded work", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    const oversized = {
      ...rpc("tools/call", { name: "send_prompt", arguments: { sessionId: "B", text: "x" } }),
      padding: "x".repeat(MCP_BODY_LIMIT_BYTES + 1024),
    };
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: oversized,
    });
    expect(res.statusCode).toBe(413);
  });

  it("X11 — a deeply nested payload does not overflow the stack", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");
    let nested = "1";
    for (let i = 0; i < 10_000; i += 1) nested = `[${nested}]`;
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":${nested}}`,
    });
    // Whatever the verdict, it must be a bounded HTTP answer rather than a
    // crashed process.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });
});

describe("X7 — concurrency", () => {
  it("50 concurrent calls all resolve with no cross-request bleed", async () => {
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");

    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        app.inject({
          method: "POST",
          url: "/mcp",
          headers: authed(token),
          payload: { ...rpc("tools/list"), id: i },
        }),
      ),
    );

    expect(responses).toHaveLength(50);
    for (const [i, res] of responses.entries()) {
      expect(res.statusCode).toBe(200);
      // The id proves each response went to its own request.
      expect(res.json().id).toBe(i);
    }
  });
});

describe("subscriptions/listen through the REAL route (not a mock hook)", () => {
  /**
   * These exist because the streaming class had full unit coverage while the
   * feature was entirely unwired: `openSubscription` was a stub that threw, so
   * every real call returned -32603 and the green suite proved nothing. Any
   * assertion about streaming has to traverse the actual route.
   */
  function streamingHarness() {
    const app = Fastify();
    open.push(app);
    const tokens = new McpTokenRegistry();
    const handlers = new Set<(sessionId: string, payload: unknown) => void>();
    const registry = new SubscriptionRegistry();

    const ready = mountMcpRoutes(app, {
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

    return {
      app,
      tokens,
      registry,
      ready,
      emit: (sessionId: string, payload: unknown) => {
        for (const h of [...handlers]) h(sessionId, payload);
      },
      get listenerCount() {
        return handlers.size;
      },
    };
  }

  it("advertises listen:true only when streaming is actually wired", async () => {
    const h = streamingHarness();
    await h.ready;
    await h.app.ready();
    const token = h.tokens.mintForSession("session-a");

    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: rpc("server/discover"),
    });
    expect(res.json().result.capabilities.subscriptions.listen).toBe(true);
  });

  it("advertises listen:false when it is NOT wired", async () => {
    // The harness() fixture supplies no `streaming` dep, so the capability
    // must report false rather than promising a method that would 404.
    const { app, tokens } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(tokens.mintForSession("session-a")),
      payload: rpc("server/discover"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result.capabilities.subscriptions.listen).toBe(false);
  });

  it("reports subscriptions/listen unsupported when it is NOT wired", async () => {
    const { app, tokens } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(tokens.mintForSession("session-a")),
      payload: rpc("subscriptions/listen", { sessionIds: ["session-a"] }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("S3 — an absent sessionIds filter is refused and opens no subscription", async () => {
    const h = streamingHarness();
    await h.ready;
    await h.app.ready();
    const token = h.tokens.mintForSession("session-a");

    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(token),
      payload: rpc("subscriptions/listen"),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { data: { type: "InvalidSubscriptionFilter" } } });
    expect(h.registry.size).toBe(0);
    expect(h.listenerCount).toBe(0);
  });

  it("an unauthenticated listen never opens a subscription", async () => {
    const h = streamingHarness();
    await h.ready;
    await h.app.ready();

    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": V },
      payload: rpc("subscriptions/listen", { sessionIds: ["session-a"] }),
    });

    expect(res.statusCode).toBe(401);
    expect(h.registry.size).toBe(0);
  });
});

describe("the throttle is wired into the route", () => {
  it("returns 429 with Retry-After after repeated auth failures", async () => {
    const { app } = await harness();

    let last = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer wrong", "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(last.statusCode).toBe(401);

    for (let i = 0; i < 15; i += 1) {
      last = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: "Bearer wrong", "mcp-protocol-version": V },
        payload: rpc("tools/list"),
      });
    }

    expect(last.statusCode).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("a VALID credential is never throttled, however many requests it makes", async () => {
    // The failure mode this guards against is a self-inflicted outage: a
    // legitimate MCP session driving a fleet must not lock itself out.
    const { app, tokens } = await harness();
    const token = tokens.mintForSession("session-a");

    for (let i = 0; i < 50; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: authed(token),
        payload: rpc("tools/list"),
      });
      expect(res.statusCode).toBe(200);
    }
  });

  it("no tool runs while throttled", async () => {
    const { app, invokeTool } = await harness();
    for (let i = 0; i < 20; i += 1) {
      await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: "Bearer wrong", "mcp-protocol-version": V },
        payload: rpc("tools/call", { name: "list_sessions", arguments: {} }),
      });
    }
    expect(invokeTool).not.toHaveBeenCalled();
  });
});

/**
 * The dual-era contract (change: mcp-legacy-clients-and-token-issuance).
 *
 * Legacy requests declare a 2025-era revision: `initialize` opens with
 * `params.protocolVersion` (no header), later requests carry only the
 * `MCP-Protocol-Version` header. Modern requests keep the strict
 * header + `_meta` contract.
 */
describe("dual era — legacy initialize handshake (E2/E3/E4)", () => {
  const legacyInit = (protocolVersion?: unknown) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: protocolVersion === undefined ? {} : { protocolVersion },
  });
  const legacyHeaders = (token: string) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });

  it.each(["2025-03-26", "2025-06-18", "2025-11-25"])(
    "E2 — initialize %s is answered and mints a session id",
    async (version) => {
      const { app, tokens } = await harness();
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: legacyHeaders(tokens.mintForSession("session-a")),
        payload: legacyInit(version),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.error).toBeUndefined();
      expect(body.result.protocolVersion).toBe(version);
      expect(body.result.capabilities).toEqual({ tools: { listChanged: false } });
      expect(body.result.serverInfo.name.length).toBeGreaterThan(0);
      expect(res.headers["mcp-session-id"]).toMatch(/^[0-9a-f]{32}$/);
    },
  );

  it("E3 — an unknown version negotiates down to 2025-11-25, never an error", async () => {
    const { app, tokens } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: legacyHeaders(tokens.mintForSession("session-a")),
      payload: legacyInit("2027-01-01"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBeUndefined();
    expect(res.json().result.protocolVersion).toBe("2025-11-25");
    expect(res.headers["mcp-session-id"]).toBeTruthy();
  });

  it.each([
    ["params: {}", {}],
    ["protocolVersion: 42", { protocolVersion: 42 }],
  ])("E4 — initialize %s is refused with all four revisions named", async (_l, params) => {
    const { app, tokens } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: legacyHeaders(tokens.mintForSession("session-a")),
      payload: { ...legacyInit(), params },
    });
    expect(res.statusCode).toBe(400);
    const err = res.json().error;
    expect(err.data.type).toBe("UnsupportedProtocolVersionError");
    for (const v of ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"]) {
      expect(err.message).toContain(v);
    }
    expect(res.headers["mcp-session-id"]).toBeUndefined();
  });

  it("E5 — the modern era still refuses the handshake", async () => {
    const { app, tokens } = await harness();
    const t = tokens.mintForSession("session-a");
    const init = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(t),
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2026-07-28" } },
    });
    expect(init.statusCode).toBe(404);
    expect(init.json().error.code).toBe(-32601);
    expect(init.headers["mcp-session-id"]).toBeUndefined();

    for (const method of ["ping", "notifications/initialized"]) {
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: authed(t),
        payload: rpc(method),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe(-32601);
      expect(res.headers["mcp-session-id"]).toBeUndefined();
    }
  });
});

describe("dual era — legacy notifications, ping, tools (E6/E7/E8/E10)", () => {
  /** POST one legacy-era request on a fresh harness with the given payload. */
  async function injectLegacy(payload: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
    const h = await harness();
    return h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${h.tokens.mintForSession("session-a")}`,
        "mcp-protocol-version": "2025-06-18",
        "content-type": "application/json",
        ...extraHeaders,
      },
      payload,
    });
  }

  it.each([
    ["notifications/initialized", "notifications/initialized", {}],
    ["notifications/cancelled", "notifications/cancelled", {}],
    ["notifications/zzz", "notifications/zzz", {}],
    ["notifications/initialized with a stray id", "notifications/initialized", { id: 7 }],
  ])("E6 — %s is accepted with 202 and an empty body", async (_label, method, extra) => {
    const { app, tokens } = await harness();
    const t = tokens.mintForSession("session-a");
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${t}`,
        "mcp-protocol-version": "2025-06-18",
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", method, params: {}, ...extra },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toHaveLength(0);
  });

  it("E7 — legacy ping answers an empty result object", async () => {
    const res = await injectLegacy({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({});
  });

  it("E8 — legacy and modern tool calls return identical bodies", async () => {
    const { app, tokens } = await harness();
    const t = tokens.mintForSession("session-a");
    const legacyHeaders = {
      authorization: `Bearer ${t}`,
      "mcp-protocol-version": "2025-06-18",
      "content-type": "application/json",
    };
    const legacy = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: legacyHeaders,
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    const modern = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(t),
      payload: rpc("tools/list"),
    });
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json()).toEqual(modern.json());
    expect(legacy.headers["mcp-session-id"]).toBeUndefined();

    const legacyCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: legacyHeaders,
      payload: { jsonrpc: "2.0", id: 2, method: "server/discover", params: {} },
    });
    const modernCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(t),
      payload: rpc("server/discover"),
    });
    expect(legacyCall.json().result).toEqual(modernCall.json().result);
  });

  it("E10 — an unknown Mcp-Session-Id still dispatches (never 404)", async () => {
    const res = await injectLegacy(
      { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
      { "mcp-session-id": "deadbeef" },
    );
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().result.tools)).toBe(true);
  });
});

describe("dual era — session id and version markers", () => {
  it("E11 — the modern era ignores an inbound Mcp-Session-Id", async () => {
    const { app, tokens } = await harness();
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...authed(tokens.mintForSession("session-a")), "mcp-session-id": "deadbeef" },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["mcp-session-id"]).toBeUndefined();
  });

  it("X3 — a repeated MCP-Protocol-Version header is refused on every method", async () => {
    const { app, tokens } = await harness();
    const t = tokens.mintForSession("session-a");
    const toolsList = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${t}`,
        // light-my-request forwards array header values as distinct headers.
        "mcp-protocol-version": ["2025-06-18", "2026-07-28"] as unknown as string,
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(toolsList.statusCode).toBe(400);
    expect(toolsList.json().error.data.type).toBe("AmbiguousHeader");

    const init = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${t}`,
        "mcp-protocol-version": ["2025-06-18", "2026-07-28"] as unknown as string,
        "content-type": "application/json",
      },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    });
    expect(init.statusCode).toBe(400);
    expect(init.json().error.data.type).toBe("AmbiguousHeader");
    expect(init.headers["mcp-session-id"]).toBeUndefined();
  });
});

describe("dual era — subscriptions/listen is subject to version resolution (E12)", () => {
  function listenHarness() {
    const app = Fastify();
    open.push(app);
    const tokens = new McpTokenRegistry();
    const handlers = new Set<(sessionId: string, payload: unknown) => void>();
    const registry = new SubscriptionRegistry();
    const openSpy = vi.spyOn(registry, "open");
    const ready = mountMcpRoutes(app, {
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
    return { app, tokens, open: openSpy, ready };
  }

  it.each([
    ["header 2026-07-28 with no _meta", "2026-07-28", { _meta: {} } as Record<string, unknown>, 400, "MissingProtocolVersion"],
    ["unsupported header 1999-01-01", "1999-01-01", { _meta: {} } as Record<string, unknown>, 400, "UnsupportedProtocolVersionError"],
  ])("refuses with the version error any other method receives (%s)", async (_l, header, params, status, type) => {
    const h = listenHarness();
    await h.ready;
    await h.app.ready();
    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${h.tokens.mintForSession("s")}`, "mcp-protocol-version": header },
      payload: { jsonrpc: "2.0", id: 1, method: "subscriptions/listen", params },
    });
    expect(res.statusCode).toBe(status);
    expect(res.json().error.data.type).toBe(type);
    expect(h.open).not.toHaveBeenCalled();
  });

  it("a header/body mismatch is a 400 HeaderMismatch", async () => {
    const h = listenHarness();
    await h.ready;
    await h.app.ready();
    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${h.tokens.mintForSession("s")}`, "mcp-protocol-version": "2026-07-28" },
      payload: {
        jsonrpc: "2.0",
        id: 1,
        method: "subscriptions/listen",
        params: { _meta: { [META_VERSION_KEY]: "2025-06-18" }, sessionIds: ["s1"] },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.type).toBe("HeaderMismatch");
    expect(h.open).not.toHaveBeenCalled();
  });

  it("a legacy-era listen is the removed-method shape, and no stream opens (D3)", async () => {
    const h = listenHarness();
    await h.ready;
    await h.app.ready();
    const res = await h.app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${h.tokens.mintForSession("s")}`, "mcp-protocol-version": "2025-06-18" },
      payload: { jsonrpc: "2.0", id: 1, method: "subscriptions/listen", params: { sessionIds: ["s1"] } },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe(-32601);
    expect(h.open).not.toHaveBeenCalled();
  });
});

describe("dual era — legacy authentication parity (X1/X2)", () => {
  it("X1 — legacy requests are authenticated identically", async () => {
    const { app } = await harness();
    for (const payload of [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { jsonrpc: "2.0", id: 1, method: "ping", params: {} },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    ] as const) {
      for (const headers of [
        { "mcp-protocol-version": "2025-06-18" },
        { "mcp-protocol-version": "2025-06-18", authorization: "Bearer not-a-real-token" },
      ]) {
        const res = await app.inject({ method: "POST", url: "/mcp", headers, payload });
        expect(res.statusCode).toBe(401);
        expect(res.headers["www-authenticate"]).toBe("Bearer");
        expect(res.headers["mcp-session-id"]).toBeUndefined();
      }
    }
  });

  it("X2 — a minted Mcp-Session-Id never substitutes for the credential", async () => {
    const { app, tokens } = await harness();
    const init = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${tokens.mintForSession("session-a")}` },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    });
    expect(init.statusCode).toBe(200);
    const sessionId = init.headers["mcp-session-id"] as string;

    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { "mcp-protocol-version": "2025-06-18", "mcp-session-id": sessionId },
      payload: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("dual era — malformed legacy payloads (X10)", () => {
  it("never produce a 500 or an unhandled rejection", async () => {
    const rejections: unknown[] = [];
    const handler = (err: unknown) => rejections.push(err);
    process.on("unhandledRejection", handler);
    try {
      const { app, tokens } = await harness();
      const t = tokens.mintForSession("session-a");
      const headers = {
        authorization: `Bearer ${t}`,
        "mcp-protocol-version": "2025-06-18",
        "content-type": "application/json",
      };
      for (const payload of ["not json", [], { jsonrpc: "2.0" }]) {
        const res = await app.inject({ method: "POST", url: "/mcp", headers, payload: payload as never });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).not.toBe(500);
        expect(res.statusCode).toBeLessThan(500);
        expect(res.json().error).toBeDefined();
      }
    } finally {
      process.off("unhandledRejection", handler);
    }
    expect(rejections).toEqual([]);
  });
});


// E14 (test-plan: mcp-legacy-clients-and-token-issuance) — a token minted by
// the direct-issuance route reaches /mcp as an indistinguishable device caller.
describe("E14 — a manually minted device token reaches /mcp", () => {
  it("authenticates as a device caller with no originating session", async () => {
    const app = Fastify();
    open.push(app);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-mcp-e14-"));
    try {
      const registry = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
      const invokeTool = vi.fn(async (_inv: { caller: unknown }) => ({ ok: true }));
      await mountMcpRoutes(app, {
        tokens: new McpTokenRegistry(),
        verifyDeviceToken: () => null,
        verifyDeviceTokenTier: (t: string) => registry.verify(t),
        invokeTool,
        serverInfo: { name: "pi-dashboard", version: "0.7.0" },
        log: { info: () => {}, warn: () => {}, error: () => {} },
      });
      await app.ready();

      const { device, token } = registry.add("cli", "manual", "operate");
      const res = await app.inject({
        method: "POST",
        url: "/mcp",
        headers: authed(token),
        payload: rpc("tools/call", { name: "abort", arguments: { sessionId: "anything" } }),
      });
      expect(res.statusCode).toBe(200);
      expect(invokeTool).toHaveBeenCalledOnce();
      // Device caller: no originating session, so any session target is allowed.
      expect(invokeTool.mock.calls[0][0].caller).toEqual({
        kind: "device",
        deviceId: device.id,
        tier: "operate",
      });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("E8 — one session's stale token never denies a healthy one (route level)", () => {
  it("A's throttled fingerprint does not stop B's valid credential from the same ip", async () => {
    const { app, tokens } = await harness();

    // Session B holds a VALID token.
    const bToken = tokens.mintForSession("session-b");

    // Session A presents its stale token past the per-credential threshold.
    for (let i = 0; i < 15; i += 1) {
      await app.inject({
        method: "POST",
        url: "/mcp",
        headers: { authorization: "Bearer stale-token-A", "mcp-protocol-version": V },
        payload: rpc("tools/list"),
      });
    }

    // A's credential bucket is exhausted — A gets 429...
    const aRes = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: "Bearer stale-token-A", "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(aRes.statusCode).toBe(429);

    // ...while B, from the SAME 127.0.0.1, is served.
    const bRes = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed(bToken),
      payload: rpc("tools/list"),
    });
    expect(bRes.statusCode).toBe(200);
  });

  it("E5 — an unminted well-formed mcp_ bearer is refused and creates no row", async () => {
    const { app, tokens } = await harness();
    const before = tokens.size;
    const forged = `mcp_${"A".repeat(43)}`;
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { authorization: `Bearer ${forged}`, "mcp-protocol-version": V },
      payload: rpc("tools/list"),
    });
    expect(res.statusCode).toBe(401);
    expect(tokens.size).toBe(before);
  });
});

// ── E11–E13 (test-plan expand-mcp-tiered-surface): path cap + 404 discipline ─

const tierFixtureTools: readonly GeneratedTool[] = [
  mk("o_read", "observe"),
  mk("c_write", "control"),
  mk("p_kill", "operate"),
];

function mk(name: string, tier: Tier): GeneratedTool {
  return {
    name,
    description: `${tier} tool`,
    tier,
    annotations: { readOnlyHint: tier === "observe", destructiveHint: false },
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    bind: { kind: "context", member: "sessionManager" },
    paramSplit: { path: [], bodyAll: true },
    sessionTargeting: false,
  };
}

async function toolsListAt(url: string, token: string, tiers: Map<string, { id: string; tier: Tier }>) {
  const { app } = await harness({ tools: tierFixtureTools, tiers });
  const res = await app.inject({
    method: "POST",
    url,
    headers: authed(token),
    payload: rpc("tools/list"),
  });
  expect(res.statusCode, url).toBe(200);
  return (res.json() as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
}

describe("E11/E12 — path cap", () => {
  it("operate token at /mcp/observe, /mcp/control, /mcp → 1 / 2 / 3 tools", async () => {
    const tiers = new Map([["op", { id: "d", tier: "operate" as Tier }]]);
    expect(await toolsListAt("/mcp/observe", "op", tiers)).toEqual(["o_read"]);
    expect(await toolsListAt("/mcp/control", "op", tiers)).toEqual(["o_read", "c_write"]);
    expect(await toolsListAt("/mcp", "op", tiers)).toEqual(["o_read", "c_write", "p_kill"]);
  });

  it("the cap never raises: observe token at /mcp/control still sees the observe set", async () => {
    const tiers = new Map([["ob", { id: "d", tier: "observe" as Tier }]]);
    expect(await toolsListAt("/mcp/control", "ob", tiers)).toEqual(["o_read"]);
  });
});

describe("E13 — bad suffix / method discipline", () => {
  it("POST /mcp/operate and GET /mcp/nope are 404 JSON, never the SPA", async () => {
    const { app } = await harness();
    const post = await app.inject({ method: "POST", url: "/mcp/operate", headers: authed("x"), payload: rpc("tools/list") });
    expect(post.statusCode).toBe(404);
    expect(post.headers["content-type"]).toContain("application/json");
    expect(post.body).not.toContain("<!doctype html");

    const get = await app.inject({ method: "GET", url: "/mcp/nope" });
    expect(get.statusCode).toBe(404);
    expect(get.headers["content-type"]).toContain("application/json");
    expect(get.body).not.toContain("<!doctype html");
  });

  it("PUT /mcp/observe is 405 like PUT /mcp", async () => {
    const { app } = await harness();
    const res = await app.inject({ method: "PUT", url: "/mcp/observe" });
    expect(res.statusCode).toBe(405);
  });
});

// X10 (test-plan expand-mcp-tiered-surface) — a token revoked mid-flight 401s.
describe("X10 — revocation is checked per request", () => {
  it("tools/list works, then the same token is revoked and tools/call is 401 (not 403)", async () => {
    const tiers = new Map<string, { id: string; tier: Tier }>([["tok", { id: "d", tier: "observe" }]]);
    const { app } = await harness({ tools: tierFixtureTools, tiers });

    const list = await app.inject({ method: "POST", url: "/mcp", headers: authed("tok"), payload: rpc("tools/list") });
    expect(list.statusCode).toBe(200);

    tiers.delete("tok");

    const call = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: authed("tok"),
      payload: rpc("tools/call", { name: "o_read", arguments: {} }),
    });
    expect(call.statusCode).toBe(401);
  });
});
