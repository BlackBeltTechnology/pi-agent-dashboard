import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryTracker, installPiAiDelayFn } from "../retry-tracker.js";

/**
 * Observe-based RetryTracker (corrected model — change:
 * retry-forever-with-stop-control). Retry state is derived by OBSERVING pi's
 * real event shape: one full `agent_start … agent_end` cycle per attempt, with
 * a single `agent_settled` as the sole terminal signal. No regex classifier.
 */
const ERR = "503: overloaded_error";
const errAssistant = { role: "assistant", stopReason: "error", errorMessage: ERR };
const errAgentEnd = { messages: [{ ...errAssistant }] };
const okAgentEnd = { messages: [{ role: "assistant", stopReason: "end_turn" }] };

describe("RetryTracker (observe-based, agent_end/agent_settled model)", () => {
  it("records an error message_end but emits NOTHING (waiting is decided at agent_end)", () => {
    const t = new RetryTracker();
    expect(t.observeMessageEnd("s1", { ...errAssistant })).toBeNull();
    // A recorded pending failure opens the chain, but nothing is emitted yet.
    expect(t.isRetrying("s1")).toBe(true);
  });

  it("emits a waiting signal on an error agent_end and does NOT clear the chain", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    const ev = t.observeAgentEnd("s1", errAgentEnd);
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_waiting");
    expect(ev!.data.attempt).toBe(1);
    expect(ev!.data.maxAttempts).toBe(3);
    expect(ev!.data.delayMs).toBe(2000); // baseDelayMs · 2^0
    expect(typeof ev!.data.nextAttemptAt).toBe("number");
    expect(ev!.data.errorMessage).toBe(ERR);
    expect(t.isRetrying("s1")).toBe(true);
  });

  it("emits auto_retry_start when the awaited retry attempt starts", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd); // arms the next attempt
    const ev = t.observeAgentStart("s1");
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_start");
    expect(ev!.data).toEqual({
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: ERR,
    });
  });

  it("does NOT emit auto_retry_start for the initial (unarmed) agent_start", () => {
    const t = new RetryTracker();
    expect(t.observeAgentStart("s1")).toBeNull();
  });

  // test-plan #6: a manual dashboard retry (retry_session / legacy sentinel)
  // disarms the chain via noteExplicitRun BEFORE its re-drive, so the manual
  // turn's native agent_start is NOT converted into a synthetic
  // auto_retry_start — no attempt counter renders for a user-initiated retry.
  // See change: replace-dashboard-retry-command-with-protocol-message.
  it("#6 an armed chain disarmed by noteExplicitRun yields no counter for the next agent_start", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd); // arms the next attempt
    expect(t.isRetrying("s1")).toBe(true);

    t.noteExplicitRun("s1"); // the disarm the bridge performs before a manual retry

    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentStart("s1")).toBeNull();
  });

  it("increments delay geometrically across the chain", () => {
    const t = new RetryTracker({ maxRetries: 5, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)!.data.delayMs).toBe(2000); // 2^0
    t.observeAgentStart("s1");
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)!.data.delayMs).toBe(4000); // 2^1
    t.observeAgentStart("s1");
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)!.data.delayMs).toBe(8000); // 2^2
  });

  it("suppresses the waiting signal once pi's budget is spent", () => {
    const t = new RetryTracker({ maxRetries: 2, baseDelayMs: 2000 });
    // attempt 1 → waiting
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)!.data.attempt).toBe(1);
    // attempt 2 → waiting
    t.observeAgentStart("s1");
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)!.data.attempt).toBe(2);
    // attempt 3 would exceed maxRetries:2 → no waiting signal
    t.observeAgentStart("s1");
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)).toBeNull();
    // chain still open until agent_settled
    expect(t.isRetrying("s1")).toBe(true);
  });

  it("emits NO waiting signal when retry.enabled is false (pi will not retry)", () => {
    const t = new RetryTracker({ enabled: false, maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    // pi never retries when disabled — a countdown would be a phantom.
    expect(t.observeAgentEnd("s1", errAgentEnd)).toBeNull();
    // The chain still opens so agent_settled can close it as a settled error.
    expect(t.isRetrying("s1")).toBe(true);
    const ev = t.observeAgentSettled("s1");
    expect(ev!.eventType).toBe("auto_retry_end");
    expect(ev!.data.success).toBe(false);
  });

  it("degrades to delayMs:0 (elapsed-only) when settings are unreadable", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 0 });
    t.observeMessageEnd("s1", { ...errAssistant });
    const ev = t.observeAgentEnd("s1", errAgentEnd)!;
    expect(ev.data.delayMs).toBe(0);
    expect(ev.data.nextAttemptAt).toBeUndefined();
  });

  it("saturates an overflowing exponential delay to pi's cap instead of Infinity", () => {
    // pi-ai `retryDelayMs` saturates an unsafe product to MAX_SAFE_INTEGER and
    // then caps it at maxAgentDelayMs (default 60000) — pi really sleeps 60 s,
    // so the countdown shows exactly that. See change: fix-retry-delay-cap.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      const t = new RetryTracker({ maxRetries: 3, baseDelayMs: Number.MAX_VALUE });
      t.observeMessageEnd("s1", { ...errAssistant });
      t.observeAgentEnd("s1", errAgentEnd);
      t.observeAgentStart("s1");
      t.observeMessageEnd("s1", { ...errAssistant });
      const ev = t.observeAgentEnd("s1", errAgentEnd)!;
      expect(ev.data.delayMs).toBe(60000);
      expect(ev.data.nextAttemptAt).toBe(1_700_000_000_000 + 60000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes with auto_retry_end{success:false,finalError} on a terminal error settle", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    const ev = t.observeAgentSettled("s1");
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_end");
    expect(ev!.data.success).toBe(false);
    expect(ev!.data.finalError).toBe(ERR);
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("closes with auto_retry_end{success:true} on a clean settle after retrying", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd); // retry armed
    t.observeAgentStart("s1"); // retry in flight
    t.observeAgentEnd("s1", okAgentEnd); // retry succeeded
    const ev = t.observeAgentSettled("s1");
    expect(ev!.eventType).toBe("auto_retry_end");
    expect(ev!.data.success).toBe(true);
  });

  it("agent_settled with no active chain emits nothing", () => {
    const t = new RetryTracker();
    expect(t.observeAgentSettled("s1")).toBeNull();
  });

  it("a non-error agent_end does not open or advance a chain", () => {
    const t = new RetryTracker();
    expect(t.observeAgentEnd("s1", okAgentEnd)).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("noteAbort clears the chain so a subsequent agent_settled does not double-emit", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.noteAbort("s1");
    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentSettled("s1")).toBeNull();
  });

  it("scopes retry state per-session", () => {
    const t = new RetryTracker();
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    expect(t.isRetrying("s1")).toBe(true);
    expect(t.isRetrying("s2")).toBe(false);
  });
});

/**
 * REGRESSION — pi's REAL observed event order (measured against pi 0.81.1).
 *
 * pi does NOT keep a retry chain inside one agent turn. Every attempt is a
 * complete `agent_start` … `agent_end` cycle, and exactly ONE `agent_settled`
 * fires after the final `agent_end`:
 *
 *   agent_start → message_end(error) → agent_end          attempt 1
 *   [sleep baseDelayMs · 2^0]
 *   agent_start → message_end(error) → agent_end          attempt 2
 *   [sleep baseDelayMs · 2^1]
 *   agent_start → message_end(error) → agent_end → agent_settled   TERMINAL
 *
 * The PREVIOUS tracker treated each `agent_end` as terminal and deleted the
 * pending failure, so `observeMessageStart` always short-circuited and NOTHING
 * was ever synthesized — the retry surface was dead in production.
 *
 * This test pins the real order so the next upstream shape change fails a test
 * instead of silently failing the product.
 *
 * See change: retry-forever-with-stop-control (design E2/E3, spec
 * `bridge-retry-observability`).
 */
describe("RetryTracker — pi's real event order (regression: zero-events defect)", () => {
  const errMsg = { role: "assistant", stopReason: "error", errorMessage: ERR };
  const agentEndErr = { messages: [{ ...errMsg }] };

  /** Drive N failing attempts in pi's real shape, then settle. Collect every event. */
  function runChain(t: RetryTracker, attempts: number) {
    const events: { eventType: string; data: Record<string, unknown> }[] = [];
    const collect = (r: unknown) => {
      if (!r) return;
      for (const e of Array.isArray(r) ? r : [r]) events.push(e as never);
    };
    for (let i = 0; i < attempts; i++) {
      collect(t.observeAgentStart?.("s1"));
      collect(t.observeMessageEnd("s1", { ...errMsg }));
      collect(t.observeAgentEnd("s1", agentEndErr));
    }
    collect(t.observeAgentSettled("s1"));
    return events;
  }

  it("synthesizes retry events for pi's agent_end-per-attempt sequence", () => {
    const t = new RetryTracker({ maxRetries: 10, baseDelayMs: 2000 });
    const events = runChain(t, 3);

    const starts = events.filter((e) => e.eventType === "auto_retry_start");
    const ends = events.filter((e) => e.eventType === "auto_retry_end");

    // The defect: today this is 0.
    expect(starts.length).toBeGreaterThanOrEqual(1);
    expect(ends).toHaveLength(1);
  });

  it("does NOT clear the chain on a non-terminal agent_end", () => {
    const t = new RetryTracker({ maxRetries: 10, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errMsg });
    t.observeAgentEnd("s1", agentEndErr);
    // agent_end is one attempt boundary, not the end of the lifecycle.
    expect(t.isRetrying("s1")).toBe(true);
  });

  it("treats agent_settled as the sole terminal signal", () => {
    const t = new RetryTracker({ maxRetries: 10, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errMsg });
    t.observeAgentEnd("s1", agentEndErr);
    t.observeAgentSettled("s1");
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("carries the real attempt/delay values, never the -1 sentinels", () => {
    const t = new RetryTracker({ maxRetries: 10, baseDelayMs: 2000 });
    const events = runChain(t, 3);
    const starts = events.filter((e) => e.eventType === "auto_retry_start");
    expect(starts.length).toBeGreaterThanOrEqual(1);
    for (const s of starts) {
      expect(s.data.maxAttempts).not.toBe(-1);
      expect(s.data.delayMs).not.toBe(-1);
      expect(s.data.errorMessage).toBe(ERR);
    }
  });
});

describe("RetryTracker — arms on the last ASSISTANT message, not the last array element", () => {
  // Regression: a turn can end with a non-assistant entry (e.g. a toolResult)
  // after the failed assistant message. The tracker must scan backward for the
  // last `role === "assistant"` message (matching pi's `_willRetryAfterAgentEnd`)
  // rather than inspecting only `messages[length-1]`, or it never arms and no
  // retry counting shows. See change: unify-retry-visibility.
  const errAssistantMsg = { role: "assistant", stopReason: "error", errorMessage: ERR };

  it("arms when the assistant error is followed by a toolResult entry", () => {
    const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ ...errAssistantMsg }, { role: "toolResult" }],
    });
    expect(ev).not.toBeNull();
    expect(ev!.eventType).toBe("auto_retry_waiting");
    expect(ev!.data.attempt).toBe(1);
    // The next agent_start then goes in-flight.
    const start = t.observeAgentStart("s1");
    expect(start!.eventType).toBe("auto_retry_start");
  });

  it("still treats a clean last assistant message as success (no arming)", () => {
    const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
    const ev = t.observeAgentEnd("s1", {
      messages: [{ role: "assistant", stopReason: "end_turn" }, { role: "toolResult" }],
    });
    expect(ev).toBeNull();
  });

  it("counts attempts 1 → 2 → 3 across three toolResult-trailed failures", () => {
    const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
    const trailed = () => ({ messages: [{ ...errAssistantMsg }, { role: "toolResult" }] });
    const attempts: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      if (i > 0) t.observeAgentStart("s1");
      attempts.push(t.observeAgentEnd("s1", trailed())!.data.attempt);
    }
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("a clean toolResult-trailed turn closes an ARMED chain successfully", () => {
    const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
    // Arm the chain with a trailed failure, then succeed with a trailed success.
    t.observeAgentEnd("s1", { messages: [{ ...errAssistantMsg }, { role: "toolResult" }] });
    t.observeAgentStart("s1");
    expect(
      t.observeAgentEnd("s1", {
        messages: [{ role: "assistant", stopReason: "stop" }, { role: "toolResult" }],
      }),
    ).toBeNull();
    const end = t.observeAgentSettled("s1");
    expect(end!.eventType).toBe("auto_retry_end");
    expect(end!.data.success).toBe(true);
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("arms nothing when no entry carries an assistant role", () => {
    const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
    expect(
      t.observeAgentEnd("s1", {
        messages: [{ role: "toolResult", stopReason: "error" }, { role: "user" }],
      }),
    ).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentStart("s1")).toBeNull();
  });

  it("a missing assistant message is NO disposition — it never closes an ACTIVE chain as success", () => {
    // Regression: `isError` is false both when the last assistant message is
    // clean AND when there is no assistant message at all. Collapsing those two
    // cases let a payload carrying no disposition mark a live retry chain
    // successful, so `agent_settled` reported success for a turn that never
    // succeeded. See change: raw-error-render-and-retry-authority.
    const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
    // Arm a chain with a real failure.
    expect(t.observeAgentEnd("s1", { messages: [{ ...errAssistantMsg }] })).not.toBeNull();
    expect(t.isRetrying("s1")).toBe(true);
    // A payload with no assistant entry must leave the chain's disposition alone.
    expect(t.observeAgentEnd("s1", { messages: [{ role: "toolResult" }] })).toBeNull();
    expect(t.isRetrying("s1")).toBe(true);
    const end = t.observeAgentSettled("s1");
    expect(end!.eventType).toBe("auto_retry_end");
    expect(end!.data.success).toBe(false);
  });

  it("an empty / absent messages array is likewise no disposition", () => {
    for (const payload of [{ messages: [] }, {}, null]) {
      const t = new RetryTracker({ maxRetries: 20, baseDelayMs: 2000 });
      t.observeAgentEnd("s1", { messages: [{ ...errAssistantMsg }] });
      t.observeAgentEnd("s1", payload as { messages?: unknown } | null);
      const end = t.observeAgentSettled("s1")!;
      expect(end.data.success).toBe(false);
      expect(end.data.finalError).toBe(ERR);
    }
  });
});

describe("RetryTracker — terminal convergence", () => {
  it("E1/X1 automatic continuation succeeds on clean assistant message_end without a user message", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.observeAgentStart("s1");

    const end = t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "toolUse",
    });

    expect(end).toEqual({
      eventType: "auto_retry_end",
      data: { success: true, attempt: 1 },
    });
    expect(t.isRetrying("s1")).toBe(false);
    expect(t.observeAgentEnd("s1", okAgentEnd)).toBeNull();
    expect(t.observeAgentSettled("s1")).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["non-string", 42 as unknown as string],
  ])("does not close an active chain when message_end has a %s stopReason", (_label, stopReason) => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.observeAgentStart("s1");

    expect(t.observeMessageEnd("s1", { role: "assistant", stopReason })).toBeNull();
    expect(t.isRetrying("s1")).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-string", 42 as unknown as string],
  ])("does not mark agent_end with a %s stopReason as successful disposition", (_label, stopReason) => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.observeAgentStart("s1");

    expect(t.observeAgentEnd("s1", { messages: [{ role: "assistant", stopReason }] })).toBeNull();
    expect(t.observeAgentSettled("s1")).toEqual({
      eventType: "auto_retry_end",
      data: { success: false, attempt: 1, finalError: ERR },
    });
  });

  it("E2/X2 repeated assistant errors retain the latest provider error until exhaustion", () => {
    const t = new RetryTracker({ maxRetries: 1, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.observeAgentStart("s1");
    t.observeMessageEnd("s1", {
      role: "assistant",
      stopReason: "error",
      errorMessage: "504: second failure",
    });
    expect(
      t.observeAgentEnd("s1", {
        messages: [{ role: "assistant", stopReason: "error", errorMessage: "504: second failure" }],
      }),
    ).toBeNull();

    expect(t.observeAgentSettled("s1")).toEqual({
      eventType: "auto_retry_end",
      data: { success: false, attempt: 2, finalError: "504: second failure" },
    });
  });

  it("E3 aborted assistant completion is neither recovery nor another retry", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.observeAgentStart("s1");

    expect(t.observeMessageEnd("s1", { role: "assistant", stopReason: "aborted" })).toEqual({
      eventType: "auto_retry_end",
      data: { success: false, attempt: -1 },
    });
    expect(t.observeAgentEnd("s1", { messages: [{ role: "assistant", stopReason: "aborted" }] })).toBeNull();
    expect(t.observeAgentStart("s1")).toBeNull();
    expect(t.observeAgentSettled("s1")?.data.success).not.toBe(true);
  });

  it("X3/X4 abort tombstone suppresses delayed cancelled-chain events", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    t.noteAbort("s1");

    expect(t.observeAgentStart("s1")).toBeNull();
    expect(t.observeMessageEnd("s1", { ...errAssistant })).toBeNull();
    expect(t.observeAgentEnd("s1", errAgentEnd)).toBeNull();
    expect(t.observeAgentSettled("s1")).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("F5: the retry chain closes exactly ONCE on the native agent_settled", () => {
    // pi's real order with NO floor-pi synthesis: agent_end(error) → waiting,
    // then agent_start → in-flight, then agent_end(ok), then the single native
    // agent_settled terminates the chain.
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.observeAgentEnd("s1", errAgentEnd)!.eventType).toBe("auto_retry_waiting");
    expect(t.observeAgentStart("s1")!.eventType).toBe("auto_retry_start");
    expect(t.observeAgentEnd("s1", okAgentEnd)).toBeNull();

    const end = t.observeAgentSettled("s1");
    expect(end!.eventType).toBe("auto_retry_end");
    expect(end!.data.success).toBe(true);
    // The sole terminal signal fires once — a second settle is a no-op.
    expect(t.observeAgentSettled("s1")).toBeNull();
    expect(t.isRetrying("s1")).toBe(false);
  });

  it("X4 a new explicit run releases abort suppression", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    t.noteAbort("s1");
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.isRetrying("s1")).toBe(false);

    t.noteExplicitRun("s1");
    t.observeMessageEnd("s1", { ...errAssistant });
    expect(t.isRetrying("s1")).toBe(true);
  });
});

/**
 * Capped delay — pi-ai `retryDelayMs` caps every agent-level wait at
 * `retry.maxAgentDelayMs` (default 60000). The emitted countdown must never
 * outrun pi's real sleep. See change: fix-retry-delay-cap.
 */
describe("RetryTracker — delay is capped at maxAgentDelayMs (fix-retry-delay-cap)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drive `n` failed attempts; return the waiting event of the n-th. */
  function waitingAt(t: RetryTracker, n: number) {
    let ev = null as ReturnType<RetryTracker["observeAgentEnd"]>;
    for (let i = 0; i < n; i++) {
      if (i > 0) t.observeAgentStart("s1");
      t.observeMessageEnd("s1", { ...errAssistant });
      ev = t.observeAgentEnd("s1", errAgentEnd);
    }
    return ev;
  }

  it("caps attempt 10 at the 60000 default (test-plan #E1)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const t = new RetryTracker({ maxRetries: 11, baseDelayMs: 2700 });
    const ev = waitingAt(t, 10);
    expect(ev!.eventType).toBe("auto_retry_waiting");
    expect(ev!.data.attempt).toBe(10);
    expect(ev!.data.delayMs).toBe(60000);
    expect(ev!.data.nextAttemptAt).toBe(1_700_000_000_000 + 60000);
  });

  it("honors a configured cap below, at and above the curve (test-plan #E2)", () => {
    const t = new RetryTracker({ maxRetries: 5, baseDelayMs: 2000, maxAgentDelayMs: 5000 });
    const delays: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      if (i > 0) t.observeAgentStart("s1");
      t.observeMessageEnd("s1", { ...errAssistant });
      delays.push(t.observeAgentEnd("s1", errAgentEnd)!.data.delayMs);
    }
    expect(delays).toEqual([2000, 4000, 5000, 5000]);
  });

  it("degrades a negative cap to elapsed-only (test-plan #E3)", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: -1 });
    const ev = waitingAt(t, 1);
    expect(ev!.data.delayMs).toBe(0);
    expect(ev!.data.nextAttemptAt).toBe(undefined);
  });

  it("never consults the delay fn when the base is unknown (test-plan #E4)", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 0 });
    const fn = vi.fn(() => 999);
    t.setDelayFn(fn);
    const ev = waitingAt(t, 1);
    expect(ev!.data.delayMs).toBe(0);
    expect(fn).not.toHaveBeenCalled();
  });

  it("a zero cap yields an elapsed-only wait (test-plan #E5)", () => {
    const t = new RetryTracker({ maxRetries: 5, baseDelayMs: 2000, maxAgentDelayMs: 0 });
    const ev = waitingAt(t, 3);
    expect(ev!.data.delayMs).toBe(0);
    expect(ev!.data.nextAttemptAt).toBe(undefined);
  });

  it("uses an installed delay fn with pi's policy shape", () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 9000 });
    const fn = vi.fn(() => 1234);
    t.setDelayFn(fn);
    expect(waitingAt(t, 1)!.data.delayMs).toBe(1234);
    expect(fn).toHaveBeenCalledWith({ baseDelayMs: 2000, maxAgentDelayMs: 9000 }, 1);
  });

  it("falls back to the local formula when the delay fn throws (test-plan #X1)", () => {
    const t = new RetryTracker({ maxRetries: 5, baseDelayMs: 2000, maxAgentDelayMs: 60000 });
    t.setDelayFn(() => {
      throw new Error("boom");
    });
    // A throw escaping observeAgentEnd fails this test outright.
    const ev = waitingAt(t, 3);
    expect(ev!.data.delayMs).toBe(8000);
  });

  it("guards bad delay fn results (test-plan #X2)", () => {
    const run = (value: unknown) => {
      const t = new RetryTracker({ maxRetries: 5, baseDelayMs: 2000, maxAgentDelayMs: 60000 });
      t.setDelayFn(() => value as number);
      return waitingAt(t, 2)!.data.delayMs;
    };
    expect(run(Number.NaN)).toBe(4000);
    expect(run("5")).toBe(4000);
    expect(run(-5)).toBe(0);
  });
});

describe("installPiAiDelayFn — optional pi-ai peer (fix-retry-delay-cap)", () => {
  it("swallows a rejected import and keeps the local fallback (test-plan #X3)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (r: unknown) => unhandled.push(r);
    process.on("unhandledRejection", onUnhandled);
    try {
      const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
      installPiAiDelayFn(t, () => Promise.reject(new Error("no pi-ai")));
      await new Promise((r) => setTimeout(r, 10));
      t.observeMessageEnd("s1", { ...errAssistant });
      expect(t.observeAgentEnd("s1", errAgentEnd)!.data.delayMs).toBe(2000);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("installs pi-ai's retryDelayMs once the import resolves (test-plan #X4)", async () => {
    const spy = vi.fn(() => 2000);
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000 });
    installPiAiDelayFn(t, () => new Promise((r) => setTimeout(() => r({ retryDelayMs: spy }), 0)));
    await new Promise((r) => setTimeout(r, 10));
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentEnd("s1", errAgentEnd);
    expect(spy).toHaveBeenCalledWith({ baseDelayMs: 2000, maxAgentDelayMs: 60000 }, 1);
  });

  it("ignores a module without a retryDelayMs function", async () => {
    const t = new RetryTracker({ maxRetries: 3, baseDelayMs: 2000, maxAgentDelayMs: 3000 });
    installPiAiDelayFn(t, () => Promise.resolve({}));
    await new Promise((r) => setTimeout(r, 10));
    t.observeMessageEnd("s1", { ...errAssistant });
    t.observeAgentStart("s1");
    t.observeAgentEnd("s1", errAgentEnd);
    t.observeAgentStart("s1");
    expect(t.observeAgentEnd("s1", errAgentEnd)!.data.delayMs).toBe(3000);
  });
});
