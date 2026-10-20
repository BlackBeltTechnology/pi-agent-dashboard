import { describe, expect, it } from "vitest";
import { parseSetSupervised } from "../supervised-mode.js";

describe("parseSetSupervised (#E32 guard half)", () => {
  it("accepts a boolean on, with or without a valid rev", () => {
    expect(parseSetSupervised({ type: "set_supervised", on: true })).toEqual({ on: true });
    expect(parseSetSupervised({ on: false, rev: 3 })).toEqual({ on: false, rev: 3 });
    expect(parseSetSupervised({ on: false, rev: 0 })).toEqual({ on: false, rev: 0 });
  });

  it("ignores malformed payloads", () => {
    for (const bad of [{ on: "yes" }, {}, null, undefined, { on: 1 }, "on", 7, []]) {
      expect(parseSetSupervised(bad), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it("drops an invalid rev but keeps the flip", () => {
    for (const rev of [-1, 1.5, "2", null, Number.NaN]) {
      expect(parseSetSupervised({ on: true, rev })).toEqual({ on: true });
    }
  });
});
