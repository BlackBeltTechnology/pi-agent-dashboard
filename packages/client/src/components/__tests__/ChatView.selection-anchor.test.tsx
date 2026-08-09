import { act, fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

/**
 * Driven-geometry tests for the selection-anchor compensator
 * (change: anchor-chat-selection-against-row-growth, D1/D3/D5).
 *
 * jsdom has no layout engine, so `getBoundingClientRect()` returns zeros and a
 * real-layout assertion would be a tautology. These tests DRIVE the geometry:
 * the anchor row's rect and the container's `scrollTop` are stubbed, so what is
 * asserted is the compensator's decision logic and its write discipline — one
 * read, at most one write, only while selecting. Real layout is Playwright's
 * job (`tests/e2e/`).
 */

const defaultToolContext: ToolContext = {};

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function stateWith(n: number) {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: String(i), role: "user", content: `message body ${i}`, timestamp: Date.now() });
  }
  return s;
}

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-testid='chat-scroll-container']")!;
}

/**
 * Replace `scrollTop` with a recording accessor so every write is counted, and
 * fix `scrollHeight`/`clientHeight` so the sticky-bottom machinery sees a
 * mid-transcript (NOT near-bottom) position and stays disarmed.
 */
function instrumentScroll(el: HTMLElement, initial: number) {
  const writes: number[] = [];
  let value = initial;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => value,
    set: (v: number) => {
      value = v;
      writes.push(v);
    },
  });
  Object.defineProperty(el, "scrollHeight", { value: 100_000, writable: true, configurable: true });
  Object.defineProperty(el, "clientHeight", { value: 400, writable: true, configurable: true });
  return writes;
}

/** Pin a row's viewport-relative `top`, and count how often it is measured. */
function stubRect(el: HTMLElement) {
  const state = { top: 0, reads: 0 };
  el.getBoundingClientRect = () => {
    state.reads++;
    return { top: state.top, bottom: state.top + 50, left: 0, right: 100, width: 100, height: 50, x: 0, y: state.top, toJSON: () => ({}) } as DOMRect;
  };
  return state;
}

function firstRow(scrollEl: HTMLElement): HTMLElement {
  return scrollEl.querySelector("[data-index]") as HTMLElement;
}

/** Begin a selection whose anchor is inside `row`. */
function selectInside(row: HTMLElement) {
  const target = row.querySelector("p") ?? row;
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

async function flushRaf() {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Mount ChatView, park the view mid-transcript (bottom-pin disarmed), and
 * instrument the container plus the first virtual row.
 */
async function mountAnchored(messageCount = 30) {
  const view = render(
    <ThemeProvider>
      <ChatView state={stateWith(messageCount)} toolContext={defaultToolContext} />
    </ThemeProvider>,
  );
  await flushRaf();
  const scrollEl = getScrollContainer(view.container);
  const writes = instrumentScroll(scrollEl, 5_000);
  // A mid-transcript scroll disarms stickToBottomRef, so nothing else in
  // ChatView writes scrollTop during these tests.
  fireEvent.scroll(scrollEl);

  const row = firstRow(scrollEl);
  const rect = stubRect(row);

  const rerender = async (mutate?: (s: ReturnType<typeof stateWith>) => void) => {
    const next = stateWith(messageCount);
    mutate?.(next);
    await act(async () => {
      view.rerender(
        <ThemeProvider>
          <ChatView state={next} toolContext={defaultToolContext} />
        </ThemeProvider>,
      );
    });
  };

  return { view, scrollEl, writes, row, rect, rerender };
}

describe("ChatView selection-anchor compensation", () => {
  it("writes scrollTop exactly once, by the residual, when a row above grows while selecting", async () => {
    const { scrollEl, writes, row, rect, rerender } = await mountAnchored();

    rect.top = 120;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    // Baseline is captured; nothing written yet.
    const beforeGrowth = writes.length;
    const scrollBefore = scrollEl.scrollTop;

    // A row ABOVE the anchor grows 800px: the anchor's viewport top slides down
    // by the same amount, with no scroll event (TanStack leaves in-viewport
    // resizes uncorrected by design).
    rect.top = 920;
    await rerender();

    expect(writes.length - beforeGrowth).toBe(1);
    expect(scrollEl.scrollTop).toBe(scrollBefore + 800);
  });

  it("compensates a shrink with a negative correction", async () => {
    const { scrollEl, writes, row, rect, rerender } = await mountAnchored();

    rect.top = 900;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    const beforeGrowth = writes.length;
    const scrollBefore = scrollEl.scrollTop;

    rect.top = 600; // row above collapsed
    await rerender();

    expect(writes.length - beforeGrowth).toBe(1);
    expect(scrollEl.scrollTop).toBe(scrollBefore - 300);
  });

  it("writes nothing for the same growth when NO selection is active", async () => {
    const { writes, rect, rerender } = await mountAnchored();

    rect.top = 120;
    const before = writes.length;
    rect.top = 920;
    await rerender();

    expect(writes.length).toBe(before);
  });

  // Task 7.2 — `chat-idle-render-cost`: with no selection the compensator must be
  // FULLY inert, not merely write-free. It early-returns before touching the DOM,
  // so it forces no reflow and cannot show up in the idle layout budget.
  it("forces no reflow at all when no selection is active", async () => {
    const { rect, rerender } = await mountAnchored();

    rect.reads = 0;
    await rerender();
    await rerender((s) => {
      s.streamingText = "assistant is typing…";
    });

    expect(rect.reads).toBe(0);
  });

  it("writes nothing once the selection collapses", async () => {
    const { writes, row, rect, rerender } = await mountAnchored();

    rect.top = 120;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    await act(async () => collapseSelection());
    await flushMicrotasks();

    const before = writes.length;
    rect.top = 920;
    await rerender();
    expect(writes.length).toBe(before);
  });

  // D1 / spec scenario "Above-viewport correction is not doubled".
  it("writes nothing when the virtualizer already corrected an above-viewport resize", async () => {
    const { writes, row, rect, rerender } = await mountAnchored();

    rect.top = 300;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    const before = writes.length;

    // TanStack's resizeItem fired for a row with start < scrollOffset and moved
    // scrollTop itself, so by the time our layout effect measures, the anchor
    // has NOT moved. Asserted explicitly rather than trusting effect ordering.
    rect.top = 300;
    await rerender();

    expect(writes.length).toBe(before);
  });

  // D2 veto.
  it("does not fight a user scroll during an active selection", async () => {
    const { scrollEl, writes, row, rect, rerender } = await mountAnchored();

    rect.top = 400;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    const before = writes.length;

    // The user wheels down 200px: the viewport moved, the content did not.
    Object.defineProperty(scrollEl, "scrollTop", {
      configurable: true,
      get: () => 5_200,
      set: (v: number) => {
        writes.push(v);
      },
    });
    rect.top = 200;
    fireEvent.scroll(scrollEl);
    await rerender();

    expect(writes.length).toBe(before);
  });

  // Task 4.3 — a detached anchor must stop compensation, not correct against a
  // stale rect.
  it("stops compensating when the stored anchor is no longer connected", async () => {
    const { writes, row, rect, rerender } = await mountAnchored();

    rect.top = 120;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    const before = writes.length;

    row.remove();
    expect(row.isConnected).toBe(false);

    rect.top = 920;
    await rerender();
    expect(writes.length).toBe(before);
  });

  // Task 7.1 — exactly ONE forced reflow per commit. The post-write baseline is
  // DERIVED (`nextTop - applied`), not re-measured, so a correcting commit costs
  // the same single rect read as a non-correcting one.
  it("reads the anchor rect exactly once per commit, even when it corrects", async () => {
    const { row, rect, rerender } = await mountAnchored();

    rect.top = 120;
    await act(async () => selectInside(row));
    await flushMicrotasks();

    rect.reads = 0;
    rect.top = 920;
    await rerender();
    expect(rect.reads).toBe(1);
  });

  // The derived re-baseline must survive a CLAMPED write, or the next commit
  // treats the un-applied remainder as fresh drift and corrects it again.
  it("re-baselines from the actually-applied delta when the write is clamped", async () => {
    const { scrollEl, writes, row, rect, rerender } = await mountAnchored();

    rect.top = 120;
    await act(async () => selectInside(row));
    await flushMicrotasks();

    // Clamp scrollTop at 5_000: the container refuses to scroll further.
    let clamped = 5_000;
    Object.defineProperty(scrollEl, "scrollTop", {
      configurable: true,
      get: () => clamped,
      set: (v: number) => {
        clamped = Math.min(v, 5_000);
        writes.push(v);
      },
    });

    rect.top = 920; // wants +800, gets 0
    await rerender();
    const afterFirst = writes.length;

    // Nothing moved since; the compensator must not keep re-issuing the
    // un-applied 800px every commit.
    await rerender();
    expect(writes.length).toBe(afterFirst);
  });

  // Task 7.3 — smooth scrolling would animate every correction and turn the
  // compensator into a visible oscillator.
  it("never uses smooth scrolling on the compensation path", async () => {
    const { scrollEl, row, rect, rerender } = await mountAnchored();
    const scrollToSpy = vi.fn();
    scrollEl.scrollTo = scrollToSpy as unknown as typeof scrollEl.scrollTo;

    rect.top = 120;
    await act(async () => selectInside(row));
    await flushMicrotasks();
    rect.top = 920;
    await rerender();

    expect(scrollEl.style.scrollBehavior).not.toBe("smooth");
    for (const call of scrollToSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("smooth");
    }
  });
});
