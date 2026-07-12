import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectionRowSpan } from "../../lib/chat-virtual-rows.js";
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
});
