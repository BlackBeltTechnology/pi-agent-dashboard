/**
 * SubagentFrameBuffer — D1 buffer-and-flush + D2 resync unit coverage.
 * See change: fix-subagent-live-detail-reliability (tasks 4.3, 5.4).
 */
import { describe, expect, it } from "vitest";
import { SubagentFrameBuffer } from "../subagent-frame-buffer.js";

function frame(id: string, entries: unknown[] = []) {
  return { id, type: "Explore", description: "", details: { entries } };
}

describe("SubagentFrameBuffer — channel classification", () => {
  it("recognizes subagent channels only", () => {
    expect(SubagentFrameBuffer.isSubagentChannel("subagents:started")).toBe(true);
    expect(SubagentFrameBuffer.isSubagentChannel("subagents:completed")).toBe(true);
    expect(SubagentFrameBuffer.isSubagentChannel("flow:agent-started")).toBe(false);
    expect(SubagentFrameBuffer.isSubagentChannel("some:custom")).toBe(false);
  });

  it("extracts agentId from data.id", () => {
    expect(SubagentFrameBuffer.agentIdOf({ id: "abc" })).toBe("abc");
    expect(SubagentFrameBuffer.agentIdOf({})).toBeUndefined();
    expect(SubagentFrameBuffer.agentIdOf(undefined)).toBeUndefined();
  });
});

describe("D1 — buffer while not ready, flush on re-register", () => {
  it("retains a not-ready frame and returns it on drain (emission order)", () => {
    const buf = new SubagentFrameBuffer();
    buf.buffer("subagents:started", frame("a"));
    buf.buffer("subagents:started", frame("b"));
    const drained = buf.drain();
    expect(drained.map((f) => f.data.id)).toEqual(["a", "b"]);
    expect(buf.stats.buffered).toBe(2);
    expect(buf.stats.flushed).toBe(2);
    // Buffer is empty after drain.
    expect(buf.pendingSize).toBe(0);
    expect(buf.drain()).toEqual([]);
  });

  it("keeps the latest snapshot per agentId (same agent, buffer pressure)", () => {
    const buf = new SubagentFrameBuffer();
    buf.buffer("subagents:started", frame("a", [1]));
    buf.buffer("subagents:started", frame("a", [1, 2]));
    buf.buffer("subagents:started", frame("a", [1, 2, 3]));
    const drained = buf.drain();
    expect(drained).toHaveLength(1);
    expect((drained[0]!.data.details as { entries: unknown[] }).entries).toEqual([1, 2, 3]);
  });

  it("bounds the buffer to maxAgents, dropping the oldest agent", () => {
    const buf = new SubagentFrameBuffer(2);
    buf.buffer("subagents:started", frame("a"));
    buf.buffer("subagents:started", frame("b"));
    buf.buffer("subagents:started", frame("c")); // evicts "a"
    const ids = buf.drain().map((f) => f.data.id);
    expect(ids).toEqual(["b", "c"]);
  });

  it("re-inserting an agent moves it to the most-recent position", () => {
    const buf = new SubagentFrameBuffer(2);
    buf.buffer("subagents:started", frame("a"));
    buf.buffer("subagents:started", frame("b"));
    buf.buffer("subagents:started", frame("a", [1])); // a → most recent
    buf.buffer("subagents:started", frame("c")); // evicts "b" (now oldest)
    const ids = buf.drain().map((f) => f.data.id);
    expect(ids).toEqual(["a", "c"]);
  });

  it("counts capacity evictions in stats.overflowEvicted", () => {
    const buf = new SubagentFrameBuffer(2);
    buf.buffer("subagents:started", frame("a"));
    buf.buffer("subagents:started", frame("b"));
    buf.buffer("subagents:started", frame("c")); // evicts "a" from pending + snapshots
    // One eviction from pending + one from snapshots for the same overflow.
    expect(buf.stats.overflowEvicted).toBe(2);
  });

  it("cannot buffer a frame without an agentId (counts as dropped)", () => {
    const buf = new SubagentFrameBuffer();
    expect(buf.buffer("subagents:started", { details: {} })).toBe(false);
    expect(buf.stats.droppedNoAgentId).toBe(1);
    expect(buf.pendingSize).toBe(0);
  });

  it("markForwarded counts the ready path without buffering", () => {
    const buf = new SubagentFrameBuffer();
    buf.markForwarded("subagents:started", frame("a", [1]));
    expect(buf.stats.forwarded).toBe(1);
    expect(buf.pendingSize).toBe(0);
  });
});

describe("D2 — resync responder", () => {
  it("returns the latest snapshot for a running subagent", () => {
    const buf = new SubagentFrameBuffer();
    buf.markForwarded("subagents:started", frame("a", [1]));
    buf.markForwarded("subagents:started", frame("a", [1, 2]));
    const snap = buf.resync("a");
    expect(snap).toBeDefined();
    expect((snap!.data.details as { entries: unknown[] }).entries).toEqual([1, 2]);
    expect(buf.stats.resyncServed).toBe(1);
  });

  it("resync tracks buffered (not-ready) frames too", () => {
    const buf = new SubagentFrameBuffer();
    buf.buffer("subagents:started", frame("a", [1, 2, 3]));
    const snap = buf.resync("a");
    expect((snap!.data.details as { entries: unknown[] }).entries).toEqual([1, 2, 3]);
  });

  it("no-op for an unknown agent", () => {
    const buf = new SubagentFrameBuffer();
    expect(buf.resync("nope")).toBeUndefined();
    expect(buf.stats.resyncNoop).toBe(1);
    expect(buf.stats.resyncServed).toBe(0);
  });

  it("no-op for a finished (completed/failed) agent", () => {
    const buf = new SubagentFrameBuffer();
    buf.markForwarded("subagents:started", frame("a", [1]));
    buf.markForwarded("subagents:completed", frame("a", [1, 2]));
    expect(buf.resync("a")).toBeUndefined();
    expect(buf.stats.resyncNoop).toBe(1);
  });

  it("bounds retained snapshots to maxAgents (drop-oldest), keeping newest", () => {
    const buf = new SubagentFrameBuffer(2);
    // Three running agents forwarded live → snapshots must not exceed 2.
    buf.markForwarded("subagents:started", frame("a", [1]));
    buf.markForwarded("subagents:started", frame("b", [1]));
    buf.markForwarded("subagents:started", frame("c", [1])); // evicts oldest "a"
    expect(buf.resync("a")).toBeUndefined(); // oldest evicted
    expect(buf.resync("b")).toBeDefined();
    expect(buf.resync("c")).toBeDefined();
  });
});

describe("reset drops all retained state", () => {
  it("clears pending and snapshots", () => {
    const buf = new SubagentFrameBuffer();
    buf.buffer("subagents:started", frame("a", [1]));
    buf.markForwarded("subagents:started", frame("b", [1]));
    buf.reset();
    expect(buf.pendingSize).toBe(0);
    expect(buf.resync("a")).toBeUndefined();
    expect(buf.resync("b")).toBeUndefined();
  });
});
