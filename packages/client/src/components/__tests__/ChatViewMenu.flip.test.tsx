import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ChatViewMenu } from "../chat/ChatViewMenu.js";

function setViewportHeight(h: number) {
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
}

function setViewportWidth(w: number) {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
}

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("ChatViewMenu viewport flip", () => {
  beforeEach(() => {
    setViewportHeight(1000);
  });

  it("opens upward with a clamped max-height when its trigger is near the viewport bottom", () => {
    setViewportHeight(950);
    // Trigger button sits near the bottom edge → must flip up.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 900,
      bottom: 930,
      left: 0,
      right: 0,
      width: 0,
      height: 30,
      x: 0,
      y: 900,
      toJSON: () => ({}),
    } as DOMRect);

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("bottom-full");
    expect(popover.className).not.toContain("top-full");
    expect(popover.style.maxHeight).toBe("892px");
    expect(popover.className).toContain("overflow-y-auto");
  });

  it("flips to left-anchor in a slim panel so row labels stay on-screen", () => {
    setViewportWidth(300);
    // Trigger hugs the left edge of a slim panel → right-anchored 256px popover
    // would clip off the left of the viewport. Must flip to left-0.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 130,
      left: 20,
      right: 80,
      width: 60,
      height: 30,
      x: 20,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("left-0");
    expect(popover.className).not.toContain("right-0");
    // maxWidth clamped to the left-anchor space: innerWidth - left - gap = 300 - 20 - 8 = 272.
    expect(popover.style.maxWidth).toBe("272px");
  });

  it("stays right-anchored in a wide panel", () => {
    setViewportWidth(1400);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 130,
      left: 600,
      right: 700,
      width: 100,
      height: 30,
      x: 600,
      y: 100,
      toJSON: () => ({}),
    } as DOMRect);

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("right-0");
    expect(popover.className).not.toContain("left-0");
  });

  it("opens downward by default when there is room below", () => {
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
    } as DOMRect);

    render(<ChatViewMenu sessionId="s1" send={() => {}} currentOverride={undefined} />);
    fireEvent.click(screen.getByText("View"));

    const popover = screen.getByTestId("chat-view-popover");
    expect(popover.className).toContain("top-full");
    expect(popover.className).not.toContain("bottom-full");
  });
});
