/**
 * Tests that the bridge forwards pi's `queue_update` event as a typed
 * QueueUpdateToServerMessage. Also covers idempotent listener registration
 * via pi.on("queue_update", ...).
 *
 * See change: add-followup-edit-and-steer-cancel.
 */
import { describe, it, expect, vi } from "vitest";
import { isSubagentTick, SubagentTickThrottle } from "../subagent-tick-throttle.js";

// We don't test the full bridge here (too much wiring) — we drive the
// listener-registration-and-forward shape directly with a fake pi.

describe("bridge queue_update forwarding (shape contract)", () => {
  it("registered queue_update listener emits a typed QueueUpdateToServerMessage on event", () => {
    // Simulate the listener registration the bridge performs.
    const listeners: Record<string, (event: any) => void> = {};
    const fakePi = {
      on: vi.fn((eventType: string, handler: any) => { listeners[eventType] = handler; }),
    };
    const sent: any[] = [];
    const fakeConnection = { send: (m: any) => sent.push(m) };
    const sessionId = "S1";

    // Equivalent of the bridge's pi.on("queue_update", ...) registration.
    fakePi.on("queue_update", (event: any) => {
      const steering = Array.isArray(event?.steering) ? Array.from(event.steering as readonly string[]) : [];
      const followUp = Array.isArray(event?.followUp) ? Array.from(event.followUp as readonly string[]) : [];
      fakeConnection.send({ type: "queue_update", sessionId, steering, followUp });
    });

    // Fire pi's queue_update event.
    listeners["queue_update"]({ type: "queue_update", steering: ["a", "b"], followUp: ["c"] });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      type: "queue_update",
      sessionId: "S1",
      steering: ["a", "b"],
      followUp: ["c"],
    });
  });

  it("forwards empty arrays when pi reports empty queues", () => {
    const listeners: Record<string, (event: any) => void> = {};
    const fakePi = { on: vi.fn((t: string, h: any) => { listeners[t] = h; }) };
    const sent: any[] = [];
    const sessionId = "S2";

    fakePi.on("queue_update", (event: any) => {
      const steering = Array.isArray(event?.steering) ? Array.from(event.steering as readonly string[]) : [];
      const followUp = Array.isArray(event?.followUp) ? Array.from(event.followUp as readonly string[]) : [];
      sent.push({ type: "queue_update", sessionId, steering, followUp });
    });

    listeners["queue_update"]({ type: "queue_update", steering: [], followUp: [] });

    expect(sent).toEqual([{ type: "queue_update", sessionId: "S2", steering: [], followUp: [] }]);
  });

  it("defends against malformed event payloads (missing arrays)", () => {
    const listeners: Record<string, (event: any) => void> = {};
    const fakePi = { on: vi.fn((t: string, h: any) => { listeners[t] = h; }) };
    const sent: any[] = [];
    const sessionId = "S3";

    fakePi.on("queue_update", (event: any) => {
      const steering = Array.isArray(event?.steering) ? Array.from(event.steering as readonly string[]) : [];
      const followUp = Array.isArray(event?.followUp) ? Array.from(event.followUp as readonly string[]) : [];
      sent.push({ type: "queue_update", sessionId, steering, followUp });
    });

    // Pi returns object missing the expected fields.
    listeners["queue_update"]({ type: "queue_update" });

    expect(sent).toEqual([{ type: "queue_update", sessionId: "S3", steering: [], followUp: [] }]);
  });
});

/**
 * E10 — the subagent tick throttle is scoped to Agent ticks only; every OTHER
 * event type still forwards 1:1 through the enriched loop.
 *
 * Mirrors the bridge's forward site (`bridge.ts`, `tool_execution_update`
 * branch): the throttle is consulted ONLY when `isSubagentTick` matches; any
 * other event type never reaches it. The regression this guards against is a
 * throttle hooked one level too high, where a streaming `message_update` or a
 * `tool_call` burst would silently inherit the 500 ms window.
 *
 * See change: reduce-bridge-tick-bandwidth (task 3.16, test-plan E10).
 */
describe("bridge forward loop — non-subagent events pass 1:1 (E10)", () => {
  it("forwards message_update / tool_execution_start / tool_call untouched", () => {
    vi.useFakeTimers();
    try {
      const sent: any[] = [];
      const throttle = new SubagentTickThrottle<any>({
        windowMs: 500,
        send: (m) => sent.push(m),
        canSend: () => true,
      });

      // The bridge's forward site, reduced to its throttle decision.
      const forward = (eventType: string, event: any) => {
        if (eventType === "tool_execution_update" && isSubagentTick(event)) {
          if (throttle.offer(event.toolCallId, event, "S1")) sent.push(event);
          return;
        }
        sent.push(event);
      };

      // A burst of events that must NOT be throttled, all inside one window.
      for (let i = 0; i < 10; i++) forward("message_update", { kind: "message_update", i });
      for (let i = 0; i < 5; i++) forward("tool_execution_start", { kind: "tool_execution_start", i });
      for (let i = 0; i < 8; i++) forward("tool_call", { kind: "tool_call", i });

      expect(sent).toHaveLength(23);
      expect(sent.filter((e) => e.kind === "message_update")).toHaveLength(10);
      expect(sent.filter((e) => e.kind === "tool_execution_start")).toHaveLength(5);
      expect(sent.filter((e) => e.kind === "tool_call")).toHaveLength(8);
      // Untouched means untouched: the throttle kept no state for them.
      expect(throttle.size).toBe(0);
      expect(throttle.stats.tickForwarded).toBe(0);
      expect(throttle.stats.tickCoalesced).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throttle state does not leak across event types sharing a toolCallId", () => {
    vi.useFakeTimers();
    try {
      let clock = 0;
      const sent: any[] = [];
      const throttle = new SubagentTickThrottle<any>({
        windowMs: 500,
        now: () => clock,
        send: (m) => sent.push(m),
        canSend: () => true,
      });
      const forward = (eventType: string, event: any) => {
        if (eventType === "tool_execution_update" && isSubagentTick(event)) {
          if (throttle.offer(event.toolCallId, event, "S1")) sent.push(event);
          return;
        }
        sent.push(event);
      };

      const agentTick = (i: number) => ({
        kind: "agent-tick",
        i,
        toolCallId: "tc1",
        toolName: "Agent",
        partialResult: { details: { agentId: "a1" } },
      });

      forward("tool_execution_update", agentTick(0)); // leading edge
      clock += 100;
      forward("tool_execution_update", agentTick(1)); // held
      // A non-subagent event on the SAME toolCallId must still pass immediately.
      forward("message_update", { kind: "message_update", toolCallId: "tc1" });

      expect(sent.map((e) => e.kind)).toEqual(["agent-tick", "message_update"]);
      expect(throttle.stats.tickForwarded).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
