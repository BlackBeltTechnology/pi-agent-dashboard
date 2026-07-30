import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isolatedNestedToolsEnabled,
  registerIsolatedNestedTools,
  resolveModelRef,
} from "../isolated-nested-tools.js";

const registered: Array<any> = [];

afterEach(() => {
  registered.length = 0;
  vi.restoreAllMocks();
});

describe("isolated nested tools", () => {
  it("does not replace package tools unless the explicit opt-in is enabled", () => {
    expect(isolatedNestedToolsEnabled({})).toBe(false);
    expect(
      registerIsolatedNestedTools({ registerTool: (tool) => registered.push(tool) }, { env: {} }),
    ).toBe(false);
    expect(registered).toEqual([]);
  });

  it("registers Agent and doubt after package tools and forwards model, cwd, and run correlation", async () => {
    const run = vi.fn().mockResolvedValue({ runId: expect.any(String), status: "completed", result: "done" });
    const emit = vi.fn();
    const pi = { registerTool: (tool: any) => registered.push(tool), events: { emit } };
    expect(
      registerIsolatedNestedTools(pi, {
        env: { PI_DASHBOARD_ISOLATED_NESTED_TOOLS: "1" },
        supervisor: { run } as any,
      }),
    ).toBe(true);
    expect(registered.map((tool) => tool.name)).toEqual(["Agent", "doubt"]);

    const result = await registered[0].execute(
      "call-1",
      { subagent_type: "unknown", description: "inspect", prompt: "do work", model: "test/model:high" },
      undefined,
      undefined,
      { cwd: "/repo", model: { provider: "fallback", id: "model" } },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        model: { provider: "test", id: "model" },
        thinkingLevel: "high",
      }),
      expect.any(Object),
    );
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
    expect(result.details.agentId).toBe(run.mock.calls[0][0].runId);
    expect(emit.mock.calls.map(([channel]) => channel)).toEqual([
      "subagents:created",
      "subagents:started",
      "subagents:completed",
    ]);
  });

  it("keeps a nested worker from recursively replacing its own tools", () => {
    expect(
      isolatedNestedToolsEnabled({
        PI_DASHBOARD_ISOLATED_NESTED_TOOLS: "1",
        PI_DASHBOARD_NESTED_WORKER: "1",
      }),
    ).toBe(false);
  });

  it("publishes one forced-termination result and leaves the next parent tool call usable", async () => {
    const emit = vi.fn();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ status: "forced", error: "SIGKILL" })
      .mockResolvedValueOnce({ status: "completed", result: "next prompt works" });
    registerIsolatedNestedTools(
      { registerTool: (tool: any) => registered.push(tool), events: { emit } },
      { env: { PI_DASHBOARD_ISOLATED_NESTED_TOOLS: "1" }, supervisor: { run } as any },
    );
    const agent = registered.find((tool) => tool.name === "Agent");
    const context = { cwd: "/repo", model: { provider: "test", id: "model" } };

    const first = await agent.execute(
      "call-1",
      { subagent_type: "unknown", description: "stuck", prompt: "stuck" },
      new AbortController().signal,
      undefined,
      context,
    );
    const second = await agent.execute(
      "call-2",
      { subagent_type: "unknown", description: "next", prompt: "next" },
      undefined,
      undefined,
      context,
    );

    expect(first.isError).toBe(true);
    expect(second.content).toEqual([{ type: "text", text: "next prompt works" }]);
    expect(emit.mock.calls.filter(([channel]) => channel === "subagents:failed")).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("resolves configured role aliases without reading pi internals", () => {
    expect(resolveModelRef("openai/gpt-5:low")).toEqual({
      model: { provider: "openai", id: "gpt-5" },
      thinkingLevel: "low",
    });
    expect(resolveModelRef("invalid").error).toContain("provider/model-id");
  });
});
