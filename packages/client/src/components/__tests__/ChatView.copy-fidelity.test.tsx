import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createInitialState, type SessionState } from "../../lib/chat/event-reducer.js";
import { ChatView } from "../chat/ChatView.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

const defaultToolContext: ToolContext = {};

// Test control over the virtualizer window + fault injection (jsdom has no
// layout). `win.range` replaces the viewport range the extractor sees and
// `win.extra` adds rows to it, so ChatView's own extractor unions its retained
// and copy rows onto a deliberately SMALL working set, as in production.
const win = vi.hoisted(() => ({
  range: null as null | { start: number; end: number },
  extra: [] as number[],
  measured: [] as string[],
  total: () => -1,
}));
const hooks = vi.hoisted(() => ({
  throwOnSerialize: false,
  onSerialize: null as null | (() => void),
  flushCalls: 0,
  flushThrowAt: null as null | number,
}));
vi.mock("@tanstack/react-virtual", async (importActual) => {
  const actual = await importActual<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (opts: Parameters<typeof actual.useVirtualizer>[0]) => {
      const v = actual.useVirtualizer({
        ...opts,
        rangeExtractor: (r) => {
          if (!win.range) return opts.rangeExtractor?.(r) ?? actual.defaultRangeExtractor(r);
          const out = opts.rangeExtractor?.({ ...r, startIndex: win.range.start, endIndex: win.range.end, overscan: 0 }) ?? [];
          return Array.from(new Set([...out, ...win.extra.filter((i) => i < r.count)])).sort((a, b) => a - b);
        },
      });
      const holder = v as unknown as { __wrapped?: boolean; measureElement: (n: Element | null) => void };
      if (!holder.__wrapped) {
        const orig = holder.measureElement;
        holder.measureElement = (node) => {
          win.measured.push(node ? (node.getAttribute("data-index") ?? "?") : "null");
          return orig(node);
        };
        holder.__wrapped = true;
      }
      win.total = () => v.getTotalSize();
      return v;
    },
  };
});
vi.mock("react-dom", async (importActual) => {
  const actual = await importActual<typeof import("react-dom")>();
  return {
    ...actual,
    flushSync: ((fn: () => void) => {
      hooks.flushCalls++;
      if (hooks.flushThrowAt === hooks.flushCalls) throw new Error("flushSync boom");
      return actual.flushSync(fn);
    }) as typeof actual.flushSync,
  };
});
vi.mock("../../lib/chat/chat-selection-copy.js", async (importActual) => {
  const actual = await importActual<typeof import("../../lib/chat/chat-selection-copy.js")>();
  return {
    ...actual,
    buildSelectionClipboardText: (...args: Parameters<typeof actual.buildSelectionClipboardText>) => {
      hooks.onSerialize?.();
      if (hooks.throwOnSerialize) throw new Error("serialize boom");
      return actual.buildSelectionClipboardText(...args);
    },
  };
});
vi.mock("../terminal/InlineTerminalCard.js", () => ({
  InlineTerminalCard: () => <div>terminal ready</div>,
}));

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

function getScrollContainer(container: HTMLElement): HTMLElement {
  return container.querySelector("[data-testid='chat-scroll-container']")!;
}

/** Dispatch a copy event with a stub clipboardData; return what was written. */
function dispatchCopy(scrollEl: HTMLElement): { text: string | null; prevented: boolean } {
  let written: string | null = null;
  const clipboardData = { setData: (_type: string, value: string) => (written = value) };
  const evt = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "clipboardData", { value: clipboardData });
  act(() => {
    scrollEl.dispatchEvent(evt);
  });
  return { text: written, prevented: evt.defaultPrevented };
}

describe("ChatView copy fidelity", () => {
  it("rebuilds clipboard text from a partial-node transcript selection", () => {
    const state = createInitialState();
    state.messages.push({ id: "0", role: "user", content: "the quick brown fox", timestamp: Date.now() });
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEl = getScrollContainer(container);
    const textNode = scrollEl.querySelector("[data-index] p")!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 4);
    range.setEnd(textNode, 15);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const { text, prevented } = dispatchCopy(scrollEl);
    expect(text).toBe("quick brown");
    expect(prevented).toBe(true);
  });

  it("serializes a selection that extends outside the transcript as inside + outside parts (D7)", () => {
    const state = createInitialState();
    state.messages.push({ id: "0", role: "user", content: "inside the transcript", timestamp: Date.now() });
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEl = getScrollContainer(container);
    // A node OUTSIDE the scroll container (sibling in the document body).
    const outside = document.createElement("p");
    outside.textContent = "outside pane text";
    document.body.appendChild(outside);

    // Selection starts inside the transcript and ends outside it: the container
    // is a block boundary, so the parts join with one newline.
    const insideNode = scrollEl.querySelector("[data-index] p")!.firstChild!;
    const range = document.createRange();
    range.setStart(insideNode, 0);
    range.setEnd(outside.firstChild!, 3);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    const { text, prevented } = dispatchCopy(scrollEl);
    expect(text).toMatch(/^inside the transcript\n[\s\S]*\nout$/);
    expect(prevented).toBe(true);
    outside.remove();
  });

  it("ignores a collapsed selection (native copy owns it)", () => {
    const state = createInitialState();
    state.messages.push({ id: "0", role: "user", content: "hello world", timestamp: Date.now() });
    const { container } = render(
      <ThemeProvider>
        <ChatView state={state} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEl = getScrollContainer(container);
    window.getSelection()!.removeAllRanges();

    const { text, prevented } = dispatchCopy(scrollEl);
    expect(text).toBeNull();
    expect(prevented).toBe(false);
  });
});

// --- keep-oversized-chat-selection: full-span copy, ceiling, arbitration, faults ---

function mockMedia(coarse: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(pointer: coarse)" ? coarse : query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

const marker = (i: number) => `row-marker-${i}-end`;

function stateWithMarkers(n: number, special?: Record<number, Partial<SessionState["messages"][number]>>): SessionState {
  const s = createInitialState();
  for (let i = 0; i < n; i++) {
    s.messages.push({ id: String(i), role: "user", content: marker(i), timestamp: Date.now(), ...(special?.[i] ?? {}) });
  }
  return s;
}

const mountedRows = (scrollEl: HTMLElement) =>
  Array.from(scrollEl.querySelectorAll("[data-index]"))
    .map((n) => Number(n.getAttribute("data-index")))
    .sort((a, b) => a - b);

function rowText(scrollEl: HTMLElement, index: number): Node {
  const row = scrollEl.querySelector(`[data-index="${index}"]`);
  if (!row) throw new Error(`row ${index} not mounted`);
  return row.querySelector("p")?.firstChild ?? row;
}

function selectRows(scrollEl: HTMLElement, a: number, b: number) {
  const sel = window.getSelection() as Selection;
  const start = rowText(scrollEl, a);
  const end = rowText(scrollEl, b);
  const range = document.createRange();
  range.setStart(start, 0);
  range.setEnd(end, end.textContent?.length ?? 0);
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Mount `n` rows with ONLY rows `extra` (+ anything retained) in the working set. */
async function mountSelected(state: SessionState, a: number, b: number, extra: number[]) {
  const n = state.messages.length;
  win.range = { start: 0, end: n - 1 };
  const view = render(
    <ThemeProvider>
      <ChatView state={state} toolContext={defaultToolContext} />
    </ThemeProvider>,
  );
  const scrollEl = getScrollContainer(view.container);
  selectRows(scrollEl, a, b);
  await flush();
  win.range = { start: 0, end: -1 };
  win.extra = extra;
  await act(async () => view.rerender(<ThemeProvider><ChatView state={{ ...state }} toolContext={defaultToolContext} /></ThemeProvider>));
  return { ...view, scrollEl, state };
}

describe("ChatView full-span copy (D2/D3/D7)", () => {
  afterEach(() => {
    win.range = null;
    win.extra = [];
    win.measured = [];
    hooks.throwOnSerialize = false;
    hooks.onSerialize = null;
    hooks.flushThrowAt = null;
    hooks.flushCalls = 0;
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
    mockMedia(false);
  });

  it("E12: declines a transcript part above the copy ceiling — 150 copies, 151 declines (coarse)", async () => {
    mockMedia(true);
    const view = await mountSelected(stateWithMarkers(152), 0, 149, [0]);
    const ok = dispatchCopy(view.scrollEl);
    expect(ok.prevented).toBe(true);
    for (const i of [0, 75, 149]) expect(ok.text).toContain(marker(i));
    view.unmount();

    const big = await mountSelected(stateWithMarkers(152), 0, 150, [0]);
    const declined = dispatchCopy(big.scrollEl);
    expect(declined.text).toBeNull(); // no setData: the prior clipboard survives
    expect(declined.prevented).toBe(true);
    expect(screen.getByText(/too large to copy at once/i)).toBeTruthy();
    expect(window.getSelection()?.isCollapsed).toBe(false);
  });

  it("E12: fine pointer copies up to 500 rows and declines at 501", async () => {
    const view = await mountSelected(stateWithMarkers(502), 0, 499, [0]);
    expect(dispatchCopy(view.scrollEl).text).toContain(marker(499));
    view.unmount();
    const big = await mountSelected(stateWithMarkers(502), 0, 500, [0]);
    const declined = dispatchCopy(big.scrollEl);
    expect(declined.text).toBeNull();
    expect(declined.prevented).toBe(true);
  }, 30_000);

  it("E13: never hijacks a copy that originates in an editable field", async () => {
    const view = await mountSelected(stateWithMarkers(6), 0, 3, [0]);
    const field = document.createElement("textarea");
    document.body.appendChild(field);
    let written: string | null = null;
    const evt = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "clipboardData", { value: { setData: (_t: string, v: string) => (written = v) } });
    act(() => {
      field.dispatchEvent(evt);
    });
    expect(written).toBeNull();
    expect(evt.defaultPrevented).toBe(false);
    field.remove();
    view.unmount();
  });

  it("E14: with two transcripts, exactly one listener acts and it declines with one toast", async () => {
    const a = stateWithMarkers(4);
    const b = stateWithMarkers(4);
    const { container } = render(
      <ThemeProvider>
        <ChatView state={a} toolContext={defaultToolContext} />
        <ChatView state={b} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEls = Array.from(container.querySelectorAll<HTMLElement>("[data-testid='chat-scroll-container']"));
    expect(scrollEls).toHaveLength(2);
    const range = document.createRange();
    range.setStart(rowText(scrollEls[0], 1), 0);
    range.setEnd(rowText(scrollEls[1], 2), 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    let setDataCalls = 0;
    const evt = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(evt, "clipboardData", { value: { setData: () => setDataCalls++ } });
    const prevent = vi.spyOn(evt, "preventDefault");
    act(() => {
      scrollEls[0].dispatchEvent(evt);
    });
    expect(setDataCalls).toBe(0);
    expect(prevent).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/Copy each transcript separately/i)).toHaveLength(1);
  });

  it("F16: copies every row of a 200-row selection whose interior is unmounted, without measuring them", async () => {
    const view = await mountSelected(stateWithMarkers(210), 3, 203, [3, 203]);
    const before = mountedRows(view.scrollEl);
    expect(before.includes(100)).toBe(false); // interior really is unmounted
    win.measured = [];
    const totalBefore = win.total();

    const { text, prevented } = dispatchCopy(view.scrollEl);
    expect(prevented).toBe(true);
    let at = -1;
    for (let i = 3; i <= 203; i++) {
      const found = (text as string).indexOf(marker(i));
      expect(found, `row ${i}`).toBeGreaterThan(at); // present, in order
      expect((text as string).split(marker(i)).length - 1, `row ${i} once`).toBe(1);
      at = found;
    }
    expect(win.measured.filter((m) => m !== "null" && Number(m) > 3 && Number(m) < 203)).toEqual([]);
    expect(mountedRows(view.scrollEl)).toEqual(before);
    expect(win.total()).toBe(totalBefore);
  });

  it("X1: a throwing serializer leaves the working set intact and surfaces the error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await mountSelected(stateWithMarkers(140), 3, 130, [3, 130]);
    const before = mountedRows(view.scrollEl);
    hooks.throwOnSerialize = true;
    const { text, prevented } = dispatchCopy(view.scrollEl);
    expect(text).toBeNull();
    expect(prevented).toBe(false); // native copy stays in charge
    expect(err.mock.calls.some((c) => String(c[0]).includes("copy serialization failed"))).toBe(true);
    expect(mountedRows(view.scrollEl)).toEqual(before);
    hooks.throwOnSerialize = false;
    await act(async () => view.rerender(<ThemeProvider><ChatView state={{ ...view.state }} toolContext={defaultToolContext} /></ThemeProvider>));
    expect(mountedRows(view.scrollEl)).toEqual(before);
  });

  it("X2: a failing release flushSync falls back to a plain bump and the working set returns", async () => {
    const view = await mountSelected(stateWithMarkers(140), 3, 130, [3, 130]);
    const before = mountedRows(view.scrollEl);
    hooks.flushCalls = 0;
    hooks.flushThrowAt = 2; // 1 = mount, 2 = release
    const { text, prevented } = dispatchCopy(view.scrollEl);
    expect(prevented).toBe(true);
    expect(text).toContain(marker(60));
    await flush();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mountedRows(view.scrollEl)).toEqual(before);
  });

  it("X3: a copy-only row's late image load never reaches the size cache", async () => {
    const png = { data: "iVBORw0KGgo=", mimeType: "image/png" };
    const state = stateWithMarkers(140, { 60: { images: [png] } });
    const view = await mountSelected(state, 3, 130, [3, 130]);
    const totalBefore = win.total();
    win.measured = [];
    // During the copy the interior image row is mounted copy-only; its image
    // "finishes decoding" right then and queues a re-measure for the next frame.
    hooks.onSerialize = () => {
      view.scrollEl.querySelector('[data-index="60"] img')?.dispatchEvent(new Event("load"));
    };
    dispatchCopy(view.scrollEl);
    hooks.onSerialize = null;
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(win.measured).not.toContain("60");
    expect(win.total()).toBe(totalBefore);
  });

  it("X3: a queued measure whose row unmounted before the frame is skipped", async () => {
    const png = { data: "iVBORw0KGgo=", mimeType: "image/png" };
    win.range = { start: 0, end: 20 };
    const view = render(
      <ThemeProvider>
        <ChatView state={stateWithMarkers(60, { 5: { images: [png] } })} toolContext={defaultToolContext} />
      </ThemeProvider>,
    );
    const scrollEl = getScrollContainer(view.container);
    const node = scrollEl.querySelector('[data-index="5"] img');
    expect(node).not.toBeNull();
    win.measured = [];
    act(() => {
      node?.dispatchEvent(new Event("load")); // queued for the next frame
    });
    win.range = { start: 30, end: 35 };
    await act(async () => view.rerender(<ThemeProvider><ChatView state={stateWithMarkers(60, { 5: { images: [png] } })} toolContext={defaultToolContext} /></ThemeProvider>));
    expect(scrollEl.querySelector('[data-index="5"]')).toBeNull();
    win.measured = [];
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(win.measured).not.toContain("5");
  });

  it("X4: a suspended lazy row in the copy span does not break the copy", async () => {
    const state = stateWithMarkers(140, {
      60: { role: "inlineTerminal", content: "", args: { terminalId: "t1" } } as never,
    });
    const view = await mountSelected(state, 3, 130, [3, 130]);
    const { text, prevented } = dispatchCopy(view.scrollEl);
    expect(prevented).toBe(true);
    for (const i of [3, 59, 61, 130]) expect(text).toContain(marker(i));
  });
});
