import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "../useWebSocket.js";

/** Minimal controllable WebSocket double (same shape as useWebSocket.test.ts). */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

const lastSocket = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

describe("useWebSocket — sudo_credential_* outbox exclusion (S55)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects every sudo_credential_* send while the socket is not OPEN and never replays after reopen", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket(); // CONNECTING: a socket exists but is not OPEN
    const msgs = [
      { type: "sudo_credential_response", sessionId: "s1", callId: "C1", password: "pw" },
      { type: "sudo_credential_cancel", sessionId: "s1", callId: "C1" },
      { type: "sudo_credential_forget", sessionId: "s1" },
      { type: "sudo_credential_shown", sessionId: "s1", callId: "C1" },
    ];
    for (const m of msgs) {
      let verdict: unknown;
      act(() => {
        verdict = result.current.send(m as never);
      });
      expect(verdict).toEqual({ status: "rejected", reason: "no_socket" });
    }
    act(() => ws.open());
    expect(ws.sent.filter((s) => s.includes("sudo_credential_"))).toHaveLength(0);
    // Non-sudo messages still queue (the exclusion is type-scoped).
    const other = lastSocket();
    other.readyState = MockWebSocket.CLOSED;
    let v: unknown;
    act(() => {
      v = result.current.send({ type: "abort", sessionId: "s1" } as never);
    });
    expect(v).toMatchObject({ status: "queued" });
  });
});
