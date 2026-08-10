import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { TokenStatsBar } from "../session/TokenStatsBar.js";
import type { TurnStat } from "../../lib/chat/event-reducer.js";

function makeTurn(overrides: Partial<TurnStat> = {}): TurnStat {
  return { input: 1000, output: 500, cacheRead: 3000, cacheWrite: 200, turnIndex: 0, ...overrides };
}

const defaultProps = {
  tokensIn: 1000,
  tokensOut: 500,
  cacheRead: 3000,
  cacheWrite: 200,
  cost: 0.05,
};

describe("TokenStatsBar", () => {
  it("renders butterfly chart with input (blue) and output (purple)", () => {
    const { container } = render(
      <TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} />
    );
    expect(container.querySelector(".bg-blue-500")).not.toBeNull();
    expect(container.querySelector(".bg-purple-500")).not.toBeNull();
  });

  it("renders butterfly-chart and stats-panel side by side", () => {
    const { container } = render(
      <TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} />
    );
    expect(container.querySelector('[data-testid="butterfly-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="stats-panel"]')).not.toBeNull();
  });

  it("renders center axis between halves", () => {
    const { container } = render(
      <TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} />
    );
    const axis = container.querySelector(".h-px.bg-\\[var\\(--border-subtle\\)\\]");
    expect(axis).not.toBeNull();
  });

  it("renders stacked context bar with segments", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        contextUsage={{ tokens: 50000, contextWindow: 200000 }}
        {...defaultProps}
      />
    );
    const contextBar = container.querySelector('[data-testid="context-bar"]');
    expect(contextBar).not.toBeNull();
  });

  it("uses gradient color for context bar", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        contextUsage={{ tokens: 185000, contextWindow: 200000 }}
        {...defaultProps}
      />
    );
    const bar = container.querySelector('[data-testid="context-bar"]');
    const segments = bar?.querySelectorAll<HTMLElement>(".h-full");
    expect(segments!.length).toBeGreaterThan(0);
    const seg = segments![0]!;
    expect(seg.style.backgroundColor).toBeTruthy();
  });

  it("shows cumulative input (tokensIn + cacheRead) in stats panel", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        tokensIn={91000}
        tokensOut={4200}
        cacheRead={29000000}
        cacheWrite={445000}
        cost={19.498}
      />
    );
    const panel = container.querySelector('[data-testid="stats-panel"]')!;
    // ↓ = tokensIn + cacheRead = 91000 + 29000000 = 29.1M
    expect(panel.textContent).toContain("↓29.1M");
    expect(panel.textContent).toContain("↑4.2k");
  });

  it("shows cache R/W values in stats panel", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        tokensIn={1000}
        tokensOut={500}
        cacheRead={29000000}
        cacheWrite={445000}
        cost={0.05}
      />
    );
    const panel = container.querySelector('[data-testid="stats-panel"]')!;
    expect(panel.textContent).toContain("R29.0M");
    expect(panel.textContent).toContain("W445.0k");
  });

  it("hides cache R/W when zero", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn({ cacheRead: 0, cacheWrite: 0 })]}
        tokensIn={1000}
        tokensOut={500}
        cacheRead={0}
        cacheWrite={0}
        cost={0}
      />
    );
    const panel = container.querySelector('[data-testid="stats-panel"]')!;
    expect(panel.textContent).not.toContain("R");
    expect(panel.textContent).not.toContain("W");
  });

  it("shows cost in stats panel", () => {
    const { container } = render(
      <TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} cost={19.498} />
    );
    const panel = container.querySelector('[data-testid="stats-panel"]')!;
    expect(panel.textContent).toContain("$19.50");
  });

  it("hides chart when no turns", () => {
    const { container } = render(
      <TokenStatsBar turnStats={[]} tokensIn={0} tokensOut={0} cacheRead={0} cacheWrite={0} cost={0} />
    );
    expect(container.querySelector('[data-testid="butterfly-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="stats-panel"]')).toBeNull();
  });

  it("calls onTurnClick with correct turnIndex when bar is clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn({ turnIndex: 3 }), makeTurn({ turnIndex: 7 })]}
        {...defaultProps}
        onTurnClick={onClick}
      />
    );
    const chart = container.querySelector('[data-testid="butterfly-chart"]');
    const bars = chart?.children;
    expect(bars!.length).toBe(2);
    fireEvent.click(bars![1] as HTMLElement);
    expect(onClick).toHaveBeenCalledWith(7);
  });

  it("does not set cursor-pointer on bars without a user message (turnIndex -1)", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn({ turnIndex: -1 })]} 
        {...defaultProps}
        onTurnClick={() => {}}
      />
    );
    const chart = container.querySelector('[data-testid="butterfly-chart"]');
    const bar = chart?.firstElementChild;
    expect(bar?.className).not.toContain("cursor-pointer");
  });

  it("sets cursor-pointer on bars when onTurnClick is provided", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        {...defaultProps}
        onTurnClick={() => {}}
      />
    );
    const chart = container.querySelector('[data-testid="butterfly-chart"]');
    const bar = chart?.firstElementChild;
    expect(bar?.className).toContain("cursor-pointer");
  });

  it("does not set cursor-pointer when onTurnClick is absent", () => {
    const { container } = render(
      <TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} />
    );
    const chart = container.querySelector('[data-testid="butterfly-chart"]');
    const bar = chart?.firstElementChild;
    expect(bar?.className).not.toContain("cursor-pointer");
  });

  it("hides stats sections when showStats is false", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        contextUsage={{ tokens: 50000, contextWindow: 200000 }}
        {...defaultProps}
        showStats={false}
      />
    );
    expect(container.querySelector('[data-testid="butterfly-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="stats-panel"]')).toBeNull();
    // context bar still present
    expect(container.querySelector('[data-testid="context-bar"]')).not.toBeNull();
  });

  it("hides context bar when showContextBar is false", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        contextUsage={{ tokens: 50000, contextWindow: 200000 }}
        {...defaultProps}
        showContextBar={false}
      />
    );
    expect(container.querySelector('[data-testid="context-bar"]')).toBeNull();
    // stats still present
    expect(container.querySelector('[data-testid="butterfly-chart"]')).not.toBeNull();
  });

  it("renders only the context bar when showStats is false but showContextBar is true", () => {
    const { container } = render(
      <TokenStatsBar
        turnStats={[makeTurn()]}
        contextUsage={{ tokens: 50000, contextWindow: 200000 }}
        {...defaultProps}
        showStats={false}
        showContextBar={true}
      />
    );
    expect(container.querySelector('[data-testid="butterfly-chart"]')).toBeNull();
    expect(container.querySelector('[data-testid="stats-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="context-bar"]')).not.toBeNull();
  });
});
