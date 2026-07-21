import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTranslateBridgeDispatcher } from "../translate-via-bridge.js";
import type { PiGateway } from "../pi-gateway.js";

function makeGateway(opts: {
  connected: string[];
  sendOk?: boolean;
  onSend?: (sessionId: string, msg: any) => void;
}): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    address: () => 9999,
    sendToSession: vi.fn((sid, msg) => {
      opts.onSend?.(sid, msg);
      return opts.sendOk ?? true;
    }),
    broadcast: vi.fn(),
    connectionCount: () => opts.connected.length,
    findSessionByCwd: () => undefined,
    findSessionsByCwd: () => [],
    getConnectedSessionIds: () => opts.connected,
    isSessionConnected: (sid: string) => opts.connected.includes(sid),
    closeSession: () => false,
  } as unknown as PiGateway;
}

describe("createTranslateBridgeDispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("rejects with helpful message when no bridge is connected", async () => {
    const gw = makeGateway({ connected: [] });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });
    const r = await d.translate({ provider: "p", model: "m", system: "s", user: "u" });
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("No bridge");
    expect(gw.sendToSession).not.toHaveBeenCalled();
  });

  it("sends translate_request to first connected session and resolves on matching response", async () => {
    let captured: any = null;
    const gw = makeGateway({
      connected: ["s1", "s2"],
      onSend: (_sid, msg) => { captured = msg; },
    });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });

    const promise = d.translate({
      provider: "opencode-go",
      model: "kimi-k2.6",
      system: "translate to english",
      user: "Szia",
      maxTokens: 512,
    });

    // Was sent to first session with correct shape
    expect(gw.sendToSession).toHaveBeenCalledTimes(1);
    expect((gw.sendToSession as any).mock.calls[0][0]).toBe("s1");
    expect(captured.type).toBe("translate_request");
    expect(captured.modelRef).toBe("opencode-go/kimi-k2.6");
    expect(captured.system).toBe("translate to english");
    expect(captured.user).toBe("Szia");
    expect(captured.maxTokens).toBe(512);
    expect(typeof captured.requestId).toBe("string");
    expect(captured.requestId.length).toBeGreaterThan(8);

    // Bridge replies
    d.handleResponse({
      type: "translate_response",
      requestId: captured.requestId,
      ok: true,
      text: "Hi",
    });
    const r = await promise;
    expect(r).toEqual({ ok: true, text: "Hi" });
  });

  it("propagates not-ok responses with status + error", async () => {
    let captured: any = null;
    const gw = makeGateway({
      connected: ["s1"],
      onSend: (_sid, msg) => { captured = msg; },
    });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });

    const promise = d.translate({ provider: "p", model: "m", system: "s", user: "u" });
    d.handleResponse({
      type: "translate_response",
      requestId: captured.requestId,
      ok: false,
      status: 401,
      error: "auth failed",
    });
    const r = await promise;
    expect(r).toEqual({ ok: false, status: 401, error: "auth failed" });
  });

  it("times out when no response arrives", async () => {
    const gw = makeGateway({ connected: ["s1"] });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });
    const promise = d.translate({ provider: "p", model: "m", system: "s", user: "u", timeoutMs: 100 });

    vi.advanceTimersByTime(101);
    const r = await promise;
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("timed out");
  });

  it("ignores stale handleResponse for unknown requestId", async () => {
    const gw = makeGateway({ connected: ["s1"] });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });
    // No throw on unknown requestId
    d.handleResponse({
      type: "translate_response",
      requestId: "never-issued",
      ok: true,
      text: "x",
    });
    expect(true).toBe(true);
  });

  it("resolves outstanding requests with shutdown reason", async () => {
    let captured: any = null;
    const gw = makeGateway({
      connected: ["s1"],
      onSend: (_sid, msg) => { captured = msg; },
    });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });

    const promise = d.translate({ provider: "p", model: "m", system: "s", user: "u" });
    expect(captured).toBeTruthy();
    d.shutdown("test");
    const r = await promise;
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("shutting down");
  });

  it("rejects when sendToSession returns false (race: connection dropped)", async () => {
    const gw = makeGateway({ connected: ["s1"], sendOk: false });
    const d = createTranslateBridgeDispatcher({ piGateway: gw });
    const r = await d.translate({ provider: "p", model: "m", system: "s", user: "u" });
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("connection dropped");
  });
});
