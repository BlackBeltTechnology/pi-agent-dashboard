import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarState } from "../../hooks/useSidebarState.js";
import { ResizableSidebar } from "../shell/ResizableSidebar.js";

afterEach(() => cleanup());

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
    const handle = screen.getByTestId("drag-handle");
    fireEvent.mouseDown(handle);
    fireEvent.mouseUp(document, { clientX: 400 });
    expect(sidebar.setWidth).toHaveBeenCalledWith(400);
  });

  it("E3: drag past the min clamps the persisted width to 180", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    fireEvent.mouseDown(screen.getByTestId("drag-handle"));
    fireEvent.mouseUp(document, { clientX: 120 });
    expect(sidebar.setWidth).toHaveBeenCalledWith(180);
  });

  it("E4: drag past the max clamps the persisted width to 500", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    fireEvent.mouseDown(screen.getByTestId("drag-handle"));
    fireEvent.mouseUp(document, { clientX: 640 });
    expect(sidebar.setWidth).toHaveBeenCalledWith(500);
  });

  it("collapse button does not trigger drag", () => {
    const sidebar = makeSidebar();
    render(
      <ResizableSidebar sidebar={sidebar}>
        <div>Content</div>
      </ResizableSidebar>,
    );
    // Clicking the collapse button should not start a drag
    fireEvent.mouseDown(screen.getByTestId("sidebar-collapse"));
    fireEvent.mouseUp(document, { clientX: 400 });
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
});
