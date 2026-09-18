/**
 * L3 tool policy tests (task 12.7: X2, X4-logic, X5).
 *
 * The point of these is the DENY-FIRST boundary: an unrecognised tool must not
 * be allowed, and nothing in the decision path may be widened by model output.
 *
 * See change: add-chat-gateway.
 */
import { describe, expect, it } from "vitest";
import { decideToolCall } from "../policy.js";

describe("decideToolCall (deny-first)", () => {
  it("X2: an unlisted tool is denied by default", () => {
    expect(decideToolCall("bash", { allow: ["read"] })).toEqual({
      action: "deny",
      reason: "denied_by_default",
    });
  });

  it("denies by default with an entirely absent policy", () => {
    expect(decideToolCall("bash", {}).action).toBe("deny");
  });

  it("allows an explicitly allowed tool", () => {
    expect(decideToolCall("read", { allow: ["read"], approval: ["bash"] })).toEqual({
      action: "allow",
    });
  });

  it("routes an explicitly gated tool to approval", () => {
    expect(decideToolCall("bash", { approval: ["bash"] })).toEqual({
      action: "approve",
      reason: "requires_approval",
    });
  });

  it("explicit allow wins over approval when a tool is in both", () => {
    expect(decideToolCall("bash", { allow: ["bash"], approval: ["bash"] }).action).toBe("allow");
  });

  it("only an explicit defaultAction widens the default", () => {
    expect(decideToolCall("bash", { defaultAction: "approve" })).toEqual({
      action: "approve",
      reason: "default_requires_approval",
    });
  });

  it("denies an empty or non-string tool name rather than matching loosely", () => {
    expect(decideToolCall("", { defaultAction: "approve" }).action).toBe("deny");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(decideToolCall(undefined as any, { allow: ["read"] }).action).toBe("deny");
  });
});
