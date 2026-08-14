/**
 * Change: greet-as-assistant-message
 *
 * A session message with role:"custom" and display:true renders as ONE
 * assistant-side ChatMessage. It is built at message_end (message_start is a
 * no-op), is idempotent across re-replay, and never participates in
 * assistant-inference bookkeeping. display:false produces no row.
 */
import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function customStart(content: unknown, display: boolean, entryId?: string, ts = 1000): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: ts,
    data: { message: { role: "custom", customType: "x-note", content, display }, ...(entryId ? { entryId } : {}) },
  };
}
function customEnd(content: unknown, display: boolean, entryId?: string, ts = 1000): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: ts,
    data: { message: { role: "custom", customType: "x-note", content, display }, ...(entryId ? { entryId } : {}) },
  };
}

/** A message_end carrying an ib-greeting (change: replace-replayed-greeting). */
function greetingEnd(content: unknown, display: boolean, entryId?: string, ts = 1000): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: ts,
    data: { message: { role: "custom", customType: "ib-greeting", content, display }, ...(entryId ? { entryId } : {}) },
  };
}

describe("custom display-message rendering", () => {
  it("T1: a custom display message becomes one assistant row with its content", () => {
    let s = createInitialState();
    s = reduceEvent(s, customStart("hello there", true, "e1"));
    // message_start is a no-op — no row yet.
    expect(s.messages).toHaveLength(0);
    s = reduceEvent(s, customEnd("hello there", true, "e1"));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("assistant");
    expect(s.messages[0].content).toBe("hello there");
  });

  it("T1b: array content concatenates text parts", () => {
    let s = createInitialState();
    s = reduceEvent(s, customEnd([{ type: "text", text: "a" }, { type: "text", text: "b" }], true, "e1"));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].content).toBe("ab");
  });

  it("T2: replaying the same custom message twice yields exactly one row", () => {
    let s = createInitialState();
    s = reduceEvent(s, customStart("once", true, "e1"));
    s = reduceEvent(s, customEnd("once", true, "e1"));
    s = reduceEvent(s, customStart("once", true, "e1"));
    s = reduceEvent(s, customEnd("once", true, "e1"));
    const rows = s.messages.filter((m) => m.id === "custom-e1");
    expect(rows).toHaveLength(1);
    expect(s.messages).toHaveLength(1);
  });

  it("T3: a hidden custom message (display:false) produces no row", () => {
    let s = createInitialState();
    s = reduceEvent(s, customStart("secret", false, "e1"));
    s = reduceEvent(s, customEnd("secret", false, "e1"));
    expect(s.messages).toHaveLength(0);
  });

  it("T4: a custom display message does not disturb a following assistant turn", () => {
    let s = createInitialState();
    s = reduceEvent(s, customEnd("opener", true, "e1"));
    const seqAfterCustom = s.assistantInferenceSeq;
    expect(seqAfterCustom).toBe(0); // custom never advances the inference counter

    // A real assistant message with [text, toolCall] content.
    s = reduceEvent(s, { eventType: "message_start", timestamp: 2000, data: { message: { role: "assistant" } } });
    expect(s.assistantInferenceSeq).toBe(1);
    s = reduceEvent(s, {
      eventType: "tool_execution_start",
      timestamp: 2100,
      data: { toolCallId: "t1", toolName: "bash", args: { command: "ls" } },
    });
    s = reduceEvent(s, { eventType: "tool_execution_end", timestamp: 2200, data: { toolCallId: "t1", isError: false, result: "ok" } });
    s = reduceEvent(s, {
      eventType: "message_end",
      timestamp: 2300,
      data: { message: { role: "assistant", content: [{ type: "text", text: "done" }, { type: "toolCall", id: "t1", name: "bash" }] } },
    });

    // The custom opener row survives untouched at the head.
    expect(s.messages[0].id).toBe("custom-e1");
    expect(s.messages[0].content).toBe("opener");
    // Assistant text renders before its own tool card (reorder unaffected).
    const textIdx = s.messages.findIndex((m) => m.role === "assistant" && m.content === "done");
    const toolIdx = s.messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === "t1");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(textIdx);
  });
});

describe("ib-greeting singleton replacement (change: replace-replayed-greeting)", () => {
  it("T4: a newer greeting replaces the prior greeting in place", () => {
    let s = createInitialState();
    s = reduceEvent(s, greetingEnd("A", true, "g1"));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].id).toBe("custom-ib-greeting");
    expect(s.messages[0].content).toBe("A");

    s = reduceEvent(s, greetingEnd("B", true, "g2"));
    expect(s.messages).toHaveLength(1); // replaced, not appended
    expect(s.messages[0].id).toBe("custom-ib-greeting");
    expect(s.messages[0].content).toBe("B");
    expect(s.messages[0].entryId).toBe("g2");
  });

  it("T5: unrelated custom messages are not collapsed", () => {
    let s = createInitialState();
    s = reduceEvent(s, greetingEnd("A", true, "g1"));
    s = reduceEvent(s, customEnd("note-one", true, "c1"));
    s = reduceEvent(s, greetingEnd("B", true, "g2"));
    // One greeting row (latest) + one separate x-note row.
    expect(s.messages).toHaveLength(2);
    const greeting = s.messages.find((m) => m.id === "custom-ib-greeting");
    const note = s.messages.find((m) => m.id === "custom-c1");
    expect(greeting?.content).toBe("B");
    expect(note?.content).toBe("note-one");
  });

  it("T6: a hidden greeting produces no row", () => {
    let s = createInitialState();
    s = reduceEvent(s, greetingEnd("secret", false, "g1"));
    expect(s.messages).toHaveLength(0);
  });
});
