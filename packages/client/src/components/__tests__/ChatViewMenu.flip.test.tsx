import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatViewMenu } from "../ChatViewMenu.js";

function setViewportHeight(h: number) {
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
}

function setViewportWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
}

function mockTriggerRect(partial: Partial<DOMRect>) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 130,
    left: 0,
    right: 0,
    width: 0,
    height: 30,
    x: 0,
    y: 100,
    toJSON: () => ({}),
    ...partial,
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ChatViewMenu viewport flip", () => {
  beforeEach(() => {
    setViewportHeight(1000);
    setViewportWidth(1200);
  });

  it("opens upward with a clamped max-height when its trigger is near the viewport bottom", () => {
    setViewportHeight(950);
    // Trigger button sits near the bottom edge → must flip up.
    mockTriggerRect({ top: 900, bottom: 930, left: 0, right: 0, x: 0, y: 900 });

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("bottom-full");
    expect(popover.className).not.toContain("top-full");
    expect(popover.style.maxHeight).toBe("892px");
    expect(popover.className).toContain("overflow-y-auto");
  });

  it("opens downward by default when there is room below", () => {
    mockTriggerRect({ top: 100, bottom: 130, left: 0, right: 0, x: 0, y: 100 });

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("top-full");
    expect(popover.className).not.toContain("bottom-full");
  });

  it("left-aligns when the StatusBar View trigger sits near the left edge", () => {
    // iOS Safari mobile repro: 390px viewport, View button at ~41–101px.
    setViewportWidth(390);
    mockTriggerRect({ top: 719, bottom: 743, left: 41, right: 101, width: 60, height: 24, x: 41, y: 719 });

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("left-0");
    expect(popover.className).not.toMatch(/(?:^|\s)right-0(?:\s|$)/);
  });

  it("right-aligns when there is room to hang left of a right-side trigger", () => {
    mockTriggerRect({ top: 100, bottom: 130, left: 900, right: 980, width: 80, height: 30, x: 900, y: 100 });

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("right-0");
    expect(popover.className).not.toMatch(/(?:^|\s)left-0(?:\s|$)/);
  });
});
