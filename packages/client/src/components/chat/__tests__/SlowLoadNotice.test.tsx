/**
 * Slow-load notice threshold + announce-once contract.
 * See change: show-session-history-load-state (test-plan #E3, #F7).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOW_LOAD_MS } from "../../../lib/replay/history-load-phase.js";
import { SlowLoadNotice } from "../SlowLoadNotice.js";

const T0 = 1_000_000;

describe("SlowLoadNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("#E3 renders nothing at t0+9 999 ms, notice + · 10s + Retry at t0+10 000 ms", () => {
    const onRetry = vi.fn();
    render(<SlowLoadNotice startedAt={T0} onRetry={onRetry} />);
    act(() => {
      vi.advanceTimersByTime(SLOW_LOAD_MS - 1);
    });
    expect(screen.queryByTestId("chat-history-slow-notice")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Still loading history")).toBeTruthy();
    expect(screen.getByText("· 10s")).toBeTruthy();
    fireEvent.click(screen.getByTestId("chat-history-slow-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("#F7 live text stays static while the aria-hidden seconds advance", () => {
    vi.setSystemTime(T0 + SLOW_LOAD_MS);
    render(<SlowLoadNotice startedAt={T0} onRetry={() => {}} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Still loading history");
    const secs = screen.getByText("· 10s");
    expect(secs.getAttribute("aria-hidden")).toBe("true");
    for (let i = 0; i < 3; i++) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(screen.getByRole("status").textContent).toBe("Still loading history");
    }
    expect(screen.getByText("· 13s")).toBeTruthy();
  });
});
