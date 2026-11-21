/**
 * sudo_credential_response / _cancel / _forget ride the IMMEDIATE lane of the
 * inbound pump: a full pump must never delay or drop a password / Cancel.
 * See change: add-sudo-credential-prompt (test-plan #S37).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionManager } from "../connection.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }
  simulateMessage(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("sudo_credential_* inbound IMMEDIATE lane (#S37)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("dispatches all three out-of-band while the pump is full; the ordinary frame is the one dropped", async () => {
    const delivered: string[] = [];
    let release!: () => void;
    const parked = new Promise<void>((r) => {
      release = r;
    });
    const cm = new ConnectionManager({
      url: "ws://localhost:9999",
      WebSocketImpl: MockWebSocket as any,
      watchdogTimeout: 0,
      maxInboundQueue: 1,
      onMessage: async (data: any) => {
        delivered.push(data.type);
        if (data.type === "park") await parked;
      },
    });
    cm.connect();
    const ws = MockWebSocket.instances[0];
    ws.simulateOpen();

    ws.simulateMessage({ type: "park" });
    await flush();
    ws.simulateMessage({ type: "send_prompt", id: "fills-the-queue" });
    await flush();

    ws.simulateMessage({ type: "sudo_credential_response", sessionId: "s", callId: "c", password: "x" });
    ws.simulateMessage({ type: "sudo_credential_cancel", sessionId: "s", callId: "c" });
    ws.simulateMessage({ type: "sudo_credential_forget", sessionId: "s" });
    ws.simulateMessage({ type: "send_prompt", id: "ordinary-dropped" });
    await flush();

    expect(delivered).toEqual(["park", "sudo_credential_response", "sudo_credential_cancel", "sudo_credential_forget"]);
    expect(cm.getDroppedInboundCount()).toBe(1);

    release();
    await flush();
    expect(delivered).toContain("send_prompt");
    cm.disconnect();
  });
});
