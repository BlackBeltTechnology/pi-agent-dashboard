/**
 * Unit tests for the unified SessionBanner component (composed error-lifecycle
 * surface). The selector (`deriveBannerState`) is tested in
 * event-reducer.test.ts; here we test the rendered output + action callbacks
 * given an already-derived composed BannerState.
 *
 * See change: unify-error-retry-lifecycle.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { SessionBanner } from "../SessionBanner";

// vitest.config.ts does not enable @testing-library/react's auto-cleanup
// (no `globals: true`), so we clean up manually between tests to avoid
// duplicate DOM nodes leaking across renders.
afterEach(() => cleanup());

const retry = (over: Partial<{ attempt: number; maxAttempts: number; delayMs: number; reason: string; startedAt: number }> = {}) => ({
  attempt: 1,
  maxAttempts: -1,
  delayMs: -1,
  reason: "rate limit",
  startedAt: 0,
  ...over,
});

describe("SessionBanner composed surface", () => {
  it("hidden variant renders nothing in the DOM", () => {
    const { container } = render(<SessionBanner state={{ variant: "hidden" }} />);
    expect(container.firstChild).toBeNull();
  });

  describe("retry-only sub-surface", () => {
    it("renders attempt + reason + Stop with countdown when delayMs > 0", () => {
      const onAbort = vi.fn();
      const { container, getByTestId } = render(
        <SessionBanner
          state={{ retry: retry({ attempt: 2, maxAttempts: 3, delayMs: 4000, reason: "rate limit exceeded", startedAt: 1_000_000 }) }}
          onAbort={onAbort}
          now={() => 1_001_000} // 1s elapsed of 4s
        />,
      );
      expect(getByTestId("retry-banner")).toBeTruthy();
      expect(getByTestId("retry-banner-attempt").textContent).toMatch(/2.*3/);
      expect(getByTestId("retry-banner-countdown").textContent).toBe("3s");
      expect(getByTestId("retry-banner-reason").textContent).toBe("rate limit exceeded");
      fireEvent.click(getByTestId("retry-banner-stop"));
      expect(onAbort).toHaveBeenCalledOnce();
      // No error-banner DOM in a retry-only surface (no early red promotion).
      expect(container.querySelector('[data-testid="error-banner"]')).toBeNull();
    });

    it("renders indeterminate state when delayMs is sentinel -1", () => {
      const { getByTestId } = render(
        <SessionBanner state={{ retry: retry({ delayMs: -1, maxAttempts: -1 }) }} />,
      );
      expect(getByTestId("retry-banner-indeterminate")).toBeTruthy();
    });

    it("countdown clamps to 0, never negative", () => {
      const { getByTestId } = render(
        <SessionBanner state={{ retry: retry({ maxAttempts: 3, delayMs: 1000, reason: "x", startedAt: 0 }) }} now={() => 5000} />,
      );
      expect(getByTestId("retry-banner-countdown").textContent).toBe("0s");
    });

    it("hides Stop button when onAbort omitted", () => {
      const { container } = render(<SessionBanner state={{ retry: retry() }} />);
      expect(container.querySelector('[data-testid="retry-banner-stop"]')).toBeNull();
    });
  });

  describe("error-only sub-surface", () => {
    it("renders message + Retry + Dismiss, fires callbacks", () => {
      const onRetry = vi.fn();
      const onDismiss = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "fetch failed: ECONNRESET" } }}
          onRetry={onRetry}
          onDismiss={onDismiss}
        />,
      );
      expect(getByTestId("error-banner")).toBeTruthy();
      expect(getByTestId("error-banner-text").textContent).toContain("fetch failed: ECONNRESET");
      fireEvent.click(getByTestId("error-banner-retry"));
      expect(onRetry).toHaveBeenCalledOnce();
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("hides Retry button when onRetry omitted", () => {
      const { container } = render(
        <SessionBanner state={{ error: { kind: "error", message: "x" } }} onDismiss={vi.fn()} />,
      );
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    });

    it("truncates long messages with Show more / Show less toggle", () => {
      const long = "a".repeat(300);
      const { container, getByTestId } = render(
        <SessionBanner state={{ error: { kind: "error", message: long } }} collapseThreshold={240} />,
      );
      const text = getByTestId("error-banner-text").textContent ?? "";
      expect(text.length).toBeLessThan(long.length); // truncated
      expect(text.endsWith("…")).toBe(true);
      const toggle = getByTestId("error-banner-toggle");
      expect(toggle.textContent).toBe("Show more");
      fireEvent.click(toggle);
      expect(getByTestId("error-banner-text").textContent).toBe(long);
      expect(getByTestId("error-banner-toggle").textContent).toBe("Show less");
      expect(container.querySelector('[data-testid="limit-exceeded-hint"]')).toBeNull();
    });

    it("short message has no toggle", () => {
      const { container } = render(
        <SessionBanner state={{ error: { kind: "error", message: "short" } }} collapseThreshold={240} />,
      );
      expect(container.querySelector('[data-testid="error-banner-toggle"]')).toBeNull();
    });
  });

  describe("limit-exceeded sub-surface", () => {
    it("renders message + Dismiss + hint, NO Retry button", () => {
      const onRetry = vi.fn();
      const onDismiss = vi.fn();
      const { container, getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "limit-exceeded", message: "monthly_spending_cap exceeded" } }}
          onRetry={onRetry}
          onDismiss={onDismiss}
        />,
      );
      expect(getByTestId("error-banner")).toBeTruthy();
      expect(getByTestId("limit-exceeded-banner")).toBeTruthy();
      expect(getByTestId("limit-exceeded-hint").textContent).toBe("Session stopped automatically.");
      expect(getByTestId("error-banner-text").textContent).toContain("monthly_spending_cap");
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe("composed error anchor + retry sub-line", () => {
    it("renders BOTH the error header and the retry sub-line in one surface", () => {
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "429 rate limited" }, retry: retry({ attempt: 2 }) }}
          onAbort={vi.fn()}
        />,
      );
      expect(getByTestId("error-banner")).toBeTruthy();
      expect(getByTestId("error-banner-text").textContent).toContain("429 rate limited");
      expect(getByTestId("retry-banner")).toBeTruthy();
      expect(getByTestId("retry-banner-stop")).toBeTruthy();
    });

    it("does NOT render a manual Retry button while a retry is in flight", () => {
      const { container } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "429" }, retry: retry() }}
          onRetry={vi.fn()}
        />,
      );
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    });
  });

  describe("state-dependent Dismiss ✕", () => {
    it("aborts AND clears when a retry is in flight", () => {
      const onAbort = vi.fn();
      const onDismiss = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "429" }, retry: retry() }}
          onAbort={onAbort}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onAbort).toHaveBeenCalledOnce();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("aborts AND clears on a generic retryable error (no live retry)", () => {
      const onAbort = vi.fn();
      const onDismiss = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "fetch failed" } }}
          onAbort={onAbort}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onAbort).toHaveBeenCalledOnce();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("only clears (no abort) on a terminal limit-exceeded surface", () => {
      const onAbort = vi.fn();
      const onDismiss = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "limit-exceeded", message: "usage_limit_reached" } }}
          onAbort={onAbort}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onAbort).not.toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  describe("legacy data-testid compatibility", () => {
    it("error and limit-exceeded both expose `error-banner` test-id", () => {
      const errR = render(<SessionBanner state={{ error: { kind: "error", message: "x" } }} />);
      const limR = render(<SessionBanner state={{ error: { kind: "limit-exceeded", message: "usage_limit_reached" } }} />);
      expect(errR.container.querySelector('[data-testid="error-banner"]')).not.toBeNull();
      expect(limR.container.querySelector('[data-testid="error-banner"]')).not.toBeNull();
    });

    it("error and limit-exceeded both expose `error-banner-dismiss` when onDismiss supplied", () => {
      const errR = render(<SessionBanner state={{ error: { kind: "error", message: "x" } }} onDismiss={vi.fn()} />);
      const limR = render(<SessionBanner state={{ error: { kind: "limit-exceeded", message: "y" } }} onDismiss={vi.fn()} />);
      expect(errR.container.querySelector('[data-testid="error-banner-dismiss"]')).not.toBeNull();
      expect(limR.container.querySelector('[data-testid="error-banner-dismiss"]')).not.toBeNull();
    });
  });
});
