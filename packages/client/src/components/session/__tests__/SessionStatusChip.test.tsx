/**
 * Status-chip history ring: show-delay, variants/stacking/a11y, tooltip clock.
 * See change: show-session-history-load-state (test-plan #E4, #F8, #F9).
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryLoadPhase } from "../../../lib/replay/history-load-phase.js";
import { REPLAY_PILL_DELAY_MS } from "../../../lib/replay/loading-history.js";
import { SessionStatusChip } from "../SessionStatusChip.js";

const BASE = "Terminal — active";

function chip(p: { phase?: HistoryLoadPhase; startedAt?: number; selected?: boolean; variant?: "desktop" | "mobile"; sessionId?: string }) {
  return (
    <SessionStatusChip
      variant={p.variant ?? "desktop"}
      sessionId={p.sessionId ?? "s1"}
      baseTitle={BASE}
      colorClass="text-[var(--status-active)]"
      statusShape="filled"
      isSelected={p.selected ?? false}
      historyPhase={p.phase}
      historyStartedAt={p.startedAt}
    >
      <svg data-testid="source-icon" />
      <span data-status-shape="filled" data-testid="badge" />
    </SessionStatusChip>
  );
}
const ring = () => screen.queryByTestId("session-history-ring");
const icon = () => screen.getByTestId("session-status-icon");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SessionStatusChip show-delay (#E4)", () => {
  it("no ring at 299 ms, arc at 300 ms", () => {
    render(chip({ phase: "loading", startedAt: Date.now() }));
    act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS - 1);
    });
    expect(ring()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(ring()?.getAttribute("data-history-phase")).toBe("loading");
  });

  it("phase → idle at 250 ms never paints the arc", () => {
    const { rerender } = render(chip({ phase: "loading", startedAt: Date.now() }));
    act(() => {
      vi.advanceTimersByTime(250);
    });
    rerender(chip({ phase: "idle" }));
    act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 3);
    });
    expect(ring()).toBeNull();
  });
});

describe("SessionStatusChip variants, stacking, a11y (#F8)", () => {
  const expectations: Array<[HistoryLoadPhase, string[] | null, string | null]> = [
    ["loading", ["animate-spin", "border-t-transparent", "motion-reduce:animate-none", "border-[var(--accent-text)]"], "Loading history…"],
    ["waiting", ["border-dashed", "border-[var(--text-tertiary)]"], "Waiting for connection"],
    ["failed", ["border-[var(--tint-red-fg)]"], "Couldn't load history"],
    ["idle", null, null],
  ];
  for (const variant of ["desktop", "mobile"] as const) {
    for (const [phase, classes, text] of expectations) {
      for (const selected of [true, false]) {
        it(`${variant} · ${phase} · selected=${selected}`, () => {
          render(chip({ variant, phase, selected, startedAt: Date.now() }));
          act(() => {
            vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
          });
          const r = ring();
          if (!classes) {
            expect(r).toBeNull();
            expect(icon().getAttribute("title")).toBe(BASE);
          } else {
            expect(r).not.toBeNull();
            for (const c of classes) expect(r!.classList.contains(c)).toBe(true);
            if (phase !== "failed") expect(r!.classList.contains("border-[var(--tint-red-fg)]")).toBe(false);
            // Ring precedes the badge in DOM order (badge paints on top).
            const badge = screen.getByTestId("badge");
            expect(r!.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            const title = icon().getAttribute("title") ?? "";
            expect(title).toContain(BASE);
            expect(title).toContain(text!);
          }
          const sr = screen.queryByTestId("session-history-ring-text");
          if (selected) expect(sr?.getAttribute("role")).toBe("status");
          else expect(sr?.getAttribute("role") ?? null).toBeNull();
          if (sr) expect(/\d/.test(sr.textContent ?? "")).toBe(false);
          if (text && sr) expect(sr.textContent).toBe(text);
          if (variant === "mobile") {
            expect([...icon().classList].some((c) => /^(w|h)-/.test(c))).toBe(false);
          }
        });
      }
    }
  }

  it("sr text stays digit-free past the slow threshold", () => {
    render(chip({ phase: "loading", selected: true, startedAt: Date.now() - 15_000 }));
    act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(icon().getAttribute("title")).toMatch(/· 15s$/);
    expect(screen.getByTestId("session-history-ring-text").textContent).toBe("Loading history…");
  });
});

describe("SessionStatusChip tooltip clock (#F9)", () => {
  it("title ends · 10s, · 11s, · 12s", () => {
    render(chip({ phase: "loading", startedAt: Date.now() - 10_000 }));
    act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    // The 300 ms show-delay elapsed but the 1 s clock has not ticked yet.
    expect(icon().getAttribute("title")).toMatch(/Still loading history · 10s$/);
    act(() => {
      vi.advanceTimersByTime(1000 - REPLAY_PILL_DELAY_MS);
    });
    expect(icon().getAttribute("title")).toMatch(/· 11s$/);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(icon().getAttribute("title")).toMatch(/· 12s$/);
  });
});
