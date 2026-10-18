// A green test that loads nothing from `src/`, so the coverage run has a test to
// execute while `src/unloaded.ts` stays unloaded.
import { expect, it } from "vitest";

it("passes without importing the fixture source", () => {
  expect(1 + 1).toBe(2);
});
