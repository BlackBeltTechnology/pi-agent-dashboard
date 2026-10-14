/** Presentation helpers of the request landing. See change: add-lan-knock-pairing (test-plan #F2, #F6). */
import { describe, expect, it } from "vitest";
import { confirmCodeAriaLabel, formatCountdown, groupConfirmCode } from "../knock-format.js";

describe("groupConfirmCode", () => {
  it("groups 8 digits as 4+4", () => expect(groupConfirmCode("48217730")).toBe("4821 7730"));
  it("leaves other shapes untouched", () => {
    expect(groupConfirmCode("77 88 99")).toBe("77 88 99");
    expect(groupConfirmCode("123")).toBe("123");
  });
});

describe("confirmCodeAriaLabel", () => {
  it("reads digits in two groups", () => expect(confirmCodeAriaLabel("48217730")).toBe("4 8 2 1, 7 7 3 0"));
});

describe("formatCountdown", () => {
  it.each([
    [420_000, "7:00"],
    [292_000, "4:52"],
    [59_001, "1:00"],
    [9_000, "0:09"],
    [0, "0:00"],
    [-5, "0:00"],
  ])("%i ms → %s", (ms, want) => expect(formatCountdown(ms)).toBe(want));
});
