import { act, fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/event-reducer.js";
import { ChatView } from "../ChatView.js";
import { ThemeProvider } from "../ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = { editors: [] };

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

function setScrollPosition(el: Element, scrollTop: number, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollTop", { value: scrollTop, writable: true, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight, writable: true, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: clientHeight, writable: true, configurable: true });
}

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-testid='chat-scroll-container']")!;
}

function stateWith(n: number) {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: String(i), role: "user", content: `message body ${i}`, timestamp: Date.now() });
  }
  return s;
}

async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

/** Flush the hook's microtask-coalesced isSelecting flip. */
async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Select the first rendered transcript text node inside the container. */
function selectInsideTranscript(scrollEl: HTMLElement) {
  const target = scrollEl.querySelector("[data-index] p, [data-index]") ?? scrollEl;
  const textNode = target.firstChild ?? target;
  const sel = window.getSelection();
  if (!sel) throw new Error("no selection");
  const range = document.createRange();
  range.selectNodeContents(textNode);
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function collapseSelection() {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
}

describe("ChatView selection preservation", () => {
  it("suspends the auto-scroll bottom-pin while a transcript selection is held", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={stateWith(30)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    // User is at the bottom, following.
    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);

    // Hold a selection inside the transcript.
    await act(async () => selectInsideTranscript(scrollEl));
    await flushMicrotasks();

    // New content streams in with grown height. Because a selection is held,
    // the view must NOT be yanked to the new bottom.
    setScrollPosition(scrollEl, 950, 2000, 400);
    const more = stateWith(40);
    more.streamingText = "assistant is typing…";
    rerender(
      <ThemeProvider>
        <ChatView state={more} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(950); // not pinned to scrollHeight (2000)
  });

  it("resumes following the bottom on collapse even when no further content arrives", async () => {
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={stateWith(30)} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl); // stickToBottomRef = true

    await act(async () => selectInsideTranscript(scrollEl));
    await flushMicrotasks();

    // Content arrived DURING the selection (height grew, no pin applied).
    setScrollPosition(scrollEl, 950, 2000, 400);
    const more = stateWith(40);
    rerender(
      <ThemeProvider>
        <ChatView state={more} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    expect(scrollEl.scrollTop).toBe(950);

    // Collapse with NO new content: the isSelecting→false edge must re-fire the
    // pin (isSelecting is in the effect dep array) and land at the bottom.
    await act(async () => collapseSelection());
    await flushMicrotasks();
    expect(scrollEl.scrollTop).toBe(2000);
  });

  it("does not throw and suspends follow for a streaming-tail-only selection (Path B baseline)", async () => {
    const streaming = stateWith(20);
    streaming.streamingText = "streaming answer text that is long enough to select";
    const { container, rerender } = render(
      <ThemeProvider>
        <ChatView state={streaming} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    await flushRaf();
    const scrollEl = getScrollContainer(container);

    setScrollPosition(scrollEl, 950, 1000, 400);
    fireEvent.scroll(scrollEl);

    // Select inside the streaming tail (non-virtual region: no data-index).
    await act(async () => {
      const tail = scrollEl.querySelector(".chat-stream-live") ?? scrollEl;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(tail);
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await flushMicrotasks();

    // Next chunk arrives — must not crash; follow suspended (no yank).
    setScrollPosition(scrollEl, 950, 2000, 400);
    const more = stateWith(20);
    more.streamingText = "streaming answer text that is long enough to select and MORE";
    expect(() =>
      rerender(
        <ThemeProvider>
          <ChatView state={more} toolContext={defaultToolContext} />
        </ThemeProvider>,
      ),
    ).not.toThrow();
    expect(scrollEl.scrollTop).toBe(950);
  });
});
