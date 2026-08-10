/**
 * RecoveryOfferHost: renders from the recovery-offer bus, routes reopen
 * through onReopen, dismisses durably via onDismiss (sends recovery_dismiss
 * with the offered ids), never auto-times-out, and auto-dismisses when a
 * session is resumed (bus cleared).
 * See change: fix-recovery-offer-dismiss-and-phantom-reopen (task 4.3).
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRecoveryOfferBusForTests,
  clearRecoveryOffer,
  setRecoveryOffer,
} from "../../lib/state/recovery-offer-bus.js";
import { RecoveryOfferHost } from "../session/RecoveryOfferHost.js";

describe("RecoveryOfferHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetRecoveryOfferBusForTests();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function push() {
    act(() => {
      setRecoveryOffer([
        { sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" },
      ]);
    });
  }

  it("renders nothing with no offer", () => {
    const { queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} onDismiss={() => {}} />);
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  it("renders the offer with the candidate count", () => {
    const { getByTestId, queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} onDismiss={() => {}} />);
    push();
    expect(queryByTestId("recovery-offer-host")).not.toBeNull();
    expect(getByTestId("recovery-offer-host").textContent).toContain("Reopen 3 sessions");
    // a11y: the async offer must live in a polite live region so screen
    // readers announce it. See change: reopen-sessions-after-shutdown.
    const live = getByTestId("recovery-offer-host").querySelector('[role="status"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute("aria-live")).toBe("polite");
  });

  it("reopen routes all candidate ids through onReopen and clears the offer", () => {
    const onReopen = vi.fn();
    const onDismiss = vi.fn();
    const { getByTestId, queryByTestId } = render(<RecoveryOfferHost onReopen={onReopen} onDismiss={onDismiss} />);
    push();
    fireEvent.click(getByTestId("recovery-offer-reopen"));
    expect(onReopen).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  it("dismiss sends recovery_dismiss with the offered ids and clears the offer without reopening", () => {
    const onReopen = vi.fn();
    const onDismiss = vi.fn();
    const { getByTestId, queryByTestId } = render(<RecoveryOfferHost onReopen={onReopen} onDismiss={onDismiss} />);
    push();
    fireEvent.click(getByTestId("recovery-offer-dismiss"));
    expect(onDismiss).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(onReopen).not.toHaveBeenCalled();
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  it("does NOT auto-time-out", () => {
    const { queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} onDismiss={() => {}} />);
    push();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(queryByTestId("recovery-offer-host")).not.toBeNull();
  });

  it("auto-dismisses when a session is resumed (bus cleared upstream)", () => {
    const { queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} onDismiss={() => {}} />);
    push();
    expect(queryByTestId("recovery-offer-host")).not.toBeNull();
    act(() => { clearRecoveryOffer(); }); // mirrors resume_result success path
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  // Class-2 grace window: while liveness is unresolved (graceUntil in the
  // future) Reopen is NON-actionable so a still-alive session cannot be
  // double-spawned; after the window it enables.
  // See change: fix-recovery-offer-bridge-liveness-gate.
  it("keeps Reopen non-actionable during the liveness grace window, then enables it", () => {
    const onReopen = vi.fn();
    const { getByTestId } = render(<RecoveryOfferHost onReopen={onReopen} onDismiss={() => {}} />);
    act(() => {
      setRecoveryOffer([{ sessionId: "a" }], Date.now() + 2500);
    });
    const reopen = getByTestId("recovery-offer-reopen") as HTMLButtonElement;
    // Disabled + verifying hint; a click must NOT reopen (no double-spawn).
    expect(reopen.disabled).toBe(true);
    expect(getByTestId("recovery-offer-host").textContent).toContain("Checking if still running");
    fireEvent.click(reopen);
    expect(onReopen).not.toHaveBeenCalled();
    // Window closes → Reopen becomes actionable.
    act(() => { vi.advanceTimersByTime(2500); });
    expect((getByTestId("recovery-offer-reopen") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getByTestId("recovery-offer-reopen"));
    expect(onReopen).toHaveBeenCalledWith(["a"]);
  });

  // Undefined custom properties resolve to the empty string, painting a
  // transparent card / invisible button. The card and primary action must
  // bind to theme-declared tokens (--bg-surface / --accent-primary), never
  // the undeclared --bg-elevated / --accent.
  // See change: fix-recovery-offer-undefined-tokens.
  it("binds card + reopen action to declared theme tokens, not undeclared ones", () => {
    const { getByTestId } = render(<RecoveryOfferHost onReopen={() => {}} onDismiss={() => {}} />);
    push();
    const card = getByTestId("recovery-offer-host").querySelector('[role="status"]') as HTMLElement;
    const reopen = getByTestId("recovery-offer-reopen");
    expect(card.className).toContain("bg-[var(--bg-surface)]");
    expect(reopen.className).toContain("bg-[var(--accent-primary)]");
    expect(card.className).not.toContain("--bg-elevated");
    expect(reopen.className).not.toContain("var(--accent)");
  });
});
