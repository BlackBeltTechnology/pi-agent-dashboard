import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTBOX_CAPACITY, OUTBOX_EXPIRY_MS, useWebSocket } from "../useWebSocket.js";

/**
 * Controllable `WebSocket` double. The hook only touches the pieces modeled
 * here (`readyState`, `send`, `close`, the `on*` slots). `open()`/`serverClose()`
 * drive the lifecycle by hand so tests never depend on real network timing.
 */
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static throwOnConstruct = false;

  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  throwOnSend = false;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    if (MockWebSocket.throwOnConstruct) throw new Error("no socket available");
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.throwOnSend) throw new Error("send on closing race");
    this.sent.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Simulate the transport opening the socket. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** Simulate the transport dropping the socket (server close / network loss). */
  serverClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

const lastSocket = (): MockWebSocket => MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

describe("useWebSocket — send verdict & outbox", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.throwOnConstruct = false;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("E1: an open socket yields a handed verdict and writes the message", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();
    act(() => ws.open());

    let verdict: unknown;
    act(() => {
      verdict = result.current.send({ type: "abort", sessionId: "s1" } as any);
    });

    expect(ws.sent).toHaveLength(1);
    expect(verdict).toEqual({ status: "handed" });
  });

  it("E2: each non-open readyState never yields a handed verdict", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();

    for (const state of [MockWebSocket.CONNECTING, MockWebSocket.CLOSING, MockWebSocket.CLOSED]) {
      ws.readyState = state;
      let verdict: any;
      act(() => {
        verdict = result.current.send({ type: "abort", sessionId: "s1" } as any);
      });
      expect(verdict.status).not.toBe("handed");
      expect(ws.sent).toHaveLength(0);
    }
  });

  it("E3: no socket instance rejects rather than throwing", () => {
    MockWebSocket.throwOnConstruct = true;
    const { result } = renderHook(() => useWebSocket("ws://test"));

    let verdict: any;
    act(() => {
      verdict = result.current.send({ type: "abort", sessionId: "s1" } as any);
    });
    expect(verdict).toEqual({ status: "rejected", reason: "no_socket" });
  });

  it("E4: a message refused while offline is queued and flushed exactly once", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();

    let verdict: any;
    act(() => {
      verdict = result.current.send({ type: "abort", sessionId: "s1" } as any);
    });
    expect(verdict).toMatchObject({ status: "queued" });
    expect(ws.sent).toHaveLength(0);

    act(() => ws.open());
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: "abort", sessionId: "s1" });

    // A second open (reconnect) must not re-flush the popped entry.
    act(() => ws.open());
    expect(ws.sent).toHaveLength(1);
  });

  it("E5: a handed-off message is never re-sent after reconnect", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();
    act(() => ws.open());

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "hello" } as any);
    });
    expect(ws.sent).toHaveLength(1);

    // Socket closes before any ack arrives, then reopens.
    act(() => ws.serverClose());
    act(() => ws.open());

    expect(ws.sent).toHaveLength(1);
  });

  it("E6: the outbox is bounded and evicts oldest-first", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();

    // Queue one past capacity while the socket is not open.
    act(() => {
      for (let i = 0; i <= OUTBOX_CAPACITY; i++) {
        result.current.send({ type: "abort", sessionId: `s${i}` } as any);
      }
    });

    act(() => ws.open());

    // Oldest (s0) evicted; exactly capacity messages flushed.
    expect(ws.sent).toHaveLength(OUTBOX_CAPACITY);
    const flushedIds = ws.sent.map((s) => JSON.parse(s).sessionId);
    expect(flushedIds).not.toContain("s0");
    expect(flushedIds).toContain("s1");
    expect(flushedIds).toContain(`s${OUTBOX_CAPACITY}`);
  });

  it("E7: an expired queued prompt is discarded, not flushed late", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "hello" } as any);
    });

    // Past the outbox expiry AND past the 30s pending-prompt deadline.
    act(() => {
      vi.advanceTimersByTime(OUTBOX_EXPIRY_MS + 25_000);
    });

    act(() => ws.open());
    expect(ws.sent).toHaveLength(0);
  });

  it("E8: a prompt queued briefly still flushes once", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "hello" } as any);
    });

    act(() => {
      vi.advanceTimersByTime(OUTBOX_EXPIRY_MS - 1);
    });

    act(() => ws.open());
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0]!)).toMatchObject({ type: "send_prompt", text: "hello" });
  });

  it("X1: a throwing send on an open socket reports failure without escaping", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();
    act(() => ws.open());
    ws.throwOnSend = true;

    let verdict: any;
    act(() => {
      verdict = result.current.send({ type: "abort", sessionId: "s1" } as any);
    });
    expect(verdict).toEqual({ status: "rejected", reason: "send_failed" });
    expect(ws.sent).toHaveLength(0);
  });

  it("Q1: a queued prompt is reported undelivered when it expires without a reconnect", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const seen: any[] = [];
    act(() => {
      result.current.onOutboxExpiry((m) => seen.push(m));
    });

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "hello" } as any);
    });

    // Still inside the flush window: no verdict yet, it may reconnect.
    act(() => {
      vi.advanceTimersByTime(OUTBOX_EXPIRY_MS - 1);
    });
    expect(seen).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "send_prompt", sessionId: "s1", text: "hello" });
  });

  it("Q1: a prompt flushed before expiry is never reported undelivered", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();
    const seen: any[] = [];
    act(() => {
      result.current.onOutboxExpiry((m) => seen.push(m));
    });

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "hello" } as any);
    });
    act(() => ws.open()); // flushed exactly once

    act(() => {
      vi.advanceTimersByTime(OUTBOX_EXPIRY_MS * 2);
    });
    expect(ws.sent).toHaveLength(1);
    expect(seen).toHaveLength(0);
  });

  it("Q1: a prompt evicted by capacity is reported undelivered", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const seen: any[] = [];
    act(() => {
      result.current.onOutboxExpiry((m) => seen.push(m));
    });

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "old" } as any);
      for (let i = 0; i < OUTBOX_CAPACITY; i++) {
        result.current.send({ type: "abort", sessionId: `s${i}` } as any);
      }
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "send_prompt", sessionId: "s1", text: "old" });
  });

  it("Q1: a prompt whose flush write throws is reported undelivered, and never retried", () => {
    const { result } = renderHook(() => useWebSocket("ws://test"));
    const ws = lastSocket();
    const seen: any[] = [];
    act(() => {
      result.current.onOutboxExpiry((m) => seen.push(m));
    });

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "x" } as any);
    });

    // The socket opens, but the write throws on a closing race.
    ws.throwOnSend = true;
    act(() => ws.open());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "send_prompt", sessionId: "s1", text: "x" });

    // Popped, never retried: a later clean open writes nothing.
    ws.throwOnSend = false;
    act(() => ws.open());
    expect(ws.sent).toHaveLength(0);
  });

  it("a url change drops queued entries as undelivered instead of flushing them to the new endpoint", () => {
    const { result, rerender } = renderHook(({ url }: { url: string }) => useWebSocket(url), {
      initialProps: { url: "ws://a" },
    });
    const seen: any[] = [];
    act(() => {
      result.current.onOutboxExpiry((m) => seen.push(m));
    });

    act(() => {
      result.current.send({ type: "send_prompt", sessionId: "s1", text: "to-a" } as any);
    });
    expect(seen).toHaveLength(0);

    // Server switch: the entry was addressed to the OLD endpoint.
    act(() => {
      rerender({ url: "ws://b" });
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: "send_prompt", text: "to-a" });

    act(() => lastSocket().open());
    expect(lastSocket().sent).toHaveLength(0);
  });
});
