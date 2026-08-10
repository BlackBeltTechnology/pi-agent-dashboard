import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";
import { ThemeProvider } from "../settings/ThemeProvider.js";

// Mock mermaid module
const mockRender = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mockRender,
  },
}));

// Import after mock is set up
import {
  MermaidBlock,
  _svgCache,
  _errorCache,
  colorizeDefaultNodes,
  hashId,
  rgba,
} from "../preview/MermaidBlock.js";

const ACCENTS_A = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#f97316"];
const ACCENTS_B = ["#8be9fd", "#50fa7b", "#f1fa8c", "#ff5555", "#bd93f9", "#ffb86c"];
const TEXT = "#111827";

const FLOWCHART_FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg">
  <g class="node" id="flowchart-A-0"><rect class="basic label-container" style=""></rect><g class="label"><foreignObject><span class="nodeLabel">A</span></foreignObject></g></g>
  <g class="node" id="flowchart-B-1"><rect class="basic label-container" style="fill:#ff0000 !important;stroke:#000"></rect></g>
  <g class="node" id="flowchart-C-2"><rect class="basic label-container" style="fill:#00ff00 !important"></rect></g>
</svg>`;

const CLASS_FIXTURE = `<svg xmlns="http://www.w3.org/2000/svg">
  <g class="classGroup" id="Animal"><path fill="#eeeeee" style=""></path><text>Animal</text></g>
  <g class="classGroup" id="Dog"><path fill="#00ff00" style="fill:#00ff00"></path><text>Dog</text></g>
</svg>`;

function parse(svg: string): Document {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

describe("colorizeDefaultNodes", () => {
  it("tints default flowchart nodes but leaves authored nodes untouched", () => {
    const out = colorizeDefaultNodes(FLOWCHART_FIXTURE, ACCENTS_A, TEXT);
    const doc = parse(out);

    // Default node A → accent wash fill (rgba), full-accent border
    const aStyle = doc.querySelector("#flowchart-A-0 rect")!.getAttribute("style")!;
    expect(aStyle).toMatch(/fill:\s*rgba\(\d+,\d+,\d+,0\.08\)/);
    expect(aStyle).toMatch(/stroke:\s*rgba\(\d+,\d+,\d+,0\.85\)/);

    // Authored `style B` node keeps #ff0000, no rgba wash
    const bStyle = doc.querySelector("#flowchart-B-1 rect")!.getAttribute("style")!;
    expect(bStyle).toContain("#ff0000");
    expect(bStyle).not.toContain("rgba");

    // classDef node keeps its fill
    const cStyle = doc.querySelector("#flowchart-C-2 rect")!.getAttribute("style")!;
    expect(cStyle).toContain("#00ff00");
    expect(cStyle).not.toContain("rgba");
  });

  it("tints default class nodes (path fill attr + style) and skips authored ones", () => {
    const out = colorizeDefaultNodes(CLASS_FIXTURE, ACCENTS_A, TEXT);
    const doc = parse(out);

    const animalPath = doc.querySelector("#Animal path")!;
    expect(animalPath.getAttribute("style")).toMatch(/fill:\s*rgba\(/);
    // fill attribute overridden so it does not fight the style wash
    expect(animalPath.getAttribute("fill")).toMatch(/rgba\(/);

    const dogPath = doc.querySelector("#Dog path")!;
    expect(dogPath.getAttribute("style")).toContain("#00ff00");
    expect(dogPath.getAttribute("style")).not.toContain("rgba");
  });

  it("assigns a stable color per node id even when an unrelated node is added", () => {
    const out1 = colorizeDefaultNodes(FLOWCHART_FIXTURE, ACCENTS_A, TEXT);
    const colorBefore = parse(out1).querySelector("#flowchart-A-0 rect")!.getAttribute("style")!.match(/fill:\s*(rgba\([^)]+\))/)![1];

    const withExtra = FLOWCHART_FIXTURE.replace(
      "</svg>",
      `<g class="node" id="flowchart-Z-9"><rect class="basic label-container" style=""></rect></g></svg>`,
    );
    const out2 = colorizeDefaultNodes(withExtra, ACCENTS_A, TEXT);
    const colorAfter = parse(out2).querySelector("#flowchart-A-0 rect")!.getAttribute("style")!.match(/fill:\s*(rgba\([^)]+\))/)![1];

    expect(colorAfter).toBe(colorBefore);
  });

  it("uses low-opacity wash fill + full-accent border + theme text color", () => {
    const out = colorizeDefaultNodes(FLOWCHART_FIXTURE, ACCENTS_A, TEXT);
    const doc = parse(out);
    const style = doc.querySelector("#flowchart-A-0 rect")!.getAttribute("style")!;
    expect(style).toContain("0.08)");
    expect(style).toContain("0.85)");
    // Label keeps theme text color
    const label = doc.querySelector("#flowchart-A-0 .nodeLabel") as HTMLElement | null;
    expect(label?.getAttribute("style") ?? "").toContain("color");
  });

  it("produces different colors when the accent palette (theme) changes", () => {
    const a = parse(colorizeDefaultNodes(FLOWCHART_FIXTURE, ACCENTS_A, TEXT)).querySelector("#flowchart-A-0 rect")!.getAttribute("style")!;
    const b = parse(colorizeDefaultNodes(FLOWCHART_FIXTURE, ACCENTS_B, TEXT)).querySelector("#flowchart-A-0 rect")!.getAttribute("style")!;
    const fillA = a.match(/fill:\s*(rgba\([^)]+\))/)![1];
    const fillB = b.match(/fill:\s*(rgba\([^)]+\))/)![1];
    expect(fillA).not.toBe(fillB);
  });
});

describe("hashId / rgba helpers", () => {
  it("hashId is deterministic and spreads distinct ids", () => {
    expect(hashId("flowchart-A-0")).toBe(hashId("flowchart-A-0"));
    const idxs = ["a", "b", "c", "d", "e", "f"].map((s) => hashId(s) % 6);
    expect(new Set(idxs).size).toBeGreaterThan(1);
  });

  it("rgba parses hex to rgba string", () => {
    expect(rgba("#3b82f6", 0.08)).toBe("rgba(59,130,246,0.08)");
    expect(rgba("#fff", 0.85)).toBe("rgba(255,255,255,0.85)");
  });
});

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

    // Pre-populate cache for base light theme
    _svgCache.set("graph TD; A-->B\0base:light", svgLight);
    // Pre-populate cache for base dark theme with different SVG
    _svgCache.set("graph TD; A-->B\0base:dark", svgDark);

    // Both should be separate cache entries
    expect(_svgCache.size).toBe(2);
    expect(_svgCache.get("graph TD; A-->B\0base:light")).toBe(svgLight);
    expect(_svgCache.get("graph TD; A-->B\0base:dark")).toBe(svgDark);
  });
});
