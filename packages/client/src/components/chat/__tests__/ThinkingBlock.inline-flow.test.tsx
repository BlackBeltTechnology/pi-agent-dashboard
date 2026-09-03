/**
 * ThinkingBlock `inlineFlow` prop — the HEIGHT-ONLY inline-flow mode
 * (change: render-inline-reasoning-and-custom-entries, test-plan E9).
 *
 * When `inlineFlow` is true the body renders with NO vertical height cap and
 * NO inner vertical scrollbar (keeps `overflow-x-auto` for long lines). When
 * absent/false, the classes are byte-identical to today. The collapse
 * machinery (auto-collapse timer, manual toggle) is orthogonal and unchanged
 * in both modes.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { ThinkingBlock } from "../ThinkingBlock.js";

// Real MarkdownContent renders inside the body; it needs the theme context
// (ToolBurstGroup.test.tsx pattern). jsdom implements neither scrollTo nor
// matchMedia — shim them for the suite.
beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => cleanup());

function bodyOf(container: HTMLElement): HTMLElement {
  const body = container.querySelector('[data-testid="reasoning-body"]');
  expect(body).toBeTruthy();
  return body as HTMLElement;
}

function renderExpanded(props: Record<string, unknown> = {}) {
  const { container } = render(
    <ThemeProvider>
      <ThinkingBlock content="long reasoning" streamedLive autoCollapseMs={0} {...props} />
    </ThemeProvider>,
  );
  return container;
}

describe("ThinkingBlock inlineFlow (E9)", () => {
  it("absent → body has max-h-[400px] + overflow-y-auto (today's exact classes)", () => {
    const container = renderExpanded();
    const body = bodyOf(container);
    expect(body.className).toContain("max-h-[400px]");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.className).toContain("overflow-x-auto");
  });

  it("false → identical to absent (default off preserves today)", () => {
    const container = renderExpanded({ inlineFlow: false });
    const body = bodyOf(container);
    expect(body.className).toContain("max-h-[400px]");
    expect(body.className).toContain("overflow-y-auto");
  });

  it("true → NO vertical cap and NO inner vertical scrollbar; overflow-x-auto kept", () => {
    const container = renderExpanded({ inlineFlow: true });
    const body = bodyOf(container);
    expect(body.className).not.toContain("max-h-[400px]");
    expect(body.className).not.toContain("overflow-y-auto");
    expect(body.className).toContain("overflow-x-auto");
  });

  it("auto-collapse timer arms identically with inlineFlow on", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ThemeProvider>
          <ThinkingBlock content="x" streamedLive autoCollapseMs={30000} inlineFlow />
        </ThemeProvider>,
      );
      expect(container.querySelector('[data-testid="reasoning-body"]')).toBeTruthy();
      act(() => vi.advanceTimersByTime(30000));
      expect(container.querySelector('[data-testid="reasoning-body"]')).toBeFalsy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("manual collapse toggle still works with inlineFlow on", () => {
    const { container } = render(
      <ThemeProvider>
        <ThinkingBlock content="x" streamedLive autoCollapseMs={0} inlineFlow />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-testid="reasoning-body"]')).toBeTruthy();
    fireEvent.click(container.querySelector("button")!);
    expect(container.querySelector('[data-testid="reasoning-body"]')).toBeFalsy();
  });
});
