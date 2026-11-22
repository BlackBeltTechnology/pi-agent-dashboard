/**
 * MCP spawn_session forwards the full input; the hook's warning reaches the
 * tool result text.
 * test-plan: E20, E22. See change: add-spawn-model-choice.
 * Exemplar: dispatch.test.ts (context tool raw value → JSON text content).
 */
import { describe, expect, it, vi } from "vitest";
import { GENERATED_TOOLS } from "../generated/tools.js";
import { runSpawnSessionTool } from "../spawn-session-tool.js";
import { MANIFEST } from "../tools.manifest.js";

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

describe("T.69 harden-agent-tool-guards: spawn_session is byte-identical (no trust surface)", () => {
  it("result text and forwarded options carry no trust field; description/tier unchanged", async () => {
    const spy = vi.fn(async (_o: unknown) => ({ success: true, sessionId: "S1" }));
    const result = await runSpawnSessionTool(spy, { cwd: "/w/clone" });
    // Baseline captured at the time of the change: the hook result passes through untouched.
    expect(JSON.stringify(result)).toBe('{"success":true,"sessionId":"S1"}');
    expect(spy).toHaveBeenCalledWith({ cwd: "/w/clone" });
    for (const k of ["trust", "trusted", "approve", "noProjectTrust", "withholdActivationTrust"]) {
      expect(Object.keys((spy.mock.calls[0]?.[0] ?? {}) as object)).not.toContain(k);
    }
    const row = MANIFEST.find((r) => r.name === "spawn_session");
    expect(row).toMatchObject({ description: "Spawn a new pi session in a working directory.", tier: "control" });
    const gen = GENERATED_TOOLS.find((t) => t.name === "spawn_session") as { description: string; inputSchema?: unknown } | undefined;
    expect(gen?.description).toContain("Spawn a new pi session in a working directory.");
    expect(JSON.stringify(gen?.inputSchema ?? {})).not.toMatch(/trust/i);
  });
});
