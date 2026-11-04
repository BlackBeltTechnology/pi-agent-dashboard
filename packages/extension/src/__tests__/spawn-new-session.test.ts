/**
 * Bridge `spawn_new_session` frame inherits the current model + thinking.
 * test-plan: E27, E28, X7. See change: add-spawn-model-choice.
 * Exemplar: bridge-default-model-apply.test.ts (pure helper under test).
 */
import { describe, expect, it } from "vitest";
import type { BridgeContext } from "../bridge-context.js";
import { buildSpawnNewSessionMessage } from "../spawn-new-session.js";

function bc(model: { provider: string; id: string } | undefined, level?: string): BridgeContext {
  return {
    cachedCtx: model ? { model } : undefined,
    pi: { getThinkingLevel: () => level },
  } as unknown as BridgeContext;
}

describe("buildSpawnNewSessionMessage", () => {
  it("E27: carries model + thinking level when known", () => {
    expect(buildSpawnNewSessionMessage("s1", "/p", () => bc({ provider: "anthropic", id: "claude-sonnet-5-5" }, "medium"))).toEqual({
      type: "spawn_new_session",
      sessionId: "s1",
      cwd: "/p",
      model: "anthropic/claude-sonnet-5-5",
      thinkingLevel: "medium",
    });
  });

  it("E28: unknown model → no model / thinkingLevel keys", () => {
    const msg = buildSpawnNewSessionMessage("s1", "/p", () => bc(undefined, "high"));
    expect(msg).toEqual({ type: "spawn_new_session", sessionId: "s1", cwd: "/p" });
    expect(msg).not.toHaveProperty("thinkingLevel");
  });

  it("X7: a throwing context read falls back to the plain frame", () => {
    const msg = buildSpawnNewSessionMessage("s1", "/p", () => {
      throw new Error("boom");
    });
    expect(msg).toEqual({ type: "spawn_new_session", sessionId: "s1", cwd: "/p" });
  });
});
