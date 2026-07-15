/**
 * Toast action + no-auto-dismiss extension.
 * See change: add-seek-to-session-card (Toast gains an optional action button
 * and a no-auto-dismiss flag for the reveal-timeout Retry toast).
 *
 * Existing display-only call sites are unaffected: no action => no button and
 * the current ~3s auto-dismiss still applies.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toast } from "../Toast.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
});

describe("Toast action button", () => {
  it("renders an action button when action is present and invokes onClick", () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <Toast
        messages={[{ id: 1, text: "Couldn't reveal", variant: "info", action: { label: "Retry", onClick }, noAutoDismiss: true }]}
        onDismiss={onDismiss}
      />,
    );
    const btn = getByTestId("toast-action");
    expect(btn.textContent).toBe("Retry");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders NO action button for an informational toast without an action", () => {
    const { queryByTestId } = render(
      <Toast messages={[{ id: 2, text: "hidden", variant: "info" }]} onDismiss={() => {}} />,
    );
    expect(queryByTestId("toast-action")).toBeNull();
  });

  it("does NOT auto-dismiss when noAutoDismiss is set", () => {
    const onDismiss = vi.fn();
    render(
      <Toast
        messages={[{ id: 3, text: "stay", variant: "info", action: { label: "Retry", onClick: () => {} }, noAutoDismiss: true }]}
        onDismiss={onDismiss}
      />,
    );
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("still auto-dismisses a normal informational toast (~3s)", () => {
    const onDismiss = vi.fn();
    render(
      <Toast messages={[{ id: 4, text: "info", variant: "info" }]} onDismiss={onDismiss} />,
    );
    act(() => { vi.advanceTimersByTime(3_000 + 300); });
    expect(onDismiss).toHaveBeenCalledWith(4);
  });
});
