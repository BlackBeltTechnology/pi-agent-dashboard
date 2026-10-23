import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

// Test control over the virtualizer window (jsdom has no layout, so the real
// default range is meaningless). When `win.range` is set, the extractor sees THAT
// as the viewport range; ChatView's own extractor then unions retained rows onto
// it exactly as in production, and the real virtualizer renders the result.
const win = vi.hoisted(() => ({ range: null as null | { start: number; end: number } }));
vi.mock("@tanstack/react-virtual", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (opts: Parameters<typeof actual.useVirtualizer>[0]) =>
      actual.useVirtualizer({
        ...opts,
        rangeExtractor: (r) =>
          win.range
            ? opts.rangeExtractor?.({ ...r, startIndex: win.range.start, endIndex: win.range.end, overscan: 0 }) ?? []
            : (opts.rangeExtractor?.(r) ?? actual.defaultRangeExtractor(r)),
      }),
  };
});

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

// --- keep-oversized-chat-selection: retention past the ceiling, live read, no clearing ---

function mockMedia(matches: (query: string) => boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matches(query),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

const mountedRows = (scrollEl: HTMLElement) =>
  Array.from(scrollEl.querySelectorAll("[data-index]"))
    .map((n) => Number(n.getAttribute("data-index")))
    .sort((a, b) => a - b);

function rowText(scrollEl: HTMLElement, index: number): Node {
  const row = scrollEl.querySelector(`[data-index="${index}"]`);
  if (!row) throw new Error(`row ${index} not mounted`);
  const p = row.querySelector("p") ?? row;
  return p.firstChild ?? p;
}

/** Select from row `a` start to row `b` end; optionally fire `selectionchange`. */
function selectRows(scrollEl: HTMLElement, a: number, b: number, fire = true) {
  const sel = window.getSelection() as Selection;
  const start = rowText(scrollEl, a);
  const end = rowText(scrollEl, b);
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.textContent?.length ?? 0);
  sel.removeAllRanges();
  sel.addRange(range);
  if (fire) document.dispatchEvent(new Event("selectionchange"));
}

const tree = (state: SessionState, extra?: { historySpliceRev?: number }) => (
  <ThemeProvider>
    <ChatView state={state} toolContext={defaultToolContext} {...extra} />
  </ThemeProvider>
);

describe("ChatView oversized selection retention", () => {
  afterEach(() => {
    win.range = null;
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    mockMedia((q) => q === "(prefers-color-scheme: dark)");
  });

  async function mountAll(n: number) {
    win.range = { start: 0, end: n - 1 };
    const view = render(tree(stateWith(n)));
    await flushRaf();
    return { ...view, scrollEl: getScrollContainer(view.container) };
  }

  async function shrinkWindow(view: { rerender: (ui: React.ReactElement) => void }, n: number, start = 0, end = 2) {
    win.range = { start, end };
    await act(async () => view.rerender(tree(stateWith(n))));
  }

  it("E11: retained ceiling follows the pointer modality — 100 fine / 40 coarse / 100 fine-short", async () => {
    const cases: Array<{ name: string; media: (q: string) => boolean; cap: number }> = [
      { name: "fine, short window (max-height:599px)", media: (q) => q.includes("max-height"), cap: 100 },
      { name: "coarse, wide", media: (q) => q === "(pointer: coarse)", cap: 40 },
      { name: "fine, wide", media: () => false, cap: 100 },
    ];
    for (const c of cases) {
      mockMedia(c.media);
      for (const [len, interiorMounted] of [
        [c.cap, true],
        [c.cap + 1, false],
      ] as const) {
        const view = await mountAll(130);
        selectRows(view.scrollEl, 5, 5 + len - 1);
        await flushMicrotasks();
        await shrinkWindow(view, 130);
        const mounted = mountedRows(view.scrollEl);
        // Endpoints always stay; the interior stays only within the ceiling.
        expect(mounted, c.name).toContain(5);
        expect(mounted, c.name).toContain(5 + len - 1);
        expect(mounted.includes(5 + Math.floor(len / 2)), `${c.name} len=${len}`).toBe(interiorMounted);
        // Past the ceiling the selection is never cleared.
        expect(window.getSelection()?.isCollapsed, c.name).toBe(false);
        view.unmount();
      }
    }
  });

  it("F10: a selection survives a history splice above it — retained by row key", async () => {
    const view = await mountAll(60);
    selectRows(view.scrollEl, 30, 31);
    await flushMicrotasks();
    const keyA = view.scrollEl.querySelector('[data-index="30"]')?.getAttribute("data-row-key");
    expect(keyA).toBe("30");

    const spliced = stateWith(60);
    spliced.messages = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, role: "user" as const, content: `older ${i}`, timestamp: 0 })),
      ...spliced.messages,
    ];
    win.range = { start: 0, end: 2 };
    await act(async () => view.rerender(tree(spliced, { historySpliceRev: 1 })));

    const row = view.scrollEl.querySelector('[data-row-key="30"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute("data-index")).toBe("50");
    const sel = window.getSelection() as Selection;
    expect(row?.contains(sel.anchorNode)).toBe(true);
    expect(sel.isCollapsed).toBe(false);
  });

  it("F13: a stored-span change alone is honoured by the next range recompute", async () => {
    const view = await mountAll(60);
    selectRows(view.scrollEl, 2, 3);
    await flushMicrotasks();
    selectRows(view.scrollEl, 2, 8); // stored span grows; isSelecting does not flip → no render
    await shrinkWindow(view, 60, 40, 45);
    const mounted = mountedRows(view.scrollEl);
    for (let i = 2; i <= 8; i++) expect(mounted).toContain(i);
    expect(mounted).toContain(42);
    expect(mounted).not.toContain(20);
  });

  it("F14: a 150-row selection is never cleared and still suspends the bottom-pin", async () => {
    const view = await mountAll(160);
    setScrollPosition(view.scrollEl, 950, 1000, 400);
    fireEvent.scroll(view.scrollEl);
    selectRows(view.scrollEl, 2, 151);
    await flushMicrotasks();
    const spy = vi.spyOn(Selection.prototype, "removeAllRanges");

    document.dispatchEvent(new Event("selectionchange"));
    await flushMicrotasks();
    setScrollPosition(view.scrollEl, 950, 2000, 400);
    const streaming = stateWith(160);
    streaming.streamingText = "a streaming chunk";
    await act(async () => view.rerender(tree(streaming)));

    expect(spy).not.toHaveBeenCalled();
    expect(window.getSelection()?.isCollapsed).toBe(false);
    expect(view.scrollEl.scrollTop).toBe(950);
  });

  it("F15: with selectionchange swallowed, the live selection still keeps its anchor row mounted", async () => {
    const realAdd = document.addEventListener.bind(document);
    vi.spyOn(document, "addEventListener").mockImplementation(((type: string, ...rest: unknown[]) => {
      if (type === "selectionchange") return;
      return (realAdd as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof document.addEventListener);
    const view = await mountAll(60);
    selectRows(view.scrollEl, 0, 0, false);
    await shrinkWindow(view, 60, 40, 45);
    expect(mountedRows(view.scrollEl)).toContain(0);
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });
});
