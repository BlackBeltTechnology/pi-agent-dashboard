/**
 * ACP v2 update model: parse tolerance + upsert reducer.
 * See change: add-acp-session-driver (test-plan #E1–#E4).
 */
import { describe, expect, it } from "vitest";
import { applyUpdate, createAcpSessionState, parseSessionUpdate } from "../update-model.js";

const text = (t: string) => ({ type: "text", text: t });

describe("parseSessionUpdate", () => {
  it("E1: preserves unknown variants unmodified", () => {
    for (const raw of [{ sessionUpdate: "_querymt_hook_notice", x: 1 }, { sessionUpdate: "future_kind" }]) {
      const u = parseSessionUpdate(raw);
      expect(u).toEqual({ kind: "unknown", raw });
      expect((u as { raw: unknown }).raw).toBe(raw);
    }
  });

  it("E2: tolerates malformed input without throwing", () => {
    const bad: unknown[] = [{}, { sessionUpdate: 5 }, null, undefined, "x", [], { sessionUpdate: "tool_call_update" }];
    for (const raw of bad) {
      expect(() => parseSessionUpdate(raw)).not.toThrow();
      expect(parseSessionUpdate(raw).kind).toBe("unknown");
    }
    // wrongly-typed field on a known variant
    expect(parseSessionUpdate({ sessionUpdate: "agent_message_chunk", messageId: "m", content: "nope" }).kind).toBe("unknown");
    expect(parseSessionUpdate({ sessionUpdate: "state_update", state: "bogus" }).kind).toBe("unknown");
    expect(parseSessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "t", status: 3 }).kind).toBe("unknown");
  });

  it("parses every known variant", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ sessionUpdate: "user_message", messageId: "u", content: [text("a")] }, "user_message"],
      [{ sessionUpdate: "user_message_chunk", messageId: "u", content: text("a") }, "user_message_chunk"],
      [{ sessionUpdate: "agent_message", messageId: "m" }, "agent_message"],
      [{ sessionUpdate: "agent_message_chunk", messageId: "m", content: text("a") }, "agent_message_chunk"],
      [{ sessionUpdate: "agent_thought", messageId: "m", content: null }, "agent_thought"],
      [{ sessionUpdate: "agent_thought_chunk", messageId: "m", content: text("a") }, "agent_thought_chunk"],
      [{ sessionUpdate: "tool_call_update", toolCallId: "t", kind: "read" }, "tool_call_update"],
      [{ sessionUpdate: "tool_call_content_chunk", toolCallId: "t", content: { type: "content" } }, "tool_call_content_chunk"],
      [{ sessionUpdate: "state_update", state: "idle", stopReason: "end_turn" }, "state_update"],
      [{ sessionUpdate: "plan_update", plan: { type: "items", planId: "p", entries: [{ content: "x", status: "pending" }] } }, "plan_update"],
      [{ sessionUpdate: "config_option_update", configOptions: [{ configId: "m", type: "select", currentValue: "a" }] }, "config_option_update"],
      [{ sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "d" }] }, "available_commands_update"],
      [{ sessionUpdate: "usage_update", used: 1, size: 2 }, "usage_update"],
      [{ sessionUpdate: "session_info_update", title: "T" }, "session_info_update"],
      [{ sessionUpdate: "terminal_update", terminalId: "x", command: "ls" }, "terminal_update"],
      [{ sessionUpdate: "terminal_output_chunk", terminalId: "x", data: "aGk=" }, "terminal_output_chunk"],
    ];
    for (const [raw, kind] of cases) expect(parseSessionUpdate(raw).kind).toBe(kind);
  });

  it("flattens grouped select options", () => {
    const u = parseSessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [
        { configId: "model", type: "select", currentValue: "a", options: [{ groupId: "g", name: "G", options: [{ value: "a", name: "A" }] }, { value: "b", name: "B" }] },
      ],
    });
    expect(u).toMatchObject({ kind: "config_option_update", options: [{ options: [{ value: "a" }, { value: "b" }] }] });
  });
});

describe("applyUpdate", () => {
  const tool = (extra: Record<string, unknown>) =>
    parseSessionUpdate({ sessionUpdate: "tool_call_update", toolCallId: "t1", ...extra });

  it("E3: upsert semantics (omitted / null / value)", () => {
    let s = applyUpdate(createAcpSessionState(), tool({ title: "Read", status: "pending" }));
    expect(s.toolCalls.get("t1")).toMatchObject({ title: "Read", status: "pending" });

    s = applyUpdate(s, tool({ status: "completed" }));
    expect(s.toolCalls.get("t1")).toMatchObject({ title: "Read", status: "completed" });
    expect(s.toolCalls.size).toBe(1);

    s = applyUpdate(s, tool({ title: null }));
    expect(s.toolCalls.get("t1")?.title).toBeUndefined();
    expect(s.toolCalls.get("t1")?.status).toBe("completed");

    s = applyUpdate(s, tool({ title: "W" }));
    expect(s.toolCalls.get("t1")?.title).toBe("W");
  });

  it("does not mutate the previous state", () => {
    const s0 = createAcpSessionState();
    const s1 = applyUpdate(s0, tool({ title: "Read" }));
    expect(s0.toolCalls.size).toBe(0);
    expect(s1).not.toBe(s0);
  });

  it("E4: whole-message upsert resets, chunk appends", () => {
    let s = createAcpSessionState();
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "agent_message", messageId: "m1", content: [text("A"), text("B")] }));
    expect(s.messages.get("m1")?.content).toEqual([text("A"), text("B")]);
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "agent_message", messageId: "m1", content: [text("C")] }));
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "agent_message_chunk", messageId: "m1", content: text("D") }));
    expect(s.messages.get("m1")?.content).toEqual([text("C"), text("D")]);
  });

  it("agent_message without content leaves content unchanged; null clears", () => {
    let s = applyUpdate(createAcpSessionState(), parseSessionUpdate({ sessionUpdate: "agent_message", messageId: "m", content: [text("A")] }));
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "agent_message", messageId: "m" }));
    expect(s.messages.get("m")?.content).toEqual([text("A")]);
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "agent_message", messageId: "m", content: null }));
    expect(s.messages.get("m")?.content).toEqual([]);
  });

  it("tool content chunks append; terminal output decodes and snapshots replace", () => {
    let s = applyUpdate(createAcpSessionState(), tool({ content: [{ type: "content", n: 1 }] }));
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "tool_call_content_chunk", toolCallId: "t1", content: { type: "content", n: 2 } }));
    expect(s.toolCalls.get("t1")?.content).toHaveLength(2);

    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "terminal_output_chunk", terminalId: "x", data: btoa("he") }));
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "terminal_output_chunk", terminalId: "x", data: btoa("llo") }));
    expect(s.terminals.get("x")?.output).toBe("hello");
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "terminal_update", terminalId: "x", output: { data: btoa("fresh") } }));
    expect(s.terminals.get("x")?.output).toBe("fresh");
  });

  it("tracks run state, title, commands, config options", () => {
    let s = createAcpSessionState();
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "state_update", state: "running" }));
    expect(s.run.state).toBe("running");
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "session_info_update", title: "T" }));
    expect(s.title).toBe("T");
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "session_info_update", title: null }));
    expect(s.title).toBeUndefined();
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "available_commands_update", availableCommands: [{ name: "x" }] }));
    expect(s.commands).toEqual([{ name: "x" }]);
    s = applyUpdate(s, parseSessionUpdate({ sessionUpdate: "config_option_update", configOptions: [{ configId: "m", type: "select", currentValue: "a" }] }));
    expect(s.configOptions.get("m")?.currentValue).toBe("a");
  });
});
