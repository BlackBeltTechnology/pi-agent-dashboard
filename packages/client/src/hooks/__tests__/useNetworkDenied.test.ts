import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNetworkDenied } from "../useNetworkDenied.js";

/**
 * The banner's `networkDenied` input (change: add-lan-knock-pairing, design D10):
 * only a 403 `network_not_allowed` while offline is a denial.
 */
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useNetworkDenied", () => {
  it("reports the server hint on a 403 network_not_allowed while offline", async () => {
    const fetchImpl = vi.fn(() => json(403, { error: "network_not_allowed", hint: "add your network" }));
    const { result } = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fetchImpl as never }));
    await act(async () => {});
    expect(result.current).toEqual({ hint: "add your network" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("probes the active remote server's own base", async () => {
    const fetchImpl = vi.fn(() => json(403, { error: "network_not_allowed" }));
    renderHook(() => useNetworkDenied("offline", "http://192.168.16.204:8000", { fetchImpl: fetchImpl as never }));
    await act(async () => {});
    expect(fetchImpl).toHaveBeenCalledWith("http://192.168.16.204:8000/api/health", expect.anything());
  });

  it("a transport failure or any other answer is not a denial", async () => {
    const fail = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const a = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fail as never }));
    await act(async () => {});
    expect(a.result.current).toBeNull();
    const other = vi.fn(() => json(403, { error: "operator credential required" }));
    const b = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: other as never }));
    await act(async () => {});
    expect(b.result.current).toBeNull();
  });

  it("does not probe while connected or connecting, and clears on connect", async () => {
    const fetchImpl = vi.fn(() => json(403, { error: "network_not_allowed" }));
    const { result, rerender } = renderHook(({ s }) => useNetworkDenied(s, "", { fetchImpl: fetchImpl as never }), {
      initialProps: { s: "connecting" as "connecting" | "offline" | "connected" },
    });
    await act(async () => {});
    expect(fetchImpl).not.toHaveBeenCalled();
    rerender({ s: "offline" });
    await act(async () => {});
    expect(result.current).not.toBeNull();
    rerender({ s: "connected" });
    expect(result.current).toBeNull();
  });

  it("re-probes on the interval so a lifted denial clears", async () => {
    let denied = true;
    const fetchImpl = vi.fn(() => (denied ? json(403, { error: "network_not_allowed" }) : json(200, { ok: true })));
    const { result } = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fetchImpl as never, intervalMs: 1000 }));
    await act(async () => {});
    expect(result.current).not.toBeNull();
    denied = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBeNull();
  });
});
