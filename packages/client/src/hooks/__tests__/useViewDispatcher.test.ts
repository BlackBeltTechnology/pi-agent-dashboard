import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useViewDispatcher } from "../useViewDispatcher.js";
import type { ConnectionStatus } from "../useWebSocket.js";

/**
 * See change: session-card-unread-stripes.
 */
describe("useViewDispatcher", () => {
  function setup(initial: { id: string | null; status: ConnectionStatus }) {
    const send = vi.fn();
    const { rerender } = renderHook(
      ({ id, status }: { id: string | null; status: ConnectionStatus }) =>
        useViewDispatcher({
          viewedSessionId: id,
          connectionStatus: status,
          send,
        }),
      { initialProps: { id: initial.id, status: initial.status } },
    );
    return { send, rerender };
  }

  it("sends session_view on initial mount with a non-null id (connected)", () => {
    const { send } = setup({ id: "abc", status: "connected" });
    expect(send).toHaveBeenCalledTimes(2); // one from id-effect, one from connect-effect
    expect(send).toHaveBeenCalledWith({ type: "session_view", sessionId: "abc" });
  });

  it("does NOT send session_view when id is null on mount", () => {
    const { send } = setup({ id: null, status: "connected" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends unview→view when navigating between sessions", () => {
    const { send, rerender } = setup({ id: "abc", status: "connected" });
    send.mockClear();
    rerender({ id: "xyz", status: "connected" });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(1, { type: "session_unview", sessionId: "abc" });
    expect(send).toHaveBeenNthCalledWith(2, { type: "session_view", sessionId: "xyz" });
  });

  it("sends unview when navigating away (id → null)", () => {
    const { send, rerender } = setup({ id: "abc", status: "connected" });
    send.mockClear();
    rerender({ id: null, status: "connected" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "session_unview", sessionId: "abc" });
  });

  it("re-sends session_view on reconnect (offline → connected) for the current id", () => {
    const { send, rerender } = setup({ id: "abc", status: "connected" });
    send.mockClear();
    // Drop to offline
    rerender({ id: "abc", status: "offline" });
    // Reconnect
    rerender({ id: "abc", status: "connected" });
    expect(send).toHaveBeenCalledWith({ type: "session_view", sessionId: "abc" });
  });

  it("does NOT re-send on reconnect when no session is viewed", () => {
    const { send, rerender } = setup({ id: null, status: "connected" });
    send.mockClear();
    rerender({ id: null, status: "offline" });
    rerender({ id: null, status: "connected" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT re-send on every render while staying connected", () => {
    const { send, rerender } = setup({ id: "abc", status: "connected" });
    send.mockClear();
    rerender({ id: "abc", status: "connected" });
    rerender({ id: "abc", status: "connected" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does NOT send unview → view when id is unchanged across reconnect — only the reconnect re-send fires", () => {
    const { send, rerender } = setup({ id: "abc", status: "connecting" });
    // Initial: status starts in "connecting" so the connect-effect did NOT
    // fire yet, but the id-effect did → 1 send.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ type: "session_view", sessionId: "abc" });

    send.mockClear();
    rerender({ id: "abc", status: "connected" });
    // First connect → reconnect-arm re-sends session_view
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({ type: "session_view", sessionId: "abc" });
  });
});
