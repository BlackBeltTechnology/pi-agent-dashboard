import { describe, expect, it } from "vitest";
import { isUiTone, UI_TONES } from "../ui-primitives.js";

describe("isUiTone (test-plan #E1)", () => {
  it("accepts exactly the four tones", () => {
    for (const t of ["go", "create", "caution", "danger"]) expect(isUiTone(t)).toBe(true);
    expect(UI_TONES).toHaveLength(4);
  });
  it("rejects everything else, including prototype keys", () => {
    for (const v of ["purple", "", "Danger", "constructor", "__proto__", "toString", 42, null, undefined, {}]) {
      expect(isUiTone(v)).toBe(false);
    }
  });
});
