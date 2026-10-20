/**
 * Coverage for change: fix-split-divider-drag (§1, capability
 * `resize-drag-lifecycle`, design D1–D4/D7; test-plan rows E1–E10, X1–X5).
 *
 * Glue mirrors `useBodyDragStyle.test.tsx` (hook + body styles) and
 * `effect-cleanup-contract.test.tsx` (unmount cleanup); pointer events come
 * from `test-support/pointer.ts` (jsdom has no PointerEvent).
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lostPointerCapture,
  nextFrame,
  pointerCancel,
  pointerDown,
  pointerMove,
  pointerUp,
} from "../../test-support/pointer.js";
import { type ResizeDragOptions, useResizeDrag } from "../useResizeDrag.js";

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

function Handle(props: ResizeDragOptions & { id?: string }) {
  const { id = "h", ...opts } = props;
  const h = useResizeDrag(opts);
  return <div data-testid={id} onPointerDown={h.onPointerDown} onMouseDown={h.onMouseDown} />;
}

const shields = () =>
  Array.from(document.body.children).filter(
    (el) => el.classList.contains("fixed") && el.classList.contains("inset-0") && el.classList.contains("z-lightbox"),
  ) as HTMLElement[];

function setup(over: Partial<ResizeDragOptions> = {}) {
  const cbs = { onStart: vi.fn(), onPreview: vi.fn(), onEnd: vi.fn() };
  const opts: ResizeDragOptions = { axis: "x", cursor: "col-resize", ...cbs, ...over };
  const utils = render(<Handle {...opts} />);
  return { ...utils, cbs, handle: utils.getByTestId("h") };
}

describe("useResizeDrag", () => {
  it("E1: down sets body overrides, first moved move mounts exactly one shield", () => {
    const { handle } = setup();
    pointerDown(handle, { clientX: 100 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");
    expect(shields()).toHaveLength(0);
    pointerMove(window, { clientX: 101 });
    const s = shields();
    expect(s).toHaveLength(1);
    expect(s[0].getAttribute("aria-hidden")).toBe("true");
    expect(s[0].style.touchAction).toBe("none");
  });

  it("E2: non-primary button does not start a drag", async () => {
    const { handle, cbs } = setup();
    pointerDown(handle, { clientX: 100, button: 2 });
    expect(cbs.onStart).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
    pointerMove(window, { clientX: 150 });
    await nextFrame();
    expect(cbs.onPreview).not.toHaveBeenCalled();
  });

  it("E3: unmounting an idle B mid-drag of A leaves A's drag intact", async () => {
    const a = { onStart: vi.fn(), onPreview: vi.fn(), onEnd: vi.fn() };
    const b = { onStart: vi.fn(), onPreview: vi.fn(), onEnd: vi.fn() };
    const { getByTestId, rerender } = render(
      <>
        <Handle id="a" axis="x" cursor="col-resize" {...a} />
        <Handle id="b" axis="x" cursor="col-resize" {...b} />
      </>,
    );
    pointerDown(getByTestId("a"), { clientX: 100 });
    pointerMove(window, { clientX: 110 });
    pointerDown(getByTestId("b"), { clientX: 5 });
    expect(b.onStart).not.toHaveBeenCalled();
    rerender(<Handle id="a" axis="x" cursor="col-resize" {...a} />);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(shields()).toHaveLength(1);
    pointerMove(window, { clientX: 120 });
    await nextFrame();
    expect(a.onPreview).toHaveBeenLastCalledWith(120);
  });

  it("E4: multiple moves in one frame → one onPreview with the latest", async () => {
    const { handle, cbs } = setup();
    pointerDown(handle, { clientX: 100 });
    pointerMove(window, { clientX: 110 });
    pointerMove(window, { clientX: 120 });
    pointerMove(window, { clientX: 130 });
    await nextFrame();
    expect(cbs.onPreview).toHaveBeenCalledTimes(1);
    expect(cbs.onPreview).toHaveBeenCalledWith(130);
  });

  it("E5: axis y reports clientY", async () => {
    const { handle, cbs } = setup({ axis: "y" });
    pointerDown(handle, { clientX: 500, clientY: 10 });
    pointerMove(window, { clientX: 500, clientY: 42 });
    await nextFrame();
    expect(cbs.onPreview).toHaveBeenCalledWith(42);
  });

  it("E6: other pointerId is ignored", async () => {
    const { handle, cbs } = setup();
    pointerDown(handle, { clientX: 100, pointerId: 1 });
    pointerMove(window, { clientX: 150, pointerId: 2 });
    await nextFrame();
    expect(cbs.onPreview).not.toHaveBeenCalled();
  });

  it("E7: pointerup replaces the pending frame with the release coordinate", async () => {
    const { handle, cbs } = setup();
    pointerDown(handle, { clientX: 100 });
    pointerMove(window, { clientX: 120 });
    await nextFrame();
    pointerMove(window, { clientX: 130 });
    pointerUp(window, { clientX: 140 });
    expect(cbs.onPreview).toHaveBeenLastCalledWith(140);
    expect(cbs.onPreview).not.toHaveBeenCalledWith(130);
    expect(cbs.onEnd).toHaveBeenCalledTimes(1);
    expect(cbs.onEnd).toHaveBeenCalledWith(140);
    expect(shields()).toHaveLength(0);
    await nextFrame();
    expect(cbs.onPreview).not.toHaveBeenCalledWith(130);
  });

  it("E8: click without movement → onEnd(null), no preview, no shield", () => {
    const { handle, cbs } = setup();
    pointerDown(handle, { clientX: 100 });
    expect(shields()).toHaveLength(0);
    pointerUp(window, { clientX: 100 });
    expect(cbs.onEnd).toHaveBeenCalledWith(null);
    expect(cbs.onPreview).not.toHaveBeenCalled();
    expect(shields()).toHaveLength(0);
  });

  it("E9: moved boundary — same-coordinate move is not moved, +1px is", () => {
    const one = setup();
    pointerDown(one.handle, { clientX: 100 });
    pointerMove(window, { clientX: 100 });
    pointerUp(window, { clientX: 100 });
    expect(one.cbs.onEnd).toHaveBeenCalledWith(null);
    cleanup();

    const two = setup();
    pointerDown(two.handle, { clientX: 100 });
    pointerMove(window, { clientX: 101 });
    pointerUp(window, { clientX: 101 });
    expect(two.cbs.onEnd).toHaveBeenCalledWith(101);
  });

  it("E10: onPointerDown identity is stable; latest callbacks are used", async () => {
    const seen: unknown[] = [];
    function Probe({ onPreview, onEnd }: Pick<ResizeDragOptions, "onPreview" | "onEnd">) {
      const h = useResizeDrag({ axis: "x", cursor: "col-resize", onPreview: (n) => onPreview(n), onEnd: (n) => onEnd(n) });
      seen.push(h.onPointerDown);
      return <div data-testid="h" onPointerDown={h.onPointerDown} />;
    }
    const first = { onPreview: vi.fn(), onEnd: vi.fn() };
    const second = { onPreview: vi.fn(), onEnd: vi.fn() };
    const { rerender, getByTestId } = render(<Probe {...first} />);
    rerender(<Probe {...second} />);
    expect(seen[seen.length - 1]).toBe(seen[0]);
    pointerDown(getByTestId("h"), { clientX: 100 });
    pointerMove(window, { clientX: 120 });
    await nextFrame();
    pointerUp(window, { clientX: 120 });
    expect(first.onPreview).not.toHaveBeenCalled();
    expect(second.onPreview).toHaveBeenCalledWith(120);
    expect(second.onEnd).toHaveBeenCalledWith(120);
    expect(first.onEnd).not.toHaveBeenCalled();
  });

  async function previewed120Then130Pending() {
    const r = setup();
    pointerDown(r.handle, { clientX: 100 });
    pointerMove(window, { clientX: 120 });
    await nextFrame();
    pointerMove(window, { clientX: 130 });
    return r;
  }

  function expectCleanEnd(cbs: ReturnType<typeof setup>["cbs"]) {
    expect(cbs.onEnd).toHaveBeenCalledTimes(1);
    expect(cbs.onEnd).toHaveBeenCalledWith(120);
    expect(shields()).toHaveLength(0);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  }

  it("X1: pointercancel commits last previewed, drops pending frame", async () => {
    const { cbs } = await previewed120Then130Pending();
    pointerCancel(window);
    await nextFrame();
    expect(cbs.onPreview).not.toHaveBeenCalledWith(130);
    expectCleanEnd(cbs);
  });

  it("X2: lostpointercapture on the handle ends the drag", async () => {
    const { cbs, handle } = await previewed120Then130Pending();
    lostPointerCapture(handle);
    await nextFrame();
    expect(cbs.onPreview).not.toHaveBeenCalledWith(130);
    expectCleanEnd(cbs);
  });

  it("X3: buttons:0 move ends at last previewed, not the stale coordinate", async () => {
    const { cbs } = await previewed120Then130Pending();
    pointerMove(window, { clientX: 900, buttons: 0 });
    expectCleanEnd(cbs);
    pointerMove(window, { clientX: 950 });
    await nextFrame();
    expect(cbs.onPreview).not.toHaveBeenCalledWith(900);
    expect(cbs.onPreview).not.toHaveBeenCalledWith(950);
  });

  it("X4: cancel with only a pending (never previewed) move → onEnd(null)", async () => {
    const { handle, cbs } = setup();
    pointerDown(handle, { clientX: 100 });
    pointerMove(window, { clientX: 130 });
    pointerCancel(window);
    await nextFrame();
    expect(cbs.onEnd).toHaveBeenCalledWith(null);
    expect(cbs.onPreview).not.toHaveBeenCalled();
  });

  it("X5: unmount mid-drag tears down without onEnd; new instance can drag", async () => {
    const { handle, cbs, unmount } = setup();
    pointerDown(handle, { clientX: 100 });
    pointerMove(window, { clientX: 130 });
    expect(shields()).toHaveLength(1);
    unmount();
    expect(shields()).toHaveLength(0);
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    await nextFrame();
    expect(cbs.onEnd).not.toHaveBeenCalled();
    expect(cbs.onPreview).not.toHaveBeenCalled();

    const next = setup();
    pointerDown(next.handle, { clientX: 10 });
    expect(next.cbs.onStart).toHaveBeenCalledTimes(1);
  });
});
