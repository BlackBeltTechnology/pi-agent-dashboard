/**
 * P1 (test-plan expand-mcp-tiered-surface) — the REST binder's serialization
 * hop must stay inside the 20 ms budget. In-process, in-memory inject, so this
 * measures the binder overhead, not network latency.
 */
import { describe, expect, it } from "vitest";
import { dispatchRpc, type DispatchDeps, type ResolvedVersion } from "../dispatch.js";
import type { GeneratedTool } from "../generated/tools.js";
import type { McpCaller } from "../tokens.js";

const V = "2026-07-28";
const MODERN: ResolvedVersion = { era: "modern", version: V };
const meta = { _meta: { "io.modelcontextprotocol/protocolVersion": V } };
const caller: McpCaller = { kind: "device", deviceId: "d1", tier: "operate" };

function tool(name: string, bind: GeneratedTool["bind"]): GeneratedTool {
  return {
    name,
    description: "fixture",
    tier: "observe",
    annotations: { readOnlyHint: true, destructiveHint: false },
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    bind,
    paramSplit: { path: [], queryAll: true },
    sessionTargeting: false,
  };
}

const restTool = tool("rest_fixture", { kind: "rest", method: "GET", path: "/api/sessions" });
const contextTool = tool("ctx_fixture", { kind: "context", member: "sessionManager" });

function deps(): DispatchDeps {
  return {
    tools: [restTool, contextTool],
    serverInfo: { name: "pi-dashboard", version: "0.7.0" },
    invokeTool: async () => ({ sessions: [] }),
    inject: async () => ({ statusCode: 200, body: { success: true, data: { sessions: [] } } }),
  };
}

const req = (name: string) => ({
  jsonrpc: "2.0" as const,
  id: 1,
  method: "tools/call",
  params: { ...meta, name, arguments: {} },
});

function p95(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

describe("P1 — REST binder overhead", () => {
  it("p95(rest) − p95(context) < 20 ms across 100 calls (10 warm-up)", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) {
      await dispatchRpc(req("rest_fixture"), MODERN, caller, d);
      await dispatchRpc(req("ctx_fixture"), MODERN, caller, d);
    }
    const rest: number[] = [];
    const ctx: number[] = [];
    for (let i = 0; i < 100; i++) {
      let t = performance.now();
      await dispatchRpc(req("rest_fixture"), MODERN, caller, d);
      rest.push(performance.now() - t);
      t = performance.now();
      await dispatchRpc(req("ctx_fixture"), MODERN, caller, d);
      ctx.push(performance.now() - t);
    }
    expect(p95(rest) - p95(ctx)).toBeLessThan(20);
  });
});
