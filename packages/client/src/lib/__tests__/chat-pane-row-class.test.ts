import { describe, expect, it } from "vitest";
import {
  CHAT_COMPOSER_BOUND,
  CHAT_COMPOSER_WEIGHT,
  CHAT_HEADER_BOUND,
  CHAT_HEADER_FLOOR,
  CHAT_HEADER_WEIGHT,
  CHAT_PANE_ROW_TABLE,
  CHAT_TRANSCRIPT_BOUND,
  CHAT_TRANSCRIPT_FLOOR,
  CHAT_TRANSCRIPT_WEIGHT,
  type ShrinkableRowSpec,
} from "../layout/chat-pane-row-class.js";

describe("chat-pane-row-class constants & table (L1, #E1)", () => {
  it("declares transcript constants: floor > bound with weight 3", () => {
    expect(CHAT_TRANSCRIPT_FLOOR).toBe(64);
    expect(CHAT_TRANSCRIPT_BOUND).toBe(16);
    expect(CHAT_TRANSCRIPT_WEIGHT).toBe(3);
    expect(CHAT_TRANSCRIPT_FLOOR).toBeGreaterThan(CHAT_TRANSCRIPT_BOUND);
  });

  it("declares composer constants: bound 72 with weight 1", () => {
    expect(CHAT_COMPOSER_BOUND).toBe(72);
    expect(CHAT_COMPOSER_WEIGHT).toBe(1);
  });

  it("declares header constants: bound 0, floor 1, weight 2", () => {
    expect(CHAT_HEADER_BOUND).toBe(0);
    expect(CHAT_HEADER_FLOOR).toBe(1);
    expect(CHAT_HEADER_WEIGHT).toBe(2);
    expect(CHAT_HEADER_FLOOR).toBeGreaterThan(CHAT_HEADER_BOUND);
  });

  it("classifies content-header-sticky as shrinkable at bound 0 (D6)", () => {
    const row = CHAT_PANE_ROW_TABLE["content-header-sticky"] as ShrinkableRowSpec;
    expect(row.rowClass).toBe("shrinkable");
    expect(row.bound).toBe(0);
    expect(row.floor).toBe(1);
    expect(row.weight).toBe(2);
    // floor > bound is the table's validation idiom; bound 0 is deliberate.
    expect(row.floor).toBeGreaterThan(row.bound);
  });

  it("asserts floor > bound for each shrinkable row in the table", () => {
    const shrinkableRows = Object.entries(CHAT_PANE_ROW_TABLE).filter(
      ([, spec]) => spec.rowClass === "shrinkable",
    ) as [string, ShrinkableRowSpec][];

    // transcript + composer + sticky header. NOTE: bound is a LOWER bound, so
    // 0 is legal (the header's); no assertion may demand bound > 0.
    expect(shrinkableRows.length).toBe(3);

    for (const [name, row] of shrinkableRows) {
      expect(
        row.floor,
        `Row '${name}' must declare floor strictly greater than bound to participate in shrink pool`,
      ).toBeGreaterThan(row.bound);
    }
  });
});
