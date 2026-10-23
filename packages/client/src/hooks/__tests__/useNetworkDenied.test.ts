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

/**
 * The strict default: a bare-loopback tab is told by `/api/health` (200 +
 * `localProof: "required"`) that it needs `pi-dashboard open`.
 * See change: close-container-loopback-impersonation (test-plan #F1–#F3).
 */
describe("useNetworkDenied — local proof required", () => {
  const needsProof = () => json(200, { ok: true, localProof: "required" });

  it("F1 offline: converges to local_proof_required with the command in the hint and stays across re-probes", async () => {
    const fetchImpl = vi.fn(needsProof);
    const { result } = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fetchImpl as never, intervalMs: 1000 }));
    await act(async () => {});
    expect(result.current).toMatchObject({ reason: "local_proof_required" });
    expect(result.current?.hint).toContain("pi-dashboard open");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current).toMatchObject({ reason: "local_proof_required" });
  });

  it("F2 auth_required (OAuth configured): converges to the same denial, not null", async () => {
    const fetchImpl = vi.fn(needsProof);
    const { result } = renderHook(() => useNetworkDenied("auth_required", "", { fetchImpl: fetchImpl as never }));
    await act(async () => {});
    expect(fetchImpl).toHaveBeenCalledWith("/api/health", expect.anything());
    expect(result.current).toMatchObject({ reason: "local_proof_required" });
    expect(result.current?.hint).toContain("pi-dashboard open");
  });

  it("F3 a proofed tab sees no banner: the field disappearing clears the denial", async () => {
    let required = true;
    const fetchImpl = vi.fn(() => (required ? needsProof() : json(200, { ok: true })));
    const { result } = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fetchImpl as never, intervalMs: 1000 }));
    await act(async () => {});
    expect(result.current).not.toBeNull();
    required = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current).toBeNull();
  });

  it("a 403 refusal that names local_proof_required carries the reason", async () => {
    const fetchImpl = vi.fn(() => json(403, { error: "network_not_allowed", reason: "local_proof_required", hint: "run pi-dashboard open" }));
    const { result } = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fetchImpl as never }));
    await act(async () => {});
    expect(result.current).toEqual({ reason: "local_proof_required", hint: "run pi-dashboard open" });
  });

  it("a plain 200 health (no field) is not a denial, and `connecting` does not probe", async () => {
    const fetchImpl = vi.fn(() => json(200, { ok: true }));
    const a = renderHook(() => useNetworkDenied("offline", "", { fetchImpl: fetchImpl as never }));
    await act(async () => {});
    expect(a.result.current).toBeNull();
    const connecting = vi.fn(needsProof);
    renderHook(() => useNetworkDenied("connecting", "", { fetchImpl: connecting as never }));
    await act(async () => {});
    expect(connecting).not.toHaveBeenCalled();
  });
});
