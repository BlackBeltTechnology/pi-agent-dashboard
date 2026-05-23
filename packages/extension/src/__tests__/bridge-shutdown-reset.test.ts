/**
 * Tests for the bridge's shutdown-time shadow-queue reset.
 *
 * Pure-model mirror of bridge.ts:786 `shutdown` extension command. If
 * production drifts from this shape, this test drifts in lockstep.
 *
 * Spec: openspec/specs/mid-turn-prompt-queue/spec.md — requirement
 * "Session shutdown resets shadow queues and clears pi's native queues"
 * (added by change reset-shadow-queues-on-shutdown).
 *
 * See change: reset-shadow-queues-on-shutdown.
 */
import { describe, it, expect, vi } from "vitest";

interface ShadowQueue {
  steering: string[];
  followUp: string[];
}

type QueueUpdateEmit = { steering: string[]; followUp: string[] };

interface PiLike {
  clearSteeringQueue?: () => void;
  clearFollowUpQueue?: () => void;
}

interface CachedCtxLike {
  shutdown?: () => void;
}

/**
 * Pure version of the shutdown extension command. Mirrors bridge.ts
 * 1:1 — defensive pi clears (unconditional), conditional shadow reset
 * + emit, then cachedCtx.shutdown, then process.exit safety net.
 */
function makeShutdown(opts: {
  pi: PiLike;
  cachedCtx: CachedCtxLike | null;
  queue: ShadowQueue;
  onEmit: (snapshot: QueueUpdateEmit) => void;
  onProcessExit: () => void;
  callLog: string[];
}) {
  return () => {
    try {
      if (typeof opts.pi.clearSteeringQueue === "function") {
        opts.callLog.push("pi.clearSteeringQueue");
        opts.pi.clearSteeringQueue();
      }
    } catch {
      // swallow — teardown must not throw
    }
    try {
      if (typeof opts.pi.clearFollowUpQueue === "function") {
        opts.callLog.push("pi.clearFollowUpQueue");
        opts.pi.clearFollowUpQueue();
      }
    } catch {
      // swallow
    }
    if (opts.queue.steering.length > 0 || opts.queue.followUp.length > 0) {
      opts.queue.steering = [];
      opts.queue.followUp = [];
      opts.callLog.push("emitQueueUpdate");
      opts.onEmit({ steering: [], followUp: [] });
    }
    if (opts.cachedCtx?.shutdown) {
      opts.callLog.push("cachedCtx.shutdown");
      opts.cachedCtx.shutdown();
    }
    opts.callLog.push("setTimeout(process.exit)");
    opts.onProcessExit();
  };
}

describe("bridge shutdown: shadow-queue reset", () => {
  it("non-empty steering: resets shadow, emits one final queue_update with empty arrays", () => {
    const queue: ShadowQueue = { steering: ["focus on X"], followUp: [] };
    const onEmit = vi.fn();
    const callLog: string[] = [];
    const pi: PiLike = { clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };
    const cachedCtx: CachedCtxLike = { shutdown: vi.fn() };

    makeShutdown({ pi, cachedCtx, queue, onEmit, onProcessExit: vi.fn(), callLog })();

    expect(queue.steering).toEqual([]);
    expect(queue.followUp).toEqual([]);
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(onEmit).toHaveBeenCalledWith({ steering: [], followUp: [] });
  });

  it("non-empty followUp: resets shadow, emits one final queue_update", () => {
    const queue: ShadowQueue = { steering: [], followUp: ["run tests when done"] };
    const onEmit = vi.fn();
    const pi: PiLike = { clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };
    const cachedCtx: CachedCtxLike = { shutdown: vi.fn() };

    makeShutdown({ pi, cachedCtx, queue, onEmit, onProcessExit: vi.fn(), callLog: [] })();

    expect(queue).toEqual({ steering: [], followUp: [] });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("both queues non-empty: emits exactly once (not twice)", () => {
    const queue: ShadowQueue = { steering: ["a", "b"], followUp: ["c"] };
    const onEmit = vi.fn();
    const pi: PiLike = { clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };

    makeShutdown({
      pi,
      cachedCtx: { shutdown: vi.fn() },
      queue,
      onEmit,
      onProcessExit: vi.fn(),
      callLog: [],
    })();

    expect(queue).toEqual({ steering: [], followUp: [] });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("both queues empty: does NOT emit queue_update, still calls pi.clear* defensively", () => {
    const queue: ShadowQueue = { steering: [], followUp: [] };
    const onEmit = vi.fn();
    const clearSteer = vi.fn();
    const clearFollow = vi.fn();
    const pi: PiLike = { clearSteeringQueue: clearSteer, clearFollowUpQueue: clearFollow };

    makeShutdown({
      pi,
      cachedCtx: { shutdown: vi.fn() },
      queue,
      onEmit,
      onProcessExit: vi.fn(),
      callLog: [],
    })();

    expect(onEmit).not.toHaveBeenCalled();
    // Defensive clears run unconditionally — pi's queues may be non-empty
    // from non-dashboard sources.
    expect(clearSteer).toHaveBeenCalledTimes(1);
    expect(clearFollow).toHaveBeenCalledTimes(1);
  });

  it("pi missing clearSteeringQueue / clearFollowUpQueue: still resets shadow + emits + does not throw", () => {
    const queue: ShadowQueue = { steering: ["a"], followUp: ["b"] };
    const onEmit = vi.fn();
    const pi: PiLike = {}; // both functions absent — pi version skew
    const cachedCtx: CachedCtxLike = { shutdown: vi.fn() };

    expect(() => {
      makeShutdown({ pi, cachedCtx, queue, onEmit, onProcessExit: vi.fn(), callLog: [] })();
    }).not.toThrow();

    expect(queue).toEqual({ steering: [], followUp: [] });
    expect(onEmit).toHaveBeenCalledTimes(1);
  });

  it("pi.clearSteeringQueue throws: teardown continues (shadow still reset, emit still fires, cachedCtx.shutdown still called)", () => {
    const queue: ShadowQueue = { steering: ["a"], followUp: [] };
    const onEmit = vi.fn();
    const cachedShutdown = vi.fn();
    const pi: PiLike = {
      clearSteeringQueue: () => {
        throw new Error("boom");
      },
      clearFollowUpQueue: vi.fn(),
    };

    expect(() => {
      makeShutdown({
        pi,
        cachedCtx: { shutdown: cachedShutdown },
        queue,
        onEmit,
        onProcessExit: vi.fn(),
        callLog: [],
      })();
    }).not.toThrow();

    expect(queue).toEqual({ steering: [], followUp: [] });
    expect(onEmit).toHaveBeenCalledTimes(1);
    expect(cachedShutdown).toHaveBeenCalledTimes(1);
  });

  it("order of operations: pi.clearSteeringQueue → pi.clearFollowUpQueue → emitQueueUpdate → cachedCtx.shutdown → process.exit", () => {
    const queue: ShadowQueue = { steering: ["a"], followUp: ["b"] };
    const callLog: string[] = [];
    const pi: PiLike = { clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };
    const cachedCtx: CachedCtxLike = { shutdown: vi.fn() };

    makeShutdown({ pi, cachedCtx, queue, onEmit: vi.fn(), onProcessExit: vi.fn(), callLog })();

    expect(callLog).toEqual([
      "pi.clearSteeringQueue",
      "pi.clearFollowUpQueue",
      "emitQueueUpdate",
      "cachedCtx.shutdown",
      "setTimeout(process.exit)",
    ]);
  });

  it("safety-net: cachedCtx.shutdown still called and process.exit scheduled when shadows are empty", () => {
    const queue: ShadowQueue = { steering: [], followUp: [] };
    const cachedShutdown = vi.fn();
    const onProcessExit = vi.fn();
    const pi: PiLike = { clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };

    makeShutdown({
      pi,
      cachedCtx: { shutdown: cachedShutdown },
      queue,
      onEmit: vi.fn(),
      onProcessExit,
      callLog: [],
    })();

    expect(cachedShutdown).toHaveBeenCalledTimes(1);
    expect(onProcessExit).toHaveBeenCalledTimes(1);
  });

  it("safety-net: process.exit scheduled even when cachedCtx is null", () => {
    const queue: ShadowQueue = { steering: ["a"], followUp: [] };
    const onProcessExit = vi.fn();
    const pi: PiLike = { clearSteeringQueue: vi.fn(), clearFollowUpQueue: vi.fn() };

    makeShutdown({
      pi,
      cachedCtx: null,
      queue,
      onEmit: vi.fn(),
      onProcessExit,
      callLog: [],
    })();

    expect(onProcessExit).toHaveBeenCalledTimes(1);
  });
});
