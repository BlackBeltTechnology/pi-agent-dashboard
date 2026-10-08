// See change: stream-subagent-reasoning-and-stable-card (card option C + inspector redesign).
import { describe, expect, it } from "vitest";
import { currentSentence, plainTail } from "../live-tail-text.js";

describe("plainTail", () => {
  it("strips heading, bullet, code and bold markers, keeps line breaks", () => {
    expect(plainTail("## Layout\n- `packages/`: 28 **workspaces**\n* docs")).toBe("Layout\n• packages/: 28 workspaces\n• docs");
  });
  it("leaves plain prose untouched", () => {
    expect(plainTail("I need:\n1. ls")).toBe("I need:\n1. ls");
  });
});

describe("currentSentence", () => {
  it("returns the sentence being written (plus the one before, if just started)", () => {
    expect(currentSentence("First done. Second is still go")).toBe("Second is still go");
    expect(currentSentence("First done. ")).toBe("First done.");
  });
  it("flattens whitespace and markers", () => {
    expect(currentSentence("## Head\n- item `x`")).toBe("Head • item x");
  });
  it("handles empty input", () => {
    expect(currentSentence("")).toBe("");
  });
});
