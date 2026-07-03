/**
 * RecoveryOfferHost: renders from the recovery-offer bus, routes reopen
 * through onReopen, dismisses non-destructively, never auto-times-out, and
 * auto-dismisses when a session is resumed (bus cleared).
 * See change: reopen-sessions-after-shutdown (task 6.1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, fireEvent, cleanup } from "@testing-library/react";
import { RecoveryOfferHost } from "../RecoveryOfferHost.js";
import {
  setRecoveryOffer,
  clearRecoveryOffer,
  __resetRecoveryOfferBusForTests,
} from "../../lib/recovery-offer-bus.js";

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
    const { queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} />);
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  it("renders the offer with the candidate count", () => {
    const { getByTestId, queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} />);
    push();
    expect(queryByTestId("recovery-offer-host")).not.toBeNull();
    expect(getByTestId("recovery-offer-host").textContent).toContain("Reopen 3 sessions");
    // a11y: the async offer must live in a polite live region so screen
    // readers announce it. See change: reopen-sessions-after-shutdown.
    const live = getByTestId("recovery-offer-host").querySelector('[role="status"]');
    expect(live).not.toBeNull();
    expect(live?.getAttribute("aria-live")).toBe("polite");
  });

  it("reopen routes all candidate ids and clears the offer", () => {
    const onReopen = vi.fn();
    const { getByTestId, queryByTestId } = render(<RecoveryOfferHost onReopen={onReopen} />);
    push();
    fireEvent.click(getByTestId("recovery-offer-reopen"));
    expect(onReopen).toHaveBeenCalledWith(["a", "b", "c"]);
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  it("dismiss clears the offer without reopening", () => {
    const onReopen = vi.fn();
    const { getByTestId, queryByTestId } = render(<RecoveryOfferHost onReopen={onReopen} />);
    push();
    fireEvent.click(getByTestId("recovery-offer-dismiss"));
    expect(onReopen).not.toHaveBeenCalled();
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });

  it("does NOT auto-time-out", () => {
    const { queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} />);
    push();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(queryByTestId("recovery-offer-host")).not.toBeNull();
  });

  it("auto-dismisses when a session is resumed (bus cleared upstream)", () => {
    const { queryByTestId } = render(<RecoveryOfferHost onReopen={() => {}} />);
    push();
    expect(queryByTestId("recovery-offer-host")).not.toBeNull();
    act(() => { clearRecoveryOffer(); }); // mirrors resume_result success path
    expect(queryByTestId("recovery-offer-host")).toBeNull();
  });
});
