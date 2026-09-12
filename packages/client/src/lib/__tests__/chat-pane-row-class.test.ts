import { describe, expect, it } from "vitest";
import {
  CHAT_COMPOSER_BOUND,
  CHAT_COMPOSER_WEIGHT,
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

  it("asserts floor > bound for each shrinkable row in the table", () => {
    const shrinkableRows = Object.entries(CHAT_PANE_ROW_TABLE).filter(
      ([, spec]) => spec.rowClass === "shrinkable",
    ) as [string, ShrinkableRowSpec][];

    expect(shrinkableRows.length).toBe(2);

    for (const [name, row] of shrinkableRows) {
      expect(
        row.floor,
        `Row '${name}' must declare floor strictly greater than bound to participate in shrink pool`,
      ).toBeGreaterThan(row.bound);
    }
  });
});
