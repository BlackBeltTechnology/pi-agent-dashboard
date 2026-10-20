/**
 * Supervised policy builder: default set, case-insensitive matching (builder
 * only — the shared engine stays exact-match), configured-set authority.
 *
 * See change: add-supervised-tool-approval (test-plan #E1 #E6 #E7).
 */
import { describe, expect, it, vi } from "vitest";
import { createToolCallGuard } from "../guard.js";
import { decideToolCall } from "../policy.js";
import {
  buildSupervisedPolicy,
  DEFAULT_SUPERVISED_TOOLS,
  decideSupervisedTool,
  readFamily,
  riskySet,
  wrapperTools,
} from "../supervised-policy.js";

describe("supervised policy builder", () => {
  it("E1: unset tools → default risky set, allow-first; first five approve, read family allows", () => {
    const policy = buildSupervisedPolicy();
    expect(policy).toEqual({
      approval: ["bash", "powershell", "write", "edit", "Agent"],
      defaultAction: "allow",
    });
    for (const name of ["bash", "powershell", "write", "edit", "Agent"]) {
      expect(decideToolCall(name, policy).action).toBe("approve");
      expect(decideSupervisedTool(name, policy).action).toBe("approve");
    }
    for (const name of ["read", "grep", "find", "ls"]) {
      expect(decideToolCall(name, policy)).toEqual({ action: "allow" });
      expect(decideSupervisedTool(name, policy)).toEqual({ action: "allow" });
    }
  });

  it("E6: matching is case-insensitive on both sides", () => {
    const policy = buildSupervisedPolicy(["Agent"]);
    for (const name of ["agent", "AGENT", "Agent"]) {
      expect(decideSupervisedTool(name, policy).action).toBe("approve");
    }
    // The shared engine itself never folds.
    expect(decideToolCall("agent", policy).action).toBe("allow");
  });

  it("E7: the configured set is authoritative — a configured read is gated and prompts", async () => {
    const request = vi.fn(() => ({ decision: Promise.resolve({ answer: "Allow once", surface: "dashboard" }), cancel() {} }));
    const guard = createToolCallGuard({
      surface: {
        reasonPrefix: "supervised",
        buildPrompt: (e) => ({ title: e.toolName, body: "", plain: e.toolName, metadata: {} }),
        request,
        onDecision: () => {},
      },
      policy: buildSupervisedPolicy(["read"]),
      decide: decideSupervisedTool,
      timeoutMs: 1000,
    });
    expect(await guard({ toolName: "read" }, {})).toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
    // An unconfigured tool runs with no prompt.
    request.mockClear();
    expect(await guard({ toolName: "bash" }, {})).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
  });

  it("exports the classification sets (drift-test inputs)", () => {
    expect(DEFAULT_SUPERVISED_TOOLS).toEqual(["bash", "powershell", "write", "edit", "Agent"]);
    expect(riskySet).toEqual(DEFAULT_SUPERVISED_TOOLS);
    expect(readFamily).toEqual(["read", "grep", "find", "ls"]);
    expect(wrapperTools).toEqual(["codemode", "tool_search"]);
  });
});
