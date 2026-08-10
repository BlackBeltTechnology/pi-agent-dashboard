/**
 * Superseded terminal heal — reducer primitives.
 *
 * Proof-of-completion primitive: a later assistant `message_start` than the
 * inference that emitted the tool call. `message_end` is NOT the boundary — it
 * fires after its own inference's tool (see design D1), so it must never
 * satisfy the proof.
 *
 * See change: fix-stuck-tool-card-superseded-heal.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  createInitialState,
  hasLaterAssistantInference,
  reduceEvent,
  type SessionState,
  SUPERSEDE_SENTINEL_BODY,
  synthesizeSupersededEnd,
} from "../chat/event-reducer.js";

function apply(events: DashboardEvent[], from: SessionState = createInitialState()): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), from);
}
const asstStart = (t: number): DashboardEvent => ({
  eventType: "message_start",
  timestamp: t,
  data: { message: { role: "assistant", content: [] } },
});
const asstEnd = (t: number, content: unknown[] = []): DashboardEvent => ({
  eventType: "message_end",
  timestamp: t,
  data: { message: { role: "assistant", content } },
});
const toolStart = (t: number, id: string, name = "bash"): DashboardEvent => ({
  eventType: "tool_execution_start",
  timestamp: t,
  data: { toolCallId: id, toolName: name, args: {} },
});
const toolEnd = (t: number, id: string, result = "ok", isError = false): DashboardEvent => ({
  eventType: "tool_execution_end",
  timestamp: t,
  data: { toolCallId: id, result, isError },
});
const agentEnd = (t: number): DashboardEvent => ({
  eventType: "agent_end",
  timestamp: t,
  data: {},
});

describe("assistantInferenceSeq / emittedAtInferenceSeq", () => {
  it("increments seq on assistant message_start only, stamps tool at start", () => {
    const s = apply([asstStart(1), toolStart(2, "t1")]);
    expect(s.assistantInferenceSeq).toBe(1);
    expect(s.toolCalls.get("t1")?.emittedAtInferenceSeq).toBe(1);
  });

  it("user message_start does NOT advance the inference counter", () => {
    const s = apply([
      asstStart(1),
      toolStart(2, "t1"),
      { eventType: "message_start", timestamp: 3, data: { message: { role: "user", content: "hi" } } },
    ]);
    expect(s.assistantInferenceSeq).toBe(1);
  });
});

describe("hasLaterAssistantInference (proof primitive)", () => {
  it("1.1 true only after a SECOND assistant message_start (not the own message_end)", () => {
    // Own inference: start, tool_start, (end withheld), message_end.
    let s = apply([asstStart(10), toolStart(11, "t1"), asstEnd(12, [{ type: "toolCall", id: "t1", name: "bash" }])]);
    // The tool's own inference message_end must NOT count as "later".
    expect(hasLaterAssistantInference(s, "t1")).toBe(false);
    // A new assistant inference begins → proof holds.
    s = reduceEvent(s, asstStart(13));
    expect(hasLaterAssistantInference(s, "t1")).toBe(true);
  });

  it("1.2 parallel sibling tool_start in the SAME inference does not prove completion", () => {
    // Two tools in one inference; no later assistant message_start yet.
    const s = apply([asstStart(20), toolStart(21, "tA"), toolStart(22, "tB")]);
    expect(hasLaterAssistantInference(s, "tA")).toBe(false);
    expect(hasLaterAssistantInference(s, "tB")).toBe(false);
  });

  it("1.3 abort (agent_end) with no later inference does not prove completion", () => {
    const s = apply([asstStart(30), toolStart(31, "t1"), asstEnd(32), agentEnd(33)]);
    expect(hasLaterAssistantInference(s, "t1")).toBe(false);
    expect(s.toolCalls.get("t1")?.status).toBe("running");
  });

  it("returns false for a non-running (already terminal) row", () => {
    const s = apply([asstStart(40), toolStart(41, "t1"), toolEnd(42, "t1"), asstStart(43)]);
    expect(hasLaterAssistantInference(s, "t1")).toBe(false); // complete, not a heal target
  });
});

describe("synthesizeSupersededEnd + reducer finalization", () => {
  it("finalizes a running row to complete with healedBy:superseded + sentinel body", () => {
    let s = apply([asstStart(50), toolStart(51, "t1"), asstEnd(52), asstStart(53)]);
    expect(hasLaterAssistantInference(s, "t1")).toBe(true);
    s = reduceEvent(s, synthesizeSupersededEnd("t1", 60));
    expect(s.toolCalls.get("t1")?.status).toBe("complete");
    const row = s.messages.find((m) => m.role === "toolResult" && m.toolCallId === "t1");
    expect(row?.toolStatus).toBe("complete");
    expect(row?.toolDetails?.healedBy).toBe("superseded");
    expect(row?.result).toContain(SUPERSEDE_SENTINEL_BODY);
  });
});

describe("D4 — real result overwrites a superseded placeholder (commutative)", () => {
  it("superseded → real end restores the real body and clears healedBy", () => {
    let s = apply([asstStart(70), toolStart(71, "t1"), asstEnd(72), asstStart(73)]);
    s = reduceEvent(s, synthesizeSupersededEnd("t1", 80));
    s = reduceEvent(s, toolEnd(90, "t1", "the REAL output"));
    const row = s.messages.find((m) => m.role === "toolResult" && m.toolCallId === "t1");
    expect(row?.result).toContain("the REAL output");
    expect(row?.toolDetails?.healedBy).toBeUndefined();
    expect(s.toolCalls.get("t1")?.status).toBe("complete");
  });

  it("real end then a (stale) superseded synth does NOT clobber the real body", () => {
    let s = apply([asstStart(70), toolStart(71, "t1"), toolEnd(80, "t1", "the REAL output"), asstStart(81)]);
    // Row already complete → hasLaterAssistantInference is false, so no heal
    // target; but even a direct synth must not downgrade a real completion.
    s = reduceEvent(s, synthesizeSupersededEnd("t1", 90));
    const row = s.messages.find((m) => m.role === "toolResult" && m.toolCallId === "t1");
    expect(row?.result).toContain("the REAL output");
    expect(row?.toolDetails?.healedBy).toBeUndefined();
  });
});
