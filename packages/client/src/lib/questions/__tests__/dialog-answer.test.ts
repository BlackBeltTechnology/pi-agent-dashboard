/** Text-only answer encoding for the REST road. See change: add-pending-question-stack. */
import { describe, expect, it } from "vitest";
import { encodeDialogAnswer } from "../dialog-answer.js";

const img = { type: "image", data: "AAAA", mimeType: "image/png" };

describe("encodeDialogAnswer", () => {
  it("encodes every renderer result like the chat does", () => {
    expect(encodeDialogAnswer({ confirmed: true })).toBe("true");
    expect(encodeDialogAnswer({ confirmed: false })).toBe("false");
    expect(encodeDialogAnswer({ value: "x" })).toBe("x");
    expect(encodeDialogAnswer({ value: "" })).toBe("");
    expect(encodeDialogAnswer({ values: ["a", "b"] })).toBe('["a","b"]');
    expect(encodeDialogAnswer({ values: [] })).toBe("[]");
  });

  it("drops images from a standalone input", () => {
    expect(encodeDialogAnswer({ value: "hi", images: [img] })).toBe("hi");
  });

  it("drops images from batch input entries, keeps the rest", () => {
    const out = encodeDialogAnswer({ answers: [{ confirmed: true }, { value: "t", images: [img] }, { values: ["a"] }] });
    expect(JSON.parse(out)).toEqual([{ confirmed: true }, { value: "t" }, { values: ["a"] }]);
  });
});
