/**
 * Tests for the bridge tail-window entry selector (change: bound-bridge-resume-replay, D1).
 */
import { describe, expect, it } from "vitest";
import { BRIDGE_TAIL_ENTRIES, selectEntryWindow } from "../select-entry-window.js";

function userEntry(i: number) {
  return { id: `u${i}`, type: "message", message: { role: "user", content: `hi ${i}` } };
}
function assistantEntry(i: number, toolCallIds: string[] = []) {
  const content: any[] = [{ type: "text", text: `reply ${i}` }];
  for (const id of toolCallIds) content.push({ type: "toolCall", id, name: "bash", arguments: "{}" });
  return { id: `a${i}`, type: "message", message: { role: "assistant", content } };
}
function toolResultEntry(toolCallId: string) {
  return {
    id: `r-${toolCallId}`,
    type: "message",
    message: { role: "toolResult", toolCallId, toolName: "bash", content: [{ type: "text", text: "ok" }] },
  };
}

describe("selectEntryWindow", () => {
  it("returns all entries when the branch fits within budget", () => {
    const entries = [userEntry(1), assistantEntry(1), userEntry(2), assistantEntry(2)];
    const { entries: window, hasOlder } = selectEntryWindow(entries, 10);
    expect(window).toHaveLength(4);
    expect(hasOlder).toBe(false);
  });

  it("picks the last-N entries and reports hasOlder when the branch exceeds budget", () => {
    // 20 plain user entries (no tool spans → every boundary is safe).
    const entries = Array.from({ length: 20 }, (_, i) => userEntry(i));
    const { entries: window, hasOlder } = selectEntryWindow(entries, 5);
    expect(window).toHaveLength(5);
    expect(hasOlder).toBe(true);
    // Should be the newest 5.
    expect(window.map((e) => e.id)).toEqual(["u15", "u16", "u17", "u18", "u19"]);
  });

  it("extends the start backward to a safe cut so the tail never opens mid-tool-span", () => {
    // Layout (indices): 0 user, 1 assistant(toolCall t1), 2 toolResult t1,
    // 3 user, 4 assistant(toolCall t2), 5 toolResult t2, 6 user, 7 assistant.
    const entries = [
      userEntry(0),
      assistantEntry(0, ["t1"]),
      toolResultEntry("t1"),
      userEntry(1),
      assistantEntry(1, ["t2"]),
      toolResultEntry("t2"),
      userEntry(2),
      assistantEntry(2),
    ];
    // budget 3 → naive start at index 5 (the toolResult t2), which is UNSAFE
    // (tool span for t2 still open at boundary 5). Must extend back to a safe
    // boundary (index 3, after t1's span closed at boundary 3).
    const { entries: window } = selectEntryWindow(entries, 3);
    const first = window[0];
    // First entry must not be an orphan toolResult.
    expect(first.message.role).not.toBe("toolResult");
    // Window covers from a safe cut → includes the full t2 span.
    const ids = window.map((e) => e.id);
    expect(ids).toContain("a1"); // assistant that opened t2
    expect(ids).toContain("r-t2"); // its result
  });

  it("falls back to the hard-cap boundary when no safe cut exists within 2×budget", () => {
    // A pathological branch: one assistant opens a tool call that never closes
    // within the cap window. Build 10 entries where an early toolCall stays
    // open across the whole cap span.
    const entries: any[] = [assistantEntry(0, ["open"])];
    for (let i = 1; i < 10; i++) entries.push(userEntry(i));
    // budget 2 → cap floor = 10 - 4 = 6. No safe cut (tool "open" never closes),
    // so start clamps at the cap floor (index 6).
    const { entries: window } = selectEntryWindow(entries, 2);
    expect(window).toHaveLength(4); // entries[6..9]
    expect(window[0].id).toBe("u6");
  });

  it("defaults to BRIDGE_TAIL_ENTRIES budget", () => {
    const entries = Array.from({ length: BRIDGE_TAIL_ENTRIES + 50 }, (_, i) => userEntry(i));
    const { entries: window, hasOlder } = selectEntryWindow(entries);
    expect(window.length).toBeLessThanOrEqual(BRIDGE_TAIL_ENTRIES);
    expect(hasOlder).toBe(true);
  });

  it("handles an empty branch", () => {
    const { entries: window, hasOlder } = selectEntryWindow([], 5);
    expect(window).toHaveLength(0);
    expect(hasOlder).toBe(false);
  });
});
