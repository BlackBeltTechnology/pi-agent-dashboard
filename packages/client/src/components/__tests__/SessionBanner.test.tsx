/**
 * Unit tests for the single-card SessionBanner (change:
 * error-banner-observe-only).
 *
 * ONE card renders the error string plus an optional live retry sub-line —
 * never two sibling cards. Observe-only: pi owns the retry loop, so the banner
 * has NO "Stop retrying" control and NO collapse. The ✕ is ALWAYS present and
 * clear-only — it never aborts; pi keeps retrying and the next attempt re-opens
 * the surface with the fresh attempt number. There is NO Retry control.
 * See change: unify-retry-visibility.
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
  it("shows the message, a clear-only ✕, and NO Stop / NO Retry", () => {
    const onDismiss = vi.fn();
    const { getByTestId, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "fetch failed: ECONNRESET" } }}
        onDismiss={onDismiss}
        now={clock}
      />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("fetch failed: ECONNRESET");
    expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
    // ✕ clears via onDismiss.
    fireEvent.click(getByTestId("error-banner-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
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

describe("SessionBanner — observe-only while retrying (no stop / no collapse, ✕ always present)", () => {
  it("renders status + Copy + ✕ but NO stop and NO collapse while retrying", () => {
    const onDismiss = vi.fn();
    const { getByTestId, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry() }}
        onDismiss={onDismiss}
        now={clock}
      />,
    );
    expect(getByTestId("retry-banner-attempt").textContent).toMatch(/attempt 1/);
    expect(getByTestId("retry-banner-countdown")).toBeTruthy();
    expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-collapse"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-expand"]')).toBeNull();
    // The ✕ IS present while retrying, and is clear-only.
    const x = getByTestId("error-banner-dismiss");
    expect(x).toBeTruthy();
    fireEvent.click(x);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("the ✕ is present in BOTH the retrying and the settled surface", () => {
    const { getByTestId, rerender } = render(
      <SessionBanner state={{ error: { kind: "error", message: "x" }, retry: retry() }} onDismiss={vi.fn()} now={clock} />,
    );
    expect(getByTestId("error-banner-dismiss")).toBeTruthy();
    // Retry ends → settled → ✕ still there.
    rerender(<SessionBanner state={{ error: { kind: "error", message: "x" } }} onDismiss={vi.fn()} now={clock} />);
    expect(getByTestId("error-banner-dismiss")).toBeTruthy();
  });

  it("the ✕ renders while the retry is IN FLIGHT (waiting: false)", () => {
    const onDismiss = vi.fn();
    const { getByTestId } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2, waiting: false }) }}
        onDismiss={onDismiss}
        now={clock}
      />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/retrying now/i);
    fireEvent.click(getByTestId("error-banner-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("activating the ✕ dispatches NO abort / cancel / stop — only the clear", () => {
    const onDismiss = vi.fn();
    const spies = { onAbort: vi.fn(), onCancel: vi.fn(), onStop: vi.fn(), onStopRetrying: vi.fn() };
    const { getByTestId } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry() }}
        onDismiss={onDismiss}
        now={clock}
        {...(spies as Record<string, unknown>)}
      />,
    );
    fireEvent.click(getByTestId("error-banner-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it("a subsequent attempt re-opens a dismissed banner with the NEW number", () => {
    // Dismissal is transient: the parent clears its state, the banner unmounts,
    // and the next attempt's signal brings the surface back with attempt N+1.
    const { getByTestId, container, rerender } = render(
      <SessionBanner state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2 }) }} onDismiss={vi.fn()} now={clock} />,
    );
    expect(getByTestId("retry-banner-attempt").textContent).toMatch(/attempt 2/);
    // Parent applied the dismissal → hidden.
    rerender(<SessionBanner state={{ variant: "hidden" }} now={clock} />);
    expect(container.querySelector('[data-testid="error-banner"]')).toBeNull();
    // Attempt 3's waiting signal arrives → the surface re-opens with the new number.
    rerender(
      <SessionBanner state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 3 }) }} onDismiss={vi.fn()} now={clock} />,
    );
    expect(getByTestId("retry-banner-attempt").textContent).toMatch(/attempt 3/);
    expect(getByTestId("error-banner-dismiss")).toBeTruthy();
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
  it("renders bare 'attempt N' — never 'of N'", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ attempt: 7, maxAttempts: 100 }) }} now={clock} />,
    );
    const line = getByTestId("retry-banner").textContent ?? "";
    expect(line).toMatch(/attempt 7/);
    expect(line).not.toMatch(/of\s*\d/);
  });

  it("exact countdown from nextAttemptAt", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ attempt: 7, waiting: true, nextAttemptAt: NOW + 42_000 }) }} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/42\s*s/);
  });

  it("computed countdown from startedAt + delayMs when nextAttemptAt absent", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 4000, startedAt: NOW }) }} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/4\s*s/);
  });

  it("degrades to 'still waiting… (N s elapsed)' on overrun", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 4000, startedAt: NOW - 10_000 }) }} now={clock} />,
    );
    const txt = getByTestId("retry-banner-countdown").textContent ?? "";
    expect(txt).toMatch(/still waiting/i);
    expect(txt).toMatch(/10\s*s/);
  });

  it("elapsed-only when delayMs is 0 and no nextAttemptAt", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 0, startedAt: NOW - 5000 }) }} now={clock} />,
    );
    const txt = getByTestId("retry-banner-countdown").textContent ?? "";
    expect(txt).toMatch(/still waiting/i);
    expect(txt).toMatch(/5\s*s/);
  });

  it("in-flight sub-state shows 'retrying now' (no countdown)", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: false }) }} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/retrying now/i);
  });

  it("retry-only (no settled error): the reason string is the card header", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ reason: "overloaded" }) }} now={clock} />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
  });
});
