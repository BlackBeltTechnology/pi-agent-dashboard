import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { performServerSwitch, type ServerSwitchDeps } from "../api/server-switch.js";
import { createReplayCache } from "../replay/replay-cache.js";
import { createReplayPersister } from "../replay/replay-persist.js";

function makeStorage() {
  const map = new Map<string, string>();
  return {
    setItem: vi.fn((k: string, v: string) => map.set(k, v)),
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    removeItem: vi.fn((k: string) => map.delete(k)),
    _map: map,
  };
}

function makeDeps(overrides: Partial<ServerSwitchDeps> = {}): ServerSwitchDeps {
  return {
    openStagingSocket: vi.fn(async () =>
      ({ close: vi.fn() } as unknown as WebSocket),
    ),
    clearInMemoryState: vi.fn(),
    setWsUrl: vi.fn(),
    persistLastServer: vi.fn(),
    notifyError: vi.fn(),
    ...overrides,
  };
}

describe("performServerSwitch", () => {
  it("success path: opens staging, closes staging, clears state, setWsUrl, persists", async () => {
    const stagingWs = { close: vi.fn() } as unknown as WebSocket;
    const deps = makeDeps({
      openStagingSocket: vi.fn(async () => stagingWs),
    });
    const result = await performServerSwitch(
      { host: "newpc", port: 8000, wsProtocol: "ws:" },
      deps,
    );
    expect(result).toEqual({ ok: true });
    expect(deps.openStagingSocket).toHaveBeenCalledWith(
      "ws://newpc:8000/ws",
      { timeoutMs: 5000 },
    );
    expect((stagingWs.close as any).mock.calls.length).toBe(1);
    expect(deps.clearInMemoryState).toHaveBeenCalledTimes(1);
    expect(deps.setWsUrl).toHaveBeenCalledWith("ws://newpc:8000/ws");
    expect(deps.persistLastServer).toHaveBeenCalledWith("newpc", 8000);
    expect(deps.notifyError).not.toHaveBeenCalled();
  });

  it("failure path: staging throws \u2192 no state cleared, no wsUrl change, no persist, notifyError called", async () => {
    const deps = makeDeps({
      openStagingSocket: vi.fn(async () => {
        throw new Error("Staging socket timed out after 5000ms");
      }),
    });
    const result = await performServerSwitch(
      { host: "dead", port: 8000, wsProtocol: "ws:" },
      deps,
    );
    expect(result.ok).toBe(false);
    expect(deps.clearInMemoryState).not.toHaveBeenCalled();
    expect(deps.setWsUrl).not.toHaveBeenCalled();
    expect(deps.persistLastServer).not.toHaveBeenCalled();
    expect(deps.notifyError).toHaveBeenCalledWith(
      expect.stringContaining("dead"),
    );
  });

  it("ordering: setWsUrl is called AFTER clearInMemoryState AND BEFORE persistLastServer", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      clearInMemoryState: vi.fn(() => void order.push("clear")),
      setWsUrl: vi.fn(() => void order.push("setWsUrl")),
      persistLastServer: vi.fn(() => void order.push("persist")),
    });
    await performServerSwitch(
      { host: "x", port: 8000, wsProtocol: "ws:" },
      deps,
    );
    expect(order).toEqual(["clear", "setWsUrl", "persist"]);
  });

  it("failed switch leaves replay buffers and stored entries usable (test-plan #X2)", async () => {
    // Binds the guarantee to the REAL persister: the durable/buffer reset lives
    // inside clearInMemoryState (design D3), so a failed staging open cannot
    // reach it. If someone moves resetBuffers into performServerSwitch itself,
    // this test goes red.
    const factory = new IDBFactory();
    const cache = createReplayCache({ factory });
    const persister = createReplayPersister(cache, 0, () => "a:8000");
    persister.seed("s1", [
      {
        seq: 4,
        event: { sessionId: "s1", eventType: "message_end", timestamp: 4, data: {} } as unknown as DashboardEvent,
      },
    ]);
    await persister.flush("s1");

    const deps = makeDeps({
      openStagingSocket: vi.fn(async () => {
        throw new Error("Staging socket timed out after 5000ms");
      }),
      clearInMemoryState: vi.fn(() => persister.resetBuffers()),
    });

    const result = await performServerSwitch(
      { host: "dead", port: 8000, wsProtocol: "ws:" },
      deps,
    );

    expect(result.ok).toBe(false);
    expect(deps.clearInMemoryState).not.toHaveBeenCalled();
    expect(deps.notifyError).toHaveBeenCalledTimes(1);
    // Server A's entry survives and still delta-replays from its cursor.
    expect((await cache.get("s1", "a:8000"))?.maxSeq).toBe(4);
  });

  it("builds wss:// URL when wsProtocol is 'wss:'", async () => {
    const deps = makeDeps();
    await performServerSwitch(
      { host: "secure", port: 443, wsProtocol: "wss:" },
      deps,
    );
    expect(deps.openStagingSocket).toHaveBeenCalledWith(
      "wss://secure:443/ws",
      { timeoutMs: 5000 },
    );
  });
});
