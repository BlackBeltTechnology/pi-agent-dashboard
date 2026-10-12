/**
 * Task 3.4 (bridge side) for change: fix-stuck-tool-card-on-dropped-event.
 *
 * The bridge buffers outgoing messages while the WS is not OPEN in a bounded
 * ring; on overflow `buffer.shift()` evicts the oldest. This suite proves the
 * eviction is now COUNTED (`getDroppedBufferedCount`) and rate-limited-LOGGED
 * with `hop:"bridge→server"` + the dropped message type.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class MockWebSocket {
  public url: string;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("ConnectionManager dropped-frame instrumentation", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("counts each ring-buffer eviction on overflow", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 10,
    });
    // Never connect → everything buffers. 15 sends over a cap of 10 → 5 evicted.
    for (let i = 0; i < 15; i++) {
      cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    }
    expect(cm.getDroppedBufferedCount()).toBe(5);
  });

  it("starts at zero and stays zero under the cap", () => {
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 10,
    });
    for (let i = 0; i < 10; i++) cm.send({ type: "event_forward", event: { i } });
    expect(cm.getDroppedBufferedCount()).toBe(0);
  });

  it("logs a rate-limited warning with hop + dropped message type", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      maxBufferSize: 2,
    });
    // Fill then overflow. The oldest evicted message is an `event_forward`.
    for (let i = 0; i < 6; i++) {
      cm.send({ type: "event_forward", sessionId: "s1", event: { i } });
    }
    const warns = warnSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("dropped buffered message"));
    // Rate-limited: at most one warning inside the window despite 4 evictions.
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("hop=bridge→server");
    expect(warns[0]).toContain("droppedType=event_forward");
  });
});
