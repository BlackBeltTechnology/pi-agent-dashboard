/**
 * SubagentFrameBuffer — D1 buffer-and-flush + D2 resync unit coverage.
 * See change: fix-subagent-live-detail-reliability (tasks 4.3, 5.4).
 */
import { describe, expect, it } from "vitest";
import { SubagentFrameBuffer } from "../subagent-frame-buffer.js";

function frame(id: string, entries: unknown[] = []) {
  return { id, type: "Explore", description: "", details: { entries } };
}

/** A frame whose details carry the producer's v7 runner `agentSessionId`. */
function frameWithSession(id: string, agentSessionId: string, entries: unknown[] = []) {
  return { id, type: "Explore", description: "", details: { entries, agentSessionId } };
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

describe("D3 — resync resolves by either id (agentId or derived agentSessionId)", () => {
  it("agentSessionIdOf reads details.agentSessionId (undefined when absent)", () => {
    expect(SubagentFrameBuffer.agentSessionIdOf({ details: { agentSessionId: "S" } })).toBe("S");
    expect(SubagentFrameBuffer.agentSessionIdOf({ details: {} })).toBeUndefined();
    expect(SubagentFrameBuffer.agentSessionIdOf({})).toBeUndefined();
    expect(SubagentFrameBuffer.agentSessionIdOf(undefined)).toBeUndefined();
  });

  // X2: retained running snapshot for A with details.agentSessionId=S →
  // resync(S) returns it via the values-scan; resync(A) via the fast path.
  it("resolves a retained running snapshot by its derived agentSessionId (values-scan)", () => {
    const buf = new SubagentFrameBuffer();
    buf.markForwarded("subagents:started", frameWithSession("A", "S", [1, 2]));
    const byId = buf.resync("A");
    expect(byId).toBeDefined();
    expect(buf.stats.resyncByAgentId).toBe(1);
    const bySession = buf.resync("S");
    expect(bySession).toBeDefined();
    // state.id stays canonical (the agentId), even when resolved via the v7 id.
    expect(bySession!.data.id).toBe("A");
    expect(buf.stats.resyncByAgentSessionId).toBe(1);
    expect(buf.stats.resyncServed).toBe(2);
  });

  // X3: terminal frame removes A's snapshot → resync(A) and resync(S) both no-op.
  it("terminated run resolves to nothing by either id", () => {
    const buf = new SubagentFrameBuffer();
    buf.markForwarded("subagents:started", frameWithSession("A", "S", [1]));
    buf.markForwarded("subagents:completed", frameWithSession("A", "S", [1, 2]));
    expect(buf.resync("A")).toBeUndefined();
    expect(buf.resync("S")).toBeUndefined();
    expect(buf.stats.resyncNoop).toBe(2);
  });

  // X1 (bridge/frame-buffer half of graceful degrade): frames never carry
  // agentSessionId → no session-id resolution, no throw, agentId path intact.
  it("graceful degrade: frames without agentSessionId → resync(sessionId) no-ops, no throw", () => {
    const buf = new SubagentFrameBuffer();
    buf.markForwarded("subagents:started", frame("A", [1]));
    expect(buf.resync("A")).toBeDefined();
    expect(buf.resync("S")).toBeUndefined();
    expect(buf.stats.resyncByAgentSessionId).toBe(0);
  });

  // E5: 65 distinct running subagents (each with its own S), then complete →
  // the evicted first agentId and its S both no-op; retained ≤ 64; no separate
  // index retains completed runs by session id.
  it("adds no independent bound (BVA on 64) — session-id resolution inherits the snapshot bound", () => {
    const buf = new SubagentFrameBuffer(64);
    for (let i = 0; i < 65; i++) {
      buf.markForwarded("subagents:started", frameWithSession(`a${i}`, `s${i}`, [1]));
    }
    // The 65th insert evicted the oldest (a0/s0): retained running snapshots ≤ 64.
    expect(buf.resync("a0")).toBeUndefined();
    expect(buf.resync("s0")).toBeUndefined();
    expect(buf.resync("a64")).toBeDefined();
    expect(buf.resync("s64")).toBeDefined();
    expect(buf.stats.overflowEvicted).toBeGreaterThanOrEqual(1);
    // Complete every still-tracked run → no snapshot retained by either id.
    for (let i = 1; i < 65; i++) {
      buf.markForwarded("subagents:completed", frameWithSession(`a${i}`, `s${i}`, [1]));
    }
    expect(buf.resync("a64")).toBeUndefined();
    expect(buf.resync("s64")).toBeUndefined();
  });

  // P1: snapshots at the 64 cap, resync by a non-matching agentSessionId
  // (worst case: full scan, miss) → single call is cheap. The design intent is
  // sub-millisecond; the assertion uses a generous upper bound (25 ms) so a
  // 64-element scan (microseconds in practice) never false-fails under CI CPU
  // jitter / tick resolution, while still catching a pathological regression
  // (e.g. an accidental O(n²) or per-call allocation blow-up). CodeRabbit nit.
  it("derived scan is cheap on a full buffer (worst-case full-scan miss)", () => {
    const buf = new SubagentFrameBuffer(64);
    for (let i = 0; i < 64; i++) {
      buf.markForwarded("subagents:started", frameWithSession(`a${i}`, `s${i}`, [1]));
    }
    const t0 = performance.now();
    const snap = buf.resync("non-matching-session-id");
    const dt = performance.now() - t0;
    expect(snap).toBeUndefined();
    expect(dt).toBeLessThan(25);
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
