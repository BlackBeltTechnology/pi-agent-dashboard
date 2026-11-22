/**
 * A contention refusal is terminal on the bridge side.
 *
 * test-plan #X8: the bridge receives `register_rejected` for `S`, its reconnect
 * logic runs, and there is NO reconnect + re-register for `S`; the reason is
 * surfaced rather than swallowed.
 *
 * Without this the refused duplicate loops forever on exponential backoff while
 * its pi keeps writing into the incumbent's transcript.
 *
 * See change: fix-duplicate-bridge-registration (D2).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class MockWebSocket {
  public url: string;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateClose() {
    this.readyState = 3;
    this.onclose?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }
}

describe("terminal registration refusal (X8)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  function connected(opts: Record<string, unknown> = {}) {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      ...opts,
    });
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();
    return cm;
  }

  it("does not reconnect after a register_rejected frame", () => {
    const cm = connected();
    expect(MockWebSocket.instances).toHaveLength(1);

    MockWebSocket.instances[0].simulateMessage(
      JSON.stringify({
        type: "register_rejected",
        sessionId: "S",
        reason: "another live bridge already serves this session id",
      }),
    );
    // The server closes right behind the frame.
    MockWebSocket.instances[0].simulateClose();

    // Drive well past any backoff the reconnect loop could have scheduled.
    vi.advanceTimersByTime(120_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    cm.disconnect();
  });

  it("surfaces the session id and reason instead of failing silently", () => {
    const seen: Array<{ sessionId: string; reason: string }> = [];
    const cm = connected({
      onRegisterRejected: (sessionId: string, reason: string) => seen.push({ sessionId, reason }),
    });

    MockWebSocket.instances[0].simulateMessage(
      JSON.stringify({ type: "register_rejected", sessionId: "S", reason: "duplicate" }),
    );

    expect(seen).toEqual([{ sessionId: "S", reason: "duplicate" }]);
    cm.disconnect();
  });

  it("does not route the rejection through the ordinary message handler", () => {
    const messages: unknown[] = [];
    const cm = connected({ onMessage: (d: unknown) => messages.push(d) });

    MockWebSocket.instances[0].simulateMessage(
      JSON.stringify({ type: "register_rejected", sessionId: "S", reason: "duplicate" }),
    );
    vi.advanceTimersByTime(1000);

    expect(messages).toEqual([]);
    cm.disconnect();
  });

  it("an ordinary close still reconnects (the refusal is what is terminal)", () => {
    const cm = connected();
    MockWebSocket.instances[0].simulateClose();
    vi.advanceTimersByTime(120_000);

    expect(MockWebSocket.instances.length).toBeGreaterThan(1);
    cm.disconnect();
  });
});

/**
 * An origin-refused id change on a socket that already owns a session is answered with the detail-free,
 * NON-terminal `provisional_rejected` (not `register_rejected`, which tears the connection down). The bridge
 * must keep the connection and its session. See change: harden-bridge-session-claim (D1, task 1.5).
 */
describe("a provisional_rejected outside a move is not terminal", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("keeps the connection, does not reconnect and does not surface a rejection", () => {
    const rejected: unknown[] = [];
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      onRegisterRejected: (...a: unknown[]) => rejected.push(a),
    });
    cm.connect();
    MockWebSocket.instances[0].simulateOpen();

    MockWebSocket.instances[0].simulateMessage(JSON.stringify({ type: "provisional_rejected" }));
    vi.advanceTimersByTime(2_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].readyState).toBe(1);
    expect(rejected).toEqual([]);
    cm.disconnect();
  });
});

