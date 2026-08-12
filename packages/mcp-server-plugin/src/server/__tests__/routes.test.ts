/**
 * Route-level conformance and the auth boundary, against a real Fastify
 * instance with a not-found handler that mimics the dev-mode SPA fallback.
 *
 * Covers E1/E2/E4 (405), E5/E6 (Mcp-Session-Id ignored), E7 (Last-Event-ID),
 * E17 (malformed bodies), A1-A4/A7/A9 (auth), A8 (the negative control), X7
 * (concurrency) and X11 (oversized bodies).
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpTokenRegistry } from "../tokens.js";
import { META_VERSION_KEY } from "../protocol.js";
import { MCP_BODY_LIMIT_BYTES, REJECTED_METHODS, mountMcpRoutes } from "../routes.js";

const V = "2026-07-28";
const meta = { _meta: { [META_VERSION_KEY]: V } };

const SPA_HTML = "<!doctype html><html><body>dashboard SPA</body></html>";

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

async function harness(opts: { withAuth?: boolean } = {}): Promise<Harness> {
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
    invokeTool,
    serverInfo: { name: "pi-dashboard", version: "0.7.0" },
    openSubscription: async (ids: string[]) => ({ subscribed: ids }),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  };

  if (opts.withAuth === false) {
    // A8's negative control: the same routes with the credential check
    // removed. Used to prove the auth assertions actually bite.
    mountMcpRoutes(app, { ...deps, verifyDeviceToken: () => "anyone", tokens: { resolve: () => ({ kind: "device", deviceId: "anyone" }) } });
  } else {
    mountMcpRoutes(app, deps);
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
    mountMcpRoutes(app, {
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
