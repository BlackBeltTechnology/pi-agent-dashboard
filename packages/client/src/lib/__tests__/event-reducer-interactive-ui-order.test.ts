/**
 * Regression suite for change: fix-interactive-ui-reorder
 *
 * For an assistant message whose `content[]` contains a `toolCall` whose
 * tool emits a `prompt_request` (e.g. ask_user), the chat panel's
 * `messages[]` SHALL end up in content-array order with the
 * `interactiveUi` row paired immediately after its parent `toolResult`:
 *
 *     [..., assistant("intro text"), toolResult(running), interactiveUi(pending)]
 *
 * Previously the suffix-window helper sized itself to `relevant.length`
 * (text + toolCall + thinking only), so the parent toolResult fell
 * outside the window when an interactiveUi row had been pushed in
 * between, producing the buggy order
 *
 *     [..., toolResult(running), interactiveUi(pending), assistant("intro text")]
 *
 * which `findActiveInteractiveToolResultIds` then collapsed to
 *
 *     [..., interactiveUi, assistant]
 *
 * — dialog above intro text.
 */

import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduceEvent,
  addInteractiveRequest,
  type SessionState,
} from "../chat/event-reducer.js";
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
function textDelta(t: number, text: string): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: { message: { role: "assistant", content: [{ type: "text", text }] } },
  };
}
function toolStart(t: number, id: string, name = "ask_user"): DashboardEvent {
  return {
    eventType: "tool_execution_start",
    timestamp: t,
    data: { toolCallId: id, toolName: name, args: {} },
  };
}
function thinkingDelta(t: number, delta: string): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: {
      assistantMessageEvent: { type: "thinking_delta", delta },
    },
  };
}
function thinkingEnd(t: number): DashboardEvent {
  return {
    eventType: "message_update",
    timestamp: t,
    data: {
      assistantMessageEvent: { type: "thinking_end", signature: "s" },
    },
  };
}
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

/** Push an interactiveUi row with `toolCallId` set so the reorder helper
 *  can pair it with the parent toolResult. Mirrors the live path's
 *  `addInteractiveRequest(state, requestId, method, params, toolCallId)`. */
function pushPromptRequest(state: SessionState, requestId: string, toolCallId: string): SessionState {
  return addInteractiveRequest(
    state,
    requestId,
    "select",
    { title: "Pick one", options: ["a", "b"] },
    toolCallId,
  );
}

describe("fix-interactive-ui-reorder: ask_user ordering", () => {
  it("[text, toolCall:ask_user] — assistant text bubble lands before tool+ui pair", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "I need a decision:"),
      toolStart(102, "t1", "ask_user"),
    ]);
    // prompt_request arrives between tool_execution_start and message_end
    state = pushPromptRequest(state, "p1", "t1");
    state = reduceEvent(
      state,
      asstEnd(103, [
        { type: "text", text: "I need a decision:" },
        { type: "toolCall", id: "t1", name: "ask_user" },
      ]),
    );

    const idxAsst = state.messages.findIndex((m) => m.content === "I need a decision:");
    const idxTool = state.messages.findIndex((m) => m.toolCallId === "t1" && m.role === "toolResult");
    const idxUi = state.messages.findIndex((m) => m.toolCallId === "t1" && m.role === "interactiveUi");

    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(idxTool).toBe(idxAsst + 1);
    expect(idxUi).toBe(idxTool + 1);
  });

  it("[thinking, text, toolCall:ask_user] — thinking, text, tool, ui in that order", () => {
    let state = applyEvents([
      asstStart(100),
      thinkingDelta(101, "Reasoning..."),
      thinkingEnd(101.5),
      textDelta(102, "Now ask:"),
      toolStart(103, "t1", "ask_user"),
    ]);
    state = pushPromptRequest(state, "p1", "t1");
    state = reduceEvent(
      state,
      asstEnd(104, [
        { type: "thinking", thinking: "Reasoning..." },
        { type: "text", text: "Now ask:" },
        { type: "toolCall", id: "t1", name: "ask_user" },
      ]),
    );

    const idxThink = state.messages.findIndex((m) => m.role === "thinking");
    const idxAsst = state.messages.findIndex((m) => m.content === "Now ask:");
    const idxTool = state.messages.findIndex((m) => m.toolCallId === "t1" && m.role === "toolResult");
    const idxUi = state.messages.findIndex((m) => m.toolCallId === "t1" && m.role === "interactiveUi");

    expect(idxThink).toBeGreaterThanOrEqual(0);
    expect(idxAsst).toBe(idxThink + 1);
    expect(idxTool).toBe(idxAsst + 1);
    expect(idxUi).toBe(idxTool + 1);
  });

  it("[text, toolCall:bash, toolCall:ask_user] — only the second toolCall is interactive", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "Two steps:"),
      toolStart(102, "tBash", "bash"),
      toolStart(103, "tAsk", "ask_user"),
    ]);
    state = pushPromptRequest(state, "p1", "tAsk");
    state = reduceEvent(
      state,
      asstEnd(104, [
        { type: "text", text: "Two steps:" },
        { type: "toolCall", id: "tBash", name: "bash" },
        { type: "toolCall", id: "tAsk", name: "ask_user" },
      ]),
    );

    const idxAsst = state.messages.findIndex((m) => m.content === "Two steps:");
    const idxBash = state.messages.findIndex((m) => m.toolCallId === "tBash");
    const idxAsk = state.messages.findIndex((m) => m.toolCallId === "tAsk" && m.role === "toolResult");
    const idxUi = state.messages.findIndex((m) => m.toolCallId === "tAsk" && m.role === "interactiveUi");

    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(idxBash).toBe(idxAsst + 1);
    expect(idxAsk).toBe(idxBash + 1);
    expect(idxUi).toBe(idxAsk + 1);
  });

  it("prompt_request arrives AFTER message_end (race) — final order is still text, tool, ui", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "Asking:"),
      toolStart(102, "t1", "ask_user"),
      asstEnd(103, [
        { type: "text", text: "Asking:" },
        { type: "toolCall", id: "t1", name: "ask_user" },
      ]),
    ]);
    // After message_end fires, the prompt_request arm pushes the ui row.
    state = pushPromptRequest(state, "p1", "t1");

    const idxAsst = state.messages.findIndex((m) => m.content === "Asking:");
    const idxTool = state.messages.findIndex((m) => m.toolCallId === "t1" && m.role === "toolResult");
    const idxUi = state.messages.findIndex((m) => m.toolCallId === "t1" && m.role === "interactiveUi");

    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(idxTool).toBe(idxAsst + 1);
    expect(idxUi).toBe(idxTool + 1);
  });

  it("free-floating prompt_request (no toolCallId) trails after claimed rows", () => {
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "Editing:"),
      toolStart(102, "t1", "edit"),
    ]);
    // A free-floating ui row (no toolCallId) — e.g. architect prompt
    state = addInteractiveRequest(
      state,
      "p-free",
      "select",
      { title: "free question", options: ["x", "y"] },
      // no toolCallId
    );
    state = reduceEvent(
      state,
      asstEnd(103, [
        { type: "text", text: "Editing:" },
        { type: "toolCall", id: "t1", name: "edit" },
      ]),
    );

    const idxAsst = state.messages.findIndex((m) => m.content === "Editing:");
    const idxTool = state.messages.findIndex((m) => m.toolCallId === "t1");
    const idxFree = state.messages.findIndex(
      (m) => m.role === "interactiveUi" && (m as any).args?.requestId === "p-free",
    );

    // Free-floating row stays where it was pushed; reorder doesn't pull it in.
    expect(idxAsst).toBeGreaterThanOrEqual(0);
    expect(idxTool).toBe(idxAsst + 1);
    expect(idxFree).toBeGreaterThan(idxTool);
  });

  it("prior-turn assistant rows are untouched when a new turn ends with ask_user", () => {
    // Prior turn: text + tool (no ui) lands cleanly.
    let state = applyEvents([
      asstStart(100),
      textDelta(101, "First:"),
      toolStart(102, "tA", "edit"),
      asstEnd(103, [
        { type: "text", text: "First:" },
        { type: "toolCall", id: "tA", name: "edit" },
      ]),
      // User responds — boundary row pushed
      {
        eventType: "message_start",
        timestamp: 150,
        data: {
          message: { role: "user", content: "go" },
          entryId: undefined,
        },
      } as DashboardEvent,
      // Second turn with ask_user
      asstStart(200),
      textDelta(201, "Second:"),
      toolStart(202, "tB", "ask_user"),
    ]);
    state = pushPromptRequest(state, "p2", "tB");
    state = reduceEvent(
      state,
      asstEnd(203, [
        { type: "text", text: "Second:" },
        { type: "toolCall", id: "tB", name: "ask_user" },
      ]),
    );

    const idxAsstA = state.messages.findIndex((m) => m.content === "First:");
    const idxToolA = state.messages.findIndex((m) => m.toolCallId === "tA");
    const idxUser = state.messages.findIndex((m) => m.role === "user" && m.content === "go");
    const idxAsstB = state.messages.findIndex((m) => m.content === "Second:");
    const idxToolB = state.messages.findIndex(
      (m) => m.toolCallId === "tB" && m.role === "toolResult",
    );
    const idxUiB = state.messages.findIndex(
      (m) => m.toolCallId === "tB" && m.role === "interactiveUi",
    );

    // Prior turn intact
    expect(idxAsstA).toBeGreaterThanOrEqual(0);
    expect(idxToolA).toBe(idxAsstA + 1);
    expect(idxUser).toBe(idxToolA + 1);

    // New turn correctly ordered
    expect(idxAsstB).toBe(idxUser + 1);
    expect(idxToolB).toBe(idxAsstB + 1);
    expect(idxUiB).toBe(idxToolB + 1);
  });
});
