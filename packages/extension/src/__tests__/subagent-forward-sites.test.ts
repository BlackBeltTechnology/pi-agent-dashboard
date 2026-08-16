/**
 * D2 strip PLACEMENT — the two `sendEventForward` call sites that bypass the
 * EventBus path. There is no single chokepoint: a strip inside
 * `sendEventForward` would destroy the resync reply (X6), while a bus-path-only
 * strip would leak every buffered frame fat (X5). These helpers ARE the
 * allowlist, so they are where placement is pinned.
 *
 * See change: reduce-subagent-details-payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushBufferedSubagentFrames, serveSubagentResync } from "../subagent-forward-sites.js";
import { SubagentFrameBuffer } from "../subagent-frame-buffer.js";

type Sent = { channel: string; data: Record<string, unknown> };

function runningFrame(agentId: string, entryCount = 12): Record<string, unknown> {
  return {
    id: agentId,
    details: {
      agentId,
      status: "running",
      description: "explore",
      entries: Array.from({ length: entryCount }, (_, i) => ({
        kind: "text",
        text: `step ${i}`,
        ts: 1000 + i,
      })),
    },
  };
}

const entriesOf = (data: Record<string, unknown>): unknown[] | undefined =>
  (data.details as Record<string, unknown> | undefined)?.entries as unknown[] | undefined;

describe("subagent forward call sites", () => {
  let sent: Sent[];
  const send = (channel: string, data: Record<string, unknown>) => {
    sent.push({ channel, data });
  };

  beforeEach(() => {
    sent = [];
    delete process.env.PI_DASHBOARD_SUBAGENT_STRIP;
  });

  describe("X5: flushBufferedSubagentFrames", () => {
    it("strips drained intermediate frames", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.buffer("subagents:started", runningFrame("ag1"));
      buffer.buffer("subagents:started", runningFrame("ag2"));

      const flushed = flushBufferedSubagentFrames(buffer, send);

      expect(flushed).toBe(2);
      expect(sent).toHaveLength(2);
      for (const s of sent) expect(entriesOf(s.data)).toBeUndefined();
    });

    it("keeps the retained snapshot fat so a later resync still answers in full", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.buffer("subagents:started", runningFrame("ag1"));
      flushBufferedSubagentFrames(buffer, send);
      expect(entriesOf(buffer.resync("ag1")!.data)).toHaveLength(12);
    });

    it("forwards terminal frames untouched", () => {
      const buffer = new SubagentFrameBuffer();
      const done = runningFrame("ag1");
      (done.details as Record<string, unknown>).status = "completed";
      buffer.buffer("subagents:started", done);
      flushBufferedSubagentFrames(buffer, send);
      expect(entriesOf(sent[0].data)).toHaveLength(12);
    });

    it("is a no-op on an empty buffer and keeps flushing past a send failure", () => {
      const buffer = new SubagentFrameBuffer();
      expect(flushBufferedSubagentFrames(buffer, send)).toBe(0);

      buffer.buffer("subagents:started", runningFrame("ag1"));
      buffer.buffer("subagents:started", runningFrame("ag2"));
      const throwOnce = vi
        .fn<(c: string, d: Record<string, unknown>) => void>()
        .mockImplementationOnce(() => {
          throw new Error("transport closed");
        });
      expect(() => flushBufferedSubagentFrames(buffer, throwOnce)).not.toThrow();
      expect(throwOnce).toHaveBeenCalledTimes(2);
    });
  });

  describe("X6: serveSubagentResync", () => {
    it("replies with the FULL timeline for a RUNNING agent — never stripped", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.markForwarded("subagents:started", runningFrame("ag1"));

      const served = serveSubagentResync(buffer, "ag1", send, () => true);

      expect(served).toBe("ag1");
      expect(sent).toHaveLength(1);
      expect(sent[0].channel).toBe("subagents:started");
      expect(entriesOf(sent[0].data)).toHaveLength(12);
    });

    it("stays fat even with the strip flag ON (the flag must not reach this site)", () => {
      process.env.PI_DASHBOARD_SUBAGENT_STRIP = "1";
      const buffer = new SubagentFrameBuffer();
      buffer.markForwarded("subagents:started", runningFrame("ag1"));
      serveSubagentResync(buffer, "ag1", send, () => true);
      expect(entriesOf(sent[0].data)).toHaveLength(12);
    });

    // X2 — bridge unavailable: a retryable no-op, never a wrong or
    // permanently-empty render.
    it("X2: sends nothing when the bridge is not ready/active, leaving state recoverable", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.markForwarded("subagents:started", runningFrame("ag1"));

      expect(serveSubagentResync(buffer, "ag1", send, () => false)).toBeUndefined();
      expect(sent).toHaveLength(0);
      // Retryable: the snapshot is still there, so a later request succeeds.
      expect(serveSubagentResync(buffer, "ag1", send, () => true)).toBe("ag1");
      expect(entriesOf(sent[0].data)).toHaveLength(12);
    });

    // X3 / C3 — an agent evicted from the bounded snapshot map answers with an
    // explicit resyncNoop; the client keeps its last state.
    it("X3: an evicted RUNNING agent yields a resyncNoop, not a corrupt or empty frame", () => {
      const buffer = new SubagentFrameBuffer(2);
      buffer.markForwarded("subagents:started", runningFrame("ag1")); // evicted below
      buffer.markForwarded("subagents:started", runningFrame("ag2"));
      buffer.markForwarded("subagents:started", runningFrame("ag3"));
      expect(buffer.stats.overflowEvicted).toBe(1);

      const before = buffer.stats.resyncNoop;
      expect(serveSubagentResync(buffer, "ag1", send, () => true)).toBeUndefined();
      expect(sent).toHaveLength(0); // nothing sent → client keeps its last state
      expect(buffer.stats.resyncNoop).toBe(before + 1);

      // A surviving agent is unaffected by the eviction.
      expect(serveSubagentResync(buffer, "ag3", send, () => true)).toBe("ag3");
    });

    it("9.4: counts a cadence-driven request separately from an open-driven one", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.markForwarded("subagents:started", runningFrame("ag1"));

      serveSubagentResync(buffer, "ag1", send, () => true, "r1", "open");
      serveSubagentResync(buffer, "ag1", send, () => true, "r2", "cadence");
      serveSubagentResync(buffer, "ag1", send, () => true, "r3", "cadence");

      expect(buffer.stats.resyncRequests).toBe(3);
      expect(buffer.stats.resyncCadence).toBe(2);
    });

    it("C5: echoes the requester's correlation token onto the reply, without touching the snapshot", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.markForwarded("subagents:started", runningFrame("ag1"));

      serveSubagentResync(buffer, "ag1", send, () => true, "req-1");

      expect(sent[0].data.__resyncRequestId).toBe("req-1");
      // The retained snapshot must stay a clean frame.
      expect(buffer.resync("ag1")!.data.__resyncRequestId).toBeUndefined();
    });

    it("C5: omits the token when the client sent none (older client → broadcast path)", () => {
      const buffer = new SubagentFrameBuffer();
      buffer.markForwarded("subagents:started", runningFrame("ag1"));
      serveSubagentResync(buffer, "ag1", send, () => true);
      expect(sent[0].data.__resyncRequestId).toBeUndefined();
    });

    it("resolves a v7 agentSessionId as well as the v4 agentId", () => {
      const buffer = new SubagentFrameBuffer();
      const frame = runningFrame("ag1");
      (frame.details as Record<string, unknown>).agentSessionId = "sess-7";
      buffer.markForwarded("subagents:started", frame);

      expect(serveSubagentResync(buffer, "sess-7", send, () => true)).toBe("ag1");
      expect(entriesOf(sent[0].data)).toHaveLength(12);
    });
  });

  // X7 — reset() on session change / bridge takeover mid-run.
  it("X7: after reset() a running agent's resync is an explicit noop, not a stale frame", () => {
    const buffer = new SubagentFrameBuffer();
    buffer.markForwarded("subagents:started", runningFrame("ag1"));
    buffer.reset();

    const before = buffer.stats.resyncNoop;
    expect(serveSubagentResync(buffer, "ag1", send, () => true)).toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(buffer.stats.resyncNoop).toBe(before + 1);
    // Documented limitation: recovery for that run comes from the next producer
    // frame (which re-tracks the agent), or from the terminal frame at the end.
    buffer.markForwarded("subagents:started", runningFrame("ag1"));
    expect(serveSubagentResync(buffer, "ag1", send, () => true)).toBe("ag1");
  });
});
