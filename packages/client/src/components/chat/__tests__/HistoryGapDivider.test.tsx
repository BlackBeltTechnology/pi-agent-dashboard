/**
 * Rendered gap-divider states A1-A6 and the splice scroll anchor — test-plan
 * rows F5, F7 and F9, plus the F14 singular/plural boundary.
 *
 * Catalogued as L3; covered here for the reason given in
 * `useMessageHandler.history-gap.test.tsx` (the divider only appears once a
 * WebSocket `history_window` has landed, which Playwright routing cannot
 * synthesize against the shared harness).
 *
 * See change: lazy-load-session-history (mockups/ui-plan.md § A).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  captureScrollAnchor,
  type HistoryGapState,
  nextBackfillRange,
  restoreScrollAnchor,
} from "../../../lib/chat/history-gap.js";
import { HistoryGapDivider } from "../HistoryGapDivider.js";

const gap = (over: Partial<HistoryGapState> = {}): HistoryGapState => ({
  headMaxSeq: 20,
  tailMinSeq: 4800,
  gapCount: 1200,
  oldestGapSeq: 21,
  pending: false,
  failed: false,
  unservable: false,
  dividerPlaced: true,
  armed: true,
  ...over,
});

/** Every protocol code the server may return. None may reach the user. */
const PROTOCOL_CODES = ["not_subscribed", "in_flight", "out_of_range", "stale_generation"];

describe("HistoryGapDivider — A1 idle (F5)", () => {
  it("states the EXACT count and offers a secondary load action", () => {
    render(<HistoryGapDivider gap={gap()} onLoadEarlier={vi.fn()} />);
    // We know the count at subscribe time; an unlabelled "Load more" would make
    // the user guess how much of their session is hidden.
    expect(screen.getByTestId("history-gap-count").textContent).toBe("1,200 earlier messages");
    expect((screen.getByTestId("history-gap-load") as HTMLButtonElement).disabled).toBe(false);
  });

  it("F14: the count reads naturally at the singular boundary", () => {
    render(<HistoryGapDivider gap={gap({ gapCount: 1 })} onLoadEarlier={vi.fn()} />);
    expect(screen.getByTestId("history-gap-count").textContent).toBe("1 earlier message");
  });

  it("the count is announced, not merely drawn", () => {
    render(<HistoryGapDivider gap={gap()} onLoadEarlier={vi.fn()} />);
    expect(screen.getByTestId("history-gap-count").getAttribute("role")).toBe("status");
  });

  it("F10: the action is DISABLED while backfill is disarmed", () => {
    render(<HistoryGapDivider gap={gap({ armed: false })} onLoadEarlier={vi.fn()} />);
    expect((screen.getByTestId("history-gap-load") as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking requests the load exactly once", () => {
    const onLoadEarlier = vi.fn();
    render(<HistoryGapDivider gap={gap()} onLoadEarlier={onLoadEarlier} />);
    fireEvent.click(screen.getByTestId("history-gap-load"));
    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });
});

describe("HistoryGapDivider — A2 loading", () => {
  it("swaps to a busy, non-actionable state", () => {
    render(<HistoryGapDivider gap={gap({ pending: true })} onLoadEarlier={vi.fn()} />);
    const btn = screen.getByTestId("history-gap-loading");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("history-gap-load")).toBeNull();
  });
});

describe("HistoryGapDivider — A4 refused", () => {
  it("shows ONE plain-language line plus a retry", () => {
    render(<HistoryGapDivider gap={gap({ failed: true })} onLoadEarlier={vi.fn()} />);
    expect(screen.getByTestId("history-gap-error").textContent).toContain("Could not load earlier messages.");
    expect((screen.getByTestId("history-gap-retry") as HTMLButtonElement).disabled).toBe(false);
  });

  it("never surfaces a protocol code to the user", () => {
    const { container } = render(<HistoryGapDivider gap={gap({ failed: true })} onLoadEarlier={vi.fn()} />);
    for (const code of PROTOCOL_CODES) {
      expect(container.textContent, code).not.toContain(code);
    }
  });

  it("state is carried by an icon PLUS text, never by colour alone", () => {
    const { container } = render(<HistoryGapDivider gap={gap({ failed: true })} onLoadEarlier={vi.fn()} />);
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("HistoryGapDivider — A5 unavailable", () => {
  it("renders a NON-actionable tombstone: nothing failed, the events are gone", () => {
    render(<HistoryGapDivider gap={gap({ unservable: true })} onLoadEarlier={vi.fn()} />);
    expect(screen.getByTestId("history-gap-unavailable").textContent).toContain(
      "Earlier messages are no longer available.",
    );
    // Deliberately NOT an error, and offers no retry — there is nothing to retry.
    expect(screen.queryByTestId("history-gap-retry")).toBeNull();
    expect(screen.queryByTestId("history-gap-load")).toBeNull();
    expect(screen.queryByTestId("history-gap-error")).toBeNull();
  });

  it("unavailable outranks a prior failure, so a tombstone never shows a retry", () => {
    render(<HistoryGapDivider gap={gap({ unservable: true, failed: true })} onLoadEarlier={vi.fn()} />);
    expect(screen.queryByTestId("history-gap-retry")).toBeNull();
  });
});

describe("splice scroll anchor (F7)", () => {
  it("restores the pre-splice reading position when rows are inserted ABOVE", () => {
    // jsdom reports scrollHeight as 0, so the arithmetic is asserted directly —
    // an in-component assertion here would be vacuously true.
    const before = { scrollHeight: 10000, scrollTop: 3000 };
    const anchor = captureScrollAnchor(before);
    // 1200 spliced rows add 4000px ABOVE the viewport.
    const after = { scrollHeight: 14000 };
    expect(restoreScrollAnchor(after, anchor)).toBe(7000);
    // The distance to the bottom of the content is unchanged — the row the user
    // was reading has not moved.
    expect(after.scrollHeight - restoreScrollAnchor(after, anchor)).toBe(anchor);
  });

  it("is a no-op when nothing was inserted", () => {
    const el = { scrollHeight: 10000, scrollTop: 3000 };
    expect(restoreScrollAnchor(el, captureScrollAnchor(el))).toBe(el.scrollTop);
  });
});

describe("nextBackfillRange — requests the slice adjacent to the HEAD", () => {
  it("starts one above the head and is bounded by the server's max span", () => {
    expect(nextBackfillRange(gap())).toEqual({ fromSeq: 21, toSeq: 520 });
  });

  it("never runs past the tail's first seq", () => {
    expect(nextBackfillRange(gap({ headMaxSeq: 4700 }))).toEqual({ fromSeq: 4701, toSeq: 4799 });
  });
});
