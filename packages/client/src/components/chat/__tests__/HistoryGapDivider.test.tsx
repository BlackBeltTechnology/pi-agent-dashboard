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
import { type HistoryGapState, nextBackfillRange } from "../../../lib/chat/history-gap.js";
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
    // States the OUTCOME without attributing it to retention: an empty slice is
    // equally producible by replay compaction dropping a superseded band, so
    // "trimmed by retention" would sometimes be false.
    // See change: fix-lazy-history-backfill-ux (D8).
    const text = screen.getByTestId("history-gap-unavailable").textContent ?? "";
    expect(text).toContain("no longer available to load");
    expect(text.toLowerCase()).not.toContain("retention");
    expect(text.toLowerCase()).not.toContain("trimmed");
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

/**
 * The distance-to-bottom splice anchor is DELETED, not relocated: events now
 * splice BELOW the divider, so the surviving invariant is absolute `scrollTop`
 * and it needs no correction. Its tests go with it — asserting the old
 * arithmetic would pin behaviour this change exists to remove.
 * See change: fix-lazy-history-backfill-ux (D6).
 */

describe("nextBackfillRange — requests the slice adjacent to the TAIL (E10–E12)", () => {
  it("E10/E12: ends one below the tail and is bounded by the server's max span", () => {
    expect(nextBackfillRange(gap())).toEqual({ fromSeq: 4300, toSeq: 4799 });
  });

  it("E11: never runs below the head's last seq", () => {
    expect(nextBackfillRange(gap({ headMaxSeq: 4700 }))).toEqual({ fromSeq: 4701, toSeq: 4799 });
  });
});
