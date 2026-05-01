/**
 * Regression suite for change: fix-text-tool-render-order
 *
 * For an assistant message whose `content[]` array contains both a `text`
 * block and one or more `toolCall` blocks, the chat panel's `messages[]`
 * SHALL end up in the same order as the model's content array — text bubble
 * placed BEFORE its child tool cards (and thinking bubble before text when
 * the message also contains a `thinking` block). The fix lives in the
 * client `event-reducer.ts` `case "message_end"` arm; this file drives
 * the reducer with raw event sequences (no DOM, no React) and asserts
 * the resulting `messages` array.
 */

import { describe, it, expect } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce(reduceEvent, createInitialState());
}

/** Build a `message_start` event with role:"assistant" (no-op in reducer but
 *  matches the live event shape). */
function asstStart(t: number): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: t,
    data: { message: { role: "assistant", content: [] } },
  };
}

/** Build a `message_update` event with a streaming text delta. */
function textDelta(t: number, text: string): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: { message: { role: "assistant", content: [{ type: "text", text }] } },
  };
}

/** Build a `tool_execution_start` event. */
function toolStart(t: number, id: string, name = "edit"): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: t,
    data: { toolCallId: id, toolName: name, args: {} },
  };
}

/** Build a `message_end` event with a fully-formed assistant content array. */
function asstEnd(t: number, content: unknown[]): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: t,
    data: {
      message: { role: "assistant", content },
      entryId: undefined,
    },
  };
}

/** Build the thinking_end synthetic that the reducer accepts via `message_update`'s
 *  `assistantMessageEvent` channel. */
function thinkingStart(t: number): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: { assistantMessageEvent: { type: "thinking_start" } },
  };
}
function thinkingDelta(t: number, delta: string): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: { assistantMessageEvent: { type: "thinking_delta", delta } },
  };
}
function thinkingEnd(t: number): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: { assistantMessageEvent: { type: "thinking_end" } },
  };
}

describe("event-reducer: assistant content-array order", () => {
  it("[text, toolCall] places text bubble before tool card", () => {
    const state = applyEvents([
      asstStart(1000),
      textDelta(1001, "Now mark group 7 + 8:"),
      toolStart(1002, "t1"),
      asstEnd(1003, [
        { type: "text", text: "Now mark group 7 + 8:" },
        { type: "toolCall", id: "t1", name: "edit" },
      ]),
    ]);

    const tail = state.messages.slice(-2);
    expect(tail.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    expect(tail[0].content).toBe("Now mark group 7 + 8:");
    expect(tail[1].toolCallId).toBe("t1");
    expect(tail[1].toolStatus).toBe("running");
  });

  it("[text, toolCall, toolCall, toolCall] preserves content-array order regardless of arrival order", () => {
    // tool_execution_start arrives in order t3, t1, t2 (deliberately scrambled)
    const state = applyEvents([
      asstStart(1000),
      textDelta(1001, "Doing three things:"),
      toolStart(1002, "t3"),
      toolStart(1003, "t1"),
      toolStart(1004, "t2"),
      asstEnd(1005, [
        { type: "text", text: "Doing three things:" },
        { type: "toolCall", id: "t1" },
        { type: "toolCall", id: "t2" },
        { type: "toolCall", id: "t3" },
      ]),
    ]);

    const tail = state.messages.slice(-4);
    expect(tail.map((m) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
      "toolResult",
    ]);
    expect(tail.map((m) => m.toolCallId ?? null)).toEqual([null, "t1", "t2", "t3"]);
  });

  it("[toolCall, text] faithfully renders tool card BEFORE text (no hardcoded text-first)", () => {
    // Synthetic content where toolCall comes first in the array. The reducer
    // SHALL NOT invent a text-first ordering; it SHALL inherit content order.
    const state = applyEvents([
      asstStart(1000),
      toolStart(1001, "t1"),
      textDelta(1002, "That's why I called it"),
      asstEnd(1003, [
        { type: "toolCall", id: "t1" },
        { type: "text", text: "That's why I called it" },
      ]),
    ]);

    const tail = state.messages.slice(-2);
    expect(tail.map((m) => m.role)).toEqual(["toolResult", "assistant"]);
    expect(tail[0].toolCallId).toBe("t1");
    expect(tail[1].content).toBe("That's why I called it");
  });

  it("[thinking, text, toolCall] places thinking, then assistant, then tool card", () => {
    const state = applyEvents([
      asstStart(1000),
      thinkingStart(1001),
      thinkingDelta(1002, "Considering options..."),
      thinkingEnd(1003),
      textDelta(1004, "Here we go:"),
      toolStart(1005, "t1"),
      asstEnd(1006, [
        { type: "thinking", thinking: "Considering options..." },
        { type: "text", text: "Here we go:" },
        { type: "toolCall", id: "t1" },
      ]),
    ]);

    const tail = state.messages.slice(-3);
    expect(tail.map((m) => m.role)).toEqual(["thinking", "assistant", "toolResult"]);
    expect(tail[0].content).toBe("Considering options...");
    expect(tail[1].content).toBe("Here we go:");
    expect(tail[2].toolCallId).toBe("t1");
  });

  it("tool-only message [toolCall] is a no-op (no phantom assistant bubble)", () => {
    const state = applyEvents([
      asstStart(1000),
      toolStart(1001, "t1"),
      asstEnd(1002, [{ type: "toolCall", id: "t1" }]),
    ]);

    // The toolResult row stays where it was. The reducer's existing
    // tool-only path may push a turnSeparator after it — that is part of
    // the pre-existing behavior and unchanged by this fix.
    const lastTool = [...state.messages].reverse().find((m) => m.role === "toolResult");
    expect(lastTool?.toolCallId).toBe("t1");
    // No assistant row was synthesised
    expect(state.messages.find((m) => m.role === "assistant")).toBeUndefined();
  });

  it("text-only message [text] is a no-op (no toolCall blocks → fast path)", () => {
    const state = applyEvents([
      asstStart(1000),
      textDelta(1001, "Done."),
      asstEnd(1002, [{ type: "text", text: "Done." }]),
    ]);

    const last = state.messages[state.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.content).toBe("Done.");
  });

  it("tool cards from prior assistant messages are not touched when later message reorders", () => {
    // Message A: [text, toolCall(tA)]
    // Message B: [text, toolCall(tB)]
    // After both message_ends, A's rows must keep their indices; only B's
    // suffix is reordered.
    const state = applyEvents([
      asstStart(1000),
      textDelta(1001, "First action:"),
      toolStart(1002, "tA"),
      asstEnd(1003, [
        { type: "text", text: "First action:" },
        { type: "toolCall", id: "tA" },
      ]),
      // tool_execution_end for tA does not affect messages[] order; we
      // skip it here for brevity. Now message B starts:
      asstStart(2000),
      textDelta(2001, "Second action:"),
      toolStart(2002, "tB"),
      asstEnd(2003, [
        { type: "text", text: "Second action:" },
        { type: "toolCall", id: "tB" },
      ]),
    ]);

    // Find the indices of each row by content
    const idxAssistantA = state.messages.findIndex((m) => m.content === "First action:");
    const idxToolA = state.messages.findIndex((m) => m.toolCallId === "tA");
    const idxAssistantB = state.messages.findIndex((m) => m.content === "Second action:");
    const idxToolB = state.messages.findIndex((m) => m.toolCallId === "tB");

    expect(idxAssistantA).toBeGreaterThanOrEqual(0);
    expect(idxToolA).toBe(idxAssistantA + 1);
    expect(idxAssistantB).toBeGreaterThan(idxToolA);
    expect(idxToolB).toBe(idxAssistantB + 1);
  });

  it("tool_execution_start arriving AFTER message_end is a no-op reorder; subsequent push lands after assistant", () => {
    // Synthetic order where message_end fires before tool_execution_start.
    // The reorder helper at message_end finds no tool card to move
    // (it isn't pushed yet); when the tool_execution_start fires
    // afterwards, it appends naturally and ends up after the assistant
    // bubble — preserving content-array order without any extra work.
    const state = applyEvents([
      asstStart(1000),
      textDelta(1001, "Will call a tool:"),
      asstEnd(1002, [
        { type: "text", text: "Will call a tool:" },
        { type: "toolCall", id: "t1" },
      ]),
      toolStart(1003, "t1"),
    ]);

    const tail = state.messages.slice(-2);
    expect(tail.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    expect(tail[0].content).toBe("Will call a tool:");
    expect(tail[1].toolCallId).toBe("t1");
  });

  it("tool_execution_start arriving AFTER message_end with PRIOR user message preserves user position", () => {
    // Regression for the K-overcount edge: spec scenario 8 promises a
    // no-op reorder when a content block has no corresponding row in
    // messages[]. Without the unclaimed-row guard, the K-sized suffix
    // window would slurp the prior user row in and append it at the
    // tail (placing the user message AFTER the just-ended assistant).
    // With the guard, unclaimed suffix rows keep their original
    // positions; only matched rows reorder.
    const state = applyEvents([
      // Prior user message
      {
        eventType: "message_start",
        timestamp: 1,
        data: { message: { role: "user", content: [{ type: "text", text: "go" }] } },
      },
      // New assistant: text streams + message_end BEFORE tool_execution_start
      asstStart(100),
      textDelta(101, "Working..."),
      asstEnd(102, [
        { type: "text", text: "Working..." },
        { type: "toolCall", id: "t1" },
      ]),
      // tool_execution_start arrives after message_end
      toolStart(103, "t1"),
    ]);

    const userIdx = state.messages.findIndex((m) => m.role === "user");
    const asstIdx = state.messages.findIndex((m) => m.role === "assistant");
    const toolIdx = state.messages.findIndex((m) => m.role === "toolResult");

    // Expected order: user (chronologically first) → assistant → tool
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(asstIdx).toBe(userIdx + 1);
    expect(toolIdx).toBe(asstIdx + 1);
  });

  it("empty thinking block in content does not pull prior message rows into the suffix", () => {
    // Defensive scenario: content array declares a thinking block but no
    // thinking_end fired (e.g. empty thinking string). K=3 (thinking + text
    // + toolCall), but only 2 rows belong to this message. The K-sized
    // suffix slice would otherwise include a row from the prior message;
    // the unclaimed-row guard keeps it in place.
    const state = applyEvents([
      // Prior assistant message landing [assistant_A, tool_A]
      asstStart(100),
      textDelta(101, "First:"),
      toolStart(102, "tA"),
      asstEnd(103, [
        { type: "text", text: "First:" },
        { type: "toolCall", id: "tA" },
      ]),
      // New assistant: declares thinking in content but no thinking_end
      // event was ever streamed (empty thinking case)
      asstStart(200),
      textDelta(201, "Second:"),
      toolStart(202, "tB"),
      asstEnd(203, [
        { type: "thinking", thinking: "" },
        { type: "text", text: "Second:" },
        { type: "toolCall", id: "tB" },
      ]),
    ]);

    const idxAsstA = state.messages.findIndex((m) => m.content === "First:");
    const idxToolA = state.messages.findIndex((m) => m.toolCallId === "tA");
    const idxAsstB = state.messages.findIndex((m) => m.content === "Second:");
    const idxToolB = state.messages.findIndex((m) => m.toolCallId === "tB");

    // Prior message order preserved
    expect(idxAsstA).toBeGreaterThanOrEqual(0);
    expect(idxToolA).toBe(idxAsstA + 1);
    // New message reordered (text before tool)
    expect(idxAsstB).toBeGreaterThan(idxToolA);
    expect(idxToolB).toBe(idxAsstB + 1);
  });

  it("empty streamingText with non-empty content text (replay/fork fallback) still reorders", () => {
    // Replay path: tool_execution_start arrives, then message_end with
    // populated content but NO prior message_update (streamingText empty).
    // The reducer's existing replayText fallback pushes the assistant bubble;
    // the reorder must still place it before the tool card.
    const state = applyEvents([
      asstStart(1000),
      // No text deltas — streamingText stays empty
      toolStart(1001, "t1"),
      asstEnd(1002, [
        { type: "text", text: "Replayed text" },
        { type: "toolCall", id: "t1" },
      ]),
    ]);

    const tail = state.messages.slice(-2);
    expect(tail.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    expect(tail[0].content).toBe("Replayed text");
    expect(tail[1].toolCallId).toBe("t1");
  });

  it("DOM identity preserved: tool card id is the same before and after reorder", () => {
    // Before message_end fires, the tool card has id `tool-t1`. After
    // message_end's reorder, it MUST still be `tool-t1` (React keyed
    // reconciliation depends on this — the spinner DOM node is reused).
    const eventsBefore: DashboardEvent[] = [
      asstStart(1000),
      textDelta(1001, "Doing X:"),
      toolStart(1002, "t1"),
    ];
    const stateBefore = applyEvents(eventsBefore);
    const toolBefore = stateBefore.messages.find((m) => m.toolCallId === "t1")!;
    expect(toolBefore.id).toBe("tool-t1");

    const stateAfter = applyEvents([
      ...eventsBefore,
      asstEnd(1003, [
        { type: "text", text: "Doing X:" },
        { type: "toolCall", id: "t1" },
      ]),
    ]);
    const toolAfter = stateAfter.messages.find((m) => m.toolCallId === "t1")!;
    expect(toolAfter.id).toBe("tool-t1");
  });
});
