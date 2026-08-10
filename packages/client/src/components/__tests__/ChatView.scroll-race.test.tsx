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

function setScrollPosition(el: Element, scrollTop: number, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, writable: true, configurable: true });
}

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[class*='overflow-y-auto']")!;
}

function stateWith(n: number) {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: String(i), role: "user", content: `m${i}`, timestamp: Date.now() });
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

    // New content should now be chased again
    setScrollPosition(scrollEl, 950, 1500, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(50)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );

    expect(scrollEl.scrollTop).toBe(1500);
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

    // …and the sticky pin must still chase the (grown) bottom on next content.
    setScrollPosition(scrollEl, 900, 3000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={stateWith(51)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(3000);
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
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);

    // More streaming content arrives with grown height. Because follow is
    // suspended, the view must NOT be pinned to the (grown) bottom.
    const before = scrollEl.scrollTop;
    const more = stateWith(60);
    more.streamingText = "still typing…";
    setScrollPosition(scrollEl, 950, 2000, 400);
    rerender(
      <ThemeProvider>
        <ChatView state={more} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(before); // not yanked to scrollHeight (2000)
  });
});
