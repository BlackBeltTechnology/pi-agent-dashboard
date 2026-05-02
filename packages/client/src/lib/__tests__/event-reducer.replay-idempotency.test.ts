/**
 * Regression suite for change: fix-replay-duplicates-tool-and-flushed-rows
 *
 * Reducing the same event sequence twice from `createInitialState()` MUST
 * produce equal `messages[]`. Equivalently: replaying a sequence on top
 * of itself MUST NOT double the chat. This is the unit-level proof of
 * the symptom observed on session 019de212-… where 50 tool calls
 * rendered as 14-16 copies.
 */

import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent } from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Synthesize the shape of session 019de212-…'s event stream:
 * - assistant message_start
 * - some streaming text (message_update with text)
 * - tool_execution_start (triggers streamingText flush + tool row)
 * - tool_execution_end
 * - … repeat …
 * - message_end
 *
 * Several user/assistant turn pairs to mimic a real-world session.
 */
function buildSessionEvents(): DashboardEvent[] {
  const events: DashboardEvent[] = [];
  let ts = 1000;
  const next = () => (ts += 100);

  // Turn 1: user → assistant with 2 tools
  events.push({
    eventType: "message_start",
    timestamp: next(),
    data: { message: { role: "user", content: "do a thing" } },
  });
  events.push({
    eventType: "message_end",
    timestamp: next(),
    data: { entryId: "u1", message: { role: "user", content: "do a thing" } },
  });
  events.push({
    eventType: "message_start",
    timestamp: next(),
    data: { message: { role: "assistant", content: [] } },
  });
  events.push({
    eventType: "message_update",
    timestamp: next(),
    data: { message: { role: "assistant", content: [{ type: "text", text: "I'll start by listing files." }] } },
  });
  events.push({
    eventType: "tool_execution_start",
    timestamp: next(),
    data: { toolCallId: "t1", toolName: "bash", args: { command: "ls" } },
  });
  events.push({
    eventType: "tool_execution_end",
    timestamp: next(),
    data: { toolCallId: "t1", isError: false, result: "file1\nfile2" },
  });
  events.push({
    eventType: "tool_execution_start",
    timestamp: next(),
    data: { toolCallId: "t2", toolName: "bash", args: { command: "pwd" } },
  });
  events.push({
    eventType: "tool_execution_end",
    timestamp: next(),
    data: { toolCallId: "t2", isError: false, result: "/tmp" },
  });
  events.push({
    eventType: "message_end",
    timestamp: next(),
    data: {
      entryId: "a1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "I'll start by listing files." },
          { type: "toolCall", id: "t1" },
          { type: "toolCall", id: "t2" },
        ],
      },
    },
  });

  // Turn 2: another user → assistant with 1 tool
  events.push({
    eventType: "message_start",
    timestamp: next(),
    data: { message: { role: "user", content: "now show me the date" } },
  });
  events.push({
    eventType: "message_end",
    timestamp: next(),
    data: { entryId: "u2", message: { role: "user", content: "now show me the date" } },
  });
  events.push({
    eventType: "message_start",
    timestamp: next(),
    data: { message: { role: "assistant", content: [] } },
  });
  events.push({
    eventType: "message_update",
    timestamp: next(),
    data: { message: { role: "assistant", content: [{ type: "text", text: "Sure." }] } },
  });
  events.push({
    eventType: "tool_execution_start",
    timestamp: next(),
    data: { toolCallId: "t3", toolName: "bash", args: { command: "date" } },
  });
  events.push({
    eventType: "tool_execution_end",
    timestamp: next(),
    data: { toolCallId: "t3", isError: false, result: "Sat May 2" },
  });
  events.push({
    eventType: "message_end",
    timestamp: next(),
    data: {
      entryId: "a2",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Sure." },
          { type: "toolCall", id: "t3" },
        ],
      },
    },
  });

  return events;
}

describe("event-reducer replay idempotency", () => {
  it("reducing the same sequence twice from initial state produces equal messages[]", () => {
    const events = buildSessionEvents();

    const run1 = events.reduce(reduceEvent, createInitialState());
    const run2 = events.reduce(reduceEvent, createInitialState());

    expect(run2.messages.length).toBe(run1.messages.length);
    for (let i = 0; i < run1.messages.length; i++) {
      // Compare the structural fields; ignore identity by deep-equal of role+content+ids
      const a = run1.messages[i];
      const b = run2.messages[i];
      expect(b.id).toBe(a.id);
      expect(b.role).toBe(a.role);
      expect(b.toolCallId).toBe(a.toolCallId);
      expect(b.entryId).toBe(a.entryId);
      expect(b.content).toBe(a.content);
    }
  });

  it("replaying tool events on top of existing state does NOT duplicate toolResult rows", () => {
    // This is the in-batch defense covered by Fix B (toolResult idempotency)
    // and Fix C (stable flush row id). The full "no message[] doubling on
    // replay" contract is delivered at the WS handler layer (Fix A) where
    // event_replay resets state before reduction — see
    // useMessageHandler.replay-reset.test.tsx. Here we pin only the reducer-
    // local guarantees: tool rows and flush rows are key-stable across replay.
    const events = buildSessionEvents();

    let s = events.reduce(reduceEvent, createInitialState());
    const toolRowsAfterFirstRun = s.messages.filter((m) => m.role === "toolResult").length;
    const flushRowsAfterFirstRun = s.messages.filter(
      (m) => m.role === "assistant" && typeof m.id === "string" && m.id.startsWith("flush-"),
    ).length;

    // Replay the same events on top — simulates the bug where event_replay
    // arrives without a state reset.
    for (const e of events) s = reduceEvent(s, e);

    expect(s.messages.filter((m) => m.role === "toolResult").length).toBe(toolRowsAfterFirstRun);
    expect(
      s.messages.filter((m) => m.role === "assistant" && typeof m.id === "string" && m.id.startsWith("flush-")).length,
    ).toBe(flushRowsAfterFirstRun);
  });
});
