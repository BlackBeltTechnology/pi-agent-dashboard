/**
 * The supervised builder hands the SHARED exact-match engine lower-cased names
 * on both sides (the engine itself never folds).
 *
 * See change: add-supervised-tool-approval (test-plan #E6).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../policy.js")>();
  return { ...actual, decideToolCall: vi.fn(actual.decideToolCall) };
});

import { decideToolCall } from "../policy.js";
import { decideSupervisedTool } from "../supervised-policy.js";

describe("decideSupervisedTool → decideToolCall", () => {
  it("E6: calls the shared engine with lower-cased name and lists", () => {
    const result = decideSupervisedTool("AGENT", { approval: ["Agent"], allow: ["READ"], defaultAction: "allow" });
    expect(result.action).toBe("approve");
    expect(decideToolCall).toHaveBeenCalledWith("agent", {
      approval: ["agent"],
      allow: ["read"],
      defaultAction: "allow",
    });
  });
});
