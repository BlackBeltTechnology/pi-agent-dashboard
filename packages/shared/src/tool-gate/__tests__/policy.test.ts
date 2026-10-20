/**
 * Shared tool-policy engine tests: the deny-first table (moved assertions from
 * chat-gateway's `policy.test.ts`), the `"allow"` widening branch, and
 * `parseToolPolicy`.
 *
 * See change: add-supervised-tool-approval (test-plan #E2 #E3 #E5 #E13 #E25).
 */
import { describe, expect, it } from "vitest";
import { decideToolCall, parseToolPolicy } from "../policy.js";

describe("decideToolCall", () => {
  it("E3: absent defaultAction still resolves to deny (gateway posture unchanged)", () => {
    expect(decideToolCall("rm_tool", { allow: ["read"] })).toEqual({
      action: "deny",
      reason: "denied_by_default",
    });
    expect(decideToolCall("bash", {}).action).toBe("deny");
  });

  it('E2: defaultAction "allow" allows an unlisted tool — not deny', () => {
    expect(decideToolCall("read", { approval: ["bash"], defaultAction: "allow" })).toEqual({ action: "allow" });
  });

  it('"allow" default still routes a listed approval tool to approval', () => {
    expect(decideToolCall("bash", { approval: ["bash"], defaultAction: "allow" })).toEqual({
      action: "approve",
      reason: "requires_approval",
    });
  });

  it("E13: explicit allow beats approval even under defaultAction allow", () => {
    expect(decideToolCall("bash", { allow: ["bash"], approval: ["bash"], defaultAction: "allow" })).toEqual({
      action: "allow",
    });
  });

  it("E25: the engine is exact-match — it never lower-cases", () => {
    expect(decideToolCall("Bash", { allow: ["bash"] })).toEqual({ action: "deny", reason: "denied_by_default" });
    expect(decideToolCall("bash", { allow: ["Bash"] }).action).toBe("deny");
  });

  it("denies an empty or non-string tool name even under allow-by-default", () => {
    expect(decideToolCall("", { defaultAction: "allow" }).action).toBe("deny");
    expect(decideToolCall(undefined as unknown as string, { defaultAction: "allow" }).action).toBe("deny");
  });
});

describe("parseToolPolicy", () => {
  const gateway = { allowedDefaults: ["deny", "approve"] } as const;

  it("E5: a raw allow default is coerced to deny when the surface does not permit it", () => {
    expect(parseToolPolicy({ defaultAction: "allow" }, gateway)).toEqual({ defaultAction: "deny" });
  });

  it("keeps allow when the surface permits it", () => {
    expect(parseToolPolicy({ defaultAction: "allow" }, { allowedDefaults: ["allow"] })).toEqual({
      defaultAction: "allow",
    });
  });

  it("keeps permitted defaults and leaves an absent default absent", () => {
    expect(parseToolPolicy({ defaultAction: "approve" }, gateway)).toEqual({ defaultAction: "approve" });
    expect(parseToolPolicy({ allow: ["read"], approval: ["bash"] }, gateway)).toEqual({
      allow: ["read"],
      approval: ["bash"],
    });
  });

  it("coerces an unknown default to deny", () => {
    expect(parseToolPolicy({ defaultAction: "yolo" }, gateway)).toEqual({ defaultAction: "deny" });
  });

  it("fails closed on a non-object", () => {
    for (const raw of [null, undefined, "x", 3, ["bash"]]) {
      expect(parseToolPolicy(raw, gateway)).toEqual({ defaultAction: "deny" });
    }
  });

  it("drops malformed lists and non-string entries", () => {
    expect(parseToolPolicy({ allow: "read", approval: ["bash", 7, null] }, gateway)).toEqual({ approval: ["bash"] });
  });
});
