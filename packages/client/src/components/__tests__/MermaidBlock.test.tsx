import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../lib/i18n/i18n.js";
import { ThemeProvider, useThemeContext } from "../settings/ThemeProvider.js";

// Mock mermaid module
const mockRender = vi.fn();
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: mockRender,
  },
}));

// Fault injection for the SVG sanitizer (change: sanitize-untrusted-rendered-content).
// Delegates to the REAL DOMPurify unless a mode is set.
const purifyFault = vi.hoisted(() => ({ mode: null as null | "throw" | "unsupported" }));
vi.mock("dompurify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dompurify")>();
  const real = actual.default;
  return {
    ...actual,
    default: {
      get isSupported() {
        return purifyFault.mode === "unsupported" ? false : real.isSupported;
      },
      sanitize: (...args: unknown[]) => {
        if (purifyFault.mode === "throw") throw new Error("purify boom");
        if (purifyFault.mode === "unsupported") return args[0];
        return (real.sanitize as (...a: unknown[]) => unknown)(...args);
      },
    },
  };
});

// Spy-able pass-through to the real repair module (X3 overrides it once).
vi.mock("../../lib/preview/mermaid-repair.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/preview/mermaid-repair.js")>();
  return { ...actual, repairMermaid: vi.fn(actual.repairMermaid) };
});

// Import after mock is set up
import { repairMermaid } from "../../lib/preview/mermaid-repair.js";
import {
  _outcomeCache,
  colorizeDefaultNodes,
  hashId,
  MermaidBlock,
  rgba,
  sanitizeMermaidSvg,
} from "../preview/MermaidBlock.js";
import { VIEWPORT_HEIGHT_CSS } from "../preview/mermaid-fit.js";

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
    _outcomeCache.clear();
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
      expect(screen.getByText(/could not be rendered/i)).toBeTruthy();
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
      expect(screen.getByText(/rendering diagram/i)).toBeTruthy();
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
      expect(c1.textContent).toMatch(/could not be rendered/i);
    });
    expect(mockRender).toHaveBeenCalledTimes(1);

    unmount();
    mockRender.mockClear();

    // Remount with same code — error shows immediately, no loading flash,
    // and mermaid.render() is NOT called again.
    const { container: c2 } = renderWithTheme(<MermaidBlock code="cache-err-diagram" />);
    expect(c2.textContent).toMatch(/could not be rendered/i);
    expect(c2.textContent).not.toMatch(/rendering diagram/i);
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
    _outcomeCache.set("graph TD; A-->B\0base:light", { kind: "ok", svg: svgLight });
    // Pre-populate cache for base dark theme with different SVG
    _outcomeCache.set("graph TD; A-->B\0base:dark", { kind: "ok", svg: svgDark });

    // Both should be separate cache entries
    expect(_outcomeCache.size).toBe(2);
    expect(_outcomeCache.get("graph TD; A-->B\0base:light")).toEqual({ kind: "ok", svg: svgLight });
    expect(_outcomeCache.get("graph TD; A-->B\0base:dark")).toEqual({ kind: "ok", svg: svgDark });
  });
});

// See change: fix-markdown-remount-storm (D4; test-plan E20-E22, fitted view)
describe("MermaidBlock fixed-height fitted viewport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _outcomeCache.clear();
  });

  async function mountWith(svg: string, rect: { width: number; height: number }) {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue({ ...rect, x: 0, y: 0, top: 0, left: 0, right: rect.width, bottom: rect.height, toJSON() {} } as DOMRect);
    mockRender.mockResolvedValue({ svg });
    const utils = renderWithTheme(<MermaidBlock code={`graph TD; X-->${Math.random()}`} />);
    await waitFor(() => expect(utils.container.querySelector(".mermaid-diagram-inner")).not.toBeNull());
    return { ...utils, restore: () => spy.mockRestore() };
  }

  it("viewport uses clamp(240px, 50vh, 640px), not minHeight", async () => {
    const { container, restore } = await mountWith('<svg viewBox="0 0 800 400"></svg>', { width: 600, height: 420 });
    const vp = container.querySelector(".mermaid-diagram > div") as HTMLElement;
    // jsdom's CSSOM drops clamp(); assert the source constant and that minHeight is gone.
    expect(VIEWPORT_HEIGHT_CSS).toBe("clamp(240px, 50vh, 640px)");
    expect(vp.style.minHeight).toBe("");
    restore();
  });

  it("initial transform is the contain-fit scale", async () => {
    const { container, restore } = await mountWith('<svg viewBox="0 0 800 400"></svg>', { width: 600, height: 420 });
    const inner = container.querySelector(".mermaid-diagram-inner") as HTMLElement;
    await waitFor(() => expect(inner.style.transform).toContain("scale(0.75)"));
    restore();
  });

  it("very tall diagram clamps to the 0.5 floor", async () => {
    const { container, restore } = await mountWith('<svg viewBox="0 0 800 2000"></svg>', { width: 600, height: 420 });
    const inner = container.querySelector(".mermaid-diagram-inner") as HTMLElement;
    await waitFor(() => expect(inner.style.transform).toContain("scale(0.5)"));
    restore();
  });
});

// ── Rule-based auto-repair ─────────────────────────────────────────────────
// See change: add-mermaid-auto-repair (test-plan E14, E15, F1–F8, F10, F11, X1–X3).
describe("MermaidBlock auto-repair", () => {
  const REPAIRABLE = "graph TD\nA -->|(x)| B"; // R4
  const SVG = '<svg viewBox="0 0 1000 400"><text>fixed</text></svg>';

  beforeEach(() => {
    vi.clearAllMocks();
    _outcomeCache.clear();
    localStorage.clear();
  });

  const badge = (c: HTMLElement) => c.querySelector('[data-testid="mermaid-repair-badge"]');
  const ruleCodes = (c: HTMLElement) =>
    [...c.querySelectorAll('[data-testid="mermaid-repair-rule"]')].map((e) => e.getAttribute("data-rule"));
  const toggle = () => screen.getByRole("button", { name: /show original/i });
  const viewport = (c: HTMLElement) => c.querySelector(".mermaid-diagram-inner")!.parentElement as HTMLElement;
  const scaleOf = (c: HTMLElement) =>
    (c.querySelector(".mermaid-diagram-inner") as HTMLElement).style.transform.match(/scale\(([^)]+)\)/)![1];

  function failThenOk(err = "E1") {
    mockRender.mockRejectedValueOnce(new Error(err)).mockResolvedValueOnce({ svg: SVG });
  }

  async function mountRepaired(code = REPAIRABLE) {
    failThenOk();
    const utils = renderWithTheme(<MermaidBlock code={code} />);
    await waitFor(() => expect(badge(utils.container)).not.toBeNull());
    return utils;
  }

  describe("render-flow decision table (E14)", () => {
    it("ok → SVG, no badge, 1 render call", async () => {
      mockRender.mockResolvedValueOnce({ svg: SVG });
      const { container } = renderWithTheme(<MermaidBlock code={"graph TD\nA-->B"} />);
      await waitFor(() => expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull());
      expect(badge(container)).toBeNull();
      expect(mockRender).toHaveBeenCalledTimes(1);
      expect(repairMermaid).not.toHaveBeenCalled();
    });

    it("fail + no rule → original error, 1 render call", async () => {
      mockRender.mockRejectedValueOnce(new Error("E1"));
      const { container } = renderWithTheme(<MermaidBlock code={"unknownDiagram\nA-->B"} />);
      await waitFor(() => expect(container.textContent).toMatch(/could not be rendered.*E1/i));
      expect(mockRender).toHaveBeenCalledTimes(1);
      expect(badge(container)).toBeNull();
    });

    it("fail + rule + ok → SVG + badge R4, 2 calls, retry id ends -r", async () => {
      const { container } = await mountRepaired();
      expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull();
      expect(ruleCodes(container)).toEqual(["R4"]);
      expect(mockRender).toHaveBeenCalledTimes(2);
      const [firstId, firstCode] = mockRender.mock.calls[0];
      const [retryId, retryCode] = mockRender.mock.calls[1];
      expect(retryId).toBe(`${firstId}-r`);
      expect(firstCode).toBe(REPAIRABLE);
      expect(retryCode).toBe('graph TD\nA -->|"(x)"| B');
    });

    it("fail + rule + fail → original error from call 1, 2 calls", async () => {
      mockRender.mockRejectedValueOnce(new Error("E1")).mockRejectedValueOnce(new Error("E2"));
      const { container } = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
      await waitFor(() => expect(container.textContent).toMatch(/could not be rendered/i));
      expect(mockRender).toHaveBeenCalledTimes(2);
      expect(container.textContent).toContain("E1");
      expect(badge(container)).toBeNull();
    });
  });

  it("streaming block is neither rendered nor repaired (E15)", async () => {
    renderWithTheme(<MermaidBlock code={REPAIRABLE} complete={false} />);
    await act(async () => {});
    expect(mockRender).not.toHaveBeenCalled();
    expect(repairMermaid).not.toHaveBeenCalled();
    expect(screen.getByText(/rendering diagram/i)).toBeTruthy();
  });

  it("remount with cached repaired outcome shows SVG + badge immediately (F1)", async () => {
    const { unmount } = await mountRepaired();
    unmount();
    const calls = mockRender.mock.calls.length;
    const { container } = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
    expect(container.textContent).not.toMatch(/rendering diagram/i);
    expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull();
    expect(ruleCodes(container)).toEqual(["R4"]);
    expect(mockRender).toHaveBeenCalledTimes(calls);
  });

  it("remount with cached error shows error immediately (F2)", async () => {
    mockRender.mockRejectedValue(new Error("E1"));
    const { container: c1, unmount } = renderWithTheme(<MermaidBlock code={"unknownDiagram\nA-->B"} />);
    await waitFor(() => expect(c1.textContent).toMatch(/could not be rendered/i));
    unmount();
    const calls = mockRender.mock.calls.length;
    const { container } = renderWithTheme(<MermaidBlock code={"unknownDiagram\nA-->B"} />);
    expect(container.textContent).toMatch(/could not be rendered.*E1/i);
    expect(container.textContent).not.toMatch(/rendering diagram/i);
    expect(mockRender).toHaveBeenCalledTimes(calls);
  });

  it("show original after remount displays raw code + original error (F3)", async () => {
    const raw = "  graph TD\n    A -->|(x)| B";
    const { unmount } = await mountRepaired(raw);
    unmount();
    const { container } = renderWithTheme(<MermaidBlock code={raw} />);
    fireEvent.click(toggle());
    expect(container.querySelector("pre code")!.textContent).toBe(raw);
    expect(container.textContent).toMatch(/original render error.*E1/i);
  });

  it("show original hides the diagram from the keyboard (F4)", async () => {
    const { container } = await mountRepaired();
    fireEvent.click(viewport(container)); // focus → zoom controls render
    expect(screen.getByTitle("Zoom in")).toBeTruthy();
    fireEvent.click(toggle());
    const vp = viewport(container);
    expect(vp.hasAttribute("hidden")).toBe(true);
    expect(screen.queryByTitle("Zoom in")).toBeNull(); // focused cleared
    expect(vp.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).toHaveLength(0);
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
  });

  describe("toggle keeps the view (F5, F6)", () => {
    let roCallback: (() => void) | null = null;
    let rectSpy: { mockRestore: () => void } | null = null;

    beforeEach(() => {
      roCallback = null;
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: () => void) {
            roCallback = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      const full = { width: 600, height: 420 };
      rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const r = this.closest("[hidden]") ? { width: 0, height: 0 } : full;
        return { ...r, x: 0, y: 0, top: 0, left: 0, right: r.width, bottom: r.height, toJSON() {} } as DOMRect;
      });
    });

    afterEach(() => {
      rectSpy?.mockRestore();
      vi.unstubAllGlobals();
    });

    it("zoomed scale survives show original + 0×0 resize (F5)", async () => {
      const { container } = await mountRepaired();
      await waitFor(() => expect(scaleOf(container)).toBe("0.6"));
      fireEvent.click(viewport(container));
      fireEvent.click(screen.getByTitle("Zoom in"));
      fireEvent.click(screen.getByTitle("Zoom in"));
      const zoomed = (container.querySelector(".mermaid-diagram-inner") as HTMLElement).style.transform;
      expect(scaleOf(container)).not.toBe("0.6");
      fireEvent.click(toggle());
      act(() => roCallback?.());
      fireEvent.click(toggle());
      expect((container.querySelector(".mermaid-diagram-inner") as HTMLElement).style.transform).toBe(zoomed);
    });

    it("never-zoomed fitted scale survives show original + 0×0 resize (F6)", async () => {
      const { container } = await mountRepaired();
      await waitFor(() => expect(scaleOf(container)).toBe("0.6"));
      fireEvent.click(toggle());
      act(() => roCallback?.());
      fireEvent.click(toggle());
      expect(scaleOf(container)).toBe("0.6");
    });
  });

  it("outcome change closes the original view (F7)", async () => {
    let setPref: ((p: "light" | "dark" | "system") => void) | null = null;
    function Grab() {
      setPref = useThemeContext().setPreference as typeof setPref;
      return null;
    }
    failThenOk();
    const ui = (code: string) => (
      <ThemeProvider>
        <Grab />
        <MermaidBlock code={code} />
      </ThemeProvider>
    );
    const { container, rerender } = render(ui(REPAIRABLE));
    await waitFor(() => expect(badge(container)).not.toBeNull());

    // Theme switch: repaired again under the new theme, original view closed.
    fireEvent.click(toggle());
    expect(viewport(container).hasAttribute("hidden")).toBe(true);
    failThenOk();
    act(() => setPref!("light"));
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(badge(container)).not.toBeNull());
    expect(viewport(container).hasAttribute("hidden")).toBe(false);
    expect(toggle().getAttribute("aria-pressed")).toBe("false");

    // New valid source: original view closed, no badge.
    fireEvent.click(toggle());
    mockRender.mockResolvedValueOnce({ svg: SVG });
    rerender(ui("graph TD\nA-->B"));
    await waitFor(() => expect(badge(container)).toBeNull());
    expect(viewport(container).hasAttribute("hidden")).toBe(false);
    expect(container.querySelector("pre code")).toBeNull();
  });

  it("each rule shows its description as visible text, code only in data-rule (F8, E1)", async () => {
    const { container } = await mountRepaired("graph TD\nA[x (y)] -->|z| B");
    expect(ruleCodes(container)).toEqual(["R4", "R5"]);
    const pill = container.querySelector('[data-testid="mermaid-repair-badge"]')!;
    expect(pill.textContent).toContain("Auto-fixed");
    const rules = [...container.querySelectorAll('[data-testid="mermaid-repair-rule"]')];
    expect(rules[0].textContent).toBe("Quoted an edge label");
    expect(rules[1].textContent).toBe("Quoted a node label containing special characters");
    for (const el of rules) expect(el.textContent).not.toMatch(/^R\d$/);
  });

  it("unmount during the repair retry caches the repaired outcome (F10)", async () => {
    let resolveRetry!: (v: { svg: string }) => void;
    mockRender
      .mockRejectedValueOnce(new Error("E1"))
      .mockReturnValueOnce(new Promise<{ svg: string }>((r) => { resolveRetry = r; }));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
    await waitFor(() => expect(mockRender).toHaveBeenCalledTimes(2));
    unmount();
    await act(async () => resolveRetry({ svg: SVG }));
    await waitFor(() =>
      expect([..._outcomeCache.entries()].find(([k]) => k.startsWith(`${REPAIRABLE}\0`))?.[1].kind).toBe("repaired"),
    );
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
    const { container } = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
    expect(ruleCodes(container)).toEqual(["R4"]);
    expect(mockRender).toHaveBeenCalledTimes(2);
  });

  it("copy fixed puts the normalized, repaired source on the clipboard (F11)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = await mountRepaired("  graph TD\n    A --&gt;|(x)| B");
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="mermaid-copy-fixed"]')!);
    });
    expect(writeText).toHaveBeenCalledWith('graph TD\nA -->|"(x)"| B');
  });

  it("unrepairable diagram keeps the error display (X1)", async () => {
    mockRender.mockRejectedValue(new Error("E1"));
    const { container } = renderWithTheme(<MermaidBlock code={"unknownDiagram\nA-->B"} />);
    await waitFor(() => expect(container.textContent).toMatch(/could not be rendered.*E1/i));
    expect(container.querySelector("pre code")!.textContent).toBe("unknownDiagram\nA-->B");
    expect(badge(container)).toBeNull();
    expect(mockRender).toHaveBeenCalledTimes(1);
  });

  it("repair still failing shows the ORIGINAL error, never the retry error (X2)", async () => {
    mockRender.mockRejectedValueOnce(new Error("E1")).mockRejectedValueOnce(new Error("E2"));
    const { container } = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
    await waitFor(() => expect(container.textContent).toMatch(/could not be rendered/i));
    expect(container.textContent).toContain("E1");
    expect(container.textContent).not.toContain("E2");
  });

  it("a throwing repair falls back to the original error (X3)", async () => {
    vi.mocked(repairMermaid).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    mockRender.mockRejectedValueOnce(new Error("E1"));
    const { container } = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
    await waitFor(() => expect(container.textContent).toMatch(/could not be rendered.*E1/i));
    expect(mockRender).toHaveBeenCalledTimes(1);
    expect(badge(container)).toBeNull();
  });
});


// ── retro-ux-chat-rendering ────────────────────────────────────────────────
// See change: retro-ux-chat-rendering (test-plan E2–E5, E9, F1–F3).
describe("MermaidBlock retro-ux chat rendering", () => {
  const REPAIRABLE = "graph TD\nA -->|(x)| B"; // R4
  const SVG = '<svg viewBox="0 0 1000 400"><text>fixed</text></svg>';
  const PALETTE = /\b(?:bg|text|border)-(?:red|blue|cyan|green|yellow|orange|purple|amber|slate|gray|black|white)(?:-\d+)?/;

  beforeEach(() => {
    vi.clearAllMocks();
    _outcomeCache.clear();
    localStorage.clear();
  });

  const viewportOf = (c: HTMLElement) =>
    c.querySelector(".mermaid-diagram-inner")!.parentElement as HTMLElement;
  const scaleOf = (c: HTMLElement) =>
    (c.querySelector(".mermaid-diagram-inner") as HTMLElement).style.transform.match(/scale\(([^)]+)\)/)![1];

  async function mountOk() {
    mockRender.mockResolvedValue({ svg: SVG });
    const utils = renderWithTheme(<MermaidBlock code={"graph TD\nA-->B"} />);
    await waitFor(() => expect(utils.container.querySelector(".mermaid-diagram-inner")).not.toBeNull());
    return utils;
  }

  async function mountRepaired() {
    mockRender.mockRejectedValueOnce(new Error("E1")).mockResolvedValueOnce({ svg: SVG });
    const utils = renderWithTheme(<MermaidBlock code={REPAIRABLE} />);
    await waitFor(() => expect(utils.container.querySelector('[data-testid="mermaid-repair-badge"]')).not.toBeNull());
    return utils;
  }

  it("E2: show-original is aria-pressed, copy fixed is named, badge row has no palette class", async () => {
    const { container } = await mountRepaired();
    const toggle = screen.getByRole("button", { name: /show original/i });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /copy fixed source/i })).toBeTruthy();
    const badge = container.querySelector('[data-testid="mermaid-repair-badge"]')!;
    const classes = [badge, ...badge.querySelectorAll("*")].map((e) => e.getAttribute("class") ?? "").join(" ");
    expect(classes).not.toMatch(PALETTE);
  });

  it("E3: loading is a role=status spinner with 'Rendering diagram…', no --text-muted", async () => {
    // The render queue is global: settle the pending render at the end so later tests are not blocked.
    let settle!: (v: { svg: string }) => void;
    mockRender.mockReturnValue(new Promise<{ svg: string }>((r) => { settle = r; }));
    const { container, unmount } = renderWithTheme(<MermaidBlock code="graph TD; A-->B" />);
    const status = await screen.findByRole("status");
    expect(status.textContent).toBe("Rendering diagram…");
    expect(status.querySelector("svg.animate-spin")).not.toBeNull();
    expect(status.className).toContain("text-[var(--text-secondary)]");
    expect(container.innerHTML).not.toContain("--text-muted");
    unmount();
    await act(async () => settle({ svg: SVG }));
  });

  describe("E4: unrepairable decision table renders the error callout", () => {
    const cases: Array<[string, string, () => void]> = [
      ["unknown type", "unknownDiagram\nA-->B", () => mockRender.mockRejectedValue(new Error("E1"))],
      [
        "rules apply but retry fails",
        REPAIRABLE,
        () => mockRender.mockRejectedValueOnce(new Error("E1")).mockRejectedValueOnce(new Error("E2")),
      ],
    ];
    it.each(cases)("%s", async (_name, code, arrange) => {
      arrange();
      const { container } = renderWithTheme(<MermaidBlock code={code} />);
      await waitFor(() => expect(container.querySelector('[data-testid="mermaid-error"]')).not.toBeNull());
      const err = container.querySelector('[data-testid="mermaid-error"]')!;
      expect(err.textContent).toContain("This diagram could not be rendered.");
      expect(err.textContent).toContain("E1");
      expect(err.querySelector("pre code")!.textContent).toBe(code);
      expect(err.innerHTML).toContain("--severity-error-bg");
      expect(err.innerHTML).toContain("--severity-error-fg");
      expect(err.innerHTML).toContain("--severity-error-border");
      expect(err.innerHTML).not.toMatch(/text-red-400|bg-red-900/);
    });

    it("same failing code remounted: no loading flash and no second render", async () => {
      mockRender.mockRejectedValue(new Error("E1"));
      const first = renderWithTheme(<MermaidBlock code={"unknownDiagram\nA-->B"} />);
      await waitFor(() => expect(first.container.querySelector('[data-testid="mermaid-error"]')).not.toBeNull());
      first.unmount();
      const calls = mockRender.mock.calls.length;
      const second = renderWithTheme(<MermaidBlock code={"unknownDiagram\nA-->B"} />);
      expect(second.container.querySelector('[data-testid="mermaid-error"]')).not.toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(mockRender).toHaveBeenCalledTimes(calls);
    });
  });

  it("E5: Copy source copies the original source once", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mockRender.mockRejectedValue(new Error("E1"));
    const code = "unknownDiagram\n  A-->B";
    const { container } = renderWithTheme(<MermaidBlock code={code} />);
    const btn = await waitFor(() => {
      const b = container.querySelector('[data-testid="mermaid-copy-source"]');
      expect(b).not.toBeNull();
      return b as HTMLElement;
    });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(code);
  });

  it("E9: zoom buttons take their names and titles from the Hungarian catalog", async () => {
    function SwitchToHu() {
      const { setLanguage } = useI18n();
      return (
        <>
          <button type="button" data-testid="to-hu" onClick={() => setLanguage("hu")} />
          <button type="button" data-testid="to-en" onClick={() => setLanguage("en")} />
        </>
      );
    }
    mockRender.mockResolvedValue({ svg: SVG });
    const { container, getByTestId } = render(
      <I18nProvider>
        <ThemeProvider>
          <SwitchToHu />
          <MermaidBlock code={"graph TD\nA-->B"} />
        </ThemeProvider>
      </I18nProvider>,
    );
    try {
      act(() => getByTestId("to-hu").click());
      // The hu catalog loads on demand; the language flips once it has.
      await waitFor(() => expect(document.documentElement.lang).toBe("hu"));
      await waitFor(() => expect(container.querySelector(".mermaid-diagram-inner")).not.toBeNull());
      fireEvent.click(viewportOf(container));
      for (const name of ["Nagyítás", "Kicsinyítés", "Nagyítás visszaállítása"]) {
        const btn = container.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement | null;
        expect(btn, name).not.toBeNull();
        expect(btn!.title).toBe(name);
      }
    } finally {
      act(() => getByTestId("to-en").click());
      // setLanguage applies asynchronously (catalog load first); don't leak hu into later tests.
      await waitFor(() => expect(document.documentElement.lang).toBe("en"));
    }
  });

  it("F1: viewport is a named tab stop; Enter activates, Escape leaves with focus on the viewport", async () => {
    const { container } = await mountOk();
    const vp = viewportOf(container);
    expect(vp.getAttribute("tabindex")).toBe("0");
    expect(vp.getAttribute("role")).toBe("group");
    expect(vp.getAttribute("aria-label")).toBe("Diagram. Press Enter to zoom and pan, Escape to leave.");
    expect(vp.querySelectorAll("button")).toHaveLength(0);

    vp.focus();
    expect(document.activeElement).toBe(vp);
    fireEvent.keyDown(vp, { key: "Enter" });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    // Zoom buttons are inside the viewport and precede the diagram, so the next Tab lands on them.
    expect(vp.contains(zoomIn)).toBe(true);
    expect(vp.firstElementChild).toBe(zoomIn.parentElement);

    zoomIn.focus();
    fireEvent.keyDown(zoomIn, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(document.activeElement).toBe(vp);
  });

  it("F2: focus passing through the viewport does not activate zoom; wheel is untouched", async () => {
    const { container } = await mountOk();
    const vp = viewportOf(container);
    const before = scaleOf(container);
    vp.focus();
    const wheel = new WheelEvent("wheel", { deltaY: -120, cancelable: true, bubbles: true });
    vp.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(scaleOf(container)).toBe(before);
    vp.blur();
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(scaleOf(container)).toBe(before);
  });

  it("F3: hint is a pill without a scrim; the activated viewport uses --focus-ring, not blue", async () => {
    const { container } = await mountOk();
    const vp = viewportOf(container);
    const hint = screen.getByText("Enter or click to zoom");
    expect(hint.className).not.toContain("bg-black");
    expect(hint.parentElement!.className).not.toContain("bg-black");
    expect(vp.querySelector("[class*='bg-black']")).toBeNull();
    fireEvent.click(vp);
    expect(vp.className).toContain("focus-ring");
    expect(vp.className).toContain("border-[var(--focus-ring)]");
    expect(vp.className).not.toContain("border-blue-500");
  });

  it("F1b: Escape pressed on an unrelated control does not deactivate or steal focus", async () => {
    const { container } = await mountOk();
    const vp = viewportOf(container);
    fireEvent.click(vp);
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    const other = document.createElement("button");
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(document.activeElement).toBe(other);
    other.remove();
  });
});

// ── Untrusted-content sanitization ─────────────────────────────────────────
// See change: sanitize-untrusted-rendered-content (test-plan E20–E22, X5).
describe("MermaidBlock SVG sanitization", () => {
  const XHTML = "http://www.w3.org/1999/xhtml";
  const LABEL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.node{fill:red}</style>
  <g class="node" id="flowchart-A-0"><rect class="basic label-container" style=""></rect>
  <foreignObject width="80" height="40"><div xmlns="${XHTML}"><span class="nodeLabel">a<br/>b</span></div></foreignObject></g></svg>`;

  beforeEach(() => {
    vi.clearAllMocks();
    _outcomeCache.clear();
    purifyFault.mode = null;
  });
  afterEach(() => {
    purifyFault.mode = null;
  });

  it("#E20 strips active content but keeps labels and theme style", async () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <a xlink:href="javascript:alert(1)"><text>x</text></a>
      <g onclick="alert(1)"></g><g onload='alert(1)'></g><g onmouseover=alert(1)></g>
      <script>alert(1)</script>
      <style>.node{fill:red}</style>
      <foreignObject><div xmlns="${XHTML}"><span class="nodeLabel">a<br/>b</span></div></foreignObject></svg>`;
    const out = await sanitizeMermaidSvg(dirty);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/\son\w+\s*=/i);
    expect(out).not.toContain("<script");
    const doc = new DOMParser().parseFromString(out, "text/html");
    expect(doc.querySelector("foreignObject span.nodeLabel")).not.toBeNull();
    expect(doc.querySelector("foreignObject br")).not.toBeNull();
    expect(doc.querySelector("style")).not.toBeNull();
  });

  it("#E21 colorizes the default node first, then sanitizes (multi-line label survives)", async () => {
    mockRender.mockResolvedValue({ svg: LABEL_SVG.replace('<g class="node"', '<g class="node" onclick="alert(1)"') });
    const { container } = renderWithTheme(<MermaidBlock code={"graph TD\nA-->B"} />);
    await waitFor(() => expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull());
    const rect = container.querySelector(".mermaid-diagram g.node rect")!;
    expect(rect.getAttribute("style")).toMatch(/fill:\s*rgba\(/);
    const label = container.querySelector(".mermaid-diagram .nodeLabel")!;
    expect(label.textContent).toBe("ab");
    expect(label.querySelector("br")).not.toBeNull();
    expect(container.querySelector(".mermaid-diagram")!.innerHTML).not.toMatch(/\son\w+\s*=/i);
  });

  it("#E21b mermaid's unclosed <br> (not well-formed XML) still gets colorized", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g class="node" id="flowchart-A-0"><rect class="basic label-container" style=""></rect><foreignObject><div xmlns="${XHTML}"><span class="nodeLabel"><p>one<br>two</p></span></div></foreignObject></g></svg>`;
    const out = colorizeDefaultNodes(svg, ACCENTS_A, TEXT);
    expect(parse(out).querySelector("rect")!.getAttribute("style")).toMatch(/fill:\s*rgba\(/);
    expect(out).toContain("one");
    expect(out).toContain("two");
  });

  it("#E22 a repaired render is sanitized too", async () => {
    mockRender
      .mockRejectedValueOnce(new Error("E1"))
      .mockResolvedValueOnce({ svg: '<svg><g onclick="alert(1)"><text>fixed</text></g></svg>' });
    const { container } = renderWithTheme(<MermaidBlock code={"graph TD\nA -->|(x)| B"} />);
    await waitFor(() => expect(container.querySelector('[data-testid="mermaid-repair-badge"]')).not.toBeNull());
    expect(container.querySelector(".mermaid-diagram")!.innerHTML).not.toContain("onclick");
  });

  for (const mode of ["throw", "unsupported"] as const) {
    it(`#X5 fails closed when the sanitizer is unavailable (${mode})`, async () => {
      purifyFault.mode = mode;
      mockRender.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>RAWMARK</text></svg>' });
      const { container } = renderWithTheme(<MermaidBlock code={"graph TD\nA -->|(x)| B"} />);
      await waitFor(() => expect(container.textContent).toMatch(/could not be rendered/i));
      expect(container.querySelector(".mermaid-diagram svg")).toBeNull();
      expect(container.innerHTML).not.toContain("RAWMARK");
      for (const outcome of _outcomeCache.values()) expect(JSON.stringify(outcome)).not.toContain("RAWMARK");
    });
  }
});
