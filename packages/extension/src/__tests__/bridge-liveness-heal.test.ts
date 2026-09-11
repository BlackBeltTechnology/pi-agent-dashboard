/**
 * Bridge-side half of change: fix-stuck-streaming-status-latch.
 *
 * The reconnect heal is asymmetric today: `bridge.ts` re-asserts a synthetic
 * `agent_start` when mid-turn, and does nothing when idle — so a `streaming`
 * latched by a dropped `agent_end` never clears. The idle half is added, and
 * it must be sent from an explicit POST-FLUSH hook: `onopen` calls
 * `onReconnect()` BEFORE draining the buffer, so a heal sent from
 * `onReconnect` would overtake a buffered real `agent_end` and silently erase
 * the `streaming→idle` unread edge (design D8).
 *
 * Pattern: the repo's L1 model-mirror + fake-WS approach (exemplars
 * `connection.test.ts`, `bridge-resume-disconnect.test.ts`). The REAL
 * `ConnectionManager` — where the new `onPostFlush` hook lives — is exercised;
 * `bridge.ts`'s two-line use of it is mirrored by `wireHeal` below.
 *
 * test-plan #X1, #X3, #X5, #X6, #F3.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0; // CONNECTING
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
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

  types(): string[] {
    return this.sent.map((s) => JSON.parse(s).type);
  }
}

/**
 * Mirror of the bridge's heal wiring (`bridge.ts` reconnect block):
 *  - mid-turn  → synthetic `agent_start` from `onReconnect` (pre-existing, D7)
 *  - idle      → one `session_heartbeat{agentRunning:false}` from the
 *                post-flush hook (new, D8)
 */
function wireHeal(sessionId: string, isAgentStreaming: () => boolean) {
  return {
    onReconnect: (cm: ConnectionManager) => {
      if (isAgentStreaming()) {
        cm.send({ type: "event_forward", sessionId, event: { eventType: "agent_start", timestamp: Date.now(), data: {} } });
      }
    },
    onPostFlush: (cm: ConnectionManager) => {
      if (!isAgentStreaming()) {
        cm.send({ type: "session_heartbeat", sessionId, agentRunning: false });
      }
    },
  };
}

describe("bridge liveness heal", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("heals the latch across a transient reconnect when the bridge is idle (#X1)", () => {
    vi.useFakeTimers();
    let streaming = true;
    let cm!: ConnectionManager;
    const heal = wireHeal("s1", () => streaming);
    cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: FakeWebSocket as any,
      watchdogTimeout: 0,
      onReconnect: () => heal.onReconnect(cm),
      onPostFlush: () => heal.onPostFlush(cm),
    });
    cm.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.simulateOpen();

    // Mid-turn: agent_start reached the server, then the socket dies. The
    // agent_end is produced while the socket is DOWN but never reaches the
    // bridge's buffer (it was lost in transport / the turn ended silently).
    cm.send({ type: "event_forward", sessionId: "s1", event: { eventType: "agent_start", timestamp: 1, data: {} } });
    ws1.simulateClose();
    streaming = false; // the turn is over by the time we reconnect

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    expect(ws2).toBeDefined();
    ws2.simulateOpen();

    const types = ws2.types();
    const beats = ws2.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "session_heartbeat");
    expect(beats).toHaveLength(1);
    expect(beats[0].agentRunning).toBe(false);
    // A correction is NOT a run boundary and must not re-register.
    expect(types).not.toContain("session_register");
    const events = ws2.sent.map((s) => JSON.parse(s)).filter((m) => m.type === "event_forward");
    expect(events.some((e) => e.event.eventType === "agent_end")).toBe(false);

    cm.disconnect();
  });

  it("does not overtake a buffered agent_end (#X3)", () => {
    vi.useFakeTimers();
    let streaming = true;
    let cm!: ConnectionManager;
    const heal = wireHeal("s2", () => streaming);
    cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: FakeWebSocket as any,
      watchdogTimeout: 0,
      onReconnect: () => heal.onReconnect(cm),
      onPostFlush: () => heal.onPostFlush(cm),
    });
    cm.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.simulateOpen();
    ws1.simulateClose();

    // A REAL agent_end produced during the drop → buffered.
    cm.send({ type: "event_forward", sessionId: "s2", event: { eventType: "agent_end", timestamp: 2, data: {} } });
    streaming = false;

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.simulateOpen();

    const parsed = ws2.sent.map((s) => JSON.parse(s));
    const endIdx = parsed.findIndex((m) => m.type === "event_forward" && m.event.eventType === "agent_end");
    const beatIdx = parsed.findIndex((m) => m.type === "session_heartbeat");
    expect(endIdx).toBeGreaterThanOrEqual(0);
    expect(beatIdx).toBeGreaterThanOrEqual(0);
    // The buffered agent_end must be observed FIRST so its streaming→idle edge
    // still stamps unread exactly as it does today.
    expect(endIdx).toBeLessThan(beatIdx);

    cm.disconnect();
  });

  it("a mid-turn reconnect still asserts streaming and sends no heal (#F3)", () => {
    vi.useFakeTimers();
    let cm!: ConnectionManager;
    const heal = wireHeal("s3", () => true);
    cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: FakeWebSocket as any,
      watchdogTimeout: 0,
      onReconnect: () => heal.onReconnect(cm),
      onPostFlush: () => heal.onPostFlush(cm),
    });
    cm.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.simulateOpen();
    ws1.simulateClose();

    vi.advanceTimersByTime(1000);
    const ws2 = FakeWebSocket.instances[1];
    ws2.simulateOpen();

    const parsed = ws2.sent.map((s) => JSON.parse(s));
    expect(parsed.some((m) => m.type === "event_forward" && m.event.eventType === "agent_start")).toBe(true);
    expect(parsed.some((m) => m.type === "session_heartbeat")).toBe(false);

    cm.disconnect();
  });

  it("a running agent grants the watchdog no extra grace (#X5)", () => {
    vi.useFakeTimers();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: FakeWebSocket as any,
      watchdogTimeout: 60_000,
    });
    cm.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.simulateOpen();
    // Last beat reported a running agent — advisory only for the watchdog.
    cm.send({ type: "session_heartbeat", sessionId: "s4", agentRunning: true });

    // Server silent for 60s → force-close + reconnect on the next check.
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);

    cm.disconnect();
  });

  it("an idle agent does not shorten the watchdog threshold (#X6)", () => {
    vi.useFakeTimers();
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: FakeWebSocket as any,
      watchdogTimeout: 60_000,
    });
    cm.connect();
    const ws1 = FakeWebSocket.instances[0];
    ws1.simulateOpen();
    cm.send({ type: "session_heartbeat", sessionId: "s5", agentRunning: false });

    // Only 30s of silence → no action, the connection stays open.
    vi.advanceTimersByTime(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws1.readyState).toBe(1);

    cm.disconnect();
  });
});
