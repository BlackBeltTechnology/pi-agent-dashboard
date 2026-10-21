/**
 * The `Agent` claim's `resultPending` predicate: when the "recovered" badge shows.
 * Moved from the shell's ToolCallStep test (F9); the shell-side contract (badge
 * follows the claim's predicate) is tested in `ToolCallStep.test.tsx`.
 *
 * See change: finalize-agent-card-on-subagent-stop (D6); decouple-plugins-from-core (task 4.5).
 */
import { describe, expect, it } from "vitest";
import { isAgentResultNotReceived } from "../resultPending.js";

const session = (result?: string) => ({
  subagents: new Map([["ag", { id: "ag", type: "t", description: "d", status: "completed", ...(result ? { result } : {}) }]]),
});

describe("isAgentResultNotReceived (F9)", () => {
  it.each([
    ["resultMissing, no subagent result", { resultMissing: true, healedBy: "turn_settled", agentId: "ag" }, undefined, true],
    ["resultMissing, subagent result known", { resultMissing: true, healedBy: "turn_settled", agentId: "ag" }, "done", false],
    ["session_ended orphan-close", { healedBy: "session_ended", agentId: "ag" }, undefined, true],
    ["subagent_stopped heal", { healedBy: "subagent_stopped", agentId: "ag" }, "done", false],
    ["turn_settled with a known result", { healedBy: "turn_settled", agentId: "ag" }, "done", false],
  ] as const)("%s → %s", (_label, toolDetails, subResult, expected) => {
    expect(isAgentResultNotReceived({ ...toolDetails }, session(subResult))).toBe(expected);
  });

  it("is false without toolDetails and tolerates a missing session", () => {
    expect(isAgentResultNotReceived(undefined, session())).toBe(false);
    expect(isAgentResultNotReceived({ resultMissing: true }, undefined)).toBe(true);
    expect(isAgentResultNotReceived({ resultMissing: true, agentId: "ag" }, undefined)).toBe(true);
  });
});
