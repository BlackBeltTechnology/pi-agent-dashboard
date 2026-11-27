import { describe, expect, it } from "vitest";
import { subagentHeapBudget } from "../heap-budget.js";

describe("subagent coupling guard vs producer maxConcurrent (test-plan #E16)", () => {
  it.each([
    [2, 170, false],
    [4, 102, false],
    [5, 85, true],
    [7, 64, true],
    [8, 56, true],
  ])(
    "maxConcurrent=%i leaves %i MB per child (warn=%s)",
    (maxConcurrent, perChildMb, warn) => {
      const budget = subagentHeapBudget(512, maxConcurrent);
      expect(budget.perChildMb).toBe(perChildMb);
      expect(budget.warn).toBe(warn);
    },
  );

  it("warns on unlimited (0) under a set ceiling", () => {
    expect(subagentHeapBudget(512, 0)).toEqual({ perChildMb: 0, warn: true });
  });

  it("is inert on nonsense input rather than warning spuriously", () => {
    expect(subagentHeapBudget(512, -1)).toEqual({ perChildMb: 0, warn: false });
    expect(subagentHeapBudget(512, Number.POSITIVE_INFINITY).warn).toBe(false);
  });
});
