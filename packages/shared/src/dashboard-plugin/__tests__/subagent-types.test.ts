import { describe, expect, it } from "vitest";
import {
  applyLiveBlockPiece,
  countSteps,
  LIVE_BLOCK_GAP_MARKER,
  readLiveTail,
  readSubagentDetails,
  type SubagentState,
  type SubagentTimelineEntry,
  setSubagentState,
} from "../subagent-types.js";

const base = (over: Partial<SubagentState> = {}): SubagentState => ({
  id: "a1",
  type: "general-purpose",
  description: "d",
  status: "running",
  ...over,
});

describe("subagent-types (shared contract, task 2.7)", () => {
  it("readLiveTail normalizes: caps text, clears unknown objects, ignores non-objects", () => {
    expect(readLiveTail({ kind: "thinking", text: "x".repeat(400) })).toEqual({ kind: "thinking", text: "x".repeat(280) });
    expect(readLiveTail({ kind: "weird" })).toEqual({ kind: "none", text: "" });
    expect(readLiveTail(null)).toBeUndefined();
    expect(readLiveTail([])).toBeUndefined();
  });

  it("countSteps counts filled entries of a sparse timeline", () => {
    const sparse = [undefined, { kind: "text", text: "a", ts: 1 }, undefined] as unknown as SubagentTimelineEntry[];
    expect(countSteps(sparse)).toBe(1);
    expect(countSteps(undefined)).toBe(0);
  });

  it("readSubagentDetails omits empty entries and reads scalar fields", () => {
    expect(readSubagentDetails(undefined)).toEqual({});
    const out = readSubagentDetails({ entries: [], activity: "act", entryCount: 3, agentSessionId: "s7" });
    expect(out).toEqual({ activity: "act", entryCount: 3, agentSessionId: "s7" });
  });

  it("setSubagentState dual-indexes and never shrinks the timeline", () => {
    const map = new Map<string, SubagentState>();
    const e: SubagentTimelineEntry[] = [
      { kind: "text", text: "a", ts: 1 },
      { kind: "text", text: "b", ts: 2 },
    ];
    setSubagentState(map, base({ entries: e, agentSessionId: "s7" }));
    setSubagentState(map, base({ entries: [], agentSessionId: "s7" }));
    expect(map.get("a1")?.entries).toBe(e);
    expect(map.get("s7")).toBe(map.get("a1"));
  });

  it("applyLiveBlockPiece appends contiguous, ignores covered, marks gaps, ignores closed blocks", () => {
    const first = applyLiveBlockPiece(undefined, { blockId: 1, kind: "text", offset: 0, text: "ab" });
    expect(first).toMatchObject({ text: "ab", end: 2, gap: false });
    const dup = applyLiveBlockPiece(base({ liveBlock: first }), { blockId: 1, kind: "text", offset: 0, text: "ab" });
    expect(dup).toBe(first);
    const gap = applyLiveBlockPiece(base({ liveBlock: first }), { blockId: 1, kind: "text", offset: 5, text: "z" });
    expect(gap).toMatchObject({ text: `ab${LIVE_BLOCK_GAP_MARKER}z`, end: 6, gap: true });
    expect(applyLiveBlockPiece(base({ closedBlockMax: 1 }), { blockId: 1, kind: "text", offset: 0, text: "q" })).toBeUndefined();
    expect(applyLiveBlockPiece(base({ status: "completed" }), { blockId: 2, kind: "text", offset: 0, text: "q" })).toBeUndefined();
  });
});
