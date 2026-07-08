/**
 * Unit tests for the unified single-card SessionBanner. The selector
 * (`deriveBannerState`) is tested in event-reducer.test.ts; here we test the
 * rendered output + action callbacks given an already-derived BannerState.
 *
 * See change: unify-error-retry-lifecycle.
 * See change: simplify-error-retry-single-card.
 */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionBanner } from "../SessionBanner";

afterEach(() => cleanup());

const retry = (over: Partial<{ attempt: number; maxAttempts: number; delayMs: number; reason: string; startedAt: number }> = {}) => ({
  attempt: 1,
  maxAttempts: -1,
  delayMs: -1,
  reason: "rate limit",
  startedAt: 0,
  ...over,
});

describe("SessionBanner single card", () => {
  it("hidden variant renders nothing in the DOM", () => {
    const { container } = render(<SessionBanner state={{ variant: "hidden" }} />);
    expect(container.firstChild).toBeNull();
  });

  describe("one card, never two", () => {
    it("error + retry render inside a SINGLE card (no two sibling cards)", () => {
      const { getByTestId, container } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "overloaded_error" }, retry: retry({ attempt: 2 }) }}
          onAbort={vi.fn()}
        />,
      );
      // Exactly one bordered surface (the card carries `error-banner`).
      expect(container.querySelectorAll('[data-testid="error-banner"]').length).toBe(1);
      // Both error text and retry sub-line live inside that one card.
      const card = getByTestId("error-banner");
      expect(card.querySelector('[data-testid="error-banner-text"]')?.textContent).toContain("overloaded_error");
      expect(card.querySelector('[data-testid="retry-banner"]')).not.toBeNull();
      expect(card.querySelector('[data-testid="retry-banner-stop"]')).not.toBeNull();
    });

    it("never renders a manual retry control", () => {
      const { container } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "429" }, retry: retry() }}
        />,
      );
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
    });
  });

  describe("retry-only surface", () => {
    it("renders attempt + reason + Stop with countdown when delayMs > 0", () => {
      const onAbort = vi.fn();
      const { container, getByTestId } = render(
        <SessionBanner
          state={{ retry: retry({ attempt: 2, maxAttempts: 3, delayMs: 4000, reason: "rate limit exceeded", startedAt: 1_000_000 }) }}
          onAbort={onAbort}
          now={() => 1_001_000}
        />,
      );
      expect(getByTestId("retry-banner")).toBeTruthy();
      expect(getByTestId("retry-banner-attempt").textContent).toMatch(/2.*3/);
      expect(getByTestId("retry-banner-countdown").textContent).toBe("3s");
      expect(getByTestId("retry-banner-reason").textContent).toBe("rate limit exceeded");
      fireEvent.click(getByTestId("retry-banner-stop"));
      expect(onAbort).toHaveBeenCalledOnce();
      // No error surface in a retry-only card.
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

  describe("settled error surface", () => {
    it("renders message + Dismiss (no manual retry), fires dismiss", () => {
      const onDismiss = vi.fn();
      const { container, getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "fetch failed: ECONNRESET" } }}
          onDismiss={onDismiss}
        />,
      );
      expect(getByTestId("error-banner")).toBeTruthy();
      expect(getByTestId("error-banner-text").textContent).toContain("fetch failed: ECONNRESET");
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("billing message renders as an ordinary error (no limit-exceeded hint / 💳, no retry)", () => {
      const { container, getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "usage_limit_reached: monthly cap" } }}
          onDismiss={vi.fn()}
        />,
      );
      expect(getByTestId("error-banner-text").textContent).toContain("usage_limit_reached");
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
      expect(container.querySelector('[data-testid="limit-exceeded-banner"]')).toBeNull();
      expect(container.querySelector('[data-testid="limit-exceeded-hint"]')).toBeNull();
    });

    it("truncates long messages with Show more / Show less toggle", () => {
      const long = "a".repeat(300);
      const { getByTestId } = render(
        <SessionBanner state={{ error: { kind: "error", message: long } }} collapseThreshold={240} />,
      );
      const text = getByTestId("error-banner-text").textContent ?? "";
      expect(text.length).toBeLessThan(long.length);
      expect(text.endsWith("…")).toBe(true);
      const toggle = getByTestId("error-banner-toggle");
      expect(toggle.textContent).toBe("Show more");
      fireEvent.click(toggle);
      expect(getByTestId("error-banner-text").textContent).toBe(long);
      expect(getByTestId("error-banner-toggle").textContent).toBe("Show less");
    });

    it("short message has no toggle", () => {
      const { container } = render(
        <SessionBanner state={{ error: { kind: "error", message: "short" } }} collapseThreshold={240} />,
      );
      expect(container.querySelector('[data-testid="error-banner-toggle"]')).toBeNull();
    });
  });

  describe("Dismiss ✕ is clear-only (never aborts)", () => {
    it("does NOT abort when a retry is in flight — clears only", () => {
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
      expect(onAbort).not.toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("does NOT abort on a generic error — clears only", () => {
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
      expect(onAbort).not.toHaveBeenCalled();
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("Stop is the only control that aborts", () => {
      const onAbort = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "429" }, retry: retry() }}
          onAbort={onAbort}
          onDismiss={vi.fn()}
        />,
      );
      fireEvent.click(getByTestId("retry-banner-stop"));
      expect(onAbort).toHaveBeenCalledOnce();
    });
  });
});
