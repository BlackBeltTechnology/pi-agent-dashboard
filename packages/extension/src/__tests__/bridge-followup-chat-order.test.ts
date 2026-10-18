/**
 * Bridge wire-ordering invariant for drained queued user messages.
 *
 * Applies to BOTH drain boundaries:
 *   - Steer drain at `turn_end`     (Enter while streaming)
 *   - Follow-up drain at `agent_settled` (Alt+Enter while streaming)
 *
 * Pi emits four events synchronously back-to-back at the drain boundary:
 *
 *   1. message_end   (assistant — the final response of the just-completed turn)
 *   2. turn_end OR agent_settled (the drain boundary)
 *   3. message_start (user — the drained steer or follow-up text, e.g. "asd")
 *   4. message_end   (user — same text)
 *
 * Pre-fix bug: the bridge defers `message_end` sends via `setTimeout(0)`
 * (for entryId capture per `fix-per-message-fork`) but sends `message_start`
 * synchronously. The drained user `message_start` therefore lands on the
 * wire BEFORE the preceding assistant `message_end`. The client's reducer
 * appends the user message to `state.messages[]` at `message_start`, then
 * the assistant message at the (later) `message_end` — so the chat shows
 * the follow-up "asd" ABOVE the assistant's final response.
 *
 * Fix: defer user `message_start` sends via the same `setTimeout(0)`. All
 * user-role messages are queued in the timer FIFO behind any pending
 * `message_end` deferrals, preserving pi's emit order on the wire.
 *
 * Assistant `message_start` MUST stay sync — `message_update` events fire
 * sync and depend on the reducer having seen `message_start` first (to
 * reset `streamingTextFlushed`).
 *
 * See changes: add-followup-edit-and-steer-cancel (chat-order scenario),
 * update-pi-core-1-3-adopt-apis (the follow-up drain boundary is agent_settled).
 */

import { describe, it, expect } from "vitest";

interface WireEvent {
  eventType: string;
  role?: "user" | "assistant";
  content?: string;
}

/**
 * Simulates the bridge's event-forwarding pipeline with the new
 * deferral rule applied to USER message_start. Runs everything in
 * a single synchronous tick to mirror pi's emit cadence, then drains
 * the macrotask queue to capture the final wire order.
 */
class BridgeSim {
  readonly wire: WireEvent[] = [];

  onMessageStart(role: "user" | "assistant", content: string): void {
    if (role === "user") {
      // FIX: defer user message_start to match message_end's deferral.
      setTimeout(() => {
        this.wire.push({ eventType: "message_start", role, content });
      }, 0);
      return;
    }
    // Assistant message_start sent sync (message_update depends on it).
    this.wire.push({ eventType: "message_start", role, content });
  }

  onMessageEnd(role: "user" | "assistant", content: string): void {
    // Existing behaviour: ALL message_end sends are deferred via setTimeout(0)
    // for entryId capture (fix-per-message-fork).
    setTimeout(() => {
      this.wire.push({ eventType: "message_end", role, content });
    }, 0);
  }

  onAgentSettled(): void {
    // Sent sync.
    this.wire.push({ eventType: "agent_settled" });
  }

  onTurnEnd(): void {
    // Sent sync (mirrors agent_settled).
    this.wire.push({ eventType: "turn_end" });
  }

  /** Flush pending setTimeout(0) callbacks. */
  async flush(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // Two extra ticks in case any callback re-queues.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

describe("Bridge drained-followup chat-order invariant", () => {
  it("user message_start for drained follow-up lands AFTER preceding assistant message_end", async () => {
    const sim = new BridgeSim();

    // Pi's sync emit order at agent_settled with a queued follow-up:
    //   1. assistant message_end (the weather report)
    //   2. agent_settled
    //   3. user message_start ("asd" — the drained follow-up)
    //   4. user message_end ("asd")
    sim.onMessageEnd("assistant", "weather report");
    sim.onAgentSettled();
    sim.onMessageStart("user", "asd");
    sim.onMessageEnd("user", "asd");

    await sim.flush();

    const types = sim.wire.map((e) => `${e.eventType}:${e.role ?? "-"}`);
    // Expected wire order after the fix:
    //   1. agent_settled             (sync, fires first)
    //   2. assistant message_end     (deferred, FIFO #1)
    //   3. user message_start        (deferred, FIFO #2 — after the fix)
    //   4. user message_end          (deferred, FIFO #3)
    expect(types).toEqual([
      "agent_settled:-",
      "message_end:assistant",
      "message_start:user",
      "message_end:user",
    ]);

    // Critical invariant: the drained user message_start MUST NOT come
    // before the preceding assistant message_end.
    const userStartIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_start" && e.role === "user"
    );
    const assistantEndIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_end" && e.role === "assistant"
    );
    expect(assistantEndIdx).toBeGreaterThanOrEqual(0);
    expect(userStartIdx).toBeGreaterThan(assistantEndIdx);
  });

  it("assistant message_start stays SYNC (message_update relies on reducer seeing it first)", () => {
    const sim = new BridgeSim();
    sim.onMessageStart("assistant", "hello");
    // No flush — the event must already be on the wire.
    expect(sim.wire).toEqual([
      { eventType: "message_start", role: "assistant", content: "hello" },
    ]);
  });

  it("multiple drained follow-ups preserve their relative pi emit order", async () => {
    const sim = new BridgeSim();

    // Pi delivers two queued follow-ups in order ["a", "b"].
    sim.onMessageEnd("assistant", "final");
    sim.onAgentSettled();
    sim.onMessageStart("user", "a");
    sim.onMessageEnd("user", "a");
    sim.onMessageStart("user", "b");
    sim.onMessageEnd("user", "b");

    await sim.flush();

    const summary = sim.wire.map((e) =>
      e.eventType === "agent_settled"
        ? "agent_settled"
        : `${e.eventType}:${e.role}:${e.content}`
    );
    expect(summary).toEqual([
      "agent_settled",
      "message_end:assistant:final",
      "message_start:user:a",
      "message_end:user:a",
      "message_start:user:b",
      "message_end:user:b",
    ]);
  });

  it("drained STEER at turn_end lands AFTER preceding assistant message_end (same bug, different drain boundary)", async () => {
    const sim = new BridgeSim();

    // Pi's sync emit order at turn_end with a queued steer:
    //   1. assistant message_end (the weather report)
    //   2. turn_end
    //   3. user message_start ("asd" — the drained steer)
    //   4. user message_end ("asd")
    // (Identical to the follow-up case but the drain boundary is turn_end
    // instead of agent_settled. The fix is uniform: defer USER message_start.)
    sim.onMessageEnd("assistant", "weather report");
    sim.onTurnEnd();
    sim.onMessageStart("user", "asd");
    sim.onMessageEnd("user", "asd");

    await sim.flush();

    const types = sim.wire.map((e) => `${e.eventType}:${e.role ?? "-"}`);
    expect(types).toEqual([
      "turn_end:-",
      "message_end:assistant",
      "message_start:user",
      "message_end:user",
    ]);

    const userStartIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_start" && e.role === "user"
    );
    const assistantEndIdx = sim.wire.findIndex(
      (e) => e.eventType === "message_end" && e.role === "assistant"
    );
    expect(userStartIdx).toBeGreaterThan(assistantEndIdx);
  });

  it("idle user send (no preceding deferred message_end) still arrives intact", async () => {
    const sim = new BridgeSim();

    // No pending deferrals in flight — a fresh user prompt.
    sim.onMessageStart("user", "hi");
    sim.onMessageEnd("user", "hi");

    await sim.flush();

    expect(sim.wire.map((e) => `${e.eventType}:${e.role}`)).toEqual([
      "message_start:user",
      "message_end:user",
    ]);
  });
});
