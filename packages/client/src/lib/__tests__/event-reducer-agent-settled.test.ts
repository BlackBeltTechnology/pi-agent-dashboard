/**
 * Reducer idle-transition on `agent_settled` (the single terminal signal).
 *
 * `agent_end` sets the intermediate `"ended"`; only `agent_settled` (real on
 * pi ≥ 0.80.4, or bridge-synthesized on floor pi) resolves `"idle"`. The
 * existing `agent_end` side-effects (last-error extraction, retry / pending
 * clearing) are preserved; only the `status:"idle"` assignment moved.
 *
 * See change: adopt-pi-074-080-features (A.1 — F1, F2, F3, X2).
 */
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

let clock = 1000;
function ev(eventType: string, data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: clock++, data } as DashboardEvent;
}
function fold(events: DashboardEvent[], start: SessionState = createInitialState()): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), start);
}
/** Fold a whole batch, capturing the status after each step. */
function statusTrail(events: DashboardEvent[]): string[] {
  const trail: string[] = [];
  let s = createInitialState();
  for (const e of events) {
    s = reduceEvent(s, e);
    trail.push(s.status);
  }
  return trail;
}

describe("F1: no idle flicker across a retry (modern pi)", () => {
  it("stays non-idle after each agent_end until the final agent_settled", () => {
    const trail = statusTrail([
      ev("agent_start"),
      ev("agent_end", { messages: [] }),
      ev("auto_retry_start", { attempt: 1, maxAttempts: 3, delayMs: 10 }),
      ev("agent_start"),
      ev("agent_end", { messages: [] }),
      ev("agent_settled"),
    ]);
    // start, end, retry, start, end, settled
    expect(trail).toEqual([
      "streaming", // agent_start
      "ended", // agent_end (NOT idle)
      "ended", // auto_retry_start (unchanged)
      "streaming", // agent_start (retry)
      "ended", // agent_end
      "idle", // agent_settled — only now
    ]);
    // Never idle between the first agent_end and the retry agent_start.
    expect(trail.slice(1, 4)).not.toContain("idle");
  });
});

describe("F2: floor pi resolves idle equivalently to today", () => {
  it("agent_end + synthesized agent_settled in the same batch → idle", () => {
    // The bridge synthesizes the settle synchronously right after agent_end.
    const s = fold([ev("agent_start"), ev("agent_end", { messages: [] }), ev("agent_settled")]);
    expect(s.status).toBe("idle");
    expect(s.isStreaming).toBe(false);
  });
});

describe("F3: agent_end side-effects preserved (deferred only status:idle)", () => {
  it("extracts lastError and clears retryState/pendingPrompt on agent_end", () => {
    let s = createInitialState();
    s = reduceEvent(s, ev("agent_start"));
    // A pending prompt + in-flight retry state present before the terminal.
    s = { ...s, pendingPrompt: { text: "queued", status: "sending" }, retryState: { attempt: 1, maxAttempts: 3, delayMs: 5, reason: "x", startedAt: 1 } };
    s = reduceEvent(s, ev("agent_end", { messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom", content: [] }] }));
    // Side-effects happen on agent_end...
    expect(s.lastError).toMatchObject({ message: "boom" });
    expect(s.retryState).toBeUndefined();
    expect(s.pendingPrompt).toBeUndefined();
    // ...but only "ended" — idle is deferred to the settle.
    expect(s.status).toBe("ended");
    s = reduceEvent(s, ev("agent_settled"));
    expect(s.status).toBe("idle");
  });
});

describe("X2: illegal agent_settled with no preceding agent_end", () => {
  it("resolves idle and clears streaming without crashing", () => {
    let s = createInitialState();
    s = reduceEvent(s, ev("agent_start"));
    expect(s.status).toBe("streaming");
    // Settle arrives with no agent_end in between (illegal edge).
    s = reduceEvent(s, ev("agent_settled"));
    expect(s.status).toBe("idle");
    expect(s.isStreaming).toBe(false);
  });

  it("a bare agent_settled on a fresh state is a safe no-crash idle", () => {
    const s = reduceEvent(createInitialState(), ev("agent_settled"));
    expect(s.status).toBe("idle");
    expect(s.isStreaming).toBe(false);
  });
});
