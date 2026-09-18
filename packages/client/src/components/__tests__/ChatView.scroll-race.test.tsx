import { act, fireEvent, render } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

beforeAll(() => {
  // jsdom doesn't implement scrollTo
  Element.prototype.scrollTo = () => {};
  // jsdom doesn't implement matchMedia
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

/**
 * Model the container's scroll geometry GLOBALLY (on `HTMLElement.prototype`),
 * not as own properties of one element: `<ChatView>` remounts its scroll
 * container when `sessionId` changes (the `FilePreviewProvider key={sessionId}`
 * boundary), so a per-element accessor would be lost on exactly the
 * session-switch paths that need it.
 *
 * `scrollTop` is a CLAMPING accessor because the browser clamps every write to
 * [0, scrollHeight − clientHeight] — and that clamp is load-bearing for the
 * bottom-pin tests: the pin writes `scrollTop = scrollHeight` (an overshoot by
 * clientHeight), and the clamped value it actually lands on is what
 * `handleScroll` later compares against. A plain data property would let
 * programmatic writes overshoot and silently hide any defect about "where the
 * pin really landed".
 */
const geometry = { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
const maxScrollTop = () => Math.max(geometry.scrollHeight - geometry.clientHeight, 0);
Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
  configurable: true,
  get() {
    return geometry.scrollHeight;
  },
});
Object.defineProperty(HTMLElement.prototype, "clientHeight", {
  configurable: true,
  get() {
    return geometry.clientHeight;
  },
});
Object.defineProperty(HTMLElement.prototype, "scrollTop", {
  configurable: true,
  get() {
    return geometry.scrollTop;
  },
  set(v: number) {
    geometry.scrollTop = Math.min(Math.max(v, 0), maxScrollTop());
  },
});

function setScrollPosition(_el: Element, scrollTop: number, scrollHeight: number, clientHeight: number) {
  geometry.scrollHeight = scrollHeight;
  geometry.clientHeight = clientHeight;
  geometry.scrollTop = Math.min(Math.max(scrollTop, 0), maxScrollTop());
}

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[class*='overflow-y-auto']")!;
}

const scrollBottomButton = (container: HTMLElement) =>
  container.querySelector('[data-testid="scroll-to-bottom"]');

function stateWith(n: number) {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: String(i), role: "user", content: `m${i}`, timestamp: Date.now() });
  }
  return s;
}

/** Same shape as `stateWith` but with prefixed ids, so a saved virtual anchor
 * from one transcript cannot resolve against another. */
function stateWithIds(prefix: string, n: number) {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: `${prefix}${i}`, role: "user", content: `m${i}`, timestamp: Date.now() });
  }
  return s;
}

/** Flush one animation frame — some React updates still flush through rAF in tests */
async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

describe("ChatView sticky scroll", () => {
  it("keeps the scroll-to-bottom button hidden after programmatic auto-scroll", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={createInitialState()} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    // Simulate content streaming in while the user is already at the bottom
    const scrollEl = getScrollContainer(container);
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl); // sets stickToBottomRef = true

    setScrollPosition(scrollEl, 950, 1500, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    // Programmatic auto-scroll must not surface the escape button
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();
  });

  it("lets the user escape sticky bottom immediately on scroll-up", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={createInitialState()} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    // Start at bottom, then scroll up
    const scrollEl = getScrollContainer(container);
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);

    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // More content arrives; scroll must stay where the user left it
    const previousTop = scrollEl.scrollTop;
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    expect(scrollEl.scrollTop).toBe(previousTop);
  });

  it("re-arms sticky bottom when the user scrolls back to the end", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={createInitialState()} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    // Escape
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // Return to bottom
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();

    // New content should now be chased again (clamped max = 1500 − 400).
    setScrollPosition(scrollEl, 1100, 1500, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    expect(scrollEl.scrollTop).toBe(1100);
  });

  it("one click on scroll-to-bottom survives mid-flight height growth (virtualized rows measuring in)", async () => {
    // Regression: under TanStack virtualization the rows below the viewport
    // are ESTIMATED; while the smooth scroll descends they mount + measure and
    // scrollHeight grows past the click-time target. The in-flight scroll
    // events see nearBottom=false and used to clear stickToBottomRef, so the
    // descent stalled short of the bottom and the button had to be clicked
    // repeatedly. One click must latch "descend to bottom" until arrival.
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    // User is far up the transcript — button visible.
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();

    // Click the button (scrollTo is stubbed in jsdom — the descent is
    // represented by the scroll events we fire below).
    fireEvent.click(container.querySelector('[data-testid="scroll-to-bottom"]')!);

    // Mid-flight: not yet at the bottom AND scrollHeight grew (rows measured).
    setScrollPosition(scrollEl, 900, 2600, 400);
    fireEvent.scroll(scrollEl);

    // The single click must keep the descent latched: button stays hidden…
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).toBeNull();

    // …and the sticky pin must still chase the (grown) bottom on next content
    // (clamped max = 3000 − 400).
    setScrollPosition(scrollEl, 900, 3000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(51)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(2600);
  });

  it("user wheel input cancels an in-flight scroll-to-bottom descent", async () => {
    const { container } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();

    const scrollEl = getScrollContainer(container);
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    fireEvent.click(container.querySelector('[data-testid="scroll-to-bottom"]')!);

    // The user grabs the wheel mid-descent — that must cancel the latch.
    fireEvent.wheel(scrollEl, { deltaY: -100 });
    setScrollPosition(scrollEl, 700, 2600, 400);
    fireEvent.scroll(scrollEl);

    // Escape respected: button re-appears, no forced pin.
    expect(container.querySelector('[data-testid="scroll-to-bottom"]')).not.toBeNull();
  });
});

// Bottom-pin measurement clamp (change: fix-long-session-ux-degradation, D5).
//
// The defect: a bottom-pin writes `scrollTop = scrollHeight`, the browser clamps
// it to the extent that exists NOW, rows below the viewport then measure in and
// grow `scrollHeight`, and the pin's induced scroll event reports a position far
// from the new bottom with no user gesture. `handleScroll` used to treat that as
// an escape and clear the follow, stranding the view mid-transcript.
//
// These are LOGIC guards on the writer-attribution state machine; the browser-
// timing convergence guarantee is Playwright-gated (`long-session-settle.spec.ts`,
// test-plan #P4).
describe("ChatView bottom-pin measurement clamp", () => {
  const view = (state: ReturnType<typeof createInitialState>, sessionId?: string) => (
    <ThemeProvider>
      <ChatView sessionId={sessionId} state={state} toolContext={defaultToolContext} />
    </ThemeProvider>
  );

  it("F1: holds the follow when a measurement clamps the bottom-pin (no gesture)", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // User is at the bottom → follow armed (clamped max = 2400 − 400 = 2000).
    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();

    // Content arrives: the stick effect pins to the bottom, landing clamped at 2000.
    rerender(view(stateWith(51)));
    expect(scrollEl.scrollTop).toBe(2000);

    // A row below the viewport measures in AFTER the write, then the pin's own
    // scroll event dispatches: nearBottom is false (2600 − 2000 − 400 = 200),
    // scrollTop still equals the pinned value.
    setScrollPosition(scrollEl, 2000, 2600, 400);
    fireEvent.scroll(scrollEl);

    // The clamp must not surface the escape affordance nor clear the follow.
    expect(scrollBottomButton(container)).toBeNull();

    // …and the next growth is chased to the new bottom (clamped max = 3000 − 400).
    setScrollPosition(scrollEl, 2000, 3000, 400);
    rerender(view(stateWith(52)));
    expect(scrollEl.scrollTop).toBe(2600);
  });

  it("F2: releases the follow when the view moves above the pin with no gesture", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51)));
    expect(scrollEl.scrollTop).toBe(2000); // pinned, clamped to max

    // The user drags the scrollbar up while the pin's window is still open — no
    // wheel/touch listener fires, so only the position can reveal the escape.
    setScrollPosition(scrollEl, 1200, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // Later growth must NOT yank the view back down.
    setScrollPosition(scrollEl, 1200, 3000, 400);
    rerender(view(stateWith(52)));
    expect(scrollEl.scrollTop).toBe(1200);
  });

  it("F3: attribution is single-use — a consumed snapshot cannot re-match", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51)));
    expect(scrollEl.scrollTop).toBe(2000); // snapshot {2000, 2400}

    // First event falls through (position off the pin) and CONSUMES the snapshot.
    setScrollPosition(scrollEl, 1000, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // A later event coincidentally reports the recorded scrollTop with grown
    // content — it must NOT re-arm the follow.
    setScrollPosition(scrollEl, 2000, 3000, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // …and growth still is not chased.
    setScrollPosition(scrollEl, 2000, 3400, 400);
    rerender(view(stateWith(52)));
    expect(scrollEl.scrollTop).toBe(2000);
  });

  it("F4: a scrollbar drag away from the pin releases the follow (no wheel/touch)", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51)));
    expect(scrollEl.scrollTop).toBe(2000);

    // No wheel/touch at all — a scrollbar drag produces only a scroll event.
    setScrollPosition(scrollEl, 1500, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    setScrollPosition(scrollEl, 1500, 3000, 400);
    rerender(view(stateWith(52)));
    expect(scrollEl.scrollTop).toBe(1500);
  });

  it("F5: attribution does not cross a session switch", async () => {
    const { container, rerender } = render(view(stateWith(50), "f5-a"));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51), "f5-a"));
    expect(scrollEl.scrollTop).toBe(2000); // snapshot recorded in A

    // Move to a different geometry before switching so B's own restore pin can
    // never coincidentally match A's snapshot.
    setScrollPosition(scrollEl, 300, 3000, 400);
    rerender(view(stateWith(51), "f5-b"));
    const bScrollEl = getScrollContainer(container);

    // B's first scroll event reports A's pinned position with content grown past
    // A's snapshot. It must NOT be attributed to A's pin.
    setScrollPosition(bScrollEl, 2000, 4000, 400);
    fireEvent.scroll(bScrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();
  });

  it("F6a: the session-switch near-bottom pin is attributable", async () => {
    const { container, rerender } = render(view(stateWith(50), "f6a-a"));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Leave A at a known geometry, then switch to a fresh session B (no saved
    // state) → the near-bottom/first-visit pin.
    setScrollPosition(scrollEl, 600, 1000, 400);
    rerender(view(stateWith(50), "f6a-b"));
    const bScrollEl = getScrollContainer(container);

    // scrollTo is a no-op in jsdom, so B's pin recorded the position/height it
    // saw (600/1000). Growth then arrives and the induced event reports exactly
    // that achieved position — a measurement clamp, not an escape.
    setScrollPosition(bScrollEl, 600, 1600, 400);
    fireEvent.scroll(bScrollEl);
    expect(scrollBottomButton(container)).toBeNull();
  });

  it("F6b: the anchor-row-not-found fallback preserves the released follow", async () => {
    const { container, rerender } = render(view(stateWith(50), "f6b-b"));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Scroll away from the bottom → persists a virtual anchor for f6b-b.
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // Switch away, then back with a transcript whose rows carry DIFFERENT ids so
    // the saved anchor cannot resolve → the bottom-pin fallback, which pins
    // while deliberately leaving the follow released.
    rerender(view(stateWith(50), "f6b-x"));
    setScrollPosition(scrollEl, 500, 1200, 400);
    rerender(view(stateWithIds("z", 50), "f6b-b"));
    const bScrollEl = getScrollContainer(container);

    // A measurement-clamp event must PRESERVE that released state, not re-arm it.
    setScrollPosition(bScrollEl, 500, 1800, 400);
    fireEvent.scroll(bScrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // …and a later growth is not chased.
    setScrollPosition(bScrollEl, 500, 2200, 400);
    rerender(view(stateWithIds("z", 51), "f6b-b"));
    expect(bScrollEl.scrollTop).toBe(500);
  });

  it("F6c: the follow-effect pin is attributable", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 1000, 1400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51))); // follow-effect pin, clamped to 1000
    expect(scrollEl.scrollTop).toBe(1000);

    setScrollPosition(scrollEl, 1000, 1800, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();
  });

  it("F6d: the virtualizer onChange re-pin is attributable", async () => {
    const { container } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // The first scroll event both arms the follow and lets the virtualizer's
    // onChange re-pin — the extent grew since mount, so it writes the bottom and
    // records the snapshot. No state change occurs, so the follow effect cannot
    // be the writer.
    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();

    // The pin's induced event, after further measurement growth, is a clamp →
    // held. (Were the onChange pin absent, the mount snapshot would have been
    // consumed on the first event and this one would release the follow.)
    setScrollPosition(scrollEl, 2000, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();
  });

  it("F6e: the restore idx>=0 path is a jump — it does not re-arm the follow", async () => {
    const { container, rerender } = render(view(stateWith(50), "f6e-a"));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Persist a scroll-locked anchor for f6e-a.
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // Switch away and back with the SAME transcript → the anchor resolves → the
    // `idx >= 0` restore path (a deliberate relocation, i.e. a jump).
    rerender(view(stateWith(50), "f6e-x"));
    rerender(view(stateWith(50), "f6e-a"));
    await flushRaf();
    const bScrollEl = getScrollContainer(container);

    // A near-bottom event inside the suppression window belongs to that jump and
    // must be ignored, not used to re-arm the follow.
    setScrollPosition(bScrollEl, 1600, 2000, 400);
    fireEvent.scroll(bScrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();
  });

  it("F7: a clamp-preserved follow survives a switch away and back", async () => {
    const { container, rerender } = render(view(stateWith(50), "f7-a"));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Sit at the bottom → follow armed, and persist a resolvable anchor + follow.
    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();

    // New content pins to the (clamped) bottom; the pin records its snapshot.
    rerender(view(stateWith(51), "f7-a"));
    expect(scrollEl.scrollTop).toBe(2000); // clamped max = 2400 − 400

    // Measurement growth AFTER the pin: the induced event reads nearBottom=false
    // but is a clamp, so the follow is held. The persisted scroll state must
    // store the PRESERVED follow (true), not the raw nearBottom (false) —
    // otherwise the follow survives in-session but is thrown away by the next
    // switch, restoring mid-transcript with the escape affordance showing.
    setScrollPosition(scrollEl, 2000, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();

    // Switch away, then back: the restore must land at the bottom with the
    // button hidden, not on the saved (mid-transcript) anchor.
    rerender(view(stateWith(51), "f7-x"));
    rerender(view(stateWith(51), "f7-a"));
    await flushRaf();

    expect(scrollBottomButton(container)).toBeNull();
  });

  it("E14: sub-pixel readback (5000.4 vs a 5000 pin) is treated as a clamp", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 5000, 5400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51)));
    expect(scrollEl.scrollTop).toBe(5000); // snapshot {5000, 5400}

    setScrollPosition(scrollEl, 5000.4, 6000, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();
  });

  it("E15: a position just outside tolerance (5005 vs a 5000 pin) releases the follow", async () => {
    const { container, rerender } = render(view(stateWith(50)));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 5000, 5400, 400);
    fireEvent.scroll(scrollEl);
    rerender(view(stateWith(51)));
    expect(scrollEl.scrollTop).toBe(5000);

    setScrollPosition(scrollEl, 5005, 6000, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();
  });

  it("E16: an empty/zero-height pin does not satisfy the clamp", async () => {
    const { container } = render(view(createInitialState()));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // The mount pin landed on an EMPTY container: snapshot height 0.
    setScrollPosition(scrollEl, 0, 1000, 400);
    fireEvent.scroll(scrollEl);

    // The `landed with real content` clause fails → falls through and releases.
    expect(scrollBottomButton(container)).not.toBeNull();
  });

  it("X5: a real gesture during replay wins — follow released, later batches do not pull back", async () => {
    const streaming = stateWith(50);
    streaming.streamingText = "replaying…";
    const { container, rerender } = render(view(streaming));
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Follow active at the bottom.
    setScrollPosition(scrollEl, 2000, 2400, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).toBeNull();

    // User wheels upward — the one gesture that clears attribution.
    fireEvent.wheel(scrollEl, { deltaY: -100 });
    setScrollPosition(scrollEl, 1200, 2600, 400);
    fireEvent.scroll(scrollEl);
    expect(scrollBottomButton(container)).not.toBeNull();

    // A later replay batch must not pull the view back to the bottom.
    const more = stateWith(51);
    more.streamingText = "still replaying…";
    setScrollPosition(scrollEl, 1200, 3200, 400);
    rerender(view(more));
    expect(scrollEl.scrollTop).toBe(1200);
  });
});

// Scroll-to-top affordance (change: fix-chat-scroll-to-top-estimate-drift,
// Decision 3). These are LOGIC guards on the state machine — the browser-
// timing convergence guarantee (scrollTop lands on 0 through the bounded
// scrollToIndex retries + async image remeasure) is Playwright-gated; jsdom's
// virtualizer shim reports 0-height rows and a no-op ResizeObserver, so a
// scrollTop===0 assertion here would be vacuous.
describe("ChatView scroll-to-top", () => {
  it("shows the scroll-to-top button when scrolled away from the top, hides it at the top", async () => {
    const { container } = render(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // Scrolled down (away from the top) → button appears.
    setScrollPosition(scrollEl, 900, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-top"]')).not.toBeNull();

    // Back at the very top → button hidden.
    setScrollPosition(scrollEl, 0, 2000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-top"]')).toBeNull();
  });

  it("does not fight the bottom-pin: activating scroll-to-top from the bottom while streaming stays scroll-locked", async () => {
    // The re-arm race: starting the ascent from the bottom means handleScroll
    // fires with nearBottom=true during the scroll-to-top; without the
    // ascendingRef latch it would flip stickToBottomRef back to true and the
    // onChange/auto-scroll pin would yank the view back to the bottom.
    const streaming = stateWith(50);
    streaming.streamingText = "assistant is typing…";
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={streaming} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // User is at the bottom (following).
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);
    expect(container.querySelector('[data-testid="scroll-to-top"]')).not.toBeNull();

    // Activate scroll-to-top. scrollTo is stubbed, so the DOM position does not
    // move here — we assert the STATE MACHINE stays scroll-locked.
    fireEvent.click(container.querySelector('[data-testid="scroll-to-top"]')!);

    // A scroll event still reporting near-bottom must NOT re-arm the pin
    // (ascendingRef branch holds stickToBottomRef false).
    setScrollPosition(scrollEl, 600, 1000, 400);
    fireEvent.scroll(scrollEl);

    // More streaming content arrives with grown height. Because follow is
    // suspended, the view must NOT be pinned to the (grown) bottom.
    const before = scrollEl.scrollTop;
    const more = stateWith(60);
    more.streamingText = "still typing…";
    setScrollPosition(scrollEl, 600, 2000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={more} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(before); // not yanked to the grown bottom (1600)
  });
});
