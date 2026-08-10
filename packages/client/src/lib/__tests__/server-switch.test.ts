import { describe, it, expect, vi } from "vitest";
import { performServerSwitch, type ServerSwitchDeps } from "../api/server-switch.js";

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
