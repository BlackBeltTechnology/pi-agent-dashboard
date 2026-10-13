/**
 * v1 → v2 normaliser. See change: add-acp-session-driver (test-plan #E5–#E7).
 */
import { describe, expect, it } from "vitest";
import { createV1Normalizer } from "../normalize-v1.js";

const chunk = (sessionUpdate: string, t: string) => ({ sessionUpdate, content: { type: "text", text: t } });

describe("normalizeV1", () => {
  it("E5: prompt resolution emits exactly one idle with the stop reason", () => {
    const n = createV1Normalizer();
    expect(n.promptResolved("end_turn")).toEqual([{ kind: "state_update", state: "idle", stopReason: "end_turn" }]);
  });

  it("maps dispatch / permission / answer to state updates", () => {
    const n = createV1Normalizer();
    expect(n.promptDispatched()).toEqual([{ kind: "state_update", state: "running" }]);
    expect(n.permissionRequested()).toEqual([{ kind: "state_update", state: "requires_action" }]);
    expect(n.permissionAnswered()).toEqual([{ kind: "state_update", state: "running" }]);
  });

  it("E6: synthetic ids per contiguous same-kind run", () => {
    const n = createV1Normalizer();
    const ids = [
      ...n.update(chunk("agent_message_chunk", "a")),
      ...n.update(chunk("agent_message_chunk", "b")),
      ...n.update(chunk("agent_message_chunk", "c")),
      ...n.update(chunk("agent_thought_chunk", "t")),
      ...n.update(chunk("agent_message_chunk", "d")),
    ].map((u) => (u as { messageId: string }).messageId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).not.toBe(ids[2]);
    expect(ids[4]).not.toBe(ids[0]);
    expect(ids[4]).not.toBe(ids[3]);
  });

  it("keeps a provided messageId and a tool call breaks the run", () => {
    const n = createV1Normalizer();
    const [a] = n.update({ ...chunk("agent_message_chunk", "a"), messageId: "m9" });
    expect((a as { messageId: string }).messageId).toBe("m9");
    const [b] = n.update(chunk("agent_message_chunk", "b"));
    n.update({ sessionUpdate: "tool_call", toolCallId: "t", title: "x" });
    const [c] = n.update(chunk("agent_message_chunk", "c"));
    expect((c as { messageId: string }).messageId).not.toBe((b as { messageId: string }).messageId);
  });

  it("E7: tool_call / tool_call_update / plan / mode mapping", () => {
    const n = createV1Normalizer();
    const [tc] = n.update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "Read", kind: "read", status: "pending", rawInput: { p: 1 } });
    expect(tc).toMatchObject({ kind: "tool_call_update", toolCallId: "t1", title: "Read", toolKind: "read", status: "pending", rawInput: { p: 1 } });
    const [tu1] = n.update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" });
    const [tu2] = n.update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
    expect(tu1).toMatchObject({ kind: "tool_call_update", toolCallId: "t1" });
    expect(tu2).toMatchObject({ kind: "tool_call_update", toolCallId: "t1", status: "completed" });

    const [plan] = n.update({ sessionUpdate: "plan", entries: [{ content: "do", priority: "high", status: "pending" }] });
    expect(plan).toEqual({ kind: "plan_update", planId: "default", type: "items", entries: [{ content: "do", priority: "high", status: "pending" }] });

    const [mode] = n.update({ sessionUpdate: "current_mode_update", currentModeId: "code" });
    expect(mode).toMatchObject({ kind: "config_option_update", options: [{ configId: "mode", category: "mode", currentValue: "code" }] });
  });

  it("passes v2-shaped and unknown payloads through the parser", () => {
    const n = createV1Normalizer();
    expect(n.update({ sessionUpdate: "usage_update", used: 1, size: 2 })[0]?.kind).toBe("usage_update");
    expect(n.update({ sessionUpdate: "_x" })[0]).toEqual({ kind: "unknown", raw: { sessionUpdate: "_x" } });
    expect(n.update(null)[0]?.kind).toBe("unknown");
  });
});
