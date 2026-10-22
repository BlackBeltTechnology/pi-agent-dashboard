/**
 * Single owner of the Remote access state. Ported from the deleted TunnelButton tests.
 * See change: declutter-sidebar-header (test-plan #F4 #F5 #F6 #X1 #X3, D3).
 */
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { reachabilityStore } from "../../lib/remote-access/reachability-store.js";
import { RUN_KEY } from "../../lib/remote-access/run-store.js";
import { useRemoteAccessIndicator } from "../useRemoteAccessIndicator.js";

beforeEach(() => {
  reachabilityStore.reset();
  pairingApprovalStore.setPending([]);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const pendingReq = (id: string) => ({ pendingId: id, createdAt: 0, expiresAt: 9e12, attemptsLeft: 3 });
const ok = (status: string, extra: Record<string, unknown> = {}) =>
  ({ ok: true, json: async () => ({ status, serverOs: "darwin", ...extra }) }) as Response;
const mockFetch = (status: string, extra: Record<string, unknown> = {}) =>
  vi.spyOn(globalThis, "fetch").mockImplementation((async () => ok(status, extra)) as typeof fetch);

describe("useRemoteAccessIndicator", () => {
  it("a reachability broadcast flips the tone and label without any further request", async () => {
    const spy = mockFetch("inactive", { gateway: { connected: 0, expected: 1 } });
    const { result } = renderHook(() => useRemoteAccessIndicator());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    act(() => reachabilityStore.set({ resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1" }));
    await waitFor(() => expect(result.current.label).toBe("Remote access: this computer only"));
    const calls = spy.mock.calls.length;
    act(() => reachabilityStore.set({ resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" }));
    expect(result.current.tone).toBe("network");
    expect(result.current.state).toBe("listening on the network");
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("the pending count tracks the approval store and joins the label", () => {
    mockFetch("inactive");
    const { result } = renderHook(() => useRemoteAccessIndicator());
    expect(result.current.pending).toBe(0);
    act(() => pairingApprovalStore.setPending([pendingReq("a"), pendingReq("b")]));
    expect(result.current.pending).toBe(2);
    expect(result.current.label).toContain("2 devices waiting");
  });

  it("partial and failed tones come from the gateway counts / gated provider detail", async () => {
    mockFetch("inactive", { gateway: { connected: 1, expected: 2 } });
    const a = renderHook(() => useRemoteAccessIndicator());
    await waitFor(() => expect(a.result.current.tone).toBe("partial"));
    cleanup();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: RequestInfo | URL) => {
      const body = url.toString().includes("-detail")
        ? { status: "inactive", serverOs: "d", providers: [{ provider: "zrok", primary: true, state: "failed", error: "x" }], gateway: { connected: 0, expected: 1 } }
        : { status: "inactive", serverOs: "d", gateway: { connected: 0, expected: 1 } };
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response;
    }) as typeof fetch);
    const b = renderHook(() => useRemoteAccessIndicator());
    await waitFor(() => expect(b.result.current.tone).toBe("failed"));
  });

  it("F6: one poller (initial + one per 30 s) and a fresh stored run resumes once with initialRun; key removed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = mockFetch("inactive");
    sessionStorage.setItem(RUN_KEY, JSON.stringify({ task: "lan", done: ["bind"], at: Date.now() - 5_000 }));
    reachabilityStore.set({ resolvedBindHost: null as never, pendingBindHost: null as never });
    const { result } = renderHook(() => useRemoteAccessIndicator());
    await act(async () => {});
    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.resumeRun?.task).toBe("lan");
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
    act(() => reachabilityStore.set({ resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(spy.mock.calls.length).toBe(3); // 1 initial + 2 interval ticks
  });

  it("F4: openDialog refetches status, clears the resumed run and opens on the landing view", async () => {
    const spy = mockFetch("inactive");
    const { result } = renderHook(() => useRemoteAccessIndicator());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await act(async () => { await result.current.openDialog(null); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.resumeRun).toBeNull();
    act(() => result.current.closeDialog());
    expect(result.current.dialogOpen).toBe(false);
  });

  it("X1: a failed or non-ok status poll keeps the last known tone and never throws; polling continues", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce((async () => ok("active")) as typeof fetch)
      .mockImplementationOnce((async () => { throw new Error("network"); }) as typeof fetch)
      .mockImplementationOnce((async () => ({ ok: false, status: 500 }) as Response) as typeof fetch);
    const { result } = renderHook(() => useRemoteAccessIndicator());
    await act(async () => {});
    expect(result.current.tone).toBe("internet");
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.current.tone).toBe("internet");
  });

  it("X3: the dialog opens only after a slow status refetch settles, and a second call does not double-open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let slow = false;
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => {
      // fixed-tick-waits: opt-out — fake-timer fetch delay (fault injection), not a wait barrier
      if (slow) await new Promise((r) => setTimeout(r, 5_000));
      return ok("inactive");
    }) as typeof fetch);
    const { result } = renderHook(() => useRemoteAccessIndicator());
    await act(async () => {});
    slow = true;
    let p: Promise<void> = Promise.resolve();
    act(() => { p = result.current.openDialog(null); });
    expect(result.current.dialogOpen).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await p; });
    expect(result.current.dialogOpen).toBe(true);
  });

  describe("F5: focus return with two chip instances", () => {
    function Harness() {
      const ra = useRemoteAccessIndicator();
      return (
        <>
          <button type="button" data-testid="connection-chip" id="a">A</button>
          <button type="button" data-testid="connection-chip" id="b">B</button>
          <button type="button" data-testid="open-from-b" onClick={(e) => void ra.openDialog(document.getElementById("b") ?? e.currentTarget)}>open</button>
          {ra.dialogOpen && <button type="button" data-testid="close" onClick={ra.closeDialog}>close</button>}
        </>
      );
    }
    const visible = (ids: string[]) =>
      vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (this: HTMLElement) {
        return ids.includes(this.id) ? document.body : null;
      });

    it("opener hidden → the first visible chip gets focus; none visible → no error", async () => {
      mockFetch("inactive");
      visible(["a"]);
      render(<Harness />);
      await act(async () => { screen.getByTestId("open-from-b").click(); });
      await waitFor(() => screen.getByTestId("close"));
      act(() => screen.getByTestId("close").click());
      await waitFor(() => expect(document.activeElement?.id).toBe("a"));
      cleanup();
      vi.restoreAllMocks();
      mockFetch("inactive");
      visible([]);
      render(<Harness />);
      await act(async () => { screen.getByTestId("open-from-b").click(); });
      await waitFor(() => screen.getByTestId("close"));
      act(() => screen.getByTestId("close").click());
      // fixed-tick-waits: opt-out — asserting an ABSENT focus move after the deferred focus callback (no event to await)
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(document.activeElement).toBe(document.body);
    });

    it("opener still visible → focus returns to it", async () => {
      mockFetch("inactive");
      visible(["a", "b"]);
      render(<Harness />);
      await act(async () => { screen.getByTestId("open-from-b").click(); });
      await waitFor(() => screen.getByTestId("close"));
      act(() => screen.getByTestId("close").click());
      await waitFor(() => expect(document.activeElement?.id).toBe("b"));
    });
  });
});
