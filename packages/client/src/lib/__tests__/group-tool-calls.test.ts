import { describe, it, expect } from "vitest";
import { groupConsecutiveToolCalls, type ChatItem, type ToolCallGroup } from "../chat/group-tool-calls.js";
import type { ChatMessage } from "../chat/event-reducer.js";

function toolMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random()}`,
    role: "toolResult",
    content: "",
    toolName: "bash",
    toolCallId: "tc-1",
    toolStatus: "complete",
    timestamp: Date.now(),
    args: { command: "curl -s http://localhost:8000/api/health" },
    ...overrides,
  };
}

function userMsg(): ChatMessage {
  return { id: `msg-${Math.random()}`, role: "user", content: "hello", timestamp: Date.now() };
}

function sep(role: ChatMessage["role"] = "turnSeparator"): ChatMessage {
  return { id: `msg-${Math.random()}`, role, content: "", timestamp: Date.now() };
}

function isGroup(item: ChatItem): item is ToolCallGroup {
  return (item as any).type === "group";
}

describe("groupConsecutiveToolCalls", () => {
  it("groups 3+ consecutive identical tool calls", () => {
    const msgs = [toolMsg(), toolMsg(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(true);
    expect((result[0] as ToolCallGroup).messages).toHaveLength(3);
  });

  it("does not group fewer than 3 identical calls", () => {
    const msgs = [toolMsg(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(2);
    expect(isGroup(result[0])).toBe(false);
  });

  it("does not group different tool names", () => {
    const msgs = [
      toolMsg({ toolName: "bash" }),
      toolMsg({ toolName: "read" }),
      toolMsg({ toolName: "bash" }),
    ];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(3);
    expect(result.every((r) => !isGroup(r))).toBe(true);
  });

  it("does not group different args", () => {
    const msgs = [
      toolMsg({ args: { command: "echo 1" } }),
      toolMsg({ args: { command: "echo 2" } }),
      toolMsg({ args: { command: "echo 3" } }),
    ];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(3);
  });

  it("does not include a running last item in the group", () => {
    const msgs = [toolMsg(), toolMsg(), toolMsg(), toolMsg({ toolStatus: "running" })];
    const result = groupConsecutiveToolCalls(msgs);
    // First 3 grouped, running one separate
    expect(result).toHaveLength(2);
    expect(isGroup(result[0])).toBe(true);
    expect((result[0] as ToolCallGroup).messages).toHaveLength(3);
    expect(isGroup(result[1])).toBe(false);
  });

  it("does not absorb a RUN-STARTING running toolResult into a group", () => {
    // A live (running) row that starts the run must render standalone, not be
    // hidden inside a ×N pill. The following 3 identical completes still group.
    const running = toolMsg({ toolStatus: "running" });
    const msgs = [running, toolMsg(), toolMsg(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(2);
    expect(isGroup(result[0])).toBe(false);
    expect((result[0] as ChatMessage).toolStatus).toBe("running");
    expect(isGroup(result[1])).toBe(true);
    expect((result[1] as ToolCallGroup).messages).toHaveLength(3);
  });

  it("preserves non-tool messages between groups", () => {
    const msgs = [toolMsg(), toolMsg(), toolMsg(), userMsg(), toolMsg(), toolMsg(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(3); // group, user, group
    expect(isGroup(result[0])).toBe(true);
    expect((result[1] as ChatMessage).role).toBe("user");
    expect(isGroup(result[2])).toBe(true);
  });

  it("handles empty array", () => {
    expect(groupConsecutiveToolCalls([])).toEqual([]);
  });

  it("handles single tool call", () => {
    const result = groupConsecutiveToolCalls([toolMsg()]);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(false);
  });

  // The reducer inserts a `turnSeparator` between consecutive tool-only
  // assistant turns (event-reducer.ts:469). Without skipping these, every
  // identical bash call in a polling loop would render as its own card.
  it("groups identical tool calls separated by turnSeparator messages", () => {
    const msgs = [toolMsg(), sep(), toolMsg(), sep(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(true);
    expect((result[0] as ToolCallGroup).messages).toHaveLength(3);
  });

  it("groups identical tool calls separated by thinking blocks", () => {
    const msgs = [toolMsg(), sep("thinking"), toolMsg(), sep("thinking"), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(true);
    expect((result[0] as ToolCallGroup).messages).toHaveLength(3);
  });

  it("groups across mixed transparent roles (assistant prose + separator)", () => {
    const msgs = [toolMsg(), sep("assistant"), sep(), toolMsg(), sep(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(true);
    expect((result[0] as ToolCallGroup).messages).toHaveLength(3);
  });

  it("does NOT group across a user message (user breaks the run)", () => {
    const msgs = [toolMsg(), toolMsg(), toolMsg(), userMsg(), toolMsg(), toolMsg(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(3);
    expect(isGroup(result[0])).toBe(true);
    expect((result[1] as ChatMessage).role).toBe("user");
    expect(isGroup(result[2])).toBe(true);
  });

  it("does NOT group across a different toolResult (different tool breaks the run)", () => {
    const msgs = [
      toolMsg(),
      sep(),
      toolMsg(),
      toolMsg({ toolName: "read", args: { path: "/tmp/x" } }),
      toolMsg(),
      toolMsg(),
    ];
    const result = groupConsecutiveToolCalls(msgs);
    // First 2 bash calls (with turnSeparator between) are too few to group;
    // the read breaks the run; the trailing 2 bash calls are also too few.
    // So nothing is grouped.
    expect(result.every((r) => !isGroup(r))).toBe(true);
  });

  it("carries absorbed narration in `rendered`, keeps `messages` toolResult-only", () => {
    const t1 = sep("thinking");
    const prose = { id: "prose-1", role: "assistant", content: "still starting", timestamp: Date.now() } as ChatMessage;
    const msgs = [toolMsg(), t1, toolMsg(), prose, toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(1);
    expect(isGroup(result[0])).toBe(true);
    const group = result[0] as ToolCallGroup;
    // messages = the 3 toolResults only.
    expect(group.messages).toHaveLength(3);
    expect(group.messages.every((m) => m.role === "toolResult")).toBe(true);
    // rendered = full interleaved slice (3 tools + thinking + prose) in order.
    expect(group.rendered).toHaveLength(5);
    expect(group.rendered).toContain(t1);
    expect(group.rendered).toContain(prose);
    expect(group.rendered.map((m) => m.role)).toEqual([
      "toolResult",
      "thinking",
      "toolResult",
      "assistant",
      "toolResult",
    ]);
  });

  it("does not absorb trailing transparents after the final grouped call", () => {
    // Trailing thinking after the last grouped toolResult belongs to the next
    // row, not the group's `rendered`.
    const trailing = sep("thinking");
    const msgs = [toolMsg(), toolMsg(), toolMsg(), trailing];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(2);
    const group = result[0] as ToolCallGroup;
    expect(group.rendered).toHaveLength(3);
    expect(group.rendered).not.toContain(trailing);
    expect((result[1] as ChatMessage).id).toBe(trailing.id);
  });

  it("emits intermediate transparent rows verbatim when no group forms", () => {
    // Only 2 identical bash calls + a separator: must not group, must keep all rows.
    const msgs = [toolMsg(), sep(), toolMsg()];
    const result = groupConsecutiveToolCalls(msgs);
    expect(result).toHaveLength(3);
    expect(result.every((r) => !isGroup(r))).toBe(true);
  });
});
