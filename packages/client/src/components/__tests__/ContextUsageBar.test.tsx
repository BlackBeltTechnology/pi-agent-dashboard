import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import { ContextUsageBar } from "../ContextUsageBar.js";

afterEach(() => cleanup());

describe("ContextUsageBar", () => {
  it("shows empty bar when no data", () => {
    render(<ContextUsageBar tokens={null} contextWindow={undefined} />);
    const bar = screen.getByTestId("context-usage-bar");
    expect(bar).toBeTruthy();
    expect(screen.queryByTestId("context-usage-fill")).toBeNull();
    expect(screen.queryByTestId("context-usage-pct")).toBeNull();
  });

  it("shows neutral fill below 50% with percentage", () => {
    render(<ContextUsageBar tokens={4000} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("40%");
    expect(fill.className).toContain("bg-[var(--text-tertiary)]");
    expect(screen.getByTestId("context-usage-pct").textContent).toBe("40%");
  });

  it("shows yellow fill between 50% and 80%", () => {
    render(<ContextUsageBar tokens={6500} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("65%");
    expect(fill.className).toContain("bg-yellow-500/60");
  });

  it("shows red fill above 80%", () => {
    render(<ContextUsageBar tokens={9000} contextWindow={10000} />);
    const fill = screen.getByTestId("context-usage-fill");
    expect(fill.style.width).toBe("90%");
    expect(fill.className).toContain("bg-red-500/60");
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
});
