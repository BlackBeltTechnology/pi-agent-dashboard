/**
 * Nested tool calls (pi ≥0.99 codemode / `ctx.executeTool`) attach to their
 * ROOT call's `nested` list — never a top-level row or map entry.
 *
 * Folded from the change's test-plan: E1–E14 (E6 reduce half lives in
 * `src/__tests__/state-replay.test.ts`).
 * See change: render-nested-tool-calls.
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  type ChatMessage,
  createInitialState,
  finalizeBackfillSegment,
  reduceEvent,
  type SessionState,
  TRUNCATION_MARKER_PREFIX,
} from "../chat/event-reducer.js";

function evt(eventType: string, data: Record<string, unknown> = {}, ts = 1000): DashboardEvent {
  return { eventType, timestamp: ts, data } as DashboardEvent;
}

const fold = (events: DashboardEvent[], from: SessionState = createInitialState()) =>
  events.reduce((s, e) => reduceEvent(s, e), from);

const rootStart = (id = "call_1", name = "codemode", ts = 1000) =>
  evt("tool_execution_start", { toolCallId: id, toolName: name, args: { code: "…" } }, ts);
const rootEnd = (id = "call_1", ts = 5000, extra: Record<string, unknown> = {}) =>
  evt("tool_execution_end", { toolCallId: id, toolName: "codemode", result: "done", isError: false, ...extra }, ts);
const nStart = (id: string, parent: string, name = "bash", ts = 2000, args: Record<string, unknown> = { command: "ls" }) =>
  evt("tool_execution_start", { toolCallId: id, toolName: name, args, parentToolCallId: parent }, ts);
const nEnd = (id: string, parent: string, extra: Record<string, unknown> = {}, ts = 3000) =>
  evt(
    "tool_execution_end",
    {
      toolCallId: id,
      toolName: "bash",
      parentToolCallId: parent,
      result: { content: [{ type: "text", text: "out" }] },
      isError: false,
      ...extra,
    },
    ts,
  );

const rootRow = (s: SessionState, id = "call_1"): ChatMessage | undefined =>
  s.messages.find((m) => m.role === "toolResult" && m.toolCallId === id);
const nested = (s: SessionState, id = "call_1") => rootRow(s, id)?.nested ?? [];
const entry = (s: SessionState, nid: string, root = "call_1") => nested(s, root).find((e) => e.id === nid);
const toolRows = (s: SessionState) => s.messages.filter((m) => m.role === "toolResult");

describe("nested tool calls — live attach", () => {
  it("E1: a nested start attaches to its root; no top-level ToolCallState or row", () => {
    const s = fold([rootStart(), nStart("call_1/1", "call_1")]);
    expect(s.toolCalls.has("call_1/1")).toBe(false);
    expect(toolRows(s)).toHaveLength(1);
    expect(s.toolCalls.get("call_1")?.nested).toEqual([
      expect.objectContaining({ id: "call_1/1", parentId: "call_1", name: "bash", status: "running", startedAt: 2000 }),
    ]);
    expect(entry(s, "call_1/1")).toMatchObject({ status: "running", args: { command: "ls" } });
  });

  it("E2: a grandchild is listed under the ROOT with its direct parentId", () => {
    const s = fold([rootStart(), nStart("call_1/1", "call_1", "codemode"), nStart("call_1/1/1", "call_1/1")]);
    expect(nested(s).map((e) => e.id)).toEqual(["call_1/1", "call_1/1/1"]);
    expect(entry(s, "call_1/1/1")?.parentId).toBe("call_1/1");
  });

  it("E3: a nested error end marks only the nested entry; root unchanged", () => {
    const s = fold([rootStart(), nStart("call_1/1", "call_1"), nEnd("call_1/1", "call_1", { isError: true })]);
    expect(entry(s, "call_1/1")?.status).toBe("error");
    expect(rootRow(s)?.toolStatus).toBe("running");
    expect(s.toolCalls.get("call_1")?.status).toBe("running");
  });

  it("E4: root end closes a running nested entry as unfinished; a late real end overwrites it", () => {
    const afterRoot = fold([rootStart(), nStart("call_1/1", "call_1"), rootEnd()]);
    expect(entry(afterRoot, "call_1/1")?.status).toBe("unfinished");
    expect(afterRoot.toolCalls.get("call_1")?.nested?.[0].status).toBe("unfinished");
    const late = reduceEvent(afterRoot, nEnd("call_1/1", "call_1", {}, 6000));
    expect(entry(late, "call_1/1")?.status).toBe("complete");
  });

  it("E5: a nested update refreshes the nested partial; no top-level row", () => {
    const s = fold([
      rootStart(),
      nStart("call_1/1", "call_1"),
      evt("tool_execution_update", {
        toolCallId: "call_1/1",
        parentToolCallId: "call_1",
        partialResult: { content: [{ type: "text", text: "partial 2" }] },
      }),
    ]);
    expect(entry(s, "call_1/1")?.result).toBe("partial 2");
    expect(toolRows(s)).toHaveLength(1);
    expect(rootRow(s)?.result).toBeUndefined();
  });
});

describe("nested tool calls — record merge", () => {
  it("E7: live toolResult message_end record merges into the live list", () => {
    let s = fold([
      rootStart(),
      nStart("call_1/1", "call_1"),
      nEnd("call_1/1", "call_1", { result: { content: [{ type: "text", text: "live result" }] } }),
      nStart("call_1/2", "call_1"),
      nStart("call_1/3", "call_1"),
      rootEnd(),
    ]);
    s = reduceEvent(
      s,
      evt("message_end", {
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "codemode",
          content: [{ type: "text", text: "done" }],
          nestedCalls: {
            calls: [
              { id: "call_1/1", name: "bash", status: "ok", durationMs: 12 },
              { id: "call_1/2", name: "bash", status: "error", error: "boom" },
              { id: "call_1/4", name: "read", status: "ok", arguments: { path: "a" } },
            ],
            complete: false,
          },
        },
      }),
    );
    expect(entry(s, "call_1/1")).toMatchObject({ status: "complete", result: "live result", durationMs: 12 });
    expect(entry(s, "call_1/2")).toMatchObject({ status: "error", error: "boom" });
    expect(entry(s, "call_1/4")).toMatchObject({ status: "complete", parentId: "call_1", name: "read" });
    expect(entry(s, "call_1/3")?.status).toBe("unfinished");
    expect(nested(s).some((e) => e.status === "running")).toBe(false);
    expect(rootRow(s)?.nestedComplete).toBe(false);
  });

  it("E7b: the same record on a toolResult message_start merges too", () => {
    const s = fold([
      rootStart(),
      rootEnd(),
      evt("message_start", {
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          nestedCalls: { calls: [{ id: "call_1/1/2", name: "bash", status: "ok" }], complete: true },
        },
      }),
    ]);
    expect(entry(s, "call_1/1/2")).toMatchObject({ parentId: "call_1/1", status: "complete" });
    expect(rootRow(s)?.nestedComplete).toBe(true);
  });
});

// Review r2 B1: pi carries the same record on toolResult message_start AND
// message_end; a nested end landing between them must survive the re-merge.
describe("nested tool calls — record re-merge never reverts a real end", () => {
  it("a late real end between message_start and message_end stays complete", () => {
    const record = {
      calls: [{ id: "call_1/1", name: "bash", status: "unfinished" }],
      complete: false,
    };
    const toolResultMsg = { role: "toolResult", toolCallId: "call_1", toolName: "codemode", nestedCalls: record };
    const s = fold([
      rootStart(),
      nStart("call_1/1", "call_1"),
      rootEnd(),
      evt("message_start", { message: toolResultMsg }),
      nEnd("call_1/1", "call_1", { result: { content: [{ type: "text", text: "late" }] } }, 6000),
      evt("message_end", { message: toolResultMsg }),
    ]);
    expect(entry(s, "call_1/1")).toMatchObject({ status: "complete", result: "late" });
  });

  it("a late real error end is kept too", () => {
    const toolResultMsg = {
      role: "toolResult",
      toolCallId: "call_1",
      nestedCalls: { calls: [{ id: "call_1/1", name: "bash", status: "unfinished" }], complete: false },
    };
    const s = fold([
      rootStart(),
      nStart("call_1/1", "call_1"),
      rootEnd(),
      nEnd("call_1/1", "call_1", { isError: true }, 6000),
      evt("message_end", { message: toolResultMsg }),
    ]);
    expect(entry(s, "call_1/1")?.status).toBe("error");
  });
});

describe("nested tool calls — classification, orphans, fallback (E8)", () => {
  it("(a) a nested start with an unknown root is dropped without throwing", () => {
    let s!: SessionState;
    expect(() => {
      s = fold([nStart("ghost/1", "ghost")]);
    }).not.toThrow();
    expect(s.messages).toHaveLength(0);
    expect(s.toolCalls.size).toBe(0);
  });

  it("(b) a non-conforming id whose parent is a known nested entry attaches to that root", () => {
    const s = fold([rootStart(), nStart("call_1/1", "call_1", "codemode"), nStart("x9", "call_1/1")]);
    expect(entry(s, "x9")).toMatchObject({ parentId: "call_1/1", status: "running" });
    expect(toolRows(s)).toHaveLength(1);
  });

  it("(c) a top-level id containing `/` without parentToolCallId stays top-level", () => {
    const s = fold([rootStart("call_7/a", "bash")]);
    expect(s.toolCalls.has("call_7/a")).toBe(true);
    expect(rootRow(s, "call_7/a")).toBeDefined();
  });
});

describe("nested tool calls — window edges", () => {
  it("E9: a backfill segment with a dangling nested start creates/elides no row", () => {
    const seg = fold([nStart("call_1/1", "call_1")]);
    const finalized = finalizeBackfillSegment(seg.messages);
    expect(finalized).toHaveLength(0);
  });

  it("E9b: a segment's elided root closes its running nested entries", () => {
    const seg = fold([rootStart(), nStart("call_1/1", "call_1")]);
    const finalized = finalizeBackfillSegment(seg.messages);
    expect(finalized[0].toolStatus).toBe("elided");
    expect(finalized[0].nested?.[0].status).toBe("unfinished");
  });

  it("E10: an orphan root end carrying nestedCalls creates no row and no nested entries", () => {
    let s!: SessionState;
    expect(() => {
      s = fold([
        rootEnd("call_1", 5000, {
          nestedCalls: { calls: [{ id: "call_1/1", name: "bash", status: "ok" }], complete: true },
        }),
      ]);
    }).not.toThrow();
    expect(toolRows(s)).toHaveLength(0);
    expect(s.toolCalls.get("call_1")?.nested).toBeUndefined();
  });

  it("E11a: a late nested start under a complete root is created unfinished", () => {
    const s = fold([rootStart(), rootEnd(), nStart("call_1/2", "call_1", "bash", 6000)]);
    expect(entry(s, "call_1/2")?.status).toBe("unfinished");
  });

  it("E11b: a late nested start under an elided root is created unfinished", () => {
    const seg = fold([rootStart()]);
    const elided: SessionState = { ...createInitialState(), messages: finalizeBackfillSegment(seg.messages) };
    const s = reduceEvent(elided, nStart("call_1/2", "call_1"));
    expect(entry(s, "call_1/2")?.status).toBe("unfinished");
  });
});

describe("nested tool calls — streaming, currentTool, truncation", () => {
  it("E12: a nested start does not flush streaming text", () => {
    const base = fold([rootStart()]);
    const streaming: SessionState = { ...base, streamingText: "I'll run:", streamingTextFlushed: false };
    const s = reduceEvent(streaming, nStart("call_1/1", "call_1"));
    expect(s.messages).toHaveLength(streaming.messages.length);
    expect(s.messages.some((m) => m.role === "assistant")).toBe(false);
    expect(s.streamingText).toBe("I'll run:");
    expect(s.streamingTextFlushed).toBe(false);
  });

  it("E13: nested start/end never change the client currentTool", () => {
    const base = fold([rootStart()]);
    expect(base.currentTool).toBe("codemode");
    const started = reduceEvent(base, nStart("call_1/1", "call_1", "bash"));
    expect(started.currentTool).toBe("codemode");
    const ended = reduceEvent(started, nEnd("call_1/1", "call_1"));
    expect(ended.currentTool).toBe("codemode");
  });

  it("E14: a nested result one line over the limit keeps the last lines + omission marker", () => {
    const text = Array.from({ length: 201 }, (_, i) => `line ${i + 1}`).join("\n");
    const s = fold([
      rootStart(),
      nStart("call_1/1", "call_1"),
      nEnd("call_1/1", "call_1", { result: { content: [{ type: "text", text }] } }),
    ]);
    const result = entry(s, "call_1/1")?.result ?? "";
    // The full-output affordance keys on this exact marker prefix.
    expect(result.startsWith(TRUNCATION_MARKER_PREFIX)).toBe(true);
    expect(result).toContain("1 earlier lines hidden");
    expect(result.endsWith("line 201")).toBe(true);
    expect(result).not.toContain("line 1\n");
  });
});
