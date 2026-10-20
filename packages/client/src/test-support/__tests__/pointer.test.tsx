/** Spike: proves the jsdom premises the drag tests rely on. See change: fix-split-divider-drag (§1.1). */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextFrame, pointerDown } from "../pointer.js";

afterEach(cleanup);

describe("pointer test helper", () => {
  it("React onPointerDown fires for a dispatched MouseEvent('pointerdown') carrying pointerId", () => {
    const onDown = vi.fn();
    const { getByTestId } = render(<div data-testid="h" onPointerDown={(e) => onDown(e.pointerId, e.button)} />);
    pointerDown(getByTestId("h"), { pointerId: 7 });
    expect(onDown).toHaveBeenCalledWith(7, 0);
  });

  it("requestAnimationFrame exists and nextFrame resolves", async () => {
    expect(typeof requestAnimationFrame).toBe("function");
    await nextFrame();
  });
});
