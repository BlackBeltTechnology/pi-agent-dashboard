import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../event-reducer.js";

/**
 * Inline interactive terminal card reducer arms.
 * See change: add-inline-terminal-card.
 */
describe("eventReducer: inline terminal", () => {
  it("inline_terminal_open appends a live inlineTerminal row", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "inline_terminal_open",
      timestamp: 1,
      data: { terminalId: "term-abc" },
    });
    const rows = state.messages.filter((m) => m.role === "inlineTerminal");
    expect(rows).toHaveLength(1);
    const args = rows[0].args as any;
    expect(args.terminalId).toBe("term-abc");
    expect(args.closed).toBe(false);
  });

  it("inline_terminal_close transitions the matching row in place to frozen", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "inline_terminal_open",
      timestamp: 1,
      data: { terminalId: "term-abc" },
    });
    state = reduceEvent(state, {
      eventType: "inline_terminal_close",
      timestamp: 2,
      data: { terminalId: "term-abc", transcript: "$ echo hi\nhi\n" },
    });
    const rows = state.messages.filter((m) => m.role === "inlineTerminal");
    // Updated in place — no duplicate row.
    expect(rows).toHaveLength(1);
    const args = rows[0].args as any;
    expect(args.closed).toBe(true);
    expect(rows[0].content).toBe("$ echo hi\nhi\n");
  });

  it("inline_terminal_close without a matching open appends a frozen row (defensive)", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "inline_terminal_close",
      timestamp: 1,
      data: { terminalId: "term-orphan", transcript: "leftover" },
    });
    const rows = state.messages.filter((m) => m.role === "inlineTerminal");
    expect(rows).toHaveLength(1);
    expect((rows[0].args as any).closed).toBe(true);
    expect(rows[0].content).toBe("leftover");
  });
});
