/**
 * Tests for the per-turn line-delta derivation (change: add-change-summary-table).
 * Pins editDelta shape-correctness (no over-count of unchanged inner lines) and
 * turnFileDeltas attribution (running turn incl. the in-progress unstamped turn).
 */
import { describe, it, expect } from "vitest";
import { editDelta, toolCallDelta, turnFileDeltas, buildTurnSummaries } from "../util/lineDelta.js";
import type { ChatMessage } from "../chat/event-reducer.js";

function tool(
  toolName: string,
  args: Record<string, unknown>,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: `t-${Math.random()}`,
    role: "toolResult",
    content: toolName,
    toolName,
    args,
    timestamp: 0,
    ...extra,
  };
}

function user(text: string, turnIndex?: number): ChatMessage {
  return { id: `u-${Math.random()}`, role: "user", content: text, timestamp: 0, turnIndex };
}

describe("editDelta", () => {
  it("counts pure additions", () => {
    expect(editDelta("a\nb\n", "a\nb\nc\nd\n")).toEqual({ additions: 2, deletions: 0 });
  });

  it("counts pure deletions", () => {
    expect(editDelta("a\nb\nc\n", "a\n")).toEqual({ additions: 0, deletions: 2 });
  });

  it("does NOT count unchanged inner lines in a replacement", () => {
    // Only the middle line changes; surrounding lines are unchanged.
    expect(editDelta("a\nOLD\nc\n", "a\nNEW\nc\n")).toEqual({ additions: 1, deletions: 1 });
  });

  it("returns {0,0} for identical text", () => {
    expect(editDelta("same\n", "same\n")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("toolCallDelta", () => {
  it("Write content counts as all additions (new file)", () => {
    expect(toolCallDelta(tool("Write", { path: "a.ts", content: "x\ny\nz\n" }))).toEqual({
      additions: 3,
      deletions: 0,
    });
  });

  it("edits[] multi-op sums each op", () => {
    const delta = toolCallDelta(
      tool("Edit", {
        path: "a.ts",
        edits: [
          { oldText: "a\n", newText: "a\nb\n" }, // +1
          { oldText: "c\n", newText: "" }, // -1
        ],
      }),
    );
    expect(delta).toEqual({ additions: 1, deletions: 1 });
  });

  it("top-level oldText/newText uses editDelta", () => {
    expect(toolCallDelta(tool("Edit", { path: "a.ts", oldText: "1\n", newText: "1\n2\n" }))).toEqual(
      { additions: 1, deletions: 0 },
    );
  });

  it("hashline op lines[] count as additions", () => {
    expect(
      toolCallDelta(tool("Edit", { path: "a.ts", edits: [{ op: "append", lines: ["x", "y"] }] })),
    ).toEqual({ additions: 2, deletions: 0 });
  });

  it("pre-computed toolDetails.diff parsed for +/- (headers ignored)", () => {
    const diff = ["--- a/x", "+++ b/x", "@@", "+added", "-removed", " ctx"].join("\n");
    expect(toolCallDelta(tool("Edit", { path: "x" }, { toolDetails: { diff } }))).toEqual({
      additions: 1,
      deletions: 1,
    });
  });
});

describe("turnFileDeltas", () => {
  it("attributes tool events to the preceding user turn", () => {
    const messages: ChatMessage[] = [
      user("first", 0),
      tool("Write", { path: "a.ts", content: "x\n" }),
      user("second", 1),
      tool("Edit", { path: "a.ts", oldText: "x\n", newText: "x\ny\n" }),
      tool("Write", { path: "b.ts", content: "1\n2\n" }),
    ];
    const byTurn = turnFileDeltas(messages);
    expect(byTurn.get(0)?.get("a.ts")).toEqual({ additions: 1, deletions: 0 });
    expect(byTurn.get(1)?.get("a.ts")).toEqual({ additions: 1, deletions: 0 });
    expect(byTurn.get(1)?.get("b.ts")).toEqual({ additions: 2, deletions: 0 });
  });

  it("groups the in-progress (unstamped) turn under the next turn number", () => {
    const messages: ChatMessage[] = [
      user("first", 0),
      tool("Write", { path: "a.ts", content: "x\n" }),
      user("in progress"), // no turnIndex yet
      tool("Write", { path: "c.ts", content: "n\n" }),
    ];
    const byTurn = turnFileDeltas(messages);
    expect(byTurn.get(0)?.get("a.ts")).toEqual({ additions: 1, deletions: 0 });
    expect(byTurn.get(1)?.get("c.ts")).toEqual({ additions: 1, deletions: 0 });
  });

  it("sums multiple edits to the same file within a turn", () => {
    const messages: ChatMessage[] = [
      user("t", 0),
      tool("Edit", { path: "a.ts", oldText: "1\n", newText: "1\n2\n" }), // +1
      tool("Edit", { path: "a.ts", oldText: "2\n", newText: "2\n3\n" }), // +1
    ];
    expect(turnFileDeltas(messages).get(0)?.get("a.ts")).toEqual({ additions: 2, deletions: 0 });
  });

  it("ignores non-edit/write tool events", () => {
    const messages: ChatMessage[] = [
      user("t", 0),
      tool("Read", { path: "a.ts" }),
      tool("Bash", { command: "ls" }),
    ];
    expect(turnFileDeltas(messages).size).toBe(0);
  });
});

describe("buildTurnSummaries", () => {
  it("emits one summary per changed turn with anchor + totals", () => {
    const u1 = user("first", 0);
    const u2 = user("second", 1);
    const messages: ChatMessage[] = [
      u1,
      tool("Write", { path: "a.ts", content: "x\ny\n" }), // added, +2
      u2,
      tool("Edit", { path: "a.ts", oldText: "x\ny\n", newText: "x\ny\nz\n" }), // modified, +1
    ];
    const summaries = buildTurnSummaries(messages);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      turn: 0,
      totalAdditions: 2,
      totalDeletions: 0,
      boundaryUserMessageId: u2.id,
    });
    expect(summaries[0].files[0]).toMatchObject({ path: "a.ts", status: "added", additions: 2 });
    expect(summaries[1]).toMatchObject({ turn: 1, boundaryUserMessageId: null });
    expect(summaries[1].files[0]).toMatchObject({ path: "a.ts", status: "modified", additions: 1 });
  });

  it("skips turns with no file changes", () => {
    const messages: ChatMessage[] = [
      user("t0", 0),
      tool("Bash", { command: "ls" }),
      user("t1", 1),
      tool("Write", { path: "a.ts", content: "x\n" }),
    ];
    const summaries = buildTurnSummaries(messages);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].turn).toBe(1);
  });

  it("path-sorts files; Write-origin = added, pure edit = modified", () => {
    const messages: ChatMessage[] = [
      user("t", 0),
      tool("Edit", { path: "z.ts", oldText: "1\n", newText: "1\n2\n" }),
      tool("Write", { path: "a.ts", content: "n\n" }),
    ];
    const [s] = buildTurnSummaries(messages);
    expect(s.files.map((f) => f.path)).toEqual(["a.ts", "z.ts"]);
    expect(s.files.find((f) => f.path === "a.ts")?.status).toBe("added");
    expect(s.files.find((f) => f.path === "z.ts")?.status).toBe("modified");
  });
});
