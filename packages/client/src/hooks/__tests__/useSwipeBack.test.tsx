import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSwipeBack } from "../useSwipeBack.js";

/**
 * Swipe-back yields to a held text selection (change: keep-oversized-chat-
 * selection, D6). Touch events carry a stubbed `touches` list; the selection is
 * a real DOM Range over a page paragraph.
 */

function touch(type: "touchstart" | "touchmove" | "touchend", x: number, y = 0): Event {
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: y }] });
  act(() => {
    document.dispatchEvent(evt);
  });
  return evt;
}

function selectPageText(): HTMLElement {
  const p = document.createElement("p");
  p.textContent = "selected page text";
  document.body.appendChild(p);
  const range = document.createRange();
  range.selectNodeContents(p);
  const sel = window.getSelection() as Selection;
  sel.removeAllRanges();
  sel.addRange(range);
  return p;
}

function mount(onBack = vi.fn()) {
  const hook = renderHook(() => useSwipeBack({ enabled: true, onBack }));
  return { ...hook, onBack };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("useSwipeBack selection guard", () => {
  it("E15: a non-collapsed page selection means the edge gesture never starts", () => {
    selectPageText();
    const { result, onBack } = mount();
    touch("touchstart", 10);
    const moves = [40, 70, 100].map((x) => touch("touchmove", x));
    touch("touchend", 100);
    expect(moves.every((m) => !m.defaultPrevented)).toBe(true);
    expect(result.current.swipeState).toEqual({ offset: 0, swiping: false });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("E16: text selected in a focused field does not block the swipe", () => {
    const parent = selectPageText(); // engines report a field selection anchored on its parent
    const field = document.createElement("textarea");
    parent.appendChild(field);
    field.focus();
    expect(document.activeElement).toBe(field);
    const { onBack } = mount();
    touch("touchstart", 10);
    for (const x of [200, 400, 600]) touch("touchmove", x);
    touch("touchend", 600);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("E17: without a selection an edge swipe past the threshold goes back; x=41 is not tracked", () => {
    const { onBack } = mount();
    touch("touchstart", 10);
    for (const x of [200, 400, 600]) touch("touchmove", x);
    touch("touchend", 600);
    expect(onBack).toHaveBeenCalledTimes(1);

    onBack.mockClear();
    touch("touchstart", 41);
    const move = touch("touchmove", 600);
    touch("touchend", 600);
    expect(move.defaultPrevented).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("F11: a selection appearing mid-swipe resets the gesture and releases the page", () => {
    const { result, onBack } = mount();
    touch("touchstart", 10);
    touch("touchmove", 90);
    expect(result.current.swipeState.swiping).toBe(true);

    selectPageText();
    const move = touch("touchmove", 500);
    expect(move.defaultPrevented).toBe(false);
    expect(result.current.swipeState).toEqual({ offset: 0, swiping: false });
    touch("touchend", 500);
    expect(onBack).not.toHaveBeenCalled();
  });

  it("F12: a selection forming before the first 10px move aborts before any preventDefault", () => {
    const { result, onBack } = mount();
    touch("touchstart", 10);
    selectPageText(); // long-press selection lands before the horizontal decision
    const first = touch("touchmove", 25);
    const second = touch("touchmove", 300);
    touch("touchend", 300);
    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(result.current.swipeState).toEqual({ offset: 0, swiping: false });
    expect(onBack).not.toHaveBeenCalled();
  });
});
