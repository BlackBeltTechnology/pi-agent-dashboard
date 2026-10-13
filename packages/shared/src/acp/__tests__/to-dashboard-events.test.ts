/**
 * v2 updates → pi-shaped dashboard events.
 * See change: add-acp-session-driver (test-plan #E8, #E12, #E13, #E15, #E16 + extras).
 */
import { describe, expect, it } from "vitest";
import type { DashboardEvent } from "../../types.js";
import { createDashboardEventAdapter, mapStopReason } from "../to-dashboard-events.js";
import { parseSessionUpdate } from "../update-model.js";

const P = parseSessionUpdate;
const t = (text: string) => ({ type: "text", text });

function make() {
  let clock = 1;
  const adapter = createDashboardEventAdapter({ agentId: "qmt", now: () => clock++ });
  const feed = (...raws: Array<Record<string, unknown>>): DashboardEvent[] => raws.flatMap((r) => adapter.push(P(r)));
  return { adapter, feed };
}
const types = (evs: DashboardEvent[]) => evs.map((e) => e.eventType);
const state = (s: string, stopReason?: string) => ({ sessionUpdate: "state_update", state: s, ...(stopReason ? { stopReason } : {}) });

describe("toDashboardEvents", () => {
  it("E8: streamed answer event order and snapshots", () => {
    const { feed } = make();
    const evs = feed(
      state("running"),
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("Hel") },
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("lo") },
      state("idle", "end_turn"),
    );
    expect(types(evs)).toEqual([
      "agent_start", "message_start", "message_update", "message_update", "message_end", "turn_end", "agent_end", "agent_settled",
    ]);
    const updates = evs.filter((e) => e.eventType === "message_update");
    expect((updates[0]!.data.message as any).content[0].text).toBe("Hel");
    expect((updates[1]!.data.message as any).content[0].text).toBe("Hello");
    expect((updates[1]!.data.assistantMessageEvent as any)).toMatchObject({ type: "text_delta", delta: "lo" });
    const end = evs.find((e) => e.eventType === "message_end")!;
    expect((end.data.message as any).stopReason).toBe("stop");
  });

  it("E12: stop-reason vocabulary", () => {
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["end_turn", "stop", {}],
      ["cancelled", "aborted", {}],
      ["max_tokens", "length", {}],
      ["max_turn_requests", "length", {}],
      ["refusal", "error", { errorMessage: "Agent refused" }],
      ["_custom", "stop", {}],
    ];
    for (const [acp, pi, extra] of cases) {
      const { feed } = make();
      const evs = feed(state("running"), state("idle", acp));
      const end = evs.find((e) => e.eventType === "agent_end")!;
      const last = (end.data.messages as any[]).at(-1);
      expect(last.stopReason, acp).toBe(pi);
      for (const [k, v] of Object.entries(extra)) expect(last[k]).toBe(v);
      if (acp === "_custom") expect(end.data.acpStopReason).toBe("_custom");
      else expect(end.data.acpStopReason).toBeUndefined();
    }
    expect(mapStopReason("error", { message: "boom" })).toMatchObject({ stopReason: "error", errorMessage: "boom" });
    expect(mapStopReason(null).stopReason).toBe("stop");
  });

  it("cancelled turn carries aborted on the emitted final message", () => {
    const { feed } = make();
    const evs = feed(state("running"), { sessionUpdate: "agent_message_chunk", messageId: "m", content: t("par") }, state("idle", "cancelled"));
    expect((evs.find((e) => e.eventType === "message_end")!.data.message as any).stopReason).toBe("aborted");
  });

  it("E13: failed tool ends with isError", () => {
    const { feed } = make();
    const evs = feed(
      { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "Run", status: "in_progress" },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed" },
    );
    expect(evs.find((e) => e.eventType === "tool_execution_end")!.data).toMatchObject({ toolCallId: "t1", isError: true });
  });

  it("tool lifecycle: start closes the segment, update streams text, end carries result", () => {
    const { feed } = make();
    const evs = feed(
      state("running"),
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("Reading") },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "Read a.ts", kind: "read", status: "pending", rawInput: { path: "a.ts" } },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", content: [{ type: "content", content: t("partial") }] },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: t("done") }] },
    );
    expect(types(evs)).toEqual([
      "agent_start", "message_start", "message_update", "message_end",
      "tool_execution_start", "tool_execution_update", "tool_execution_end",
    ]);
    expect((evs.find((e) => e.eventType === "message_end")!.data.message as any).stopReason).toBe("toolUse");
    expect(evs.find((e) => e.eventType === "tool_execution_start")!.data).toMatchObject({ toolCallId: "t1", toolName: "Read a.ts", args: { path: "a.ts" } });
    expect(evs.find((e) => e.eventType === "tool_execution_end")!.data).toMatchObject({ result: "done", isError: false });
  });

  it("closes still-running tools when the turn ends cancelled", () => {
    const { feed } = make();
    const evs = feed(state("running"), { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "x", status: "in_progress" }, state("idle", "cancelled"));
    expect(evs.find((e) => e.eventType === "tool_execution_end")!.data).toMatchObject({ toolCallId: "t1", isError: true });
  });

  it("E15: suppressed user echo produces no user-turn events", () => {
    const { adapter, feed } = make();
    adapter.suppressUserMessage("u1");
    expect(feed({ sessionUpdate: "user_message", messageId: "u1", content: [t("hi")] })).toEqual([]);
    expect(feed({ sessionUpdate: "user_message_chunk", messageId: "u1", content: t("hi") })).toEqual([]);
    expect(adapter.flush()).toEqual([]);
  });

  it("emits a user turn once for unsuppressed user messages and chunks", () => {
    const { adapter, feed } = make();
    const evs = feed({ sessionUpdate: "user_message", messageId: "u2", content: [t("hello")] });
    expect(types(evs)).toEqual(["message_start", "message_end"]);
    expect((evs[0]!.data.message as any)).toMatchObject({ role: "user", content: [{ type: "text", text: "hello" }] });
    expect(feed({ sessionUpdate: "user_message", messageId: "u2", content: [t("hello")] })).toEqual([]);

    feed({ sessionUpdate: "user_message_chunk", messageId: "u3", content: t("a") });
    feed({ sessionUpdate: "user_message_chunk", messageId: "u3", content: t("b") });
    const flushed = adapter.flush();
    expect((flushed[0]!.data.message as any).content[0].text).toBe("ab");
  });

  it("E16: terminal output folds into the referencing tool; unreferenced is dropped + counted", () => {
    const { adapter, feed } = make();
    feed({ sessionUpdate: "tool_call_update", toolCallId: "t1", title: "sh", status: "in_progress", content: [{ type: "terminal", terminalId: "term1" }] });
    const folded = [btoa("a"), btoa("b"), btoa("c")].flatMap((data) =>
      feed({ sessionUpdate: "terminal_output_chunk", terminalId: "term1", data }),
    );
    expect(types(folded)).toEqual(["tool_execution_update", "tool_execution_update", "tool_execution_update"]);
    expect((folded[2]!.data.partialResult as any).content[0].text).toBe("abc");
    expect(feed({ sessionUpdate: "terminal_output_chunk", terminalId: "term9", data: btoa("x") })).toEqual([]);
    expect(adapter.counters().unreferencedTerminal).toBe(1);
  });

  it("thinking streams live: start, deltas, end before text", () => {
    const { feed } = make();
    const evs = feed(
      { sessionUpdate: "agent_thought_chunk", messageId: "th1", content: t("a") },
      { sessionUpdate: "agent_thought_chunk", messageId: "th1", content: t("b") },
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("x") },
    );
    const ame = evs.filter((e) => e.eventType === "message_update").map((e) => (e.data.assistantMessageEvent as any)?.type);
    expect(ame).toEqual(["thinking_start", "thinking_delta", "thinking_delta", "thinking_end", "text_delta"]);
  });

  it("thought + message with different ids form one message_start/end pair", () => {
    const { feed } = make();
    const evs = feed(
      state("running"),
      { sessionUpdate: "agent_thought_chunk", messageId: "th1", content: t("hm") },
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("ok") },
      state("idle", "end_turn"),
    );
    expect(evs.filter((e) => e.eventType === "message_start")).toHaveLength(1);
    const end = evs.find((e) => e.eventType === "message_end")!;
    expect((end.data.message as any).content).toEqual([{ type: "thinking", thinking: "hm" }, { type: "text", text: "ok" }]);
  });

  it("whole-message replacement that is not an extension emits a snapshot without a delta", () => {
    const { feed } = make();
    feed({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("abc") });
    const evs = feed({ sessionUpdate: "agent_message", messageId: "m1", content: [t("xyz")] });
    expect(evs).toHaveLength(1);
    expect(evs[0]!.data.assistantMessageEvent).toBeUndefined();
    expect((evs[0]!.data.message as any).content[0].text).toBe("xyz");
  });

  it("model_select rules: model carries provider acp:<agent>; thought level carries no model; unchanged values are not re-emitted", () => {
    const { feed } = make();
    const cfg = (configId: string, category: string, v: string) => ({
      sessionUpdate: "config_option_update",
      configOptions: [{ configId, category, type: "select", currentValue: v }],
    });
    const [m] = feed(cfg("model", "model", "gpt"));
    expect(m!.data).toEqual({ model: { provider: "acp:qmt", id: "gpt" } });
    const [th] = feed(cfg("thought_level", "thought_level", "high"));
    expect(th!.data).toEqual({ thinkingLevel: "high" });
    expect(th!.data.model).toBeUndefined();
    expect(feed(cfg("model", "model", "gpt"))).toEqual([]);
  });

  it("requires_action brackets a ui prompt", () => {
    const { feed } = make();
    const evs = feed(state("running"), state("requires_action"), state("running"));
    expect(types(evs)).toEqual(["agent_start", "ui_prompt_start", "ui_prompt_end"]);
  });

  it("plan updates emit one acp_plan_update per change", () => {
    const { feed } = make();
    const plan = (s: string) => ({ sessionUpdate: "plan_update", plan: { type: "items", planId: "p", entries: [{ content: "x", status: s }] } });
    expect(types(feed(plan("pending")))).toEqual(["acp_plan_update"]);
    expect(feed(plan("pending"))).toEqual([]);
    expect(types(feed(plan("completed")))).toEqual(["acp_plan_update"]);
  });

  it("flood: usage / commands / session-info / unknown / unreferenced terminal produce no chat events", () => {
    const { adapter, feed } = make();
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      total += feed({ sessionUpdate: "usage_update", used: i, size: 10 }).length;
      total += feed({ sessionUpdate: "terminal_output_chunk", terminalId: "orphan", data: btoa("x") }).length;
    }
    total += feed({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "a" }] }).length;
    total += feed({ sessionUpdate: "session_info_update", title: "T" }).length;
    total += feed({ sessionUpdate: "_vendor" }).length;
    expect(total).toBe(0);
    expect(adapter.counters()).toMatchObject({ usage: 1000, unreferencedTerminal: 1000, commands: 1, sessionInfo: 1, unknown: 1 });
    expect(adapter.getState().commands).toEqual([{ name: "a" }]);
    expect(adapter.getState().title).toBe("T");
  });

  it("D13: a finished turn's accumulated state is pruned (bounded memory); late updates for a finished tool never re-emit", () => {
    const { adapter, feed } = make();
    feed(
      state("running"),
      { sessionUpdate: "agent_message_chunk", messageId: "m1", content: t("x".repeat(1000)) },
      { sessionUpdate: "tool_call_update", toolCallId: "t1", title: "Run", status: "completed", content: [{ type: "content", content: t("out") }] },
      { sessionUpdate: "terminal_output_chunk", terminalId: "term", data: btoa("o") },
      state("idle", "end_turn"),
    );
    const st = adapter.getState();
    expect(st.messages.size).toBe(0);
    expect(st.toolCalls.size).toBe(0);
    expect(st.terminals.size).toBe(0);
    // late update for the finished tool: no tool_execution_start, no end
    const late = feed({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
    expect(late).toEqual([]);
  });
});
