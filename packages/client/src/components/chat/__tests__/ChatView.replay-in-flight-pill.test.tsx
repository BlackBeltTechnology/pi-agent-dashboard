/**
 * Render-level suite for change: show-replay-in-flight-indicator.
 *
 * Pins the pill's contract (handle + a11y), its show-delay
 * (`REPLAY_PILL_DELAY_MS`, referenced as a constant — never the literal 300),
 * its exclusivity with the loading skeleton and the "No messages yet"
 * placeholder, and the session-switch reset (`<ChatView>` is `React.memo`'d and
 * rendered without a `key`, so the instance is reused).
 *
 * Harness glue copied from `components/__tests__/ChatView.streaming-text-flush.test.tsx`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../../lib/chat/event-reducer.js";
import { REPLAY_PILL_DELAY_MS } from "../../../lib/replay/loading-history.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import type { ToolContext } from "../../tool-renderers/index.js";
import { ChatView } from "../ChatView.js";

const defaultToolContext: ToolContext = {};
const PILL = "replay-in-flight-pill";
const SCRIM = "replay-in-flight-scrim";

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

/** A state with one painted message — the "partial history already visible" case. */
function stateWithMessages(text = "hello"): SessionState {
  const s = createInitialState();
  s.messages.push({ id: "m1", role: "user", content: text, timestamp: 100 } as SessionState["messages"][number]);
  return s;
}

function renderChat(props: { sessionId?: string; state?: SessionState; replayInFlight?: boolean; loadingHistory?: boolean }) {
  return render(
    <ThemeProvider>
      <ChatView
        sessionId={props.sessionId ?? "s1"}
        state={props.state ?? stateWithMessages()}
        toolContext={defaultToolContext}
        replayInFlight={props.replayInFlight}
        loadingHistory={props.loadingHistory}
      />
    </ThemeProvider>,
  );
}

describe("ChatView replay-in-flight pill", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("F1 renders with its handle and a11y contract once the delay elapses", () => {
    renderChat({ replayInFlight: true });
    expect(screen.queryByTestId(PILL)).toBeNull();

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });

    const pill = screen.getByTestId(PILL);
    expect(pill.getAttribute("role")).toBe("status");
    expect(pill.getAttribute("aria-busy")).toBe("true");
    // The accessible name is DERIVED from the visible text. A redundant
    // `aria-label` duplicating it must not be set — it would override identical
    // content for no benefit. See change: fix-replay-pill-a11y-and-collision.
    expect(pill.hasAttribute("aria-label")).toBe(false);
    expect(pill.textContent?.trim()).toBeTruthy();
  });

  it("F2 disappears when the terminal batch clears the flag", () => {
    const { rerender } = renderChat({ replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    // Terminal `event_replay { isLast: true }` → App clears the flag.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("F3 skeleton and pill are never both present", () => {
    // Messages empty + loadingHistory → skeleton branch; pill suppressed.
    const { rerender } = renderChat({ state: createInitialState(), loadingHistory: true, replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId("chat-history-skeleton")).toBeTruthy();
    expect(screen.queryByTestId(PILL)).toBeNull();
    // The scrim is subject to the SAME exclusivity: a scrim beside the skeleton
    // would dim an empty transcript. See change: fix-replay-pill-a11y-and-collision.
    expect(screen.queryByTestId(SCRIM)).toBeNull();

    // First content batch lands: loadingHistory clears, messages present.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} loadingHistory={false} replayInFlight={true} />
        </ThemeProvider>,
      );
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.queryByTestId("chat-history-skeleton")).toBeNull();
    expect(screen.getByTestId(PILL)).toBeTruthy();
    expect(screen.getByTestId(SCRIM)).toBeTruthy();
  });

  it("F4 an empty session shows the placeholder and never the pill", () => {
    // Only `event_replay { events: [], isLast: true }` → both flags false, no messages.
    renderChat({ state: createInitialState(), loadingHistory: false, replayInFlight: false });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 10);
    });

    expect(screen.getByText("No messages yet")).toBeTruthy();
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("F5 a replay resolving just under the threshold never paints", () => {
    const { rerender } = renderChat({ replayInFlight: true });

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS - 1);
    });
    expect(screen.queryByTestId(PILL)).toBeNull();

    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    // Sample across the rest of the timeline, not just the end state.
    for (const step of [1, 1, REPLAY_PILL_DELAY_MS, REPLAY_PILL_DELAY_MS * 10]) {
      React.act(() => {
        vi.advanceTimersByTime(step);
      });
      expect(screen.queryByTestId(PILL)).toBeNull();
    }
  });

  it("F6 a slow replay paints at the threshold and stays until the flag clears", () => {
    const { rerender } = renderChat({ replayInFlight: true });

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 20);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("F7 a pending delay timer is cancelled when the flag clears before the threshold", () => {
    const { rerender } = renderChat({ replayInFlight: true });

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS - 50);
    });
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    // At and after the threshold instant the pill must stay absent, and no
    // timer may remain armed for this session.
    React.act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId(PILL)).toBeNull();
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 10);
    });
    expect(screen.queryByTestId(PILL)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("F8 delay state does not leak across a session switch on the reused instance", () => {
    // Session A: delay pending (and then also the visible case below).
    const { rerender } = renderChat({ sessionId: "A", replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    // Switch to session B (no `key` → same ChatView instance), replay NOT in flight.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="B" state={stateWithMessages("other")} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS * 10);
    });

    // No A-armed timer may resurrect it at any point on B's timeline.
    for (const step of [1, REPLAY_PILL_DELAY_MS, REPLAY_PILL_DELAY_MS * 10]) {
      React.act(() => {
        vi.advanceTimersByTime(step);
      });
      expect(screen.queryByTestId(PILL)).toBeNull();
    }
  });

  it("F8b the switched-to session never paints A's pill on its FIRST render", () => {
    // An effect-based reset runs only AFTER B's first render, so B would flash
    // A's pill for one frame. The visible bit is keyed by session id and
    // checked at render time, so the very first committed render for B is
    // already pill-free — asserted WITHOUT advancing timers in between.
    const { rerender } = renderChat({ sessionId: "A", replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();

    // Switch to B with the flag STILL true (a replay is in flight for B too):
    // the pill must not carry over, and must re-earn its delay under B.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="B" state={stateWithMessages("other")} toolContext={defaultToolContext} replayInFlight={true} />
        </ThemeProvider>,
      );
    });
    expect(screen.queryByTestId(PILL)).toBeNull();

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(PILL)).toBeTruthy();
  });

  // ── Scrim + label composition ────────────────────────────────────────────
  // See change: fix-replay-pill-a11y-and-collision.
  //
  // Geometry is deliberately NOT asserted here: jsdom has no layout engine, so
  // every getBoundingClientRect() returns zeros and a non-occlusion assertion
  // would pass vacuously. The real overlap check lives in
  // tests/e2e/replay-in-flight-pill.spec.ts (design D6). What IS assertable at
  // this level are the class/attribute proxies for those properties.

  it("G1 the scrim is inert: pointer-events-none and aria-hidden", () => {
    renderChat({ replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });

    const scrim = screen.getByTestId(SCRIM);
    // Without these the scrim silently swallows selection and clicks over the
    // tail message while rendering identically — invisible to a screenshot.
    expect(scrim.className).toContain("pointer-events-none");
    expect(scrim.getAttribute("aria-hidden")).toBe("true");
    // One status must contribute exactly one node to the accessibility tree.
    expect(scrim.getAttribute("role")).toBeNull();
  });

  it("G2 the scrim and the label appear and clear together", () => {
    const { rerender } = renderChat({ replayInFlight: true });
    expect(screen.queryByTestId(SCRIM)).toBeNull();
    expect(screen.queryByTestId(PILL)).toBeNull();

    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    expect(screen.getByTestId(SCRIM)).toBeTruthy();
    expect(screen.getByTestId(PILL)).toBeTruthy();

    // A scrim left behind would permanently dim the transcript tail.
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="s1" state={stateWithMessages()} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });
    expect(screen.queryByTestId(SCRIM)).toBeNull();
    expect(screen.queryByTestId(PILL)).toBeNull();
  });

  it("G3 the label carries the position, stacking and token classes it needs", () => {
    renderChat({ replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });

    const cls = screen.getByTestId(PILL).className;
    // Centred above the scroll-to-bottom control's 16..48px band, and ABOVE the
    // scrim in stacking order. Separation is by layout, not paint order.
    expect(cls).toContain("bottom-16");
    expect(cls).toContain("left-1/2");
    expect(cls).toContain("z-20");
    // SC 1.4.11 boundary: --border-strong on --bg-surface, not the 1.42:1
    // --border-subtle hairline on --bg-tertiary that shipped originally.
    expect(cls).toContain("border-[var(--border-strong)]");
    expect(cls).toContain("bg-[var(--bg-surface)]");
    expect(cls).not.toContain("--border-subtle");
    expect(cls).not.toContain("--bg-tertiary");
    // The scrim must paint UNDER the scroll controls (z-10).
    expect(screen.getByTestId(SCRIM).className).toContain("z-0");
  });

  it("G4 the scroll controls are not restyled or repositioned by the indicator", () => {
    // The spec pins the scroll controls' resting position as independent of
    // replay state. This is the render-level half; the e2e spec asserts the
    // actual boxes.
    const { container } = renderChat({ replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS);
    });
    const bottomBtn = container.querySelector('[data-testid="scroll-to-bottom"]');
    if (bottomBtn) expect(bottomBtn.className).toContain("bottom-4");
  });

  it("F8d no A-armed timer resurrects the pill later on B's timeline", () => {
    const { rerender } = renderChat({ sessionId: "A", replayInFlight: true });
    React.act(() => {
      vi.advanceTimersByTime(REPLAY_PILL_DELAY_MS - 50);
    });
    React.act(() => {
      rerender(
        <ThemeProvider>
          <ChatView sessionId="B" state={stateWithMessages("other")} toolContext={defaultToolContext} replayInFlight={false} />
        </ThemeProvider>,
      );
    });

    for (const step of [1, REPLAY_PILL_DELAY_MS, REPLAY_PILL_DELAY_MS * 10]) {
      React.act(() => {
        vi.advanceTimersByTime(step);
      });
      expect(screen.queryByTestId(PILL)).toBeNull();
    }
  });
});
