// Deliberately red. Run only by coverage-report.test.mjs through ./vitest.config.mjs;
// the `scripts` project include (`*.test.mjs`) never collects this file.
import { expect, it } from "vitest";

it("fails on purpose so the coverage report must survive a red run", () => {
  expect(1).toBe(2);
});
