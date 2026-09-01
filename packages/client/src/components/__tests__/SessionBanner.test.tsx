/**
 * Unit tests for the single-card SessionBanner (change:
 * error-banner-observe-only).
 *
 * ONE card renders the error string plus an optional live retry sub-line —
 * never two sibling cards. Observe-only: pi owns the retry loop, so the banner
 * has NO "Stop retrying" control. The trailing control's icon states its action:
 * a chevron that COLLAPSES while retrying (component-local — it never clears
 * `retryState`, so the session Stop stays mounted), and Retry + Copy + a real
 * ✕ once retrying stops with a provider error.
 * See change: raw-error-render-and-retry-authority.
 *
 * The selector (`deriveBannerState`) is tested in event-reducer.test.ts.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { SessionBanner } from "../session/SessionBanner.js";
import type { BannerRetry } from "../../lib/chat/event-reducer.js";

afterEach(() => cleanup());

const NOW = 1_700_000_000_000;
const clock = () => NOW;

const retry = (over: Partial<BannerRetry> = {}): BannerRetry => ({
  attempt: 1,
  maxAttempts: 3,
  delayMs: 2000,
  waiting: true,
  reason: "overloaded",
  startedAt: NOW,
  ...over,
});

describe("SessionBanner — hidden + single-card composition", () => {
  it("hidden variant renders nothing", () => {
    const { container } = render(<SessionBanner state={{ variant: "hidden" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders exactly ONE card for error + retry (retry is a sub-line, not a 2nd card)", () => {
    const { container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2 }) }}
        now={clock}
      />,
    );
    expect(container.querySelectorAll('[data-testid="error-banner"]').length).toBe(1);
    const card = container.querySelector('[data-testid="error-banner"]')!;
    expect(card.querySelector('[data-testid="retry-banner"]')).not.toBeNull();
  });
});

describe("SessionBanner — settled error (no retry)", () => {
  it("F1/E7 shows Retry, Copy, and a clear-only ✕ with no Stop", () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    const { getByTestId, getByTitle, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "fetch failed: ECONNRESET" } }}
        onDismiss={onDismiss}
        onRetry={onRetry}
        now={clock}
      />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("fetch failed: ECONNRESET");
    const retryButton = getByTestId("error-banner-retry") as HTMLButtonElement;
    fireEvent.click(retryButton);
    fireEvent.click(retryButton);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(retryButton.disabled).toBe(true);
    expect(getByTitle("Copy error message")).toBeTruthy();
    expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
    fireEvent.click(getByTestId("error-banner-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("E9 re-enables Retry when the same provider message settles with a new revision", () => {
    const onRetry = vi.fn();
    const error = { error: { kind: "error" as const, message: "503 overloaded" } };
    const { getByTestId, rerender } = render(
      <SessionBanner state={error} retryRevision={1} onRetry={onRetry} onDismiss={vi.fn()} now={clock} />,
    );

    fireEvent.click(getByTestId("error-banner-retry"));
    expect((getByTestId("error-banner-retry") as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <SessionBanner state={error} retryRevision={2} onRetry={onRetry} onDismiss={vi.fn()} now={clock} />,
    );
    expect((getByTestId("error-banner-retry") as HTMLButtonElement).disabled).toBe(false);
  });

  // test-plan #9: an undeliverable retry is negatively acked. The client's
  // retry_session_error handler bumps retryRevision (re-stamps lastError), which
  // re-enables the one-shot Retry at the banner boundary so the user can try
  // again. See change: replace-dashboard-retry-command-with-protocol-message.
  it("#9 negative-ack (bumped retryRevision) re-enables the one-shot Retry after a failed dispatch", () => {
    const onRetry = vi.fn();
    const error = { error: { kind: "error" as const, message: "503 overloaded" } };
    const { getByTestId, rerender } = render(
      <SessionBanner state={error} retryRevision={100} onRetry={onRetry} onDismiss={vi.fn()} now={clock} />,
    );

    // Press Retry → one-shot disables the button.
    fireEvent.click(getByTestId("error-banner-retry"));
    expect(onRetry).toHaveBeenCalledOnce();
    expect((getByTestId("error-banner-retry") as HTMLButtonElement).disabled).toBe(true);

    // retry_session_error arrives → retryRevision bumps → button re-enables.
    rerender(
      <SessionBanner state={error} retryRevision={101} onRetry={onRetry} onDismiss={vi.fn()} now={clock} />,
    );
    expect((getByTestId("error-banner-retry") as HTMLButtonElement).disabled).toBe(false);
  });

  it("F5 omits Retry without a callback but keeps Copy and X", () => {
    const { getByTestId, getByTitle, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "provider failed" } }}
        onDismiss={vi.fn()}
        now={clock}
      />,
    );
    expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    expect(getByTitle("Copy error message")).toBeTruthy();
    expect(getByTestId("error-banner-dismiss")).toBeTruthy();
  });

  it("a billing/quota error renders as an ordinary error (no special variant)", () => {
    const { getByTestId, container } = render(
      <SessionBanner state={{ error: { kind: "error", message: "usage_limit_reached" } }} onDismiss={vi.fn()} now={clock} />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("usage_limit_reached");
    expect(container.querySelector('[data-testid="limit-exceeded-banner"]')).toBeNull();
  });

  it("truncates long messages with a Show more / Show less toggle", () => {
    const long = "a".repeat(300);
    const { getByTestId } = render(
      <SessionBanner state={{ error: { kind: "error", message: long } }} collapseThreshold={240} now={clock} />,
    );
    expect(getByTestId("error-banner-text").textContent!.endsWith("…")).toBe(true);
    fireEvent.click(getByTestId("error-banner-toggle"));
    expect(getByTestId("error-banner-text").textContent).toBe(long);
  });
});

describe("SessionBanner — trailing control states its own action", () => {
  const errRetry = { error: { kind: "error" as const, message: "overloaded" }, retry: retry() };

  it("renders COLLAPSE (not dismiss) while waiting", () => {
    const { getByTestId, container } = render(
      <SessionBanner state={errRetry} onDismiss={vi.fn()} now={clock} />,
    );
    expect(getByTestId("error-banner-collapse")).toBeTruthy();
    expect(container.querySelector('[data-testid="error-banner-dismiss"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
  });

  it("renders COLLAPSE while an attempt is in flight", () => {
    const { getByTestId, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ waiting: false }) }}
        onDismiss={vi.fn()}
        now={clock}
      />,
    );
    expect(getByTestId("error-banner-collapse")).toBeTruthy();
    expect(container.querySelector('[data-testid="error-banner-dismiss"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
  });

  it("collapsing does NOT invoke onDismiss and dispatches no abort", () => {
    const onDismiss = vi.fn();
    const spies = { onAbort: vi.fn(), onCancel: vi.fn(), onStop: vi.fn(), onStopRetrying: vi.fn() };
    const { getByTestId } = render(
      <SessionBanner state={errRetry} onDismiss={onDismiss} now={clock} {...(spies as Record<string, unknown>)} />,
    );
    fireEvent.click(getByTestId("error-banner-collapse"));
    expect(onDismiss).not.toHaveBeenCalled();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it("the collapsed row keeps the attempt status and offers expand", () => {
    const { getByTestId, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2 }) }}
        onDismiss={vi.fn()}
        now={clock}
      />,
    );
    fireEvent.click(getByTestId("error-banner-collapse"));
    expect(getByTestId("retry-banner-attempt").textContent).toMatch(/Retry 2/);
    expect(getByTestId("error-banner-expand")).toBeTruthy();
    // The error text is gone while collapsed.
    expect(container.querySelector('[data-testid="error-banner-text"]')).toBeNull();
  });

  it("a later attempt updates the number in place without re-expanding", () => {
    const { getByTestId, rerender, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2 }) }}
        onDismiss={vi.fn()}
        now={clock}
      />,
    );
    fireEvent.click(getByTestId("error-banner-collapse"));
    rerender(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 3 }) }}
        onDismiss={vi.fn()}
        now={clock}
      />,
    );
    expect(getByTestId("retry-banner-attempt").textContent).toMatch(/Retry 3/);
    expect(container.querySelector('[data-testid="error-banner-text"]')).toBeNull();
  });

  it("expand restores the full card", () => {
    const { getByTestId } = render(<SessionBanner state={errRetry} onDismiss={vi.fn()} now={clock} />);
    fireEvent.click(getByTestId("error-banner-collapse"));
    fireEvent.click(getByTestId("error-banner-expand"));
    expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
  });

  it("F2 a collapsed surface re-expands when retrying stops with Retry + Copy + X", () => {
    const { getByTestId, getByTitle, rerender, container } = render(
      <SessionBanner state={errRetry} onDismiss={vi.fn()} onRetry={vi.fn()} now={clock} />,
    );
    fireEvent.click(getByTestId("error-banner-collapse"));
    expect(container.querySelector('[data-testid="error-banner-text"]')).toBeNull();
    // Retry ends, error remains → expanded + closable.
    rerender(<SessionBanner state={{ error: { kind: "error", message: "overloaded" } }} onDismiss={vi.fn()} onRetry={vi.fn()} now={clock} />);
    expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
    expect(getByTestId("error-banner-retry")).toBeTruthy();
    expect(getByTitle("Copy error message")).toBeTruthy();
    expect(getByTestId("error-banner-dismiss")).toBeTruthy();
    expect(container.querySelector('[data-testid="error-banner-collapse"]')).toBeNull();
  });

  it("F3 automatic recovery rerender removes the whole banner", () => {
    const { container, rerender } = render(
      <SessionBanner state={errRetry} onDismiss={vi.fn()} onRetry={vi.fn()} now={clock} />,
    );
    expect(container.querySelector('[data-testid="error-banner"]')).not.toBeNull();
    rerender(<SessionBanner state={{ variant: "hidden" }} onDismiss={vi.fn()} onRetry={vi.fn()} now={clock} />);
    expect(container.querySelector('[data-testid="error-banner"]')).toBeNull();
  });

  it("NO stop-retrying control exists in ANY state", () => {
    const states = [
      { error: { kind: "error" as const, message: "overloaded" } },
      { error: { kind: "error" as const, message: "overloaded" }, retry: retry({ waiting: true }) },
      { error: { kind: "error" as const, message: "overloaded" }, retry: retry({ waiting: false }) },
      { retry: retry({ waiting: true }) },
      { retry: retry({ waiting: false }) },
    ];
    for (const state of states) {
      const { container, unmount } = render(<SessionBanner state={state} onDismiss={vi.fn()} now={clock} />);
      expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
      expect(container.querySelector('[data-testid="retry-banner-stop"]')).toBeNull();
      expect(container.textContent ?? "").not.toMatch(/stop retry/i);
      unmount();
    }
  });
});

describe("SessionBanner — status line", () => {
  it("renders the short 'Retry N' label — never 'attempt' or 'of N'", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ attempt: 7, maxAttempts: 100 }) }} now={clock} />,
    );
    const line = getByTestId("retry-banner").textContent ?? "";
    expect(line).toMatch(/Retry 7/);
    expect(line).not.toMatch(/of\s*\d/);
    expect(line).not.toMatch(/attempt/i);
    expect(line).not.toMatch(/next attempt in/i);
  });

  it("renders a spinner alongside the label", () => {
    const { container } = render(<SessionBanner state={{ retry: retry({ attempt: 2 }) }} now={clock} />);
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("exact countdown from nextAttemptAt", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ attempt: 7, waiting: true, nextAttemptAt: NOW + 42_000 }) }} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/^42\s*s/);
  });

  it("computed countdown from startedAt + delayMs when nextAttemptAt absent", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 4000, startedAt: NOW }) }} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/^4\s*s/);
  });

  it("degrades to 'still waiting… (N s elapsed)' on overrun", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 4000, startedAt: NOW - 10_000 }) }} now={clock} />,
    );
    const txt = getByTestId("retry-banner-countdown").textContent ?? "";
    expect(txt).not.toMatch(/still waiting/i);
    expect(txt).toMatch(/10\s*s/);
  });

  it("elapsed-only when delayMs is 0 and no nextAttemptAt", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 0, startedAt: NOW - 5000 }) }} now={clock} />,
    );
    const txt = getByTestId("retry-banner-countdown").textContent ?? "";
    expect(txt).not.toMatch(/still waiting/i);
    expect(txt).toMatch(/5\s*s/);
  });

  it("in-flight renders the spinner and NO countdown suffix", () => {
    const { container } = render(
      <SessionBanner state={{ retry: retry({ waiting: false }) }} now={clock} />,
    );
    expect(container.querySelector(".animate-spin")).not.toBeNull();
    expect(container.querySelector('[data-testid="retry-banner-countdown"]')).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/retrying now/i);
  });

  it("retry-only (no settled error): the reason string is the card header", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ reason: "overloaded" }) }} now={clock} />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
  });
});
