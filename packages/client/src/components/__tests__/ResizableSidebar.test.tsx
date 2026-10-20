import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextFrame, pointerDown, pointerMove, pointerUp } from "../../test-support/pointer.js";
import type { SidebarState } from "../../hooks/useSidebarState.js";
import { ResizableSidebar } from "../shell/ResizableSidebar.js";

afterEach(() => {
  cleanup();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

function makeSidebar(overrides: Partial<SidebarState> = {}): SidebarState {
  return {
    width: 256,
    collapsed: false,
    setWidth: vi.fn(),
    toggleCollapse: vi.fn(),
    ...overrides,
  };
}

describe("ResizableSidebar", () => {
  it("renders children when expanded", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div data-testid="child">Hello</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders at specified width", () => {
    const { container } = render(
      <ResizableSidebar sidebar={makeSidebar({ width: 350 })}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    // The outer div should have width style
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper?.style.width).toBe("350px");
  });

  it("collapsed: renders the vertical SESSIONS restore tab, hides children", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar({ collapsed: true })}>
        <div data-testid="child">Hidden</div>
      </ResizableSidebar>,
    );
    expect(screen.queryByTestId("child")).toBeNull();
    const tab = screen.getByTestId("sidebar-expand");
    expect(tab).toBeTruthy();
    // Same rotated-tab idiom as the pane peeks (vertical writing mode).
    expect(tab.style.writingMode).toBe("vertical-rl");
  });

  it("calls toggleCollapse when collapse button clicked", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    fireEvent.click(screen.getByTestId("sidebar-collapse"));
    expect(sidebar.toggleCollapse).toHaveBeenCalledOnce();
  });

  it("calls toggleCollapse when expand button clicked", () => {
    const sidebar = makeSidebar({ collapsed: true });
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    fireEvent.click(screen.getByTestId("sidebar-expand"));
    expect(sidebar.toggleCollapse).toHaveBeenCalledOnce();
  });

  it("floats the collapse knob above sticky content (z-30)", () => {
    // The knob overhangs into the content area where a sticky slot (z-10)
    // would otherwise occlude it. See change: improve-flow-graph-fidelity.
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("sidebar-collapse").className).toMatch(/z-30/);
  });

  it("calls setWidth on drag end", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    pointerDown(screen.getByTestId("drag-handle"), { clientX: 256 });
    pointerMove(window, { clientX: 400 });
    pointerUp(window, { clientX: 400 });
    expect(sidebar.setWidth).toHaveBeenCalledTimes(1);
    expect(sidebar.setWidth).toHaveBeenCalledWith(400);
  });

  it("E3: drag past the min clamps the persisted width to 180", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    pointerDown(screen.getByTestId("drag-handle"), { clientX: 256 });
    pointerMove(window, { clientX: 120 });
    pointerUp(window, { clientX: 120 });
    expect(sidebar.setWidth).toHaveBeenCalledWith(180);
  });

  it("E4: drag past the max clamps the persisted width to 500", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    pointerDown(screen.getByTestId("drag-handle"), { clientX: 256 });
    pointerMove(window, { clientX: 640 });
    pointerUp(window, { clientX: 640 });
    expect(sidebar.setWidth).toHaveBeenCalledWith(500);
  });

  it("collapse button does not trigger drag", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    // E23 — pressing the knob must not start a drag (no shield, no body cursor).
    pointerDown(screen.getByTestId("sidebar-collapse"), { clientX: 256 });
    pointerMove(window, { clientX: 400 });
    expect(document.body.style.cursor).toBe("");
    expect(document.querySelector("[data-testid='resize-drag-shield']")).toBeNull();
    pointerUp(window, { clientX: 400 });
    expect(sidebar.setWidth).not.toHaveBeenCalled();
  });

  it("renders drag handle", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("drag-handle")).toBeTruthy();
  });

  it("sets body drag styles on mousedown and clears them on mouseup", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    pointerDown(screen.getByTestId("drag-handle"), { clientX: 256 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    pointerUp(window, { clientX: 256 });
    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });

  // E8 — affordance disappears mid-drag (drag-body-style spec).
  it("E8: unmount mid-drag clears the body drag styles", () => {
    const { unmount } = render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    pointerDown(screen.getByTestId("drag-handle"), { clientX: 256 });
    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
    expect(getComputedStyle(document.body).userSelect).not.toBe("none");
  });

  // X6 — a release the page never saw: the next no-button move ends at the previewed width.
  it("X6: a buttons:0 move ends the drag at the previewed width, not the stale coordinate", async () => {
    const sidebar = makeSidebar({ width: 280 });
    const { container } = render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    pointerDown(screen.getByTestId("drag-handle"), { clientX: 280 });
    pointerMove(window, { clientX: 350 });
    await nextFrame();
    pointerMove(window, { clientX: 480, buttons: 0 });
    expect(sidebar.setWidth).toHaveBeenCalledTimes(1);
    expect(sidebar.setWidth).toHaveBeenCalledWith(350);
    expect((container.firstElementChild as HTMLElement).style.width).toBe("350px");
    expect(document.querySelector("[data-testid='resize-drag-shield']")).toBeNull();
  });

  // E26 — touch drag is not taken over by panning.
  it("E26: the seam sets touch-action:none", () => {
    render(
      <ResizableSidebar sidebar={makeSidebar()}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    expect(screen.getByTestId("drag-handle").style.touchAction).toBe("none");
  });
});
