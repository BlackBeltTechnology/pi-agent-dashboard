import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { ContextUsageBar } from "../session/ContextUsageBar.js";

afterEach(() => cleanup());

describe("ContextUsageBar", () => {
  it("shows empty bar when no data", () => {
    render(<ContextUsageBar tokens={null} contextWindow={undefined} />);
    const bar = screen.getByTestId("context-usage-bar");
    expect(bar).toBeTruthy();
    expect(screen.queryByTestId("context-usage-fill")).toBeNull();
    expect(screen.queryByTestId("context-usage-pct")).toBeNull();
  });

  it("shows green fill below 50% with percentage", () => {
    render(<ContextUsageBar tokens={4000} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("40%");
    expect(fill.className).toContain("bg-green-500");
    expect(screen.getByTestId("context-usage-pct").textContent).toBe("40%");
  });

  it("shows yellow fill between 50% and 80%", () => {
    render(<ContextUsageBar tokens={6500} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("65%");
    expect(fill.className).toContain("bg-yellow-500");
  });

  it("shows red fill above 80%", () => {
    render(<ContextUsageBar tokens={9000} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("90%");
    expect(fill.className).toContain("bg-red-500");
  });

  it("caps at 100%", () => {
    render(<ContextUsageBar tokens={15000} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("100%");
  });

  it("shows tooltip with usage info", () => {
    render(<ContextUsageBar tokens={5000} contextWindow={10000} />);
    const bar = screen.getByTestId("context-usage-bar");
    const inner = bar.querySelector("[title]")!;
    expect(inner.getAttribute("title")).toContain("50%");
  });

  it("shows no-data tooltip when tokens are null", () => {
    render(<ContextUsageBar tokens={null} contextWindow={10000} />);
    const bar = screen.getByTestId("context-usage-bar");
    const inner = bar.querySelector("[title]")!;
    expect(inner.getAttribute("title")).toBe("No context data");
  });

  describe("compact mode", () => {
    it("hides percentage text when compact", () => {
      render(<ContextUsageBar tokens={5000} contextWindow={10000} compact />);
      expect(screen.queryByTestId("context-usage-pct")).toBeNull();
    });

    it("still shows fill bar when compact", () => {
      render(<ContextUsageBar tokens={5000} contextWindow={10000} compact />);
      const fill = screen.getByTestId("context-usage-fill");
      expect(fill.style.width).toBe("50%");
    });

    it("shows percentage in tooltip when compact", () => {
      render(<ContextUsageBar tokens={5000} contextWindow={10000} compact />);
      const bar = screen.getByTestId("context-usage-bar");
      const inner = bar.querySelector("[title]")!;
      expect(inner.getAttribute("title")).toContain("50%");
    });

    it("uses fixed width class when compact", () => {
      render(<ContextUsageBar tokens={5000} contextWindow={10000} compact />);
      const bar = screen.getByTestId("context-usage-bar");
      expect(bar.className).toContain("w-16");
      expect(bar.className).not.toContain("flex-1");
    });
  });

  // Rendered compaction badge (test-plan F6, F7). The scenario observable is a
  // pure render assertion (given compaction state, the badge appears / is
  // absent in the DOM). Driven here as a component render test with real DOM:
  // the faux e2e harness has no seam to inject a metadata-bearing
  // session_compact event through pi. See change: adopt-pi-074-080-features (C.1).
  describe("compaction badge", () => {
    it("F6: threshold + 12,400-token reduction renders `auto-threshold \u221212.4k`", () => {
      render(
        <ContextUsageBar
          tokens={7600}
          contextWindow={200000}
          compaction={{ reason: "threshold", preCompactionTokens: 20000, estimatedPostCompactionTokens: 7600 }}
        />,
      );
      const badge = screen.getByTestId("compaction-badge");
      expect(badge.textContent).toBe("auto-threshold \u221212.4k");
    });

    it("F7: no compaction metadata renders NO badge (bar identical to today)", () => {
      render(<ContextUsageBar tokens={5000} contextWindow={10000} />);
      expect(screen.queryByTestId("compaction-badge")).toBeNull();
    });

    it("renders the label only when the reduction is unknown", () => {
      render(<ContextUsageBar tokens={5000} contextWindow={10000} compaction={{ reason: "manual" }} />);
      expect(screen.getByTestId("compaction-badge").textContent).toBe("manual");
    });

    it("renders the overflow-retry label", () => {
      render(
        <ContextUsageBar
          tokens={5000}
          contextWindow={10000}
          compaction={{ reason: "overflow", preCompactionTokens: 9000, estimatedPostCompactionTokens: 1000 }}
        />,
      );
      expect(screen.getByTestId("compaction-badge").textContent).toBe("overflow-retry \u22128k");
    });

    it("renders the badge in compact mode too", () => {
      render(
        <ContextUsageBar
          tokens={7600}
          contextWindow={200000}
          compact
          compaction={{ reason: "threshold", preCompactionTokens: 20000, estimatedPostCompactionTokens: 7600 }}
        />,
      );
      expect(screen.getByTestId("compaction-badge").textContent).toBe("auto-threshold \u221212.4k");
    });
  });
});
