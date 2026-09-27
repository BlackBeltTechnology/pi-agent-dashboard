/**
 * FLIP on lane change. See change: session-list-group-by (design D5).
 */
import { render } from "@testing-library/react";
import React, { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFlipOnLaneChange } from "../useFlipOnLaneChange.js";

function Harness({ order, fp, disabled = false }: { order: string[]; fp: string; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFlipOnLaneChange(ref, fp, disabled);
  return (
    <div ref={ref}>
      {order.map((id) => (
        <div key={id} data-session-id={id} data-testid={id} />
      ))}
    </div>
  );
}

/** jsdom has no layout: fake rects from DOM order so a reorder yields a delta. */
function stubRects() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const idx = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
    return { left: 0, top: idx * 40, right: 100, bottom: idx * 40 + 36, width: 100, height: 36, x: 0, y: idx * 40, toJSON() {} } as DOMRect;
  });
}

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: reduce && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useFlipOnLaneChange", () => {
  it("applies an inverted transform to a card that moved", () => {
    mockReducedMotion(false);
    stubRects();
    const { rerender, getByTestId } = render(<Harness order={["a", "b"]} fp="1" />);
    rerender(<Harness order={["b", "a"]} fp="2" />);
    expect(getByTestId("a").style.transform).toBe("translate(0px, -40px)");
  });

  it("applies no transform under prefers-reduced-motion", () => {
    mockReducedMotion(true);
    stubRects();
    const { rerender, getByTestId } = render(<Harness order={["a", "b"]} fp="1" />);
    rerender(<Harness order={["b", "a"]} fp="2" />);
    expect(getByTestId("a").style.transform).toBe("");
  });

  it("applies no transform while disabled (drag active)", () => {
    mockReducedMotion(false);
    stubRects();
    const { rerender, getByTestId } = render(<Harness order={["a", "b"]} fp="1" disabled />);
    rerender(<Harness order={["b", "a"]} fp="2" disabled />);
    expect(getByTestId("a").style.transform).toBe("");
  });
});
