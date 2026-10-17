/**
 * `useServices`: refetches ONLY the list, after a 100–400 ms delay, on
 * `services_changed` and on reconnect; collapses bursts; never polls.
 * See change: add-services-settings-ui (D3) — test-plan F1/F2 (L1 share), F3.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeList, makeService } from "../../components/settings/services/__tests__/services-fixtures.js";
import { REFETCH_DELAY_MAX_MS, REFETCH_DELAY_MIN_MS, useServices } from "../useServices.js";

type Handler = (msg: ServerToBrowserMessage) => void;

function bus() {
  const handlers = new Set<Handler>();
  return {
    onMessage: (h: Handler) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    emit: (m: ServerToBrowserMessage) => act(() => handlers.forEach((h) => h(m))),
    size: () => handlers.size,
  };
}

const PING: ServerToBrowserMessage = { type: "services_changed" };
let n = 0;
const fetchList = vi.fn(async () => ({ ok: true, status: 200, data: makeList([makeService({ leases: n++ })]) }));

beforeEach(() => {
  vi.useFakeTimers();
  fetchList.mockClear();
  n = 0;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useServices", () => {
  it("loads once on mount and exposes canOperate from the list", async () => {
    const { result } = renderHook(() => useServices({ fetchList }));
    await flush();
    expect(fetchList).toHaveBeenCalledTimes(1);
    expect(result.current.list?.services).toHaveLength(1);
    expect(result.current.canOperate).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("F2 a ping refetches the list after 100–400 ms; the delay is random inside the band", async () => {
    const b = bus();
    for (const [rand, expected] of [[0, REFETCH_DELAY_MIN_MS], [1, REFETCH_DELAY_MAX_MS - 0.001]] as const) {
      fetchList.mockClear();
      const spy = vi.spyOn(Math, "random").mockReturnValue(rand);
      const { unmount } = renderHook(() => useServices({ onMessage: b.onMessage, fetchList }));
      await flush();
      fetchList.mockClear();
      b.emit(PING);
      await act(async () => { await vi.advanceTimersByTimeAsync(Math.floor(expected) - 1); });
      expect(fetchList).toHaveBeenCalledTimes(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(fetchList).toHaveBeenCalledTimes(1);
      spy.mockRestore();
      unmount();
    }
  });

  it("F2 five pings in a burst collapse into one list request", async () => {
    const b = bus();
    renderHook(() => useServices({ onMessage: b.onMessage, fetchList, delayMs: () => 100 }));
    await flush();
    fetchList.mockClear();
    for (let i = 0; i < 5; i++) b.emit(PING);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it("a ping that lands while a fetch is running schedules exactly one more", async () => {
    const b = bus();
    let release: (() => void) | undefined;
    const slow = vi.fn(
      () =>
        new Promise<{ ok: boolean; status: number; data: ReturnType<typeof makeList> }>((resolve) => {
          release = () => resolve({ ok: true, status: 200, data: makeList([]) });
        }),
    );
    renderHook(() => useServices({ onMessage: b.onMessage, fetchList: slow as never, delayMs: () => 100 }));
    expect(slow).toHaveBeenCalledTimes(1); // initial, still in flight
    b.emit(PING);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(slow).toHaveBeenCalledTimes(1); // single-flight
    await act(async () => { release?.(); await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(slow).toHaveBeenCalledTimes(2);
  });

  it("F3 a reconnect (socket after none, or a new socket) refetches; the first socket does not", async () => {
    const b = bus();
    const a = {} as WebSocket;
    const c = {} as WebSocket;
    const { rerender } = renderHook(({ ws }: { ws: WebSocket | null }) => useServices({ onMessage: b.onMessage, ws, fetchList, delayMs: () => 100 }), {
      initialProps: { ws: a as WebSocket | null },
    });
    await flush();
    fetchList.mockClear();
    rerender({ ws: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchList).toHaveBeenCalledTimes(0); // disconnecting alone fetches nothing
    rerender({ ws: c });
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(fetchList).toHaveBeenCalledTimes(1);
  });

  it("never polls: ten minutes of silence is zero requests; other message types are ignored", async () => {
    const b = bus();
    renderHook(() => useServices({ onMessage: b.onMessage, fetchList }));
    await flush();
    fetchList.mockClear();
    b.emit({ type: "pair_pending_changed" });
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(fetchList).toHaveBeenCalledTimes(0);
  });

  it("a failed fetch keeps the previous list on screen and reports the error", async () => {
    const b = bus();
    const f = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, data: makeList([makeService()]) }).mockResolvedValue({ ok: false, status: 0, code: "network", error: "down" });
    const { result } = renderHook(() => useServices({ onMessage: b.onMessage, fetchList: f as never, delayMs: () => 100 }));
    await flush();
    b.emit(PING);
    await act(async () => { await vi.advanceTimersByTimeAsync(150); });
    expect(result.current.list?.services).toHaveLength(1);
    expect(result.current.error?.code).toBe("network");
  });

  it("unsubscribes on unmount", async () => {
    const b = bus();
    const { unmount } = renderHook(() => useServices({ onMessage: b.onMessage, fetchList }));
    await flush();
    expect(b.size()).toBe(1);
    unmount();
    expect(b.size()).toBe(0);
  });
});
