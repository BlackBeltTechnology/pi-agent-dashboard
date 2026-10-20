/**
 * Regression coverage for test-plan row E8 (capability `drag-body-style`,
 * change: fix-long-session-ux-degradation §1, design D1).
 *
 * Every drag-to-resize affordance must clear its body cursor / `user-select`
 * overrides when it disappears mid-drag, and none may carry a private copy of
 * the override logic — all three delegate to `useBodyDragStyle`. The source
 * scan is the grep-equivalent half: a re-introduced `document.body.style` write
 * in any of the three files fails here.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { nextFrame, pointerDown, pointerMove, pointerUp } from "../../test-support/pointer.js";
import { ResizableTreePanel } from "../diff/FileDiffView.js";
import { SplitDivider } from "../split/SplitDivider.js";

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("drag-body-style delegation (E8)", () => {
  it("SplitDivider applies the orientation cursor and clears on unmount mid-drag", () => {
    const { unmount } = render(
      <SplitDivider orientation="h" onResize={() => {}} data-testid="split-divider" />,
    );
    pointerDown(document.querySelector("[data-testid='split-divider']")!);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(getComputedStyle(document.body).userSelect).not.toBe("none");
  });

  it("SplitDivider uses row-resize for the stacked orientation", () => {
    render(<SplitDivider orientation="v" onResize={() => {}} data-testid="split-divider-v" />);
    pointerDown(document.querySelector("[data-testid='split-divider-v']")!);
    expect(document.body.style.cursor).toBe("row-resize");
    expect(document.body.style.userSelect).toBe("none");
  });

  it("ResizableTreePanel clears on unmount mid-drag", () => {
    const { unmount } = render(
      <ResizableTreePanel>
        <div>tree</div>
      </ResizableTreePanel>,
    );
    const handle = document.querySelector("[data-testid='tree-panel-handle']");
    expect(handle).not.toBeNull();
    pointerDown(handle!);
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(getComputedStyle(document.body).userSelect).not.toBe("none");
  });

  // E24 — tree panel commits on release; a later no-button move changes nothing.
  it("E24: ResizableTreePanel keeps its width after release (no follow-on resize)", async () => {
    const { container } = render(
      <ResizableTreePanel>
        <div>tree</div>
      </ResizableTreePanel>,
    );
    const panel = container.firstElementChild as HTMLElement;
    panel.parentElement!.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 400, right: 1000, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    pointerDown(screen.getByTestId("tree-panel-handle"), { clientX: 250 });
    pointerMove(window, { clientX: 320 });
    await nextFrame();
    pointerUp(window, { clientX: 320 });
    pointerMove(window, { clientX: 450, buttons: 0 });
    await nextFrame();
    expect(panel.style.width).toBe("320px");
  });

  // E26 — touch drag is not taken over by panning.
  it("E26: the tree-panel handle sets touch-action:none", () => {
    render(
      <ResizableTreePanel>
        <div>tree</div>
      </ResizableTreePanel>,
    );
    expect(screen.getByTestId("tree-panel-handle").style.touchAction).toBe("none");
  });

  it("no source file writes document.body.style directly anymore", () => {
    const files = [
      "../shell/ResizableSidebar.tsx",
      "../split/SplitDivider.tsx",
      "../diff/FileDiffView.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(src, `${rel} must delegate to useBodyDragStyle`).not.toMatch(/document\.body\.style/);
    }
  });
});
