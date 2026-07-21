import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapseSummary, splitOverflow } from "../chat/collapse-summary.js";

afterEach(() => cleanup());

describe("splitOverflow", () => {
  it("empty input → empty visible + empty overflow", () => {
    expect(splitOverflow([], 5)).toEqual({ visible: [], overflow: [] });
  });

  it("fewer than max → all visible, no overflow", () => {
    expect(splitOverflow([1, 2, 3], 5)).toEqual({ visible: [1, 2, 3], overflow: [] });
  });

  it("exactly max → all visible, no overflow", () => {
    expect(splitOverflow([1, 2], 2)).toEqual({ visible: [1, 2], overflow: [] });
  });

  it("more than max → head visible, rest overflow", () => {
    expect(splitOverflow([1, 2, 3, 4], 2)).toEqual({ visible: [1, 2], overflow: [3, 4] });
  });

  it("applies the comparator before slicing (descending)", () => {
    const r = splitOverflow([1, 3, 2, 5, 4], 2, (a, b) => b - a);
    expect(r.visible).toEqual([5, 4]);
    expect(r.overflow).toEqual([3, 2, 1]);
  });

  it("does not mutate the input array", () => {
    const input = [3, 1, 2];
    splitOverflow(input, 1, (a, b) => a - b);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("CollapseSummary", () => {
  it("collapsed: renders children, aria-expanded=false", () => {
    const { getByTestId } = render(
      <CollapseSummary expanded={false} onToggle={vi.fn()} testId="line">
        <span>idle</span>
      </CollapseSummary>,
    );
    const btn = getByTestId("line");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.textContent).toContain("idle");
  });

  it("expanded: aria-expanded=true", () => {
    const { getByTestId } = render(
      <CollapseSummary expanded={true} onToggle={vi.fn()} testId="line">
        rows
      </CollapseSummary>,
    );
    expect(getByTestId("line").getAttribute("aria-expanded")).toBe("true");
  });

  it("click fires onToggle and stops propagation", () => {
    const onToggle = vi.fn();
    const onParent = vi.fn();
    const { getByTestId } = render(
      <div onClick={onParent}>
        <CollapseSummary expanded={false} onToggle={onToggle} testId="line">
          x
        </CollapseSummary>
      </div>,
    );
    fireEvent.click(getByTestId("line"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onParent).not.toHaveBeenCalled();
  });
});
