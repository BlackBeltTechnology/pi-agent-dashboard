/**
 * Bridge abort-latch behaviour: a user abort must stop pi's in-flight retry
 * even across a provider backoff that outlives the 2 s persistent-abort
 * scheduler. The latch is abort-on-sight, cleared by a new user prompt or
 * turn settle.
 *
 * `LatchSim` mirrors the bridge wiring (see bridge.ts): abort sets the latch
 * and records the wrapper-abort; any observed resumption (assistant
 * message_start / agent_start) while latched issues a fresh cachedCtx.abort();
 * a new user prompt or agent_end clears the latch.
 *
 * See change: unify-error-retry-lifecycle.
 */
import { describe, it, expect } from "vitest";
import { AbortLatch } from "../abort-latch.js";

class LatchSim {
  /** Ordered log of cachedCtx.abort() invocations: "wrapper" (initial) | "latch" (re-abort). */
  readonly aborts: string[] = [];
  private latch = new AbortLatch();

  /** User pressed Stop/Dismiss → wrapper-abort once + latch on. */
  userAbort(sessionId: string): void {
    this.aborts.push("wrapper");
    this.latch.request(sessionId);
  }

  /** Bridge observes the aborted turn resuming (retry attempt). */
  resume(sessionId: string): void {
    if (this.latch.shouldAbort(sessionId)) this.aborts.push("latch");
  }

  /** A new user prompt is dispatched (deliberate new turn). */
  userPrompt(sessionId: string): void {
    this.latch.clear(sessionId);
  }

  /** The aborted turn settled (agent_end / idle). */
  settle(sessionId: string): void {
    this.latch.clear(sessionId);
  }

  isLatched(sessionId: string): boolean {
    return this.latch.isActive(sessionId);
  }
}

describe("AbortLatch", () => {
  it("re-aborts a retry that wakes after the 2 s scheduler window", () => {
    const sim = new LatchSim();
    sim.userAbort("s1");
    // ...30 s backoff elapses; the persistent-abort scheduler already stopped
    // after 2 s. pi wakes and attempts to continue the same aborted turn.
    sim.resume("s1");
    expect(sim.aborts).toEqual(["wrapper", "latch"]);
    expect(sim.isLatched("s1")).toBe(true); // still latched until settle / new prompt
  });

  it("re-aborts repeatedly across multiple resumption attempts", () => {
    const sim = new LatchSim();
    sim.userAbort("s1");
    sim.resume("s1");
    sim.resume("s1");
    expect(sim.aborts).toEqual(["wrapper", "latch", "latch"]);
  });

  it("clears on a new user prompt and does NOT kill the new turn", () => {
    const sim = new LatchSim();
    sim.userAbort("s1");
    sim.userPrompt("s1"); // deliberate new turn → clears latch
    sim.resume("s1"); // the new turn's first assistant message_start
    expect(sim.aborts).toEqual(["wrapper"]); // no latch re-abort
    expect(sim.isLatched("s1")).toBe(false);
  });

  it("clears on settle (agent_end / idle)", () => {
    const sim = new LatchSim();
    sim.userAbort("s1");
    sim.settle("s1");
    sim.resume("s1"); // a later, unrelated turn
    expect(sim.aborts).toEqual(["wrapper"]);
    expect(sim.isLatched("s1")).toBe(false);
  });

  it("latch is per-session — aborting s1 never re-aborts s2", () => {
    const sim = new LatchSim();
    sim.userAbort("s1");
    sim.resume("s2");
    expect(sim.aborts).toEqual(["wrapper"]);
  });

  it("does not re-abort when no abort was requested", () => {
    const sim = new LatchSim();
    sim.resume("s1");
    expect(sim.aborts).toEqual([]);
  });
});
