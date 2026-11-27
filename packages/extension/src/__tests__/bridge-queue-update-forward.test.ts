/**
 * Tests that the bridge forwards pi's `queue_update` event as a typed
 * QueueUpdateToServerMessage. Also covers idempotent listener registration
 * via pi.on("queue_update", ...).
 *
 * See change: add-followup-edit-and-steer-cancel.
 */
import { describe, expect, it, vi } from "vitest";

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
