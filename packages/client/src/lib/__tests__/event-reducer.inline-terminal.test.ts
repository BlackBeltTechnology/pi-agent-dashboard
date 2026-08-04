import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../chat/event-reducer.js";

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

  // ── preserve-inline-terminal-transcript ──────────────────────────────────
  function openThenClose(transcript: string) {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "inline_terminal_open",
      timestamp: 1,
      data: { terminalId: "term-abc" },
    });
    state = reduceEvent(state, {
      eventType: "inline_terminal_close",
      timestamp: 2,
      data: { terminalId: "term-abc", transcript },
    });
    return state;
  }

  it("E16: an empty-transcript close removes the row entirely", () => {
    const state = openThenClose("");
    expect(state.messages.filter((m) => m.role === "inlineTerminal")).toHaveLength(0);
  });

  it("E17: a single ANSI-decorated prompt line (non-empty) stays frozen", () => {
    const state = openThenClose("\u001b[32m\u001b[1m~/repo \u001b[0m$ ");
    const rows = state.messages.filter((m) => m.role === "inlineTerminal");
    expect(rows).toHaveLength(1);
    expect((rows[0].args as any).closed).toBe(true);
  });

  it("E18: a whitespace-only (non-empty) transcript stays frozen", () => {
    const state = openThenClose("   \n\n");
    const rows = state.messages.filter((m) => m.role === "inlineTerminal");
    expect(rows).toHaveLength(1);
    expect((rows[0].args as any).closed).toBe(true);
  });

  it("X12: an empty close targeting a row already frozen with content leaves it intact", () => {
    let state = openThenClose("real output\n");
    // A stray/duplicate empty close for the same id must NOT destroy the card.
    state = reduceEvent(state, {
      eventType: "inline_terminal_close",
      timestamp: 3,
      data: { terminalId: "term-abc", transcript: "" },
    });
    const rows = state.messages.filter((m) => m.role === "inlineTerminal");
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("real output\n");
  });

  it("an empty close without a matching open appends nothing", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "inline_terminal_close",
      timestamp: 1,
      data: { terminalId: "term-ghost", transcript: "" },
    });
    expect(state.messages.filter((m) => m.role === "inlineTerminal")).toHaveLength(0);
  });
});
