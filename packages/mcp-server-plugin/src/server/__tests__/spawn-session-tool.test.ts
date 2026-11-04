/**
 * MCP spawn_session forwards the full input; the hook's warning reaches the
 * tool result text.
 * test-plan: E20, E22. See change: add-spawn-model-choice.
 * Exemplar: dispatch.test.ts (context tool raw value → JSON text content).
 */
import { describe, expect, it, vi } from "vitest";
import { runSpawnSessionTool } from "../spawn-session-tool.js";

describe("spawn_session tool", () => {
  it("E20: forwards agent, model, initialPrompt", async () => {
    const spy = vi.fn(async () => ({ success: true }));
    await runSpawnSessionTool(spy, { cwd: "/p", agent: "qmt" });
    expect(spy).toHaveBeenLastCalledWith({ cwd: "/p", agent: "qmt" });
    await runSpawnSessionTool(spy, { cwd: "/p", model: "@review", initialPrompt: "go", thinkingLevel: "low" });
    expect(spy).toHaveBeenLastCalledWith({ cwd: "/p", model: "@review", initialPrompt: "go", thinkingLevel: "low" });
  });

  it("E22: the hook warning rides in the JSON tool result text", async () => {
    const spy = vi.fn(async () => ({ success: true, warning: "role 'ghost' not configured yet" }));
    const result = await runSpawnSessionTool(spy, { cwd: "/p", model: "@ghost" });
    // dispatch wraps a context tool's raw value as JSON text content.
    expect(JSON.stringify(result)).toContain("role 'ghost' not configured yet");
  });
});
