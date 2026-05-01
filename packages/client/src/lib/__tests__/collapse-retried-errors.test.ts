import { describe, it, expect } from "vitest";
import { findRetriedErrorIds, findActiveInteractiveToolResultIds } from "../collapse-retried-errors.js";
import { createInitialState, reduceEvent, type ChatMessage } from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

let _counter = 0;
function nextId() {
  _counter += 1;
  return `m${_counter}`;
}

function tool(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: nextId(),
    role: "toolResult",
    content: "",
    toolName: "ask_user",
    toolCallId: `tc-${_counter}`,
    toolStatus: "complete",
    timestamp: Date.now(),
    ...overrides,
  };
}

function thinking(): ChatMessage {
  return { id: nextId(), role: "thinking", content: "...", timestamp: Date.now() };
}

function assistant(): ChatMessage {
  return { id: nextId(), role: "assistant", content: "ok", timestamp: Date.now() };
}

function user(): ChatMessage {
  return { id: nextId(), role: "user", content: "hi", timestamp: Date.now() };
}

describe("findRetriedErrorIds", () => {
  it("collapses an error tool followed by a successful same-tool retry", () => {
    const err = tool({ toolStatus: "error" });
    const msgs = [err, thinking(), tool({ toolStatus: "complete" })];
    expect(findRetriedErrorIds(msgs)).toEqual(new Set([err.id]));
  });

  it("ignores standalone error with no following retry", () => {
    const err = tool({ toolStatus: "error" });
    expect(findRetriedErrorIds([err])).toEqual(new Set());
  });

  it("does not collapse if the next toolResult is a different tool", () => {
    const err = tool({ toolName: "ask_user", toolStatus: "error" });
    const msgs = [err, tool({ toolName: "bash", toolStatus: "complete" })];
    expect(findRetriedErrorIds(msgs)).toEqual(new Set());
  });

  it("does not collapse if the next same-tool result is also an error", () => {
    const err1 = tool({ toolStatus: "error" });
    const err2 = tool({ toolStatus: "error" });
    expect(findRetriedErrorIds([err1, err2])).toEqual(new Set());
  });

  it("aborts look-ahead at a user message", () => {
    const err = tool({ toolStatus: "error" });
    const msgs = [err, user(), tool({ toolStatus: "complete" })];
    expect(findRetriedErrorIds(msgs)).toEqual(new Set());
  });

  it("treats a running retry as a retry (collapses the prior error)", () => {
    const err = tool({ toolStatus: "error" });
    const msgs = [err, assistant(), tool({ toolStatus: "running" })];
    expect(findRetriedErrorIds(msgs)).toEqual(new Set([err.id]));
  });

  it("collapses multiple independent error→retry pairs", () => {
    const e1 = tool({ toolStatus: "error" });
    const e2 = tool({ toolStatus: "error" });
    const msgs = [
      e1,
      tool({ toolStatus: "complete" }),
      assistant(),
      e2,
      thinking(),
      tool({ toolStatus: "complete" }),
    ];
    expect(findRetriedErrorIds(msgs)).toEqual(new Set([e1.id, e2.id]));
  });

  it("ignores error toolResult without toolName", () => {
    const err = tool({ toolName: undefined, toolStatus: "error" });
    expect(findRetriedErrorIds([err, tool({ toolStatus: "complete" })])).toEqual(new Set());
  });
});

function interactive(status: string): ChatMessage {
  return {
    id: nextId(),
    role: "interactiveUi",
    content: "confirm",
    timestamp: Date.now(),
    args: { status, requestId: "r1", method: "confirm", params: {} } as Record<string, unknown>,
  };
}

describe("findActiveInteractiveToolResultIds", () => {
  it("hides a running toolResult paired with a pending interactiveUi", () => {
    const t = tool({ toolStatus: "running" });
    const msgs = [t, interactive("pending")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set([t.id]));
  });

  it("skips through thinking/assistant when looking for the pending UI", () => {
    const t = tool({ toolStatus: "running" });
    const msgs = [t, thinking(), assistant(), interactive("pending")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set([t.id]));
  });

  it("does NOT hide once the interactiveUi has resolved", () => {
    const t = tool({ toolStatus: "running" });
    const msgs = [t, interactive("resolved")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set());
  });

  // After server restart, state-replay synthesizes a tool_execution_end for
  // every orphan toolCall in the JSONL — including a still-pending ask_user.
  // The toolResult ends up `complete` while the interactiveUi replayed from
  // the in-memory pending-prompt cache is still `pending`. Both must collapse
  // to a single Confirm card. See: lift-pending-images-to-app diagnostic.
  it("hides a complete toolResult paired with a pending interactiveUi (post-restart replay)", () => {
    const t = tool({ toolStatus: "complete" });
    const msgs = [t, interactive("pending")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set([t.id]));
  });

  it("hides an error toolResult paired with a pending interactiveUi", () => {
    const t = tool({ toolStatus: "error" });
    const msgs = [t, interactive("pending")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set([t.id]));
  });

  it("does NOT hide a complete toolResult once the interactiveUi has resolved (history view)", () => {
    const t = tool({ toolStatus: "complete" });
    const msgs = [t, interactive("resolved")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set());
  });

  it("does NOT hide a complete toolResult when the interactiveUi was cancelled", () => {
    const t = tool({ toolStatus: "complete" });
    const msgs = [t, interactive("cancelled")];
    expect(findActiveInteractiveToolResultIds(msgs)).toEqual(new Set());
  });

  it("does NOT hide a toolResult when an intermediate toolResult breaks the pairing", () => {
    // The running `t` must not be hidden because the very next non-skip
    // message is another toolResult, not the pending interactiveUi.
    // (The intermediate `complete` tool itself is paired with the pending
    // UI and will be hidden — that is the post-restart-replay behavior.)
    const t = tool({ toolStatus: "running" });
    const intermediate = tool({ toolStatus: "complete" });
    const msgs = [t, intermediate, interactive("pending")];
    const hidden = findActiveInteractiveToolResultIds(msgs);
    expect(hidden.has(t.id)).toBe(false);
    expect(hidden.has(intermediate.id)).toBe(true);
  });

  it("does NOT hide a standalone running toolResult with no following UI", () => {
    const t = tool({ toolStatus: "running" });
    expect(findActiveInteractiveToolResultIds([t])).toEqual(new Set());
  });
});

describe("retried-error pill survives [text, toolCall] reorder (fix-text-tool-render-order)", () => {
  it("identifies the error tool as retried after the reducer's content-array reorder runs", () => {
    // Drive the actual reducer with two assistant messages, each shaped
    // [text, toolCall]: the first tool errors, the second succeeds. After
    // the reorder pass at message_end the error tool is repositioned to
    // sit AFTER its parent assistant text bubble — findRetriedErrorIds
    // must still pair it with the successful retry.
    const events: DashboardEvent[] = [
      // Message A: ask_user fails with empty args
      { eventType: "message_start", timestamp: 1000, data: { message: { role: "assistant", content: [] } } },
      { eventType: "message_update", timestamp: 1001, data: { message: { role: "assistant", content: [{ type: "text", text: "Asking the user:" }] } } },
      { eventType: "tool_execution_start", timestamp: 1002, data: { toolCallId: "tA", toolName: "ask_user", args: {} } },
      { eventType: "tool_execution_end", timestamp: 1003, data: { toolCallId: "tA", toolName: "ask_user", result: "Validation: missing method", isError: true } },
      { eventType: "message_end", timestamp: 1004, data: { message: { role: "assistant", content: [{ type: "text", text: "Asking the user:" }, { type: "toolCall", id: "tA", name: "ask_user" }] } } },
      // Intervening assistant thinking + retry message
      { eventType: "message_start", timestamp: 2000, data: { message: { role: "assistant", content: [] } } },
      { eventType: "message_update", timestamp: 2001, data: { message: { role: "assistant", content: [{ type: "text", text: "Retrying with proper args:" }] } } },
      { eventType: "tool_execution_start", timestamp: 2002, data: { toolCallId: "tB", toolName: "ask_user", args: { method: "input", title: "Name?" } } },
      { eventType: "tool_execution_end", timestamp: 2003, data: { toolCallId: "tB", toolName: "ask_user", result: "ok", isError: false } },
      { eventType: "message_end", timestamp: 2004, data: { message: { role: "assistant", content: [{ type: "text", text: "Retrying with proper args:" }, { type: "toolCall", id: "tB", name: "ask_user" }] } } },
    ];

    let state = createInitialState();
    for (const ev of events) state = reduceEvent(state, ev);

    // Confirm reorder placed assistant text before its tool card for both messages
    const idxAsstA = state.messages.findIndex((m) => m.content === "Asking the user:");
    const idxToolA = state.messages.findIndex((m) => m.toolCallId === "tA");
    expect(idxToolA).toBe(idxAsstA + 1);

    // Now confirm findRetriedErrorIds still pairs tA's error with tB's success
    const errorTool = state.messages.find((m) => m.toolCallId === "tA")!;
    expect(errorTool.toolStatus).toBe("error");
    const retried = findRetriedErrorIds(state.messages);
    expect(retried.has(errorTool.id)).toBe(true);
  });
});
