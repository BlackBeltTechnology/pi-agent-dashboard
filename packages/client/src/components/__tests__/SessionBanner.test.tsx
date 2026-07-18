/**
 * Unit tests for the single-card SessionBanner (change:
 * simplify-error-retry-single-card). ONE card renders the error string plus an
 * optional live retry sub-line — never two sibling cards. ✕ is clear-only and
 * never aborts; the "Stop (ends the session)" control is the sole abort and
 * appears only while retrying; there is no manual "Try again".
 *
 * The selector (`deriveBannerState`) is tested in event-reducer.test.ts.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { SessionBanner } from "../session/SessionBanner.js";

afterEach(() => cleanup());

const retry = (
  over: Partial<{ attempt: number; maxAttempts: number; delayMs: number; reason: string; startedAt: number }> = {},
) => ({
  attempt: 1,
  maxAttempts: -1,
  delayMs: -1,
  reason: "overloaded",
  startedAt: 0,
  ...over,
});

describe("SessionBanner (single-card surface)", () => {
  it("hidden variant renders nothing", () => {
    const { container } = render(<SessionBanner state={{ variant: "hidden" }} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders exactly ONE card element for error + retry (not two siblings)", () => {
    const { container } = render(
      <SessionBanner
        state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2 }) }}
        onAbort={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-testid="error-banner"]').length).toBe(1);
    // The retry status is a sub-line INSIDE the single card, not a second card.
    const card = container.querySelector('[data-testid="error-banner"]')!;
    expect(card.querySelector('[data-testid="retry-banner"]')).not.toBeNull();
  });

  describe("error-only (settled) surface", () => {
    it("shows the message, a clear-only ✕, and NO Stop / NO Try again", () => {
      const onAbort = vi.fn();
      const onDismiss = vi.fn();
      const { getByTestId, container } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "fetch failed: ECONNRESET" } }}
          onAbort={onAbort}
          onDismiss={onDismiss}
        />,
      );
      expect(getByTestId("error-banner-text").textContent).toContain("fetch failed: ECONNRESET");
      // No manual retry control exists anymore.
      expect(container.querySelector('[data-testid="error-banner-retry"]')).toBeNull();
      // Stop is present only while retrying — absent on a settled error.
      expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
      // ✕ clears ONLY — never aborts.
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onAbort).not.toHaveBeenCalled();
    });

    it("truncates long messages with a Show more / Show less toggle", () => {
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

    it("a billing/quota error renders as an ordinary error (no 💳 hint, no special variant)", () => {
      const { getByTestId, container } = render(
        <SessionBanner state={{ error: { kind: "error", message: "usage_limit_reached" } }} onDismiss={vi.fn()} />,
      );
      expect(getByTestId("error-banner-text").textContent).toContain("usage_limit_reached");
      expect(container.querySelector('[data-testid="limit-exceeded-banner"]')).toBeNull();
      expect(container.querySelector('[data-testid="limit-exceeded-hint"]')).toBeNull();
    });
  });

  describe("retrying surface", () => {
    it("shows the error text + a retry sub-line + a labeled Stop that aborts", () => {
      const onAbort = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "overloaded" }, retry: retry({ attempt: 2 }) }}
          onAbort={onAbort}
          onDismiss={vi.fn()}
        />,
      );
      expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
      expect(getByTestId("retry-banner").textContent).toMatch(/retry/i);
      expect(getByTestId("retry-banner-attempt").textContent).toMatch(/2/);
      const stop = getByTestId("error-banner-stop");
      expect(stop.textContent).toMatch(/Stop \(ends the session\)/);
      fireEvent.click(stop);
      expect(onAbort).toHaveBeenCalledOnce();
    });

    it("retry-only (no settled error yet): the reason string is the card header", () => {
      const { getByTestId, container } = render(
        <SessionBanner state={{ retry: retry({ reason: "overloaded" }) }} onAbort={vi.fn()} />,
      );
      expect(container.querySelectorAll('[data-testid="error-banner"]').length).toBe(1);
      expect(getByTestId("error-banner-text").textContent).toContain("overloaded");
      expect(getByTestId("retry-banner")).toBeTruthy();
    });

    it("✕ during a retry clears ONLY — it never aborts the session", () => {
      const onAbort = vi.fn();
      const onDismiss = vi.fn();
      const { getByTestId } = render(
        <SessionBanner
          state={{ error: { kind: "error", message: "overloaded" }, retry: retry() }}
          onAbort={onAbort}
          onDismiss={onDismiss}
        />,
      );
      fireEvent.click(getByTestId("error-banner-dismiss"));
      expect(onDismiss).toHaveBeenCalledOnce();
      expect(onAbort).not.toHaveBeenCalled();
    });

    it("hides Stop when onAbort is omitted", () => {
      const { container } = render(<SessionBanner state={{ retry: retry() }} />);
      expect(container.querySelector('[data-testid="error-banner-stop"]')).toBeNull();
    });
  });
});
