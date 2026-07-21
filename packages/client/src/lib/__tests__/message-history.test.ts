import { describe, it, expect } from "vitest";
import { extractUserPromptHistory } from "../replay/message-history.js";
import type { ChatMessage } from "../chat/event-reducer.js";

function userMsg(id: string, content: string, timestamp = 0): ChatMessage {
  return { id, role: "user", content, timestamp };
}

function assistantMsg(id: string, content: string, timestamp = 0): ChatMessage {
  return { id, role: "assistant", content, timestamp };
}

function toolMsg(id: string, timestamp = 0): ChatMessage {
  return {
    id,
    role: "toolResult",
    content: "",
    toolName: "bash",
    timestamp,
  };
}

describe("extractUserPromptHistory", () => {
  it("returns an empty array for an empty input", () => {
    expect(extractUserPromptHistory([])).toEqual([]);
  });

  it("returns only user messages", () => {
    const msgs: ChatMessage[] = [
      assistantMsg("a1", "hi"),
      userMsg("u1", "first"),
      assistantMsg("a2", "ok"),
      toolMsg("t1"),
      userMsg("u2", "second"),
    ];
    expect(extractUserPromptHistory(msgs)).toEqual(["second", "first"]);
  });

  it("returns newest-first (reverse chronological)", () => {
    const msgs: ChatMessage[] = [
      userMsg("u1", "oldest", 1),
      userMsg("u2", "middle", 2),
      userMsg("u3", "newest", 3),
    ];
    expect(extractUserPromptHistory(msgs)).toEqual(["newest", "middle", "oldest"]);
  });

  it("collapses consecutive duplicates", () => {
    const msgs: ChatMessage[] = [
      userMsg("u1", "ping"),
      userMsg("u2", "ping"),
      userMsg("u3", "ping"),
      userMsg("u4", "pong"),
    ];
    expect(extractUserPromptHistory(msgs)).toEqual(["pong", "ping"]);
  });

  it("preserves non-consecutive duplicates", () => {
    const msgs: ChatMessage[] = [
      userMsg("u1", "ping"),
      userMsg("u2", "pong"),
      userMsg("u3", "ping"),
    ];
    // Newest-first: "ping", "pong", "ping"
    expect(extractUserPromptHistory(msgs)).toEqual(["ping", "pong", "ping"]);
  });

  it("skips empty and whitespace-only contents", () => {
    const msgs: ChatMessage[] = [
      userMsg("u1", "real prompt"),
      userMsg("u2", ""),
      userMsg("u3", "   "),
      userMsg("u4", "\n\t"),
      userMsg("u5", "another"),
    ];
    expect(extractUserPromptHistory(msgs)).toEqual(["another", "real prompt"]);
  });

  it("handles a single user message", () => {
    expect(extractUserPromptHistory([userMsg("u1", "hello")])).toEqual(["hello"]);
  });

  it("includes slash-commands and bang-shell lines verbatim", () => {
    const msgs: ChatMessage[] = [
      userMsg("u1", "/compact"),
      userMsg("u2", "!ls -la"),
      userMsg("u3", "fix the bug"),
    ];
    expect(extractUserPromptHistory(msgs)).toEqual(["fix the bug", "!ls -la", "/compact"]);
  });

  // See change: render-skill-invocations-collapsibly.

  function skillMsg(id: string, content: string): ChatMessage {
    // Mirrors what event-reducer.ts stamps on message_start for a wrapped user msg.
    const m = content.match(
      /^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/,
    );
    const name = m![1];
    const args = m![4];
    return {
      id,
      role: "user",
      content,
      timestamp: 0,
      skill: {
        name,
        location: m![2],
        body: m![3],
        args,
        condensed: `/skill:${name}${args ? " " + args : ""}`,
      },
    };
  }

  it("recalls condensed slash form for user msgs with skill stamp + args", () => {
    const wrapped =
      `<skill name="openspec-explore" location="/x/SKILL.md">\nbody\n</skill>\n\ncontinue with X`;
    const msgs: ChatMessage[] = [skillMsg("u1", wrapped)];
    expect(extractUserPromptHistory(msgs)).toEqual(["/skill:openspec-explore continue with X"]);
  });

  it("recalls bare slash form when skill has no args", () => {
    const wrapped = `<skill name="foo" location="/x">\nbody\n</skill>`;
    const msgs: ChatMessage[] = [skillMsg("u1", wrapped)];
    expect(extractUserPromptHistory(msgs)).toEqual(["/skill:foo"]);
  });

  it("falls back to ad-hoc parsing when skill stamp is missing (pre-stamping replay)", () => {
    const wrapped = `<skill name="foo" location="/x">\nbody\n</skill>\n\nargs`;
    // userMsg() helper does NOT stamp `skill` — simulates older state shape.
    const msgs: ChatMessage[] = [userMsg("u1", wrapped)];
    expect(extractUserPromptHistory(msgs)).toEqual(["/skill:foo args"]);
  });

  it("mixed plain + skill history is newest-first and dedups consecutive", () => {
    const wrapped = `<skill name="foo" location="/x">\nb\n</skill>\n\nargs1`;
    const msgs: ChatMessage[] = [
      userMsg("u1", "hello"),
      skillMsg("u2", wrapped),
      skillMsg("u3", wrapped), // consecutive dup of condensed form
      userMsg("u4", "world"),
    ];
    expect(extractUserPromptHistory(msgs)).toEqual([
      "world",
      "/skill:foo args1",
      "hello",
    ]);
  });
});
