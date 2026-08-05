/**
 * Unit tests for the single-card SessionBanner (change:
 * retry-forever-with-stop-control).
 *
 * ONE card renders the error string plus an optional live retry sub-line —
 * never two sibling cards. While a retry is pending the dismiss control
 * COLLAPSES (never clears) to a one-line pill carrying error + attempt +
 * countdown + Stop retrying + expand; a state-clearing dismiss appears only on
 * a settled error. There is NO Retry control. Collapse is sticky per chain.
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
        onAbort={vi.fn()}
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
    const onAbort = vi.fn();
    const onDismiss = vi.fn();
    const { getByTestId, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "fetch failed: ECONNRESET" } }}
        onAbort={onAbort}
        onDismiss={onDismiss}
        now={clock}
      />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("fetch failed: ECONNRESET");
    expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
    // ✕ clears ONLY — never aborts.
    fireEvent.click(getByTestId("error-banner-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAbort).not.toHaveBeenCalled();
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

describe("SessionBanner — dismiss degrades to collapse while retrying (§5.1)", () => {
  it("dismiss while retrying COLLAPSES (does not clear); no onDismiss, no onAbort", () => {
    const onAbort = vi.fn();
    const onDismiss = vi.fn();
    const { getByTestId, container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry() }}
        onAbort={onAbort}
        onDismiss={onDismiss}
        now={clock}
      />,
    );
    // Expanded retrying card carries a collapse control (not a clearing ✕).
    expect(container.querySelector('[data-testid="error-banner-dismiss"]')).toBeNull();
    fireEvent.click(getByTestId("error-banner-collapse"));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onAbort).not.toHaveBeenCalled();
    // Now a one-line pill with error + attempt + countdown + Stop + expand.
    expect(getByTestId("retry-banner-attempt").textContent).toMatch(/attempt 1/);
    expect(getByTestId("retry-banner-countdown")).toBeTruthy();
    expect(getByTestId("error-banner-stop")).toBeTruthy();
    expect(getByTestId("error-banner-expand")).toBeTruthy();
  });

  it("expand restores the full card", () => {
    const { getByTestId, container } = render(
      <SessionBanner state={{ retry: retry() }} onAbort={vi.fn()} now={clock} />,
    );
    fireEvent.click(getByTestId("error-banner-collapse"));
    fireEvent.click(getByTestId("error-banner-expand"));
    expect(container.querySelector('[data-testid="error-banner-collapse"]')).not.toBeNull();
  });

  it("clearing dismiss appears only once no retry sub-status is carried", () => {
    const { getByTestId, rerender, container } = render(
      <SessionBanner state={{ error: { kind: "error", message: "x" }, retry: retry() }} onAbort={vi.fn()} onDismiss={vi.fn()} now={clock} />,
    );
    expect(container.querySelector('[data-testid="error-banner-dismiss"]')).toBeNull();
    // Retry ends → settled → the clearing ✕ returns.
    rerender(<SessionBanner state={{ error: { kind: "error", message: "x" } }} onAbort={vi.fn()} onDismiss={vi.fn()} now={clock} />);
    expect(getByTestId("error-banner-dismiss")).toBeTruthy();
  });
});

describe("SessionBanner — sticky collapse per failure chain (§5.2)", () => {
  it("stays collapsed across attempts of the same chain", () => {
    const { getByTestId, container, rerender } = render(
      <SessionBanner state={{ retry: retry({ attempt: 3 }) }} onAbort={vi.fn()} now={clock} />,
    );
    fireEvent.click(getByTestId("error-banner-collapse"));
    expect(getByTestId("error-banner-expand")).toBeTruthy(); // collapsed
    // attempts 4 and 5 of the SAME chain (retry stays present) → still collapsed.
    rerender(<SessionBanner state={{ retry: retry({ attempt: 4 }) }} onAbort={vi.fn()} now={clock} />);
    rerender(<SessionBanner state={{ retry: retry({ attempt: 5 }) }} onAbort={vi.fn()} now={clock} />);
    expect(container.querySelector('[data-testid="error-banner-expand"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="error-banner-collapse"]')).toBeNull();
  });

  it("a new failure chain renders expanded", () => {
    const { getByTestId, container, rerender } = render(
      <SessionBanner state={{ retry: retry({ attempt: 3 }) }} onAbort={vi.fn()} now={clock} />,
    );
    fireEvent.click(getByTestId("error-banner-collapse")); // collapsed
    // Chain ends (retry absent) …
    rerender(<SessionBanner state={{ variant: "hidden" }} onAbort={vi.fn()} now={clock} />);
    // … a later, separate failure begins a NEW chain → expanded.
    rerender(<SessionBanner state={{ retry: retry({ attempt: 1 }) }} onAbort={vi.fn()} now={clock} />);
    expect(container.querySelector('[data-testid="error-banner-collapse"]')).not.toBeNull(); // expanded
  });
});

describe("SessionBanner — status line (§5.3)", () => {
  it("renders bare 'attempt N' — never 'of N'", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ attempt: 7, maxAttempts: 100 }) }} onAbort={vi.fn()} now={clock} />,
    );
    const line = getByTestId("retry-banner").textContent ?? "";
    expect(line).toMatch(/attempt 7/);
    expect(line).not.toMatch(/of\s*\d/);
  });

  it("exact countdown from nextAttemptAt", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ attempt: 7, waiting: true, nextAttemptAt: NOW + 42_000 }) }} onAbort={vi.fn()} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/42\s*s/);
  });

  it("computed countdown from startedAt + delayMs when nextAttemptAt absent", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 4000, startedAt: NOW }) }} onAbort={vi.fn()} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/4\s*s/);
  });

  it("degrades to 'still waiting… (N s elapsed)' on overrun", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 4000, startedAt: NOW - 10_000 }) }} onAbort={vi.fn()} now={clock} />,
    );
    const txt = getByTestId("retry-banner-countdown").textContent ?? "";
    expect(txt).toMatch(/still waiting/i);
    expect(txt).toMatch(/10\s*s/);
  });

  it("elapsed-only when delayMs is 0 and no nextAttemptAt", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true, delayMs: 0, startedAt: NOW - 5000 }) }} onAbort={vi.fn()} now={clock} />,
    );
    const txt = getByTestId("retry-banner-countdown").textContent ?? "";
    expect(txt).toMatch(/still waiting/i);
    expect(txt).toMatch(/5\s*s/);
  });

  it("in-flight sub-state shows 'retrying now' (no countdown)", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: false }) }} onAbort={vi.fn()} now={clock} />,
    );
    expect(getByTestId("retry-banner-countdown").textContent).toMatch(/retrying now/i);
  });
});

describe("SessionBanner — controls (§5.4)", () => {
  it("Stop retrying is present in the waiting sub-state and calls onAbort", () => {
    const onAbort = vi.fn();
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: true }) }} onAbort={onAbort} now={clock} />,
    );
    const stop = getByTestId("error-banner-stop");
    expect(stop.textContent).toMatch(/stop retrying/i);
    fireEvent.click(stop);
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("Stop retrying is present in the in-flight sub-state too", () => {
    const onAbort = vi.fn();
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ waiting: false }) }} onAbort={onAbort} now={clock} />,
    );
    fireEvent.click(getByTestId("error-banner-stop"));
    expect(onAbort).toHaveBeenCalledOnce();
  });

  it("the ONLY abort-capable control is Stop retrying (no 2nd session-abort pill)", () => {
    const { container } = render(
      <SessionBanner state={{ error: { kind: "error", message: "overloaded" }, retry: retry() }} onAbort={vi.fn()} now={clock} />,
    );
    expect(container.querySelectorAll('[data-testid="error-banner-stop"]').length).toBe(1);
    expect(container.querySelector('[data-testid="error-banner-stop-session"]')).toBeNull();
  });

  it("hides Stop when onAbort is omitted", () => {
    const { container } = render(<SessionBanner state={{ retry: retry() }} now={clock} />);
    expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
  });

  it("retry-only (no settled error): the reason string is the card header", () => {
    const { getByTestId } = render(
      <SessionBanner state={{ retry: retry({ reason: "overloaded" }) }} onAbort={vi.fn()} now={clock} />,
    );
    expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
  });
});
