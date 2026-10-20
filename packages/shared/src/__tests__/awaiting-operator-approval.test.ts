import { describe, expect, it } from "vitest";
import { awaitingOperatorApproval } from "../awaiting-operator-approval.js";

describe("awaitingOperatorApproval (test-plan #E36)", () => {
  it.each([
    [{ awaitingFileAccess: false, awaitingToolApproval: false }, false],
    [{ awaitingFileAccess: true, awaitingToolApproval: false }, true],
    [{ awaitingFileAccess: false, awaitingToolApproval: true }, true],
    [{ awaitingFileAccess: true, awaitingToolApproval: true }, true],
    [{}, false],
    [undefined, false],
  ])("%j -> %s", (s, expected) => {
    expect(awaitingOperatorApproval(s)).toBe(expected);
  });
});
