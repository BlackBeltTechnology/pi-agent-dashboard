/**
 * ThinkingBlock auto-collapse timer.
 *
 * change: reasoning-auto-collapse-timer
 *
 * - Live block mounts expanded (even when autoCollapseMs=0); replay collapsed.
 * - Live block with ms>0 collapses after the delay.
 * - autoCollapseMs=0 stays open forever.
 * - Manual toggle freezes the block (timer cancelled, no re-arm).
 * - Demotion (streamedLive true→false) collapses a mounted block.
 * - Mid-window autoCollapseMs change does NOT restart the timer.
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinkingBlock } from "../components/ThinkingBlock.js";

vi.mock("../components/MarkdownContent.js", () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="thinking-body">{content}</div>
  ),
}));

afterEach(() => cleanup());

const isExpanded = (c: HTMLElement) => !!c.querySelector('[data-testid="thinking-body"]');

describe("ThinkingBlock auto-collapse", () => {
  it("live block mounts expanded even when autoCollapseMs=0", () => {
    const { container } = render(
      <ThinkingBlock content="hi" streamedLive autoCollapseMs={0} />,
    );
    expect(isExpanded(container)).toBe(true);
  });

  it("replayed block mounts collapsed", () => {
    const { container } = render(
      <ThinkingBlock content="hi" streamedLive={false} autoCollapseMs={30000} />,
    );
    expect(isExpanded(container)).toBe(false);
  });

  it("live block collapses after autoCollapseMs", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ThinkingBlock content="hi" streamedLive autoCollapseMs={30000} />,
      );
      expect(isExpanded(container)).toBe(true);
      act(() => vi.advanceTimersByTime(30000));
      expect(isExpanded(container)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("autoCollapseMs=0 never collapses", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ThinkingBlock content="hi" streamedLive autoCollapseMs={0} />,
      );
      act(() => vi.advanceTimersByTime(10 * 60 * 1000));
      expect(isExpanded(container)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("manual toggle before expiry cancels the timer (stays as user left it)", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ThinkingBlock content="hi" streamedLive autoCollapseMs={30000} />,
      );
      // User collapses it early.
      act(() => fireEvent.click(container.querySelector("button")!));
      expect(isExpanded(container)).toBe(false);
      // Advancing past the original expiry must not re-open or re-arm.
      act(() => vi.advanceTimersByTime(60000));
      expect(isExpanded(container)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("manual toggle fires onUserCollapse only when collapsing", () => {
    const onUserCollapse = vi.fn();
    const { container } = render(
      <ThinkingBlock content="hi" isStreaming defaultExpanded onUserCollapse={onUserCollapse} />,
    );
    // defaultExpanded → first click collapses.
    fireEvent.click(container.querySelector("button")!);
    expect(onUserCollapse).toHaveBeenCalledTimes(1);
    // Next click expands → no callback.
    fireEvent.click(container.querySelector("button")!);
    expect(onUserCollapse).toHaveBeenCalledTimes(1);
  });

  it("demotion (streamedLive true→false) collapses a mounted block", () => {
    const { container, rerender } = render(
      <ThinkingBlock content="hi" streamedLive autoCollapseMs={0} />,
    );
    expect(isExpanded(container)).toBe(true);
    rerender(<ThinkingBlock content="hi" streamedLive={false} autoCollapseMs={0} />);
    expect(isExpanded(container)).toBe(false);
  });

  it("mid-window autoCollapseMs change does NOT restart the timer", () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = render(
        <ThinkingBlock content="hi" streamedLive autoCollapseMs={30000} />,
      );
      act(() => vi.advanceTimersByTime(20000));
      // Enlarge the pref mid-countdown; original schedule must still fire.
      rerender(<ThinkingBlock content="hi" streamedLive autoCollapseMs={120000} />);
      act(() => vi.advanceTimersByTime(10000)); // total 30000 on original schedule
      expect(isExpanded(container)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
