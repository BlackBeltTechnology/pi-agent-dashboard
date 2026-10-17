/**
 * One snapshot, no value rendered before it has loaded. Test-plan #F5, #X7.
 * See change: add-remote-access-wizard.
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reachabilityStore } from "../reachability-store.js";
import { evaluate, roads } from "../steps.js";
import { useRemoteAccessSnapshot } from "../use-remote-access-snapshot.js";

const jsonRes = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, headers: new Headers({ "content-type": "application/json" }), json: async () => body }) as Response;

const CONFIG = {
  tunnel: { provider: "zrok" },
  pairing: { acceptLanRequests: true },
  reachability: { resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0", unreachable: [], bindHostSource: "env" },
};

function route(configImpl: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (url: RequestInfo | URL) => {
    const u = url.toString();
    if (u.includes("/api/config")) return configImpl();
    if (u.includes("/api/tunnel-status-detail")) return jsonRes({ status: "inactive", serverOs: "darwin", connectedProviders: [] });
    if (u.includes("/api/tunnel/endpoints")) return jsonRes({ success: true, data: { endpoints: [] } });
    if (u.includes("/api/tunnel-readiness")) return jsonRes({ success: true, data: { providers: [] } });
    return jsonRes({ success: true, data: {} });
  }) as typeof fetch);
}

beforeEach(() => reachabilityStore.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useRemoteAccessSnapshot", () => {
  it("F5: the LAN road is loading — never Off — until the config read returns", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    route(() => new Promise((resolve) => setTimeout(() => resolve(jsonRes({ success: true, data: CONFIG })), 300)));
    const { result } = renderHook(() => useRemoteAccessSnapshot(true, false));
    expect(roads(result.current.snapshot).lan.state).toBe("loading");
    expect(evaluate("accept", result.current.snapshot).sat).toBe("unknown");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(roads(result.current.snapshot).lan.state).toBe("on"));
  });

  it("X7: a failed config read is unknown (not Off) and a retry converges", async () => {
    let calls = 0;
    route(async () => (++calls === 1 ? jsonRes({ success: false, error: "boom" }, 500) : jsonRes({ success: true, data: CONFIG })));
    const { result } = renderHook(() => useRemoteAccessSnapshot(true, false));
    await waitFor(() => expect(roads(result.current.snapshot).lan.state).toBe("unknown"));
    expect(evaluate("accept", result.current.snapshot)).toMatchObject({ sat: "unknown", pending: "error" });
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() => expect(roads(result.current.snapshot).lan.state).toBe("on"));
  });

  it("a reachability broadcast outranks the config read", async () => {
    route(async () => jsonRes({ success: true, data: { ...CONFIG, reachability: { ...CONFIG.reachability, resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1" } } }));
    const { result } = renderHook(() => useRemoteAccessSnapshot(true, false));
    await waitFor(() => expect(roads(result.current.snapshot).lan.state).toBe("off"));
    act(() => reachabilityStore.set({ resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" }));
    expect(roads(result.current.snapshot).lan.state).toBe("on");
  });

  it("reads nothing while the dialog is closed", () => {
    const spy = route(async () => jsonRes({ success: true, data: CONFIG }));
    renderHook(() => useRemoteAccessSnapshot(false, true));
    expect(spy).not.toHaveBeenCalled();
  });
});
