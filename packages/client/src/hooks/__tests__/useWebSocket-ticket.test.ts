import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAccessToken, getAccessToken, setAccessToken } from "../../lib/identity/token-store.js";
import { clearDeviceBearer } from "../../lib/pairing/device-auth.js";
import { IDENTITY_EXPIRED_CLOSE_CODE, useWebSocket } from "../useWebSocket.js";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly OPEN = 1;
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send() {}
  close() {}
  /** Simulate a server-side close with a given code. */
  fireClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const WS_URL = "ws://test/ws";

describe("useWebSocket ticket minting for the identity plane (§12.3)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    clearAccessToken();
    clearDeviceBearer();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearAccessToken();
  });

  it("an unpaired human with a live identity token mints a ticket; only ?ticket= rides the socket", async () => {
    setAccessToken("identity-access-tok", 300); // plane active, no device bearer
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: { ticket: "TICKET-XYZ" } })));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useWebSocket(WS_URL));

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    const socket = MockWebSocket.instances[0]!;
    // Ticket present on the socket URL…
    expect(socket.url).toContain("ticket=TICKET-XYZ");
    // …and the durable/bearer token itself NEVER rides the socket (F6).
    expect(socket.url).not.toContain("identity-access-tok");

    // The mint call authenticated with the identity bearer, scope browser.
    const mintCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes("/api/ws-ticket"));
    expect(mintCall).toBeTruthy();
    const init = mintCall![1] as RequestInit;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer identity-access-tok");
    expect(String(init.body)).toContain("browser");
  });

  it("a browser with no credential opens the socket without a ticket (inert path)", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);

    renderHook(() => useWebSocket(WS_URL));

    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));
    expect(MockWebSocket.instances[0]!.url).toBe(WS_URL);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/api/ws-ticket"))).toBe(false);
  });
});

describe("reconnect on identity expiry (§12.4)", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, data: { ticket: "T" } }))));
    clearAccessToken();
    clearDeviceBearer();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearAccessToken();
  });

  it("a 4001 close clears the stale token, invokes re-acquire, then reconnects", async () => {
    setAccessToken("stale-tok", 300);
    const reacquire = vi.fn(async () => setAccessToken("fresh-tok", 300));

    renderHook(() => useWebSocket(WS_URL, reacquire));
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    MockWebSocket.instances[0]!.fireClose(IDENTITY_EXPIRED_CLOSE_CODE);

    await vi.waitFor(() => expect(reacquire).toHaveBeenCalledTimes(1));
    // Re-acquire ran and replaced the token; a fresh socket is opened.
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(2));
    expect(getAccessToken()).toBe("fresh-tok");
  });

  it("a non-4001 close does NOT invoke the re-acquire hook", async () => {
    setAccessToken("tok", 300);
    const reacquire = vi.fn();
    renderHook(() => useWebSocket(WS_URL, reacquire));
    await vi.waitFor(() => expect(MockWebSocket.instances.length).toBe(1));

    MockWebSocket.instances[0]!.fireClose(1006); // abnormal transport close
    // Deterministic (no timer): a non-4001 close never enters the re-acquire
    // branch, so a single microtask flush settles any handler continuation and
    // the negative assertion holds without a fixed-tick barrier.
    await Promise.resolve();
    expect(reacquire).not.toHaveBeenCalled();
  });
});
