/**
 * D17/R2 — honest offline/auth classification. A transient `/auth/status`
 * probe failure must NOT conclude "offline" (that replaces the sign-in
 * affordance with a dead-end outage strip); `authenticated:false` always wins
 * as `auth_required`; only N consecutive probe rejections conclude `offline`.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "../useWebSocket.js";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((ev?: { code?: number }) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
  serverClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({});
  }
}

const lastSocket = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

/** Drop the current socket and flush the async probe + reconnect timer. */
async function dropAndSettle(): Promise<void> {
  await act(async () => {
    lastSocket().serverClose();
    await Promise.resolve(); // fetch().then chain
    await Promise.resolve();
    await Promise.resolve();
    await vi.runOnlyPendingTimersAsync(); // reconnect timer → next connect
  });
}

type ProbeBehavior = () => Promise<{ authenticated?: boolean }>;
let probeBehavior: ProbeBehavior;

describe("useWebSocket — offline vs auth_required classification (D17/R2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    probeBehavior = () => Promise.reject(new Error("probe unreachable"));
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes("/auth/status")) {
          return probeBehavior().then(
            (body) => ({ ok: true, json: () => Promise.resolve(body) }) as Response,
          );
        }
        // ticket mint & friends: benign empty response
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("a probe rejection keeps 'connecting' (never flips straight to offline)", async () => {
    const { result } = renderHook(() => useWebSocket("ws://test/ws"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // 3 transport drops reach the probe threshold; the FIRST probe rejection
    // must not conclude offline.
    await dropAndSettle();
    await dropAndSettle();
    await dropAndSettle();
    expect(result.current.status).toBe("connecting");
  });

  it("authenticated:false wins as auth_required", async () => {
    probeBehavior = () => Promise.resolve({ authenticated: false });
    const { result } = renderHook(() => useWebSocket("ws://test/ws"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    await dropAndSettle();
    await dropAndSettle();
    await dropAndSettle();
    expect(result.current.status).toBe("auth_required");
  });

  it("N consecutive probe rejections conclude offline", async () => {
    const { result } = renderHook(() => useWebSocket("ws://test/ws"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // 3 drops to reach the probe threshold + enough further drops for 3
    // consecutive probe rejections.
    for (let i = 0; i < 6; i++) await dropAndSettle();
    expect(result.current.status).toBe("offline");
  });

  it("a probe success resets the rejection streak", async () => {
    const { result } = renderHook(() => useWebSocket("ws://test/ws"));
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    // Two rejecting probes (drops 3 and 4)…
    for (let i = 0; i < 4; i++) await dropAndSettle();
    expect(result.current.status).toBe("connecting");
    // …then a successful probe reporting unauthenticated.
    probeBehavior = () => Promise.resolve({ authenticated: false });
    await dropAndSettle();
    expect(result.current.status).toBe("auth_required");
    // Streak reset: a single new rejection must not conclude offline.
    probeBehavior = () => Promise.reject(new Error("blip"));
    await dropAndSettle();
    expect(result.current.status).not.toBe("offline");
  });
});
