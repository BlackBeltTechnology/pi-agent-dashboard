/**
 * MarkdownContent loads the math engine on demand. Each test starts from a
 * fresh module graph (the engine promise is a per-page singleton), so the
 * "before load" state is observable.
 * See change: shrink-client-entry-lazy-islands (tasks 2.1/2.3).
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../split/SplitWorkspaceContext.js", () => ({
  useOptionalSplitWorkspace: () => ({ openLiveTarget: vi.fn() }),
}));

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.doUnmock("rehype-katex");
  vi.restoreAllMocks();
  vi.resetModules();
});

async function fresh() {
  vi.resetModules();
  const engine = await import("../../lib/preview/math-engine.js");
  const { MarkdownContent } = await import("../preview/MarkdownContent.js");
  const { ThemeProvider } = await import("../settings/ThemeProvider.js");
  const renderMd = (content: string) =>
    render(
      <ThemeProvider>
        <MarkdownContent content={content} />
      </ThemeProvider>,
    );
  return { engine, renderMd };
}

describe("MarkdownContent — lazy math engine", () => {
  it("renders literal source before the engine loads, typeset after", async () => {
    const { renderMd } = await fresh();
    const { container } = renderMd("Euler: $e^{i\\pi} = -1$.");
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("e^{i\\pi} = -1");
    await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull());
  });

  it("content without math never calls loadMathEngine", async () => {
    const { engine, renderMd } = await fresh();
    const spy = vi.spyOn(engine, "loadMathEngine");
    const { container } = renderMd("# Title\n\nplain *markdown* with `code`\n\n- a\n- b");
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector(".katex")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("two mounted instances share one engine load and both typeset", async () => {
    const { engine, renderMd } = await fresh();
    const a = renderMd("A: $a^2$");
    const b = renderMd("B: $b^2$");
    await waitFor(() => {
      expect(a.container.querySelector(".katex")).not.toBeNull();
      expect(b.container.querySelector(".katex")).not.toBeNull();
    });
    // One memoized promise: asking again returns the already-settled load.
    expect(engine.loadMathEngine()).toBe(engine.loadMathEngine());
  });

  it("keeps literal source and does not throw when the engine fails to load", async () => {
    vi.doMock("rehype-katex", () => {
      throw new Error("chunk 404");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { renderMd } = await fresh();
    let view: ReturnType<typeof renderMd> | undefined;
    expect(() => {
      view = renderMd("Fails: $x^2$");
    }).not.toThrow();
    await new Promise((r) => setTimeout(r, 50));
    expect(view?.container.querySelector(".katex")).toBeNull();
    expect(view?.container.textContent).toContain("x^2");
  });
});
