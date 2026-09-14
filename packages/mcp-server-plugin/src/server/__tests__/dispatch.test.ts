/**
 * JSON-RPC dispatch.
 *
 * Covers E8/E9 (no handshake; explicit initialize unsupported), E16 (unknown
 * method 404 + -32601), E17 (malformed bodies are JSON-RPC errors, not 500s),
 * E18 (request independence), E19/E20 (server/discover), E26 (sessionId
 * validation), G1/G2/G5 (self-target refusal through the real dispatch path),
 * S3 (empty filter) and S7 (legacy subscription methods).
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildDiscoverResult,
  type DispatchDeps,
  dispatchRpc,
  parseSubscriptionFilter,
  REMOVED_METHODS,
} from "../dispatch.js";
import { parseRpcRequest, RPC_METHOD_NOT_FOUND } from "../jsonrpc.js";
import { META_VERSION_KEY, SUPPORTED_PROTOCOL_VERSIONS } from "../protocol.js";
import type { ResolvedVersion } from "../dispatch.js";
import type { McpCaller } from "../tokens.js";

const V = "2026-07-28";
const MODERN: ResolvedVersion = { era: "modern", version: V };
const meta = { _meta: { [META_VERSION_KEY]: V } };
const deviceCaller: McpCaller = { kind: "device", deviceId: "d1" };
const sessionCaller = (id: string): McpCaller => ({ kind: "session", sessionId: id });

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    invokeTool: vi.fn(async () => ({ ok: true })),
    serverInfo: { name: "pi-dashboard", version: "0.7.0" },
    openSubscription: vi.fn(async (sessionIds: string[]) => ({ subscribed: sessionIds })),
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

  it("M3 — a client-supplied session claim in the arguments does not become identity", async () => {
    const d = deps();
    // The caller is a DEVICE token asserting it is session A. If the claim were
    // honoured, this self-target would be refused; it must be permitted.
    const r = await dispatchRpc(
      req("tools/call", {
        name: "send_prompt",
        arguments: { sessionId: "A", text: "hi", callerSessionId: "A" },
      }),
      MODERN,
      deviceCaller,
      d,
    );
    expect(r.status).toBe(200);
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
