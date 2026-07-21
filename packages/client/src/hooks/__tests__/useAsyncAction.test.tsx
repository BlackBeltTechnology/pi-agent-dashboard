import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAsyncAction } from "../useAsyncAction.js";

describe("useAsyncAction — http mode", () => {
  it("idle → pending → success: disables while running, re-enables on resolve", async () => {
    let resolveFn: (() => void) | undefined;
    const fn = vi.fn(() => new Promise<void>((res) => { resolveFn = res; }));
    const { result } = renderHook(() => useAsyncAction(fn));

    expect(result.current.pending).toBe(false);
    expect(result.current.bind.disabled).toBe(false);

    act(() => { result.current.run(); });
    expect(result.current.pending).toBe(true);
    expect(result.current.bind.disabled).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFn?.(); });
    expect(result.current.pending).toBe(false);
    expect(result.current.bind.disabled).toBe(false);
  });

  it("calls onSuccess and shows a success toast on resolve", async () => {
    const showToast = vi.fn();
    const onSuccess = vi.fn();
    const fn = vi.fn(() => Promise.resolve());
    const { result } = renderHook(() =>
      useAsyncAction(fn, { showToast, onSuccess, successToast: "Done!" }),
    );

    await act(async () => { result.current.run(); });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Done!", "success");
  });

  it("idle → pending → error: rejection sets error and routes to an error toast", async () => {
    const showToast = vi.fn();
    const fn = vi.fn(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useAsyncAction(fn, { showToast }));

    await act(async () => { result.current.run(); });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    expect(showToast).toHaveBeenCalledWith("boom", "error");
  });

  it("ignores concurrent runs while pending (double-click guard)", async () => {
    let resolveFn: (() => void) | undefined;
    const fn = vi.fn(() => new Promise<void>((res) => { resolveFn = res; }));
    const { result } = renderHook(() => useAsyncAction(fn));

    act(() => {
      result.current.run();
      result.current.run();
      result.current.run();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => { resolveFn?.(); });
  });
});

describe("useAsyncAction — ws mode", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stays pending after fetch resolves until the correlated event arrives", async () => {
    const handlers: ((msg: ServerToBrowserMessage) => void)[] = [];
    const onMessage = (h: (msg: ServerToBrowserMessage) => void) => {
      handlers.push(h);
      return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); };
    };
    const showToast = vi.fn();
    const onSuccess = vi.fn();
    const reqId = "req-1";
    const fn = vi.fn(() => Promise.resolve());
    // Call site closes over its own client-generated correlation id.
    const confirmEvent = (msg: ServerToBrowserMessage) =>
      (msg as any).type === "server_restarting" && (msg as any).requestId === reqId;

    const { result } = renderHook(() =>
      useAsyncAction(fn, {
        confirm: "ws",
        onMessage,
        confirmEvent,
        showToast,
        onSuccess,
        successToast: "Restarted",
      }),
    );

    // Handler registers synchronously on run(), before fn() resolves.
    act(() => { result.current.run(); });
    expect(handlers.length).toBe(1);
    await act(async () => {});
    // HTTP resolved but we wait on the WS event
    expect(result.current.pending).toBe(true);
    expect(handlers.length).toBe(1);

    act(() => {
      handlers[0]({ type: "server_restarting", requestId: "req-1" } as any);
    });
    expect(result.current.pending).toBe(false);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Restarted", "success");
    expect(handlers.length).toBe(0); // unregistered
  });

  it("timeout fallback clears pending and emits a still-working neutral toast", async () => {
    const handlers: ((msg: ServerToBrowserMessage) => void)[] = [];
    const onMessage = (h: (msg: ServerToBrowserMessage) => void) => {
      handlers.push(h);
      return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); };
    };
    const showToast = vi.fn();
    const fn = vi.fn(() => Promise.resolve());
    const confirmEvent = () => false;

    const { result } = renderHook(() =>
      useAsyncAction(fn, {
        confirm: "ws",
        onMessage,
        confirmEvent,
        showToast,
        confirmTimeoutMs: 1000,
      }),
    );

    await act(async () => { result.current.run(); });
    expect(result.current.pending).toBe(true);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.pending).toBe(false);
    // Passive background hint reclassed info → neutral. See change:
    // unify-message-severity-colors (D5).
    expect(showToast).toHaveBeenCalledWith("Still working in the background…", "neutral");
    expect(handlers.length).toBe(0);
  });
});
