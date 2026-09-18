/**
 * `MobileShell` viewport contract.
 *
 * The shell fills its flex PARENT; the App's mobile root owns the
 * `100dvh` + `overflow-hidden` bound and stacks the in-flow banners above the
 * shell. The regression this pins: a shell that again claims a viewport unit
 * (`h-[100dvh]` / `h-screen`) adds its height on TOP of those banners, making
 * the document taller than the viewport — the page then scrolls when a session
 * is opened and drags the whole shell (header included) off-screen.
 *
 * See change: fix-long-session-ux-degradation.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MobileShell } from "../MobileShell.js";

function renderShell(depth = 0) {
  return render(
    <MobileShell
      depth={depth}
      listPanel={<div data-testid="list-panel">list</div>}
      detailPanel={<div data-testid="detail-panel">detail</div>}
      onBack={() => {}}
    />,
  );
}

describe("MobileShell viewport bound", () => {
  it("fills its parent instead of claiming a viewport unit", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("w-full");
    expect(root.className).toContain("flex-1");
    expect(root.className).toContain("min-h-0");
  });

  it("does not re-introduce a viewport unit on the shell root", () => {
    const { container } = renderShell();
    const root = container.firstElementChild as HTMLElement;
    // Any of these on the shell root is exactly the defect: banner height plus
    // viewport height overflows the document.
    expect(root.className).not.toMatch(/w-screen|h-\[100dvh\]|h-screen|h-\[100vh\]/);
  });

  it("keeps both panels mounted and clipped inside the shell", () => {
    const { container } = renderShell(1);
    expect(screen.getByTestId("list-panel")).toBeTruthy();
    expect(screen.getByTestId("detail-panel")).toBeTruthy();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("overflow-hidden");
  });
});
