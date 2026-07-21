import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render as _rtlRender, cleanup } from "@testing-library/react";
import React from "react";

const render = _rtlRender;

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

// Mock @git-diff-view/react to capture diffViewMode prop.
vi.mock("@git-diff-view/react", () => ({
  DiffView: (props: Record<string, unknown>) => (
    <div
      data-testid="diff-view"
      data-diff-mode={String(props.diffViewMode)}
      data-diff-theme={String(props.diffViewTheme)}
    />
  ),
  DiffModeEnum: { Split: "split", Unified: "unified" },
}));

// Mock @git-diff-view/lowlight.
vi.mock("@git-diff-view/lowlight", () => ({ highlighter: {} }));

// Spy on generateDiffFile so we can assert language resolution.
const mockDiffFile = {
  init: vi.fn(),
  buildSplitDiffLines: vi.fn(),
  buildUnifiedDiffLines: vi.fn(),
};
const generateDiffFileMock = vi.fn((..._args: unknown[]) => mockDiffFile);
vi.mock("@git-diff-view/file", () => ({
  generateDiffFile: (...args: unknown[]) => generateDiffFileMock(...args),
}));

// Mock CSS import.
vi.mock("@git-diff-view/react/styles/diff-view.css", () => ({}));

// Mock ThemeProvider with light as default for these tests.
vi.mock("../settings/ThemeProvider.js", async () => {
  const actual = await import("react");
  const ThemeContext = actual.createContext<{ resolved: "light" | "dark"; themeName: string } | null>(null);
  return {
    ThemeProvider: ({
      children,
      value,
    }: {
      children: React.ReactNode;
      value: { resolved: "light" | "dark"; themeName: string };
    }) => actual.createElement(ThemeContext.Provider, { value }, children),
    useThemeContext: () => {
      const ctx = actual.useContext(ThemeContext);
      if (!ctx) return { resolved: "dark" as const, themeName: "base" };
      return ctx;
    },
  };
});

import { RichDiff } from "../diff/RichDiff.js";

afterEach(() => cleanup());

describe("RichDiff", () => {
  it("2.2 renders unified mode by default (no mode prop)", () => {
    const { getAllByTestId } = render(
      <RichDiff oldText="a" newText="b" filePath="foo.ts" />,
    );
    const dvs = getAllByTestId("diff-view");
    expect(dvs[0].getAttribute("data-diff-mode")).toBe("unified");
  });

  it("2.3 renders split mode when mode=\"split\"", () => {
    const { getAllByTestId } = render(
      <RichDiff oldText="a" newText="b" filePath="foo.ts" mode="split" />,
    );
    const dvs = getAllByTestId("diff-view");
    expect(dvs[0].getAttribute("data-diff-mode")).toBe("split");
  });

  it("2.4 applies maxHeight style and overflow-auto when prop provided", () => {
    const { container } = render(
      <RichDiff oldText="a" newText="b" filePath="foo.ts" maxHeight="20rem" />,
    );
    const el = container.querySelector('[data-testid="rich-diff"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.maxHeight).toBe("20rem");
    expect(el.classList.contains("overflow-auto")).toBe(true);
  });

  it("2.4 omits maxHeight style and overflow-auto when prop not provided", () => {
    const { container } = render(
      <RichDiff oldText="a" newText="b" filePath="foo.ts" />,
    );
    const el = container.querySelector('[data-testid="rich-diff"]') as HTMLElement;
    expect(el).not.toBeNull();
    expect(el.style.maxHeight).toBe("");
    expect(el.classList.contains("overflow-auto")).toBe(false);
  });

  it("2.5 resolves filePath=\"foo.ts\" to TypeScript language at generateDiffFile boundary", () => {
    generateDiffFileMock.mockClear();
    render(<RichDiff oldText="x" newText="y" filePath="foo.ts" />);
    expect(generateDiffFileMock).toHaveBeenCalledWith(
      "foo.ts", "x", "foo.ts", "y", "typescript", "typescript",
    );
  });

  it("2.6 unknown extension falls back to plaintext without throwing", () => {
    generateDiffFileMock.mockClear();
    expect(() => {
      render(<RichDiff oldText="a" newText="b" filePath="foo.xyz" />);
    }).not.toThrow();
    expect(generateDiffFileMock).toHaveBeenCalledWith(
      "foo.xyz", "a", "foo.xyz", "b", "plaintext", "plaintext",
    );
  });

  it("2.7 identical input renders the same DOM structure (snapshot guard)", () => {
    const { container: c1 } = render(<RichDiff oldText="hello" newText="hello" filePath="a.ts" />);
    const html1 = c1.innerHTML;
    cleanup();
    const { container: c2 } = render(<RichDiff oldText="hello" newText="hello" filePath="a.ts" />);
    expect(html1).toBe(c2.innerHTML);
    expect(html1).not.toBe(""); // sanity guard
  });
});
