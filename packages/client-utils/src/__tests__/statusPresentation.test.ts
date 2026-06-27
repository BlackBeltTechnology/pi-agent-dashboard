import { describe, expect, it } from "vitest";
import {
  type StatusKind,
  statusAriaLabel,
  statusPresentation,
} from "../statusPresentation.js";

describe("statusPresentation", () => {
  const kinds: StatusKind[] = ["done", "current", "todo", "error"];

  it("provides a non-color glyph indicator for every state", () => {
    for (const kind of kinds) {
      expect(statusPresentation(kind).glyph.trim().length).toBeGreaterThan(0);
    }
  });

  it("renders a distinct glyph per state (distinguishable without color)", () => {
    const glyphs = kinds.map((k) => statusPresentation(k).glyph);
    expect(new Set(glyphs).size).toBe(kinds.length);
  });

  it("done is distinguishable from todo by glyph alone", () => {
    expect(statusPresentation("done").glyph).not.toBe(statusPresentation("todo").glyph);
  });

  it("maps each state to a semantic --status / token var", () => {
    expect(statusPresentation("done").tokenVar).toContain("var(--");
    expect(statusPresentation("error").tokenVar).toContain("var(--status-error)");
  });

  it("statusAriaLabel names the item and its state", () => {
    expect(statusAriaLabel("Proposal", "done")).toBe("Proposal, done");
  });
});
