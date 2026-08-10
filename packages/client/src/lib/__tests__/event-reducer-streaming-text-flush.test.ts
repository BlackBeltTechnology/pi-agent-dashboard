/**
 * Regression suite for change: fix-streaming-text-vs-interactive-ui-order
 *
 * The reducer flushes `streamingText` into a permanent `role:"assistant"`
 * row at `tool_execution_start` time so that any subsequent `toolResult`
 * or `interactiveUi` rows pushed during the same assistant message land
 * BELOW the assistant text in `messages[]` for the entire tool runtime
 * — not just at `message_end`. This file drives the reducer with raw
 * event sequences and asserts BOTH the intermediate state (between
 * `tool_execution_start` and `message_end`) AND the final state.
 *
 * Tasks covered: 5.1, 5.1a, 5.1b, 5.1c, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8,
 * 3.3, 3.4, 3.4a, 3.4b, 3.4c, 4.1, 4.1a, 4.1b, 4.1c, 4.2.
 */

import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduceEvent,
  addInteractiveRequest,
  flushStreamingTextAsAssistantRow,
  findFlushedAssistantRowIndex,
  type SessionState,
  type ChatMessage,
} from "../chat/event-reducer.js";
import { findActiveInteractiveToolResultIds } from "../chat/collapse-retried-errors.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

function asstStart(t: number): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: t,
    data: { message: { role: "assistant", content: [] } },
  };
}
function userStart(t: number, text: string): DashboardEvent {
  return {
    eventType: "message_start",
    timestamp: t,
    data: { message: { role: "user", content: text } },
  };
}
function textDelta(t: number, text: string): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: { message: { role: "assistant", content: [{ type: "text", text }] } },
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
    data: { assistantMessageEvent: { type: "thinking_end", signature: "s" } },
  };
}
function toolStart(t: number, id: string, name = "bash", args: Record<string, unknown> = {}): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: t,
    data: { toolCallId: id, toolName: name, args },
  };
}
function toolUpdate(t: number, id: string, partial: string): DashboardEvent {
  return {
    eventType: "tool_execution_update",
    timestamp: t,
    data: { toolCallId: id, partialResult: partial },
  };
}
function toolEnd(t: number, id: string, result = "ok"): DashboardEvent {
  return {
    eventType: "tool_execution_end",
    timestamp: t,
    data: { toolCallId: id, result, status: "success" },
  };
}
function asstEnd(
  t: number,
  content: unknown[],
  opts: { entryId?: string; nonce?: string } = {},
): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: t,
    data: {
      message: { role: "assistant", content },
      entryId: opts.entryId,
      nonce: opts.nonce,
    },
  };
}

// Build a turnSeparator the same way the reducer does (tool-only assistant
// turn that emitted no prose).
function turnSep(state: SessionState, t: number): SessionState {
  // The reducer pushes a turnSeparator at message_end when streamingText is
  // empty AND msg.content has no text. The cleanest way to insert one here
  // is to mutate state directly to mirror the reducer's logic — we keep
  // tests deterministic without relying on coincidental empty-content paths.
  return {
    ...state,
    messages: [
      ...state.messages,
      {
        id: `sep-${state.messages.length}`,
        role: "turnSeparator",
        content: "",
        timestamp: t,
      },
    ],
  };
}

describe("flushStreamingTextAsAssistantRow (pure helper)", () => {
  // Task 5.7
  it("idempotency: second call returns state unchanged", () => {
    const initial: SessionState = {
      ...createInitialState(),
      streamingText: "hello",
    };
    const once = flushStreamingTextAsAssistantRow(initial, 100, "tool-1");
    const twice = flushStreamingTextAsAssistantRow(once, 200, "tool-2");
    expect(once).not.toBe(initial);
    expect(twice).toBe(once); // strict-equal: returned identity
    expect(once.messages).toHaveLength(1);
    expect(once.messages[0].role).toBe("assistant");
    expect(once.messages[0].content).toBe("hello");
    expect(once.streamingText).toBe("");
    expect(once.streamingTextFlushed).toBe(true);
  });

  it("no-op when streamingText is empty", () => {
    const initial: SessionState = createInitialState();
    const out = flushStreamingTextAsAssistantRow(initial, 100, "tool-1");
    expect(out).toBe(initial);
  });

  it("flushed row carries undefined entryId and nonce", () => {
    const initial: SessionState = {
      ...createInitialState(),
      streamingText: "x",
    };
    const out = flushStreamingTextAsAssistantRow(initial, 42, "tool-1");
    expect(out.messages[0].entryId).toBeUndefined();
    expect(out.messages[0].nonce).toBeUndefined();
    expect(out.messages[0].timestamp).toBe(42);
  });
});

describe("findFlushedAssistantRowIndex (pure helper)", () => {
  it("returns -1 on empty messages", () => {
    expect(findFlushedAssistantRowIndex([])).toBe(-1);
  });

  it("finds the most recent unstamped assistant row", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "stamped", timestamp: 1, entryId: "e1" },
      { id: "2", role: "toolResult", content: "bash", timestamp: 2 },
      { id: "3", role: "assistant", content: "flushed", timestamp: 3 },
    ];
    expect(findFlushedAssistantRowIndex(msgs)).toBe(2);
  });

  it("ignores assistant rows with entryId set", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "stamped", timestamp: 1, entryId: "e1" },
    ];
    expect(findFlushedAssistantRowIndex(msgs)).toBe(-1);
  });

  it("ignores assistant rows with nonce set", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "stamped", timestamp: 1, nonce: "n1" },
    ];
    expect(findFlushedAssistantRowIndex(msgs)).toBe(-1);
  });

  // Task 3.4a — hard turn-boundary clamp
  it("R3 clamp: stops at turnSeparator (does not match prior message's orphan flushed row)", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "orphan from prior msg", timestamp: 1 },
      { id: "2", role: "turnSeparator", content: "", timestamp: 2 },
      { id: "3", role: "toolResult", content: "bash", timestamp: 3 },
    ];
    // No assistant row in the current window → -1, NOT 0.
    expect(findFlushedAssistantRowIndex(msgs)).toBe(-1);
  });

  it("R3 clamp: stops at user row", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "orphan", timestamp: 1 },
      { id: "2", role: "user", content: "hi", timestamp: 2 },
    ];
    expect(findFlushedAssistantRowIndex(msgs)).toBe(-1);
  });

  it("R3 clamp: stops at commandFeedback row", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "orphan", timestamp: 1 },
      { id: "2", role: "commandFeedback", content: "/foo", timestamp: 2 },
    ];
    expect(findFlushedAssistantRowIndex(msgs)).toBe(-1);
  });

  it("R3 clamp: stops at rawEvent row", () => {
    const msgs: ChatMessage[] = [
      { id: "1", role: "assistant", content: "orphan", timestamp: 1 },
      { id: "2", role: "rawEvent", content: "evt", timestamp: 2 },
    ];
    expect(findFlushedAssistantRowIndex(msgs)).toBe(-1);
  });
});

describe("Task 5.1: ask_user blocking flow flushes before tool/ui rows land", () => {
  it("messages tail = [..., assistant, toolResult] after tool_execution_start", () => {
    const state = applyEvents([
      asstStart(100),
      textDelta(101, "I'll ask you which path:"),
      toolStart(102, "t1", "ask_user"),
    ]);

    expect(state.streamingText).toBe("");
    expect(state.streamingTextFlushed).toBe(true);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe("assistant");
    expect(state.messages[0].content).toBe("I'll ask you which path:");
    expect(state.messages[1].role).toBe("toolResult");
    expect(state.messages[1].toolCallId).toBe("t1");
  });

  it("messages tail = [..., assistant, toolResult, interactiveUi] after prompt_request", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "I'll ask:"),
      toolStart(102, "t1", "ask_user"),
    ]);
    state = addInteractiveRequest(
      state,
      "p1",
      "select",
      { title: "pick", options: ["a", "b"] },
      "t1",
    );
    expect(state.messages.map((m) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "interactiveUi",
    ]);
  });
});

describe("Task 5.1a: long-running bash, no prompt — order stable for entire window", () => {
  it("intermediate state is stable across many tool_execution_update events", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "All 63 tests pass. Run full test suite as final guard:"),
      toolStart(102, "t1", "bash", { command: "npm test" }),
    ]);

    const orderAfterStart = state.messages.map((m) => `${m.role}:${m.content}`);
    expect(orderAfterStart).toEqual([
      "assistant:All 63 tests pass. Run full test suite as final guard:",
      "toolResult:bash",
    ]);
    expect(state.streamingText).toBe("");
    expect(state.streamingTextFlushed).toBe(true);

    // Simulate 5 stdout chunks arriving over a long window.
    for (let i = 1; i <= 5; i++) {
      state = reduceEvent(state, toolUpdate(102 + i * 100, "t1", `chunk #${i}`));
      // Order is index-stable: always [assistant, toolResult].
      expect(state.messages.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
      expect(state.streamingText).toBe("");
      expect(state.streamingTextFlushed).toBe(true);
    }

    // tool_execution_end + message_end close the turn.
    state = reduceEvent(state, toolEnd(700, "t1", "63 tests passed"));
    expect(state.messages.map((m) => m.role)).toEqual(["assistant", "toolResult"]);

    state = reduceEvent(
      state,
      asstEnd(
        701,
        [
          { type: "text", text: "All 63 tests pass. Run full test suite as final guard:" },
          { type: "toolCall", id: "t1", name: "bash" },
        ],
        { entryId: "abc-123" },
      ),
    );

    // No duplicate assistant row.
    const assistantRows = state.messages.filter((m) => m.role === "assistant");
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0].entryId).toBe("abc-123");
    expect(state.messages.map((m) => m.role)).toEqual(["assistant", "toolResult"]);
    // Flag reset at message_end (R7).
    expect(state.streamingTextFlushed).toBe(false);
  });
});

describe("Task 5.1b: [thinking, text, toolCall] with long-running tool", () => {
  it("thinking row stays before flushed assistant row throughout the running window", () => {
    let state = applyEvents([
      asstStart(100),
      thinkingDelta(101, "Let me analyze..."),
      thinkingEnd(102),
      textDelta(103, "Now I'll run:"),
      toolStart(104, "t1", "bash"),
    ]);

    expect(state.messages.map((m) => m.role)).toEqual([
      "thinking",
      "assistant",
      "toolResult",
    ]);

    // Add tool updates over a long window.
    for (let i = 1; i <= 3; i++) {
      state = reduceEvent(state, toolUpdate(200 + i, "t1", `out${i}`));
      expect(state.messages.map((m) => m.role)).toEqual([
        "thinking",
        "assistant",
        "toolResult",
      ]);
    }

    // Close the turn.
    state = reduceEvent(state, toolEnd(300, "t1"));
    state = reduceEvent(
      state,
      asstEnd(301, [
        { type: "thinking", thinking: "Let me analyze..." },
        { type: "text", text: "Now I'll run:" },
        { type: "toolCall", id: "t1", name: "bash" },
      ]),
    );

    expect(state.messages.map((m) => m.role)).toEqual([
      "thinking",
      "assistant",
      "toolResult",
    ]);
  });
});

describe("Task 5.1c: flush + findActiveInteractiveToolResultIds interaction", () => {
  it("running toolResult is still paired with pending interactiveUi after flush", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "I'll ask:"),
      toolStart(102, "t1", "ask_user"),
    ]);
    state = addInteractiveRequest(
      state,
      "p1",
      "select",
      { title: "pick", options: ["a", "b"] },
      "t1",
    );

    const hidden = findActiveInteractiveToolResultIds(state.messages);
    const toolRow = state.messages.find(
      (m) => m.role === "toolResult" && m.toolCallId === "t1",
    );
    expect(toolRow).toBeDefined();
    expect(hidden.has(toolRow!.id)).toBe(true);
  });
});

describe("Task 5.2: non-blocking [text, toolCall] no regression", () => {
  it("final messages match the existing fix-text-tool-render-order behaviour", () => {
    const state = applyEvents([
      asstStart(100),
      textDelta(101, "Editing file:"),
      toolStart(102, "t1", "edit"),
      toolEnd(103, "t1"),
      asstEnd(104, [
        { type: "text", text: "Editing file:" },
        { type: "toolCall", id: "t1", name: "edit" },
      ]),
    ]);

    const idxAsst = state.messages.findIndex(
      (m) => m.role === "assistant" && m.content === "Editing file:",
    );
    const idxTool = state.messages.findIndex(
      (m) => m.toolCallId === "t1" && m.role === "toolResult",
    );
    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(idxTool).toBe(idxAsst + 1);
    // No duplicate assistant row.
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

describe("Task 5.3: replay path (no streamingText) — flush is no-op", () => {
  it("message_end with full content but no streamingText still pushes assistant row", () => {
    // Simulate replay: only message_end with content, no message_update text deltas,
    // and no tool_execution_start before message_end.
    const state = applyEvents([
      asstStart(100),
      asstEnd(
        101,
        [{ type: "text", text: "replayed text" }],
        { entryId: "replay-1" },
      ),
    ]);
    expect(state.streamingTextFlushed).toBe(false);
    const assistants = state.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("replayed text");
    expect(assistants[0].entryId).toBe("replay-1");
  });

  it("replay with tool: tool_execution_start fires after message_end (no streamingText) — flush no-op", () => {
    // Replay synthesizes events in archive order; for some shapes, message_end
    // may fire before tool_execution_start. streamingText is empty throughout.
    const state = applyEvents([
      asstStart(100),
      asstEnd(101, [
        { type: "text", text: "x" },
        { type: "toolCall", id: "t1", name: "edit" },
      ]),
      toolStart(102, "t1", "edit"),
    ]);
    // Flush helper saw no streamingText → no-op. No double assistant row.
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(state.streamingTextFlushed).toBe(false);
  });
});

describe("Task 5.4: [toolCall] only (no text) — no flush", () => {
  it("streamingTextFlushed stays false when no text was streamed", () => {
    const state = applyEvents([
      asstStart(100),
      toolStart(101, "t1", "edit"),
    ]);
    expect(state.streamingTextFlushed).toBe(false);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    expect(state.messages.filter((m) => m.role === "toolResult")).toHaveLength(1);
  });
});

describe("Task 5.5 + 4.2: [text, toolCall, text] — second text appears at message_end", () => {
  it("first text flushed; second text not streamed live; both correctly ordered after message_end", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "I'll search:"),
      toolStart(102, "t1", "search"),
    ]);

    // After flush, streamingTextFlushed is true. Subsequent message_update
    // events with [text1, toolCall, text2] in content[] must NOT re-populate
    // streamingText.
    state = reduceEvent(
      state,
      textDelta(103, "I'll search:Done."),
    );
    expect(state.streamingText).toBe(""); // not re-populated
    expect(state.streamingTextFlushed).toBe(true);

    state = reduceEvent(state, toolEnd(104, "t1"));
    state = reduceEvent(
      state,
      asstEnd(105, [
        { type: "text", text: "I'll search:" },
        { type: "toolCall", id: "t1", name: "search" },
        { type: "text", text: "Done." },
      ]),
    );

    // Updated by change adopt-pi-071-072-073-features (A.2): message_end now
    // honors the finalized content. The flushed row's content is replaced
    // with the effective text derived from data.message.content (all text
    // parts concatenated), so the trailing "Done." is no longer lost from
    // the live stream — live render and /reload now agree.
    const assistants = state.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toBe("I'll search:Done.");
  });
});

describe("Task 5.6: multiple tool calls — first flushes, second is a no-op", () => {
  it("[text, toolCall(t1), toolCall(t2)] → flush once, two toolResults in order", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "Two steps:"),
      toolStart(102, "t1", "bash"),
      toolStart(103, "t2", "edit"),
    ]);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(state.messages.map((m) => m.role)).toEqual([
      "assistant",
      "toolResult",
      "toolResult",
    ]);
    expect(state.streamingTextFlushed).toBe(true);

    state = reduceEvent(state, toolEnd(104, "t1"));
    state = reduceEvent(state, toolEnd(105, "t2"));
    state = reduceEvent(
      state,
      asstEnd(106, [
        { type: "text", text: "Two steps:" },
        { type: "toolCall", id: "t1", name: "bash" },
        { type: "toolCall", id: "t2", name: "edit" },
      ]),
    );

    const tools = state.messages.filter((m) => m.role === "toolResult");
    expect(tools.map((t) => t.toolCallId)).toEqual(["t1", "t2"]);
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

describe("Task 5.8: message_start resets the flag", () => {
  it("flag is reset to false on every assistant message_start", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "first"),
      toolStart(102, "t1"),
    ]);
    expect(state.streamingTextFlushed).toBe(true);

    state = reduceEvent(state, asstStart(200));
    expect(state.streamingTextFlushed).toBe(false);
  });
});

describe("Task 3.3: message_end stamps entryId onto flushed row", () => {
  it("entryId from message_end is stamped onto the flushed assistant row", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "asking"),
      toolStart(102, "t1"),
    ]);
    const flushedBeforeEnd = state.messages.find((m) => m.role === "assistant");
    expect(flushedBeforeEnd?.entryId).toBeUndefined();

    state = reduceEvent(
      state,
      asstEnd(
        103,
        [
          { type: "text", text: "asking" },
          { type: "toolCall", id: "t1", name: "bash" },
        ],
        { entryId: "abc-123", nonce: "n-42" },
      ),
    );

    const flushedAfterEnd = state.messages.find((m) => m.role === "assistant");
    expect(flushedAfterEnd?.entryId).toBe("abc-123");
    expect(flushedAfterEnd?.nonce).toBe("n-42");
    // Still only one assistant row.
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

describe("Task 3.4: two consecutive flushed messages stamp independently", () => {
  it("each message_end stamps only its own flushed row, not the prior one", () => {
    let state = applyEvents([
      // Message #1 — flushes + stamped
      asstStart(100),
      textDelta(101, "first"),
      toolStart(102, "t1"),
      toolEnd(103, "t1"),
      asstEnd(
        104,
        [
          { type: "text", text: "first" },
          { type: "toolCall", id: "t1", name: "bash" },
        ],
        { entryId: "id-1" },
      ),
      // User responds
      userStart(150, "go on"),
      // Message #2 — flushes + stamped
      asstStart(200),
      textDelta(201, "second"),
      toolStart(202, "t2"),
      toolEnd(203, "t2"),
      asstEnd(
        204,
        [
          { type: "text", text: "second" },
          { type: "toolCall", id: "t2", name: "bash" },
        ],
        { entryId: "id-2" },
      ),
    ]);

    const assistants = state.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(assistants[0].content).toBe("first");
    expect(assistants[0].entryId).toBe("id-1");
    expect(assistants[1].content).toBe("second");
    expect(assistants[1].entryId).toBe("id-2");
  });
});

describe("Task 3.4a: R3 — orphan flushed row stays unstamped (no cross-message pollution)", () => {
  it("dropped message_end #1 → message #2's stamp does not pollute message #1's flushed row", () => {
    // Message #1 starts, flushes streamingText, but its message_end is DROPPED.
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "msg1"),
      toolStart(102, "t1"),
      // <-- toolEnd + asstEnd #1 deliberately omitted (R2 disconnect)
    ]);
    // Manually insert a turnSeparator (mirrors what the reducer would emit
    // on a tool-only assistant turn end OR what state-replay synthesizes
    // between turns when reattaching).
    state = turnSep(state, 150);

    // Message #2 starts and stamps its flushed row.
    state = reduceEvent(state, asstStart(200));
    state = reduceEvent(state, textDelta(201, "msg2"));
    state = reduceEvent(state, toolStart(202, "t2"));
    state = reduceEvent(state, toolEnd(203, "t2"));
    state = reduceEvent(
      state,
      asstEnd(
        204,
        [
          { type: "text", text: "msg2" },
          { type: "toolCall", id: "t2", name: "bash" },
        ],
        { entryId: "id-2" },
      ),
    );

    const orphan = state.messages.find(
      (m) => m.role === "assistant" && m.content === "msg1",
    );
    const stamped = state.messages.find(
      (m) => m.role === "assistant" && m.content === "msg2",
    );

    // Orphan flushed row from msg #1 stays entryId-less — the turnSeparator
    // clamps the scan so msg #2's stamp cannot reach across.
    expect(orphan).toBeDefined();
    expect(orphan!.entryId).toBeUndefined();

    // Msg #2's flushed row receives id-2.
    expect(stamped).toBeDefined();
    expect(stamped!.entryId).toBe("id-2");
  });
});

describe("Task 3.4b: R2 — flush survives bridge disconnect; eventual message_end stamps it", () => {
  it("flush → simulated disconnect → reconnect → synthesized message_end stamps the orphan row", () => {
    // Phase 1: flush happens.
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "running test"),
      toolStart(102, "t1", "bash"),
    ]);
    // Phase 2: bridge disconnects. No further events arrive in this session.
    // (We do NOT mutate state — the reconnect handler keeps state intact.)
    expect(state.streamingTextFlushed).toBe(true);
    expect(state.messages.find((m) => m.role === "assistant")?.entryId).toBeUndefined();

    // Phase 3: reconnect. state-replay synthesizes a message_end carrying
    // the persisted entryId once pi has the entry on disk. We simulate by
    // delivering message_end with the same content shape and a real entryId.
    state = reduceEvent(
      state,
      asstEnd(
        500,
        [
          { type: "text", text: "running test" },
          { type: "toolCall", id: "t1", name: "bash" },
        ],
        { entryId: "post-reconnect-id" },
      ),
    );

    const stamped = state.messages.find(
      (m) => m.role === "assistant" && m.content === "running test",
    );
    expect(stamped?.entryId).toBe("post-reconnect-id");
    // No duplicate row.
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});

describe("Task 3.4c: R7 — flag reset at message_end", () => {
  it("a stray tool_execution_start AFTER message_end with non-empty streamingText still flushes", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "first"),
      toolStart(102, "t1"),
      toolEnd(103, "t1"),
      asstEnd(
        104,
        [
          { type: "text", text: "first" },
          { type: "toolCall", id: "t1", name: "bash" },
        ],
        { entryId: "id-1" },
      ),
    ]);
    expect(state.streamingTextFlushed).toBe(false); // R7: reset at message_end

    // Without a new asstStart (stray scenario), we manually set streamingText
    // and feed a tool_execution_start. The flush MUST fire because the flag
    // is false.
    state = { ...state, streamingText: "stray text" };
    state = reduceEvent(state, toolStart(200, "t-stray", "edit"));

    const lastTwo = state.messages.slice(-2);
    expect(lastTwo[0].role).toBe("assistant");
    expect(lastTwo[0].content).toBe("stray text");
    expect(lastTwo[1].role).toBe("toolResult");
    expect(lastTwo[1].toolCallId).toBe("t-stray");
  });
});

describe("Task 4.1 / 4.1a: reorder helper compatibility — [thinking, text, toolCall]", () => {
  it("flushed shape produces correct content-array order", () => {
    let state = applyEvents([
      asstStart(100),
      thinkingDelta(101, "reasoning"),
      thinkingEnd(102),
      textDelta(103, "now ask"),
      toolStart(104, "t1", "ask_user"),
    ]);
    state = addInteractiveRequest(
      state,
      "p1",
      "select",
      { title: "pick", options: ["a"] },
      "t1",
    );

    // Pre-message_end window: [thinking, assistant_flushed, toolResult, interactiveUi]
    expect(state.messages.map((m) => m.role)).toEqual([
      "thinking",
      "assistant",
      "toolResult",
      "interactiveUi",
    ]);

    state = reduceEvent(
      state,
      asstEnd(105, [
        { type: "thinking", thinking: "reasoning" },
        { type: "text", text: "now ask" },
        { type: "toolCall", id: "t1", name: "ask_user" },
      ]),
    );
    // Post-reorder: same order (already correct).
    expect(state.messages.map((m) => m.role)).toEqual([
      "thinking",
      "assistant",
      "toolResult",
      "interactiveUi",
    ]);
  });
});

describe("Task 4.1b: tool_execution_update does not perturb suffix order", () => {
  it("repeated tool_execution_update events leave [assistant, toolResult] stable", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "running"),
      toolStart(102, "t1", "bash"),
    ]);
    const baseline = state.messages.map((m) => `${m.role}:${m.toolCallId ?? m.content}`);
    for (let i = 0; i < 10; i++) {
      state = reduceEvent(state, toolUpdate(200 + i, "t1", `chunk ${i}`));
      const now = state.messages.map((m) => `${m.role}:${m.toolCallId ?? m.content}`);
      expect(now).toEqual(baseline);
    }
  });
});

describe("Task 4.1c: R6 — interleaved free-floating row does not break ordering", () => {
  it("free-floating interactiveUi (no toolCallId) trails after claimed rows", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "step:"),
      toolStart(102, "t1", "edit"),
    ]);
    // Free-floating ui row (no toolCallId).
    state = addInteractiveRequest(
      state,
      "p-free",
      "select",
      { title: "free q", options: ["a"] },
      // no toolCallId
    );
    state = reduceEvent(
      state,
      asstEnd(103, [
        { type: "text", text: "step:" },
        { type: "toolCall", id: "t1", name: "edit" },
      ]),
    );

    const idxAsst = state.messages.findIndex(
      (m) => m.role === "assistant" && m.content === "step:",
    );
    const idxTool = state.messages.findIndex((m) => m.toolCallId === "t1");
    const idxFree = state.messages.findIndex(
      (m) =>
        m.role === "interactiveUi" &&
        (m as ChatMessage).toolCallId === undefined,
    );
    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(idxTool).toBe(idxAsst + 1);
    expect(idxFree).toBeGreaterThan(idxTool);
    // Only one assistant row (no duplicate from message_end).
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });

  // ── fix-replay-duplicates-tool-and-flushed-rows ---------------------------
  it("flush row id is stable across replay (fix-replay-duplicates)", () => {
    const events: DashboardEvent[] = [
      asstStart(100),
      textDelta(110, "intro prose."),
      toolStart(120, "t1", "bash", { command: "ls" }),
      toolEnd(130, "t1", "ok"),
      asstEnd(
        140,
        [
          { type: "text", text: "intro prose." },
          { type: "toolCall", id: "t1", name: "bash" },
        ],
        { entryId: "a1" },
      ),
    ];

    // First pass: build the flushed row.
    let s = events.reduce((s, e) => reduceEvent(s, e), createInitialState());
    const flushRowsRun1 = s.messages.filter(
      (m) => m.role === "assistant" && typeof m.id === "string" && m.id.startsWith("flush-"),
    );
    expect(flushRowsRun1).toHaveLength(1);
    expect(flushRowsRun1[0].id).toBe("flush-t1");

    // Replay the SAME events on top of the existing state — simulates the
    // production bug where event_replay was delivered without a state reset.
    // The id `flush-t1` is content-stable (derived from toolCallId, not
    // messages.length), so the second pass MUST find the existing row and
    // skip the push.
    for (const e of events) s = reduceEvent(s, e);

    const flushRowsRun2 = s.messages.filter(
      (m) => m.role === "assistant" && typeof m.id === "string" && m.id.startsWith("flush-"),
    );
    expect(flushRowsRun2).toHaveLength(1);
    expect(flushRowsRun2[0].id).toBe("flush-t1");
  });

  it("flush row id is derived from toolCallId, not messages.length (fix-replay-duplicates)", () => {
    // Two distinct flushes in two distinct messages — each must carry its
    // own toolCallId-anchored id, never an index-derived one.
    const events: DashboardEvent[] = [
      asstStart(100),
      textDelta(110, "first"),
      toolStart(120, "alpha", "bash", { command: "echo a" }),
      toolEnd(130, "alpha", "a"),
      asstEnd(
        140,
        [
          { type: "text", text: "first" },
          { type: "toolCall", id: "alpha", name: "bash" },
        ],
        { entryId: "a1" },
      ),
      asstStart(200),
      textDelta(210, "second"),
      toolStart(220, "beta", "bash", { command: "echo b" }),
      toolEnd(230, "beta", "b"),
      asstEnd(
        240,
        [
          { type: "text", text: "second" },
          { type: "toolCall", id: "beta", name: "bash" },
        ],
        { entryId: "a2" },
      ),
    ];

    const s = events.reduce((s, e) => reduceEvent(s, e), createInitialState());
    const flushRows = s.messages.filter(
      (m) => m.role === "assistant" && typeof m.id === "string" && m.id.startsWith("flush-"),
    );
    expect(flushRows.map((m) => m.id).sort()).toEqual(["flush-alpha", "flush-beta"]);
  });
});
