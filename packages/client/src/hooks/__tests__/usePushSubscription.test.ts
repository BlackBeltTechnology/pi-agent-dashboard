/**
 * `usePushSubscription.subscribe()` only reports "subscribed" once the server
 * accepted the registration — a failed `POST /api/push/register` must leave
 * the toggle off (the browser would otherwise look enabled but never be
 * delivered to). Review finding, change: add-server-push-notifications.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePushSubscription } from "../usePushSubscription.js";

function installPushApi() {
  const subscription = {
    toJSON: () => ({ endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: vi.fn(async () => true),
  };
  const pushManager = {
    getSubscription: vi.fn(async () => null),
    subscribe: vi.fn(async () => subscription),
  };
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(window, "PushManager", { value: function PushManager() {}, configurable: true });
  Object.defineProperty(window, "Notification", {
    value: { permission: "default", requestPermission: vi.fn(async () => "granted") },
    configurable: true,
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  return { pushManager, subscription };
}

function mockFetch(registerStatus: number) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (url === "/api/push/vapid-public-key") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ publicKey: "BPkA" }) });
    }
    if (url === "/api/push/register") {
      return Promise.resolve({
        ok: registerStatus < 400,
        status: registerStatus,
        json: () => Promise.resolve(registerStatus < 400 ? { tokenId: "t1" } : { error: "nope" }),
      });
    }
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  }) as unknown as typeof fetch;
}

describe("usePushSubscription.subscribe", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports subscribed after the server accepted the registration", async () => {
    installPushApi();
    mockFetch(200);
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.status).toBe("unsubscribed"));
    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.status).toBe("subscribed");
    expect(localStorage.getItem("pi-dashboard.push.tokenId")).toBe("t1");
  });

  it("stays unsubscribed when POST /api/push/register fails", async () => {
    const { subscription } = installPushApi();
    mockFetch(500);
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.status).toBe("unsubscribed"));
    await act(async () => {
      await result.current.subscribe();
    });
    expect(result.current.status).toBe("unsubscribed");
    expect(localStorage.getItem("pi-dashboard.push.tokenId")).toBeNull();
    expect(subscription.unsubscribe).toHaveBeenCalled();
  });

  it("an existing subscription the server rejects on mount is NOT shown as subscribed", async () => {
    const { pushManager, subscription } = installPushApi();
    pushManager.getSubscription.mockResolvedValue(subscription as never);
    mockFetch(500);
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.status).toBe("unsubscribed"));
    expect(localStorage.getItem("pi-dashboard.push.tokenId")).toBeNull();
  });

  it("an existing subscription the server accepts on mount is shown as subscribed", async () => {
    const { pushManager, subscription } = installPushApi();
    pushManager.getSubscription.mockResolvedValue(subscription as never);
    mockFetch(200);
    const { result } = renderHook(() => usePushSubscription());
    await waitFor(() => expect(result.current.status).toBe("subscribed"));
    expect(localStorage.getItem("pi-dashboard.push.tokenId")).toBe("t1");
  });
});
