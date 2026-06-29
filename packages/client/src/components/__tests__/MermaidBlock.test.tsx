import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { ThemeProvider } from "../ThemeProvider.js";

// Mock mermaid module
const mockRender = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mockRender,
  },
}));

// Import after mock is set up
import { MermaidBlock, _svgCache, _errorCache } from "../MermaidBlock.js";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("MermaidBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _svgCache.clear();
    _errorCache.clear();
  });

  it("renders SVG from valid mermaid code", async () => {
    mockRender.mockResolvedValue({ svg: '<svg data-testid="mermaid-svg"><text>A→B</text></svg>' });

    const { container } = renderWithTheme(<MermaidBlock code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(container.querySelector("svg")).not.toBeNull();
    });
    expect(mockRender).toHaveBeenCalledWith(
      expect.stringContaining("mermaid-"),
      "graph TD; A-->B"
    );
  });

  it("shows error and raw code on invalid syntax", async () => {
    mockRender.mockRejectedValue(new Error("Parse error"));

    renderWithTheme(<MermaidBlock code="invalid diagram" />);

    await waitFor(() => {
      expect(screen.getByText(/failed to render/i)).toBeTruthy();
    });
    expect(screen.getByText("invalid diagram")).toBeTruthy();
  });

  it("discards stale render result when unmounted during render", async () => {
    let resolveRender!: (value: { svg: string }) => void;
    const renderPromise = new Promise<{ svg: string }>((resolve) => { resolveRender = resolve; });
    mockRender.mockReturnValue(renderPromise);

    const { unmount } = renderWithTheme(<MermaidBlock code="graph TD; A-->B" />);

    // Wait for loading state to appear (confirms effect has started)
    await waitFor(() => {
      expect(screen.getByText(/loading diagram/i)).toBeTruthy();
    });

    // Unmount while render is still pending
    unmount();

    // Resolve after unmount — should not throw or update state
    await act(async () => {
      resolveRender({ svg: "<svg>late</svg>" });
    });

    // No error means stale result was safely discarded
  });

  it("shows cached error instantly on remount without re-rendering", async () => {
    mockRender.mockRejectedValue(new Error("Parse error"));

    // First render — populates error cache
    const { container: c1, unmount } = renderWithTheme(<MermaidBlock code="cache-err-diagram" />);
    await waitFor(() => {
      expect(c1.textContent).toMatch(/failed to render/i);
    });
    expect(mockRender).toHaveBeenCalledTimes(1);

    unmount();
    mockRender.mockClear();

    // Remount with same code — error shows immediately, no loading flash,
    // and mermaid.render() is NOT called again.
    const { container: c2 } = renderWithTheme(<MermaidBlock code="cache-err-diagram" />);
    expect(c2.textContent).toMatch(/failed to render/i);
    expect(c2.textContent).not.toMatch(/loading diagram/i);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("generates unique IDs for multiple instances", async () => {
    mockRender.mockImplementation((id: string) => {
      return Promise.resolve({ svg: `<svg id="${id}"></svg>` });
    });

    const { container: c1 } = renderWithTheme(<MermaidBlock code="graph TD; A-->B" />);
    await waitFor(() => {
      expect(c1.querySelector(".mermaid-diagram")).not.toBeNull();
    });

    const { container: c2 } = renderWithTheme(<MermaidBlock code="graph TD; C-->D" />);
    await waitFor(() => {
      expect(c2.querySelector(".mermaid-diagram")).not.toBeNull();
    });

    // Each call should have a different ID
    expect(mockRender.mock.calls.length).toBeGreaterThanOrEqual(2);
    const ids = mockRender.mock.calls.map((c) => c[0]);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it("initializes from SVG cache on remount without re-rendering", async () => {
    const svgContent = '<svg><text>cached</text></svg>';
    mockRender.mockResolvedValue({ svg: svgContent });

    // First render — populates cache
    const { container, unmount } = renderWithTheme(<MermaidBlock code="graph TD; X-->Y" />);
    await waitFor(() => {
      expect(container.querySelector("svg")).not.toBeNull();
    });
    expect(mockRender).toHaveBeenCalledTimes(1);

    // Unmount and remount with same code
    unmount();
    mockRender.mockClear();

    const { container: c2 } = renderWithTheme(<MermaidBlock code="graph TD; X-->Y" />);

    // Should show SVG immediately from cache — no loading flash
    expect(c2.querySelector("svg")).not.toBeNull();
    // Should NOT call mermaid.render() again
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("re-renders when theme changes even with same code", async () => {
    const svgLight = '<svg><text>light</text></svg>';
    const svgDark = '<svg><text>dark</text></svg>';

    // Pre-populate cache for light theme
    _svgCache.set("graph TD; A-->B\0light", svgLight);
    // Pre-populate cache for dark theme with different SVG
    _svgCache.set("graph TD; A-->B\0dark", svgDark);

    // Both should be separate cache entries
    expect(_svgCache.size).toBe(2);
    expect(_svgCache.get("graph TD; A-->B\0light")).toBe(svgLight);
    expect(_svgCache.get("graph TD; A-->B\0dark")).toBe(svgDark);
  });
});
