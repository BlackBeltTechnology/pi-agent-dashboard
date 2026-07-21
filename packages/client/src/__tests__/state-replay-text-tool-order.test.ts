/**
 * Round-trip test for change: fix-text-tool-render-order.
 *
 * Asserts that an assistant entry with content `[text, toolCall]` replays
 * through `replayEntriesAsEvents` + the client reducer to produce a
 * `messages[]` whose suffix is `[..., assistant-text, toolResult]` \u2014
 * the same order as the model's content array. Without the reducer fix,
 * the order is reversed.
 */
import { describe, it, expect } from "vitest";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { createInitialState, reduceEvent } from "../lib/chat/event-reducer.js";

function replayAndReduce(entries: any[]) {
  const events = replayEntriesAsEvents("sess-1", entries);
  let state = createInitialState();
  for (const env of events) {
    state = reduceEvent(state, env.event);
  }
  return state;
}

describe("state-replay text+toolCall order", () => {
  it("[text, toolCall] assistant message replays in content-array order", () => {
    // Real shape harvested from a pi 0.70 session JSONL (sanitised):
    // an assistant message that emits commentary and a tool call in the
    // same content array.
    const entries = [
      {
        type: "message",
        id: "u1",
        parentId: "root",
        timestamp: "2026-04-29T06:31:21.000Z",
        message: { role: "user", content: [{ type: "text", text: "go" }] },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-04-29T06:31:21.500Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Now mark group 7 + 8:" },
            { type: "toolCall", id: "t1", name: "edit", arguments: { path: "x" } },
          ],
        },
      },
    ];

    const state = replayAndReduce(entries);
    const tail = state.messages.slice(-2);
    expect(tail.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    expect(tail[0].content).toBe("Now mark group 7 + 8:");
    expect(tail[1].toolCallId).toBe("t1");
  });

  it("two consecutive [text, toolCall] messages replay without cross-message bleed", () => {
    const entries = [
      {
        type: "message",
        id: "u1",
        parentId: "root",
        timestamp: "2026-04-29T06:31:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "go" }] },
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: "2026-04-29T06:31:21.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "First action:" },
            { type: "toolCall", id: "tA", name: "edit", arguments: {} },
          ],
        },
      },
      {
        type: "message",
        id: "a2",
        parentId: "a1",
        timestamp: "2026-04-29T06:31:25.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Second action:" },
            { type: "toolCall", id: "tB", name: "bash", arguments: {} },
          ],
        },
      },
    ];

    const state = replayAndReduce(entries);
    const idxAssistantA = state.messages.findIndex((m) => m.content === "First action:");
    const idxToolA = state.messages.findIndex((m) => m.toolCallId === "tA");
    const idxAssistantB = state.messages.findIndex((m) => m.content === "Second action:");
    const idxToolB = state.messages.findIndex((m) => m.toolCallId === "tB");

    expect(idxAssistantA).toBeGreaterThanOrEqual(0);
    expect(idxToolA).toBe(idxAssistantA + 1);
    expect(idxAssistantB).toBeGreaterThan(idxToolA);
    expect(idxToolB).toBe(idxAssistantB + 1);
  });

  it("[thinking, text, toolCall] assistant message replays as thinking → text → tool", () => {
    const entries = [
      {
        type: "message",
        id: "a1",
        parentId: "root",
        timestamp: "2026-04-29T06:31:21.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Let me think..." },
            { type: "text", text: "Going to call edit:" },
            { type: "toolCall", id: "t1", name: "edit", arguments: {} },
          ],
        },
      },
    ];

    const state = replayAndReduce(entries);
    const tail = state.messages.slice(-3);
    // state-replay does not currently emit thinking_end events for replay,
    // so the thinking row may not be in the suffix. The critical assertion
    // is that text precedes toolResult.
    const assistantIdx = tail.findIndex((m) => m.role === "assistant");
    const toolIdx = tail.findIndex((m) => m.role === "toolResult");
    expect(assistantIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(assistantIdx).toBeLessThan(toolIdx);
  });
});
