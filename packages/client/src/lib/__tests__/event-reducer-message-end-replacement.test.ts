/**
 * Regression suite for change: adopt-pi-071-072-073-features (A.2)
 *
 * Pi 0.71+ lets extensions REPLACE the finalized assistant message content
 * at message_end (cost footers, redactions). The reducer must honor
 * `data.message.content` uniformly:
 *   - already-flushed row → swap content + stamp entryId/nonce
 *   - streaming-row push → push effective (replacement) content
 *   - missing content → fall back to delta-derived streamingText (legacy)
 */
import { describe, it, expect } from "vitest";
import {
  createInitialState,
  reduceEvent,
  deriveEffectiveAssistantText,
  type SessionState,
} from "../event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce(reduceEvent, createInitialState());
}
function asstStart(t: number): DashboardEvent {
  return { eventType: "message_start", timestamp: t, data: { message: { role: "assistant", content: [] } } };
}
function textDelta(t: number, text: string): DashboardEvent {
  return { eventType: "message_update", timestamp: t, data: { message: { role: "assistant", content: [{ type: "text", text }] } } };
}
function toolStart(t: number, id: string): DashboardEvent {
  return { eventType: "tool_execution_start", timestamp: t, data: { toolCallId: id, toolName: "bash", args: {} } };
}
function toolEnd(t: number, id: string): DashboardEvent {
  return { eventType: "tool_execution_end", timestamp: t, data: { toolCallId: id, result: "ok", status: "success" } };
}
function asstEnd(t: number, content: unknown, opts: { entryId?: string; nonce?: string } = {}): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp: t,
    data: { message: { role: "assistant", content }, entryId: opts.entryId, nonce: opts.nonce },
  };
}

describe("deriveEffectiveAssistantText (pure helper)", () => {
  it("concatenates text parts from array content", () => {
    expect(deriveEffectiveAssistantText({ content: [{ type: "text", text: "a" }, { type: "toolCall" }, { type: "text", text: "b" }] }, "fb")).toBe("ab");
  });
  it("uses string content directly", () => {
    expect(deriveEffectiveAssistantText({ content: "hello" }, "fb")).toBe("hello");
  });
  it("falls back when content missing", () => {
    expect(deriveEffectiveAssistantText({}, "fb")).toBe("fb");
    expect(deriveEffectiveAssistantText(undefined, "fb")).toBe("fb");
  });
  it("honors an empty-string redaction (does NOT fall back to streamed text)", () => {
    expect(deriveEffectiveAssistantText({ content: "" }, "secret streamed text")).toBe("");
  });
});

describe("message_end content replacement (A.2)", () => {
  it("already-flushed row: content swapped + entryId/nonce stamped", () => {
    // Flush happens at tool_execution_start; replacement arrives at message_end.
    const state = applyEvents([
      asstStart(1),
      textDelta(2, "original text"),
      toolStart(3, "t1"),
      toolEnd(4, "t1"),
      asstEnd(5, [{ type: "text", text: "REPLACED text" }], { entryId: "e1", nonce: "n1" }),
    ]);
    const assistantRow = state.messages.find((m) => m.role === "assistant");
    expect(assistantRow).toBeDefined();
    expect(assistantRow!.content).toBe("REPLACED text");
    expect(assistantRow!.entryId).toBe("e1");
    expect(assistantRow!.nonce).toBe("n1");
  });

  it("streaming-row push respects msg.content replacement", () => {
    const state = applyEvents([
      asstStart(1),
      textDelta(2, "delta text"),
      asstEnd(3, [{ type: "text", text: "final replacement" }], { entryId: "e2", nonce: "n2" }),
    ]);
    const assistantRow = state.messages.find((m) => m.role === "assistant");
    expect(assistantRow!.content).toBe("final replacement");
  });

  it("fallback to streamingText when msg.content missing (legacy behavior)", () => {
    const state = applyEvents([
      asstStart(1),
      textDelta(2, "delta only"),
      asstEnd(3, undefined as any, { entryId: "e3", nonce: "n3" }),
    ]);
    const assistantRow = state.messages.find((m) => m.role === "assistant");
    expect(assistantRow!.content).toBe("delta only");
  });

  it("redaction: message_end replacing streamed text with \"\" wins (no leak)", () => {
    const state = applyEvents([
      asstStart(1),
      textDelta(2, "sensitive streamed text"),
      asstEnd(3, "", { entryId: "e4", nonce: "n4" }),
    ]);
    const assistantRow = state.messages.find((m) => m.role === "assistant");
    // Empty-string replacement honored: the streamed text is NOT re-surfaced.
    expect(assistantRow?.content ?? "").toBe("");
    expect(state.messages.some((m) => m.content === "sensitive streamed text")).toBe(false);
  });
});
