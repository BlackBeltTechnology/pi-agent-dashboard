/**
 * `spawn_result.choiceWarning` is optional and additive.
 * test-plan: E26. See change: add-spawn-model-choice.
 * Exemplar: spawn-session-attach-proposal.test.ts.
 */
import { describe, expect, expectTypeOf, it } from "vitest";
import type { SpawnResultBrowserMessage } from "../browser-protocol.js";
import type { SpawnNewSessionMessage } from "../protocol.js";

describe("SpawnResultBrowserMessage.choiceWarning", () => {
  it("E26: compiles with and without choiceWarning; legacy result has no key", () => {
    const legacy: SpawnResultBrowserMessage = { type: "spawn_result", cwd: "/p", success: true, message: "ok" };
    const warned: SpawnResultBrowserMessage = { ...legacy, choiceWarning: "role 'ghost' not configured yet" };
    expect(legacy).not.toHaveProperty("choiceWarning");
    expect(warned.choiceWarning).toContain("ghost");
    expectTypeOf<SpawnResultBrowserMessage["choiceWarning"]>().toEqualTypeOf<string | undefined>();
  });

  it("spawn_new_session carries optional model / thinkingLevel", () => {
    const plain: SpawnNewSessionMessage = { type: "spawn_new_session", sessionId: "s", cwd: "/p" };
    const inherited: SpawnNewSessionMessage = { ...plain, model: "a/b", thinkingLevel: "low" };
    expect(JSON.parse(JSON.stringify(plain))).toEqual({ type: "spawn_new_session", sessionId: "s", cwd: "/p" });
    expect(inherited.model).toBe("a/b");
  });
});
