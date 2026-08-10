import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectionRowSpan } from "../../lib/chat/chat-virtual-rows.js";
import { useActiveChatSelection } from "../useActiveChatSelection.js";

// A container with an inner text-bearing child (the "transcript") plus an
// outside text node (the "composer") sharing the same document.
function buildDom() {
  // Composer sits BEFORE the container in document order so a cross-boundary
  // selection (composer → transcript) is a forward, non-collapsed Range.
  const outside = document.createElement("p");
  outside.textContent = "outside composer";

  const container = document.createElement("div");
  const inside = document.createElement("p");
  inside.textContent = "hello transcript";
  container.appendChild(inside);

  document.body.appendChild(outside);
  document.body.appendChild(container);
  return { container, inside, outside };
}

/**
 * A container shaped like the real virtualized transcript: `[data-index]` rows,
 * each with a text-bearing child, so `closest("[data-index]")` has something to
 * find (change: anchor-chat-selection-against-row-growth, D4).
 */
function buildVirtualDom(rowCount = 3) {
  const container = document.createElement("div");
  const rows: HTMLElement[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement("div");
    row.setAttribute("data-index", String(i));
    const p = document.createElement("p");
    p.textContent = `row ${i} text`;
    row.appendChild(p);
    container.appendChild(row);
    rows.push(row);
  }
  document.body.appendChild(container);
  return { container, rows };
}

/** Select from `startNode` to `endNode` (whole text nodes) and fire the event. */
function selectRange(startNode: Node, endNode: Node) {
  const sel = window.getSelection();
  if (!sel) throw new Error("no selection");
  const range = document.createRange();
  range.setStart(startNode.firstChild ?? startNode, 0);
  const endText = endNode.firstChild ?? endNode;
  range.setEnd(endText, endText.textContent?.length ?? 0);
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function collapse() {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event("selectionchange"));
}

/** Flush the microtask-coalesced boolean flip. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  window.getSelection()?.removeAllRanges();
});

const passthroughSpan = (): SelectionRowSpan => ({ min: 0, max: 0 });

describe("useActiveChatSelection", () => {
  it("is true for a non-collapsed selection inside the container", async () => {
    const { container, inside } = buildDom();
    const ref = createRef<HTMLElement>();
    ref.current = container;

    const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));
    expect(result.current.isSelecting).toBe(false);

    await act(async () => {
      selectRange(inside, inside);
    });
    await flush();
    expect(result.current.isSelecting).toBe(true);
  });

  it("returns to false when the selection collapses", async () => {
    const { container, inside } = buildDom();
    const ref = createRef<HTMLElement>();
    ref.current = container;
    const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

    await act(async () => selectRange(inside, inside));
    await flush();
    expect(result.current.isSelecting).toBe(true);

    await act(async () => collapse());
    await flush();
    expect(result.current.isSelecting).toBe(false);
    expect(result.current.selectionSpanRef.current).toBeNull();
  });

  it("ignores a selection entirely outside the container", async () => {
    const { container, outside } = buildDom();
    const ref = createRef<HTMLElement>();
    ref.current = container;
    const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

    await act(async () => selectRange(outside, outside));
    await flush();
    expect(result.current.isSelecting).toBe(false);
  });

  it("is true for a cross-boundary selection (anchor outside, focus inside)", async () => {
    const { container, inside, outside } = buildDom();
    const ref = createRef<HTMLElement>();
    ref.current = container;
    const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

    // Anchor in the outside composer, focus inside the transcript.
    await act(async () => selectRange(outside, inside));
    await flush();
    expect(result.current.isSelecting).toBe(true);
  });

  it("coalesces a burst of selectionchange events into a single state flip", async () => {
    const { container, inside } = buildDom();
    const ref = createRef<HTMLElement>();
    ref.current = container;
    const mapRange = vi.fn(() => ({ min: 0, max: 0 }));

    const renderSpy = vi.fn();
    const { result } = renderHook(() => {
      renderSpy();
      return useActiveChatSelection(ref, mapRange);
    });
    const rendersBefore = renderSpy.mock.calls.length;

    // Fire many selectionchange events synchronously in one task.
    await act(async () => {
      for (let i = 0; i < 10; i++) selectRange(inside, inside);
    });
    await flush();

    expect(result.current.isSelecting).toBe(true);
    // The span ref updates on every event…
    expect(mapRange).toHaveBeenCalled();
    // …but the boolean flip coalesces to a single additional render.
    expect(renderSpy.mock.calls.length - rendersBefore).toBeLessThanOrEqual(2);
  });

  // change: anchor-chat-selection-against-row-growth (D6) — one clock.
  // `isSelectingRef` gates the virtualizer `onChange` bottom-pin, which runs
  // OUTSIDE render. It must be readable synchronously, or a streaming chunk
  // landing on the first frame of a drag still scrolls to the bottom.
  describe("isSelectingRef (synchronous publication, D6)", () => {
    it("is true synchronously inside the selectionchange listener, before any flush or re-render", () => {
      const { container, inside } = buildDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));
      expect(result.current.isSelectingRef.current).toBe(false);

      // NOTE: deliberately NOT wrapped in act() and NOT awaited — the point is
      // that the ref lands during the event dispatch itself.
      selectRange(inside, inside);

      expect(result.current.isSelectingRef.current).toBe(true);
      // The debounced state has NOT caught up yet: it is still on its own clock.
      expect(result.current.isSelecting).toBe(false);
    });

    it("clears synchronously on collapse", () => {
      const { container, inside } = buildDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

      selectRange(inside, inside);
      expect(result.current.isSelectingRef.current).toBe(true);

      collapse();
      expect(result.current.isSelectingRef.current).toBe(false);
    });

    it("agrees with the debounced state once flushed", async () => {
      const { container, inside } = buildDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

      await act(async () => selectRange(inside, inside));
      await flush();
      expect(result.current.isSelectingRef.current).toBe(true);
      expect(result.current.isSelecting).toBe(true);
    });

    it("keeps a stable ref identity across renders", async () => {
      const { container, inside } = buildDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));
      const first = result.current.isSelectingRef;
      expect(first).toBeDefined();

      await act(async () => selectRange(inside, inside));
      await flush();
      expect(result.current.isSelectingRef).toBe(first);
    });
  });

  // change: anchor-chat-selection-against-row-growth (D4) — pin the drag-origin
  // row, held as an Element. NEVER its data-index: inserting a row above
  // renumbers indices, which is the same silent-retarget bug being fixed.
  describe("selectionAnchorRef (drag-origin capture, D4)", () => {
    it("captures the anchor row element on the collapsed→non-collapsed transition", () => {
      const { container, rows } = buildVirtualDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));
      expect(result.current.selectionAnchorRef.current).toBeNull();

      // Drag begins in row 1.
      selectRange(rows[1].firstChild as Node, rows[1].firstChild as Node);
      expect(result.current.selectionAnchorRef.current).toBe(rows[1]);
    });

    it("does NOT re-capture while the selection stays active (the anchor must not follow the pointer)", () => {
      const { container, rows } = buildVirtualDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

      // Drag begins in row 0…
      selectRange(rows[0].firstChild as Node, rows[0].firstChild as Node);
      expect(result.current.selectionAnchorRef.current).toBe(rows[0]);

      // …and extends into row 2. The anchor stays row 0.
      selectRange(rows[0].firstChild as Node, rows[2].firstChild as Node);
      expect(result.current.selectionAnchorRef.current).toBe(rows[0]);

      selectRange(rows[1].firstChild as Node, rows[2].firstChild as Node);
      expect(result.current.selectionAnchorRef.current).toBe(rows[0]);
    });

    it("clears the anchor on collapse, and re-captures on the next drag", () => {
      const { container, rows } = buildVirtualDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

      selectRange(rows[0].firstChild as Node, rows[0].firstChild as Node);
      expect(result.current.selectionAnchorRef.current).toBe(rows[0]);

      collapse();
      expect(result.current.selectionAnchorRef.current).toBeNull();

      selectRange(rows[2].firstChild as Node, rows[2].firstChild as Node);
      expect(result.current.selectionAnchorRef.current).toBe(rows[2]);
    });

    it("stores the Element itself, so renumbering data-index cannot retarget it", () => {
      const { container, rows } = buildVirtualDom();
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

      selectRange(rows[1].firstChild as Node, rows[1].firstChild as Node);
      const captured = result.current.selectionAnchorRef.current;

      // A row is inserted above (flushStreamingTextAsAssistantRow) and every
      // data-index shifts by one. An index-based anchor would now point at a
      // DIFFERENT row; an element-based one still points at the same node.
      const inserted = document.createElement("div");
      inserted.setAttribute("data-index", "0");
      container.insertBefore(inserted, rows[0]);
      for (const [i, row] of rows.entries()) row.setAttribute("data-index", String(i + 1));

      expect(result.current.selectionAnchorRef.current).toBe(captured);
      expect(result.current.selectionAnchorRef.current).toBe(rows[1]);
      expect(rows[1].getAttribute("data-index")).toBe("2");
    });

    it("is null when the anchor endpoint is outside the container (cross-boundary drag)", () => {
      const { container, rows } = buildVirtualDom();
      const outside = document.createElement("p");
      outside.textContent = "outside composer";
      document.body.insertBefore(outside, container);
      const ref = createRef<HTMLElement>();
      ref.current = container;
      const { result } = renderHook(() => useActiveChatSelection(ref, passthroughSpan));

      // Anchor outside, focus inside: still "selecting", but there is no
      // in-transcript drag-origin row to pin.
      selectRange(outside, rows[1].firstChild as Node);
      expect(result.current.isSelectingRef.current).toBe(true);
      expect(result.current.selectionAnchorRef.current).toBeNull();
    });
  });
});
