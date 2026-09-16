/**
 * JSON-RPC dispatch.
 *
 * Covers E8/E9 (no handshake; explicit initialize unsupported), E16 (unknown
 * method 404 + -32601), E17 (malformed bodies are JSON-RPC errors, not 500s),
 * E18 (request independence), E19/E20 (server/discover), E26 (sessionId
 * validation), G1/G2/G5 (self-target refusal through the real dispatch path),
 * S3 (empty filter) and S7 (legacy subscription methods).
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedVersion } from "../dispatch.js";
import {
  buildDiscoverResult,
  type DispatchDeps,
  dispatchRpc,
  type InjectOptions,
  parseSubscriptionFilter,
  REMOVED_METHODS,
} from "../dispatch.js";
import { parseRpcRequest, RPC_INVALID_PARAMS, RPC_METHOD_NOT_FOUND } from "../jsonrpc.js";
import { listSessions, validateListSessionsArgs } from "../list-sessions.js";
import { META_VERSION_KEY, SUPPORTED_PROTOCOL_VERSIONS } from "../protocol.js";
import type { McpCaller } from "../tokens.js";

const V = "2026-07-28";
const MODERN: ResolvedVersion = { era: "modern", version: V };
const meta = { _meta: { [META_VERSION_KEY]: V } };
const deviceCaller: McpCaller = { kind: "device", deviceId: "d1", tier: "operate" };
const sessionCaller = (id: string): McpCaller => ({ kind: "session", sessionId: id, tier: "control" });

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    invokeTool: vi.fn(async () => ({ ok: true })),
    serverInfo: { name: "pi-dashboard", version: "0.7.0" },
    openSubscription: vi.fn(async (sessionIds: string[]) => ({ subscribed: sessionIds })),
    validateToolArgs: (name, args) =>
      name === "list_sessions" ? validateListSessionsArgs(args) : null,
    ...over,
  };
}

const req = (method: string, params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0" as const,
  id: 1,
  method,
  params: { ...meta, ...params },
});

describe("E8/E9 — statelessness and the removed handshake", () => {
  it("E8 — a first-ever tools/call succeeds with no prior initialize", async () => {
    const d = deps();
    const r = await dispatchRpc(
      req("tools/call", { name: "list_sessions", arguments: {} }),
      MODERN,
      deviceCaller,
      d,
    );
    expect(r.status).toBe(200);
    expect(d.invokeTool).toHaveBeenCalledOnce();
  });

  it.each(REMOVED_METHODS)("E9/S7 — %s is reported unsupported, not silently accepted", async (m) => {
    const r = await dispatchRpc(req(m), MODERN, deviceCaller, deps());
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({
      error: { code: RPC_METHOD_NOT_FOUND, data: { type: "MethodRemoved" } },
    });
  });

  it("E18 — two identical calls are independent; the second does not depend on the first", async () => {
    const d = deps();
    const call = () =>
      dispatchRpc(req("tools/call", { name: "list_sessions", arguments: {} }), MODERN, deviceCaller, d);
    const first = await call();
    const second = await call();
    expect(second).toEqual(first);
  });

  it("E18 — issuing tools/call FIRST yields the same result as issuing it second", async () => {
    const solo = await dispatchRpc(
      req("tools/call", { name: "list_sessions", arguments: {} }),
      MODERN,
      deviceCaller,
      deps(),
    );
    const d = deps();
    await dispatchRpc(req("tools/list"), MODERN, deviceCaller, d);
    const after = await dispatchRpc(
      req("tools/call", { name: "list_sessions", arguments: {} }),
      MODERN,
      deviceCaller,
      d,
    );
    expect(after).toEqual(solo);
  });
});

describe("E16 — unknown method", () => {
  it("returns 404 with JSON-RPC -32601", async () => {
    const r = await dispatchRpc(req("tools/nope"), MODERN, deviceCaller, deps());
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ id: 1, error: { code: RPC_METHOD_NOT_FOUND } });
  });

  it("echoes the request id so the client can correlate the failure", async () => {
    const r = await dispatchRpc(
      { jsonrpc: "2.0", id: "abc", method: "nope", params: meta },
      MODERN,
      deviceCaller,
      deps(),
    );
    expect(r.body?.id).toBe("abc");
  });
});

describe("E17 — malformed bodies never become 500s", () => {
  it.each([
    ["a JSON array", []],
    ["a bare string", "hello"],
    ["a number", 7],
    ["null", null],
    ["an object without jsonrpc", { id: 1, method: "tools/list" }],
    ["a wrong jsonrpc version", { jsonrpc: "1.0", id: 1, method: "tools/list" }],
    ["an object without a method", { jsonrpc: "2.0", id: 1 }],
    ["a non-string method", { jsonrpc: "2.0", id: 1, method: 42 }],
    ["an empty method", { jsonrpc: "2.0", id: 1, method: "" }],
  ])("%s is an invalid-request error, not a 500", (_label, body) => {
    const parsed = parseRpcRequest(body);
    expect("ok" in parsed && parsed.ok).toBe(false);
    if ("ok" in parsed) throw new Error("unreachable");
    expect(parsed.status).toBe(400);
    expect(parsed.status).not.toBe(500);
  });

  it("a valid envelope parses and preserves the id", () => {
    const parsed = parseRpcRequest({ jsonrpc: "2.0", id: 9, method: "tools/list" });
    expect(parsed).toMatchObject({ ok: true, request: { id: 9, method: "tools/list" } });
  });

  it("a tool rejection surfaces as an error rather than an unhandled rejection", async () => {
    const d = deps({ invokeTool: vi.fn(async () => { throw new Error("boom"); }) });
    await expect(
      dispatchRpc(req("tools/call", { name: "list_sessions", arguments: {} }), MODERN, deviceCaller, d),
    ).rejects.toThrow("boom");
    // The route layer owns the -32603 conversion; asserted there. What matters
    // here is that the rejection is a REJECTION, observable and catchable, not
    // a swallowed promise.
  });
});

describe("E19/E20 — server/discover", () => {
  it("E19 — advertises versions, capabilities and identity", async () => {
    const r = await dispatchRpc(req("server/discover"), MODERN, deviceCaller, deps());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      result: {
        protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        capabilities: { tools: {}, subscriptions: { listen: true } },
        serverInfo: { name: "pi-dashboard", version: "0.7.0" },
      },
    });
  });

  it("E20 — two calls are equivalent and create no shared state", async () => {
    const info = { name: "pi-dashboard", version: "0.7.0" };
    const a = buildDiscoverResult(info);
    const b = buildDiscoverResult(info);
    expect(a).toEqual(b);
    // Structurally distinct objects: mutating one result cannot affect the
    // next caller, which is what "no server-side state" means here.
    expect(a).not.toBe(b);
    a.serverInfo.name = "mutated";
    expect(buildDiscoverResult(info).serverInfo.name).toBe("pi-dashboard");
  });

  it("reports resources/subscribe as unavailable rather than omitting it", async () => {
    const r = await dispatchRpc(req("server/discover"), MODERN, deviceCaller, deps());
    expect(r.body).toMatchObject({ result: { capabilities: { resources: { subscribe: false } } } });
  });
});

describe("E26 — tools/call argument validation", () => {
  it("an unknown tool name returns 404", async () => {
    const r = await dispatchRpc(
      req("tools/call", { name: "no_such_tool", arguments: {} }),
      MODERN,
      deviceCaller,
      deps(),
    );
    expect(r.status).toBe(404);
  });

  it("an absent sessionId is invalid-params, and no tool runs", async () => {
    const d = deps();
    const r = await dispatchRpc(
      req("tools/call", { name: "abort", arguments: {} }),
      MODERN,
      deviceCaller,
      d,
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("an empty sessionId is invalid-params, not a lookup miss", async () => {
    const r = await dispatchRpc(
      req("tools/call", { name: "abort", arguments: { sessionId: "" } }),
      MODERN,
      deviceCaller,
      deps(),
    );
    expect(r.status).toBe(400);
  });

  it("a valid sessionId reaches the handler", async () => {
    const d = deps();
    const r = await dispatchRpc(
      req("tools/call", { name: "abort", arguments: { sessionId: "B" } }),
      MODERN,
      deviceCaller,
      d,
    );
    expect(r.status).toBe(200);
    expect(d.invokeTool).toHaveBeenCalledOnce();
  });
});

describe("G1/G2/G5 — self-target refusal through dispatch", () => {
  it("G1 — refuses a self-targeted call and never invokes the tool", async () => {
    const d = deps();
    const r = await dispatchRpc(
      req("tools/call", { name: "send_prompt", arguments: { sessionId: "A", text: "hi" } }),
      MODERN,
      sessionCaller("A"),
      d,
    );
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: { data: { type: "SelfTargetRefused" } } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("G2 — a self-targeted slash command is refused before the tool runs", async () => {
    const d = deps();
    const r = await dispatchRpc(
      req("tools/call", { name: "send_prompt", arguments: { sessionId: "A", text: "/compact" } }),
      MODERN,
      sessionCaller("A"),
      d,
    );
    expect(r.status).toBe(403);
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("G5 — the refusal is recorded with caller, target and tool", async () => {
    const recordRefusal = vi.fn();
    await dispatchRpc(
      req("tools/call", { name: "send_prompt", arguments: { sessionId: "A", text: "hi" } }),
      MODERN,
      sessionCaller("A"),
      deps({ recordRefusal }),
    );
    expect(recordRefusal).toHaveBeenCalledWith({
      callerSessionId: "A",
      targetSessionId: "A",
      tool: "send_prompt",
    });
  });

  it("G3 — cross-session control still reaches the tool", async () => {
    const d = deps();
    const r = await dispatchRpc(
      req("tools/call", { name: "send_prompt", arguments: { sessionId: "B", text: "hi" } }),
      MODERN,
      sessionCaller("A"),
      d,
    );
    expect(r.status).toBe(200);
    expect(d.invokeTool).toHaveBeenCalledOnce();
  });

  it("M3 — an undeclared session claim in the arguments is rejected, not honoured", async () => {
    const d = deps();
    // The caller is a DEVICE token. A stray `callerSessionId` is rejected by
    // strict validation before the handler, so the claim cannot even be
    // presented — stronger than silently ignoring it.
    const r = await dispatchRpc(
      req("tools/call", {
        name: "send_prompt",
        arguments: { sessionId: "A", text: "hi", callerSessionId: "A" },
      }),
      MODERN,
      deviceCaller,
      d,
    );
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });
});

describe("S3 — subscription filter (Decision 9)", () => {
  it.each([
    ["absent", {}],
    ["empty array", { sessionIds: [] }],
    ["a string", { sessionIds: "A" }],
    ["null", { sessionIds: null }],
    ["an array containing a non-string", { sessionIds: ["A", 7] }],
    ["an array containing an empty string", { sessionIds: [""] }],
  ])("rejects a %s filter with invalid-params", (_label, params) => {
    const r = parseSubscriptionFilter(params);
    expect(r.ok).toBe(false);
  });

  it("accepts an explicit list of session ids", () => {
    expect(parseSubscriptionFilter({ sessionIds: ["A", "B"] })).toEqual({
      ok: true,
      sessionIds: ["A", "B"],
    });
  });

  it("an absent filter never opens a stream", async () => {
    const openSubscription = vi.fn();
    const r = await dispatchRpc(req("subscriptions/listen"), MODERN, deviceCaller, deps({ openSubscription }));
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { data: { type: "InvalidSubscriptionFilter" } } });
    expect(openSubscription).not.toHaveBeenCalled();
  });

  it("a valid filter opens a stream scoped to exactly those sessions", async () => {
    const openSubscription = vi.fn(async (ids: string[]) => ({ subscribed: ids }));
    const r = await dispatchRpc(
      req("subscriptions/listen", { sessionIds: ["A"] }),
      MODERN,
      deviceCaller,
      deps({ openSubscription }),
    );
    expect(r.status).toBe(200);
    expect(openSubscription).toHaveBeenCalledWith(["A"], deviceCaller);
  });
});

describe("dispatch does not re-resolve the version (single resolution site, D1)", () => {
  it("a legacy verdict routes into the legacy surface even with modern-looking meta", async () => {
    // The resolver ran once in routes; dispatch trusts the verdict it is
    // handed. An initialize resolved legacy is answered, not refused.
    const r = await dispatchRpc(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
      { era: "legacy", version: "2025-06-18" },
      deviceCaller,
      deps(),
    );
    expect(r.status).toBe(200);
    expect((r.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe("2025-06-18");
    expect(r.sessionId).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ── E10, X1–X4 (test-plan expand-mcp-tiered-surface) ──────────────────────
// Tier filter + scope challenge. A fixture manifest with one tool per tier
// exercises the filter without the full 130-row manifest.
import { RPC_INSUFFICIENT_SCOPE } from "../jsonrpc.js";
import { GENERATED_TOOLS, type GeneratedTool } from "../generated/tools.js";

const fixtureTools: readonly GeneratedTool[] = [
  {
    name: "read_sessions",
    description: "observe",
    tier: "observe",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    bind: { kind: "context", member: "sessionManager" },
    paramSplit: { path: [], bodyAll: true },
    sessionTargeting: false,
  },
  {
    name: "send_prompt",
    description: "control",
    tier: "control",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "" }, text: { type: "string", description: "" } },
      required: ["sessionId", "text"],
      additionalProperties: false,
    },
    bind: { kind: "context", member: "sendToSession" },
    paramSplit: { path: [], bodyAll: true },
    sessionTargeting: true,
  },
  {
    name: "force_kill",
    description: "operate",
    tier: "operate",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "" } },
      required: ["sessionId"],
      additionalProperties: false,
    },
    bind: { kind: "rest", method: "POST", path: "/api/session/:id/lifecycle", fixed: { action: "force_kill" } },
    paramSplit: { path: [{ arg: "sessionId", param: "id" }], bodyAll: true },
    sessionTargeting: true,
  },
];

const callerAt = (tier: "observe" | "control" | "operate"): McpCaller => ({
  kind: "device",
  deviceId: "d1",
  tier,
});

const toolNames = (r: Awaited<ReturnType<typeof dispatchRpc>>): string[] =>
  (r.body as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);

describe("E10 — tools/list is filtered to the caller's tier", () => {
  it("observe ⊆ control ⊆ operate", async () => {
    const observe = await dispatchRpc(req("tools/list"), MODERN, callerAt("observe"), deps({ tools: fixtureTools }));
    const control = await dispatchRpc(req("tools/list"), MODERN, callerAt("control"), deps({ tools: fixtureTools }));
    const operate = await dispatchRpc(req("tools/list"), MODERN, callerAt("operate"), deps({ tools: fixtureTools }));

    expect(toolNames(observe)).toEqual(["read_sessions"]);
    expect(toolNames(control)).toEqual(["read_sessions", "send_prompt"]);
    expect(toolNames(operate)).toEqual(["read_sessions", "send_prompt", "force_kill"]);

    const o = new Set(toolNames(observe));
    const c = new Set(toolNames(control));
    const p = new Set(toolNames(operate));
    for (const n of o) expect(c.has(n)).toBe(true);
    for (const n of c) expect(p.has(n)).toBe(true);
  });
});

describe("X1 — out-of-tier call is refused with a scope challenge", () => {
  it("observe caller → send_prompt: 403, header, -32001, handler not called, logged", async () => {
    const recordTierRefusal = vi.fn();
    const d = deps({ tools: fixtureTools, recordTierRefusal });
    const r = await dispatchRpc(
      req("tools/call", { name: "send_prompt", arguments: { sessionId: "S", text: "hi" } }),
      MODERN,
      callerAt("observe"),
      d,
    );
    expect(r.status).toBe(403);
    expect(r.wwwAuthenticate).toBe('Bearer error="insufficient_scope", scope="control"');
    const body = r.body as unknown as { error: { code: number; data: { scope: string } } };
    expect(body.error.code).toBe(RPC_INSUFFICIENT_SCOPE);
    expect(body.error.data.scope).toBe("control");
    expect(d.invokeTool).not.toHaveBeenCalled();
    expect(recordTierRefusal).toHaveBeenCalledWith({
      caller: callerAt("observe"),
      tool: "send_prompt",
      callerTier: "observe",
      requiredTier: "control",
    });
  });
});

describe("X2 — tier refusal precedes the self-target guard", () => {
  it("session caller A (control) cannot force_kill A; no guard refusal logged", async () => {
    const recordRefusal = vi.fn();
    const recordTierRefusal = vi.fn();
    const r = await dispatchRpc(
      req("tools/call", { name: "force_kill", arguments: { sessionId: "A" } }),
      MODERN,
      sessionCaller("A"),
      deps({ tools: fixtureTools, recordRefusal, recordTierRefusal }),
    );
    expect(r.status).toBe(403);
    expect((r.body as unknown as { error: { data: { scope: string } } }).error.data.scope).toBe("operate");
    expect(recordRefusal).not.toHaveBeenCalled();
    expect(recordTierRefusal).toHaveBeenCalledOnce();
  });
});

describe("X3 — tier refusal precedes argument validation", () => {
  it("observe caller with missing args gets 403, not -32602", async () => {
    const r = await dispatchRpc(
      req("tools/call", { name: "send_prompt", arguments: {} }),
      MODERN,
      callerAt("observe"),
      deps({ tools: fixtureTools }),
    );
    expect(r.status).toBe(403);
    expect((r.body as unknown as { error: { code: number } }).error.code).toBe(RPC_INSUFFICIENT_SCOPE);
  });
});

describe("X4 — unknown tool is unchanged", () => {
  it("returns 404 + -32601 for any caller", async () => {
    const r = await dispatchRpc(
      req("tools/call", { name: "nope", arguments: {} }),
      MODERN,
      callerAt("operate"),
      deps({ tools: fixtureTools }),
    );
    expect(r.status).toBe(404);
    expect((r.body as unknown as { error: { code: number } }).error.code).toBe(RPC_METHOD_NOT_FOUND);
  });
});

// ── E19–E22, X5–X7: transport binders (design D4) ─────────────────────────

const eventsTool: GeneratedTool = {
  name: "get_session_events_fixture",
  description: "fixture rest row",
  tier: "observe",
  annotations: { readOnlyHint: true, destructiveHint: false },
  inputSchema: {
    type: "object",
    properties: { sessionId: { type: "string" }, since: { type: "number" } },
    required: ["sessionId"],
    additionalProperties: false,
  },
  bind: { kind: "rest", method: "GET", path: "/api/session/:id/events" },
  paramSplit: { path: [{ arg: "sessionId", param: "id" }], query: ["since"] },
  sessionTargeting: true,
};

const callTool = (name: string, args: Record<string, unknown>, d: DispatchDeps, caller: McpCaller = callerAt("operate"), ctx = {}) =>
  dispatchRpc(req("tools/call", { name, arguments: args }), MODERN, caller, d, ctx);

describe("E19 — REST params split into url + query", () => {
  it("GET args map to path + query, with no body", async () => {
    const inject = vi.fn(async (_opts: InjectOptions) => ({ statusCode: 200, body: { success: true, data: { ok: 1 } } }));
    const d = deps({ tools: [eventsTool], inject });
    const r = await callTool("get_session_events_fixture", { sessionId: "S1", since: 5 }, d);
    expect(r.status).toBe(200);
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: "/api/session/S1/events?since=5" }),
    );
    expect(inject.mock.calls[0][0]).not.toHaveProperty("payload");
  });
});

describe("E20 — path parameters reject smuggling", () => {
  it.each(["S1/../../restart", "a%2Fb"])("%s → -32602 and inject is not called", async (sessionId) => {
    const inject = vi.fn();
    const d = deps({ tools: [eventsTool], inject });
    const r = await callTool("get_session_events_fixture", { sessionId }, d);
    expect(r.status).toBe(400);
    expect((r.body as unknown as { error: { code: number } }).error.code).toBe(RPC_INVALID_PARAMS);
    expect(inject).not.toHaveBeenCalled();
  });
});

describe("E21 — fixed body fields", () => {
  it("force_kill injects POST …/lifecycle with {action:'force_kill'}", async () => {
    const inject = vi.fn(async (_opts: InjectOptions) => ({ statusCode: 200, body: { success: true, data: {} } }));
    const d = deps({ tools: fixtureTools, inject });
    await callTool("force_kill", { sessionId: "S2" }, d);
    expect(inject).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/api/session/S2/lifecycle",
        payload: { action: "force_kill" },
      }),
    );
  });
});

describe("E22 — the four context tools are unchanged", () => {
  it("each still invokes the context handler with tool + args + caller", async () => {
    const d = deps({ tools: fixtureTools });
    await callTool("read_sessions", {}, d, callerAt("observe"));
    await callTool("send_prompt", { sessionId: "S", text: "hi" }, d, callerAt("control"));
    expect(d.invokeTool).toHaveBeenCalledTimes(2);
    const first = (d.invokeTool as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(first.tool.name).toBe("read_sessions");
    expect(first.caller).toEqual(callerAt("observe"));
    const second = (d.invokeTool as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(second.args).toEqual({ sessionId: "S", text: "hi" });
  });
});

describe("X5 — every session-targeting row refuses self-target", () => {
  it("a session caller targeting itself is refused; inject never runs", async () => {
    const inject = vi.fn();
    const recordRefusal = vi.fn();
    for (const tool of GENERATED_TOOLS.filter((t) => t.sessionTargeting && t.tier !== "operate")) {
      const args: Record<string, unknown> = { sessionId: "A" };
      for (const reqName of tool.inputSchema.required ?? []) if (reqName !== "sessionId") args[reqName] = "x";
      const r = await callTool(tool.name, args, deps({ tools: GENERATED_TOOLS, inject, recordRefusal }), sessionCaller("A"));
      expect(r.status, tool.name).toBe(403);
    }
    expect(inject).not.toHaveBeenCalled();
    expect(recordRefusal).toHaveBeenCalled();
    expect(recordRefusal.mock.calls[0][0]).toMatchObject({ callerSessionId: "A", targetSessionId: "A" });
  });
});

describe("X6 — REST error envelope", () => {
  it("a 500 {success:false,error:'boom'} becomes isError with the message", async () => {
    const inject = vi.fn(async (_opts: InjectOptions) => ({ statusCode: 500, body: { success: false, error: "boom" } }));
    const d = deps({ tools: [eventsTool], inject });
    const r = await callTool("get_session_events_fixture", { sessionId: "S1" }, d);
    const result = (r.body as unknown as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });
});

describe("X7 — inject identity", () => {
  it("device caller forwards its credential + tunnel headers and its own IP", async () => {
    const inject = vi.fn(async (_opts: InjectOptions) => ({ statusCode: 200, body: { success: true, data: {} } }));
    const d = deps({ tools: [eventsTool], inject });
    await callTool("get_session_events_fixture", { sessionId: "S1" }, d, callerAt("operate"), {
      headers: {
        host: "dash.local",
        authorization: "Bearer tok",
        "x-forwarded-for": "203.0.113.5",
        origin: "https://evil.example",
      },
      remoteAddress: "203.0.113.5",
    });
    const opts = inject.mock.calls[0][0] as { headers: Record<string, string>; remoteAddress: string };
    expect(opts.remoteAddress).toBe("203.0.113.5");
    expect(opts.headers.authorization).toBe("Bearer tok");
    expect(opts.headers.host).toBe("dash.local");
    expect(opts.headers["x-forwarded-for"]).toBe("203.0.113.5");
    expect(opts.headers).not.toHaveProperty("origin");
  });

  it("session caller injects as loopback with no credential or forwarding headers", async () => {
    const inject = vi.fn(async (_opts: InjectOptions) => ({ statusCode: 200, body: { success: true, data: {} } }));
    const d = deps({ tools: [eventsTool], inject });
    await callTool("get_session_events_fixture", { sessionId: "S1" }, d, sessionCaller("CALLER"), {
      headers: { host: "dash.local", authorization: "Bearer tok", "x-forwarded-for": "203.0.113.5" },
      remoteAddress: "203.0.113.5",
    });
    const opts = inject.mock.calls[0][0] as { headers: Record<string, string>; remoteAddress: string };
    expect(opts.remoteAddress).toBe("127.0.0.1");
    expect(opts.headers).not.toHaveProperty("authorization");
    expect(opts.headers).not.toHaveProperty("x-forwarded-for");
  });
});

// ── Strict argument validation (change: paginate-mcp-list-sessions) ───────
// Preserved through the manifest migration: `list_sessions` keeps its bound,
// filters and cursor; the generic schema validator checks the shape and the
// tool-specific hook checks the cursor's filter binding.

function listRows(n: number, over: (i: number) => Partial<DashboardSession> = () => ({})) {
  return Array.from({ length: n }, (_, i) =>
    ({
      source: "tui",
      status: "active",
      startedAt: 1_000 + i,
      hidden: false,
      id: `s-${String(i).padStart(4, "0")}`,
      cwd: "/proj",
      ...over(i),
    }) as DashboardSession,
  );
}

const listCall = (args: Record<string, unknown>, d: DispatchDeps = deps()) =>
  dispatchRpc(req("tools/call", { name: "list_sessions", arguments: args }), MODERN, deviceCaller, d);

describe("E3/E4/E6-E9 — malformed limits are rejected, never coerced", () => {
  it.each([
    ["a zero limit", { limit: 0 }],
    ["a negative limit", { limit: -1 }],
    ["a limit above the maximum", { limit: 201 }],
    ["a non-integer limit", { limit: 25.5 }],
    ["a numeric string limit", { limit: "25" }],
    ["a non-numeric limit", { limit: "abc" }],
  ])("%s is invalid-params with no page", async (_label, args) => {
    const d = deps();
    const r = await listCall(args, d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(r.body).not.toHaveProperty("result");
    expect(d.invokeTool).not.toHaveBeenCalled();
  });
});

describe("E12/E17 — enum and unknown-name validation", () => {
  it("E12 — an unknown status value is rejected, not silently unfiltered", async () => {
    const d = deps();
    const r = await listCall({ status: ["running"] }, d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("E17 — a misspelled argument is rejected, not ignored", async () => {
    const d = deps();
    const r = await listCall({ statuss: ["active"] }, d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("E17 — a prototype-named argument is rejected, not skipped by the `in` trap", async () => {
    for (const name of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      const d = deps();
      const r = await listCall({ [name]: "x" }, d);
      expect(r.status, name).toBe(400);
      expect(r.body, name).toMatchObject({ error: { code: -32602 } });
      expect(d.invokeTool, name).not.toHaveBeenCalled();
    }
  });
});

describe("E24–E26 — the cursor is validated", () => {
  it("E24 — a malformed cursor is rejected", async () => {
    const d = deps();
    const r = await listCall({ cursor: "!!!not-base64!!!" }, d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("E25 — a cursor replayed with different filters is rejected", async () => {
    const rows = listRows(30, () => ({ status: "active" }));
    const cursor = listSessions(rows, { status: ["active"] }).nextCursor;
    expect(cursor).toBeTruthy();
    const d = deps();
    const r = await listCall({ status: ["ended"], cursor }, d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });

  it("E26 — a cursor replayed with a different limit is rejected", async () => {
    const cursor = listSessions(listRows(100), { limit: 25 }).nextCursor;
    expect(cursor).toBeTruthy();
    const d = deps();
    const r = await listCall({ limit: 50, cursor }, d);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: { code: -32602 } });
    expect(d.invokeTool).not.toHaveBeenCalled();
  });
});

describe("E27 — validation of other tools is unchanged", () => {
  it.each([
    ["send_prompt", { sessionId: "B", text: "hi" }],
    ["spawn_session", { cwd: "/tmp" }],
    ["abort", { sessionId: "B" }],
  ])("%s still dispatches with pre-change arguments", async (name, args) => {
    const d = deps();
    const r = await dispatchRpc(req("tools/call", { name, arguments: args }), MODERN, deviceCaller, d);
    expect(r.status).toBe(200);
    expect(d.invokeTool).toHaveBeenCalledOnce();
  });
});

// S1 — a client argument must not override the manifest's fixed body field.
describe("fixed body fields are not client-overridable", () => {
  it("stop_after_turn ignores a caller-supplied action", async () => {
    const inject = vi.fn(async (_opts: InjectOptions) => ({ statusCode: 200, body: { success: true, data: {} } }));
    const stopTool: GeneratedTool = {
      ...fixtureTools[2],
      name: "stop_after_turn",
      tier: "control",
      // A permissive body so a caller-supplied `action` reaches the binder (the
      // point under test) rather than being rejected as an unknown argument.
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: true },
      bind: { kind: "rest", method: "POST", path: "/api/session/:id/lifecycle", fixed: { action: "stop_after_turn" } },
    };
    const d = deps({ tools: [stopTool], inject });
    await callTool("stop_after_turn", { sessionId: "S2", action: "force_kill" }, d, callerAt("control"));
    const opts = inject.mock.calls[0][0] as InjectOptions;
    expect(opts.payload).toEqual({ action: "stop_after_turn" });
  });
});
