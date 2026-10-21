import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { TurnStat } from "../../lib/chat/event-reducer.js";
import { ContextRing } from "../session/ContextRing.js";
import { TokenStatsBar } from "../session/TokenStatsBar.js";

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

  // E18 (test-plan): the context bar left the content header; the ring owns it.
  // See change: reorganize-session-header.
  it("E18 never renders a context progress bar; the turn chart follows showStats", () => {
    const on = render(<TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} showStats />);
    expect(on.container.querySelector('[data-testid="context-bar"]')).toBeNull();
    expect(on.container.querySelector('[data-testid="butterfly-chart"]')).not.toBeNull();
    on.unmount();
    const off = render(<TokenStatsBar turnStats={[makeTurn()]} {...defaultProps} showStats={false} />);
    expect(off.container.querySelector('[data-testid="context-bar"]')).toBeNull();
    expect(off.container.querySelector('[data-testid="butterfly-chart"]')).toBeNull();
    expect(off.container.querySelector('[data-testid="stats-panel"]')).toBeNull();
  });
});

describe("ContextRing", () => {
  // E1 (test-plan): arc tier by the ROUNDED percentage.
  it.each([
    [30, "neutral", "var(--text-secondary)"],
    [31, "blue", "var(--accent-blue-text)"],
    [50, "blue", "var(--accent-blue-text)"],
    [51, "green", "var(--accent-green-text)"],
    [70, "green", "var(--accent-green-text)"],
    [71, "orange", "var(--accent-orange-text)"],
    [90, "orange", "var(--accent-orange-text)"],
    [91, "red", "var(--accent-red-text)"],
  ])("E1 %i%% uses the %s arc", (pct, tier, stroke) => {
    const { getByTestId } = render(<ContextRing usage={{ tokens: pct * 1000, contextWindow: 100_000 }} />);
    const arc = getByTestId("context-ring-arc");
    expect(arc.getAttribute("data-tier")).toBe(tier);
    expect(arc.getAttribute("stroke")).toBe(stroke);
  });

  it("E1 rounds before choosing the tier (30.4% is neutral, 30.5% is blue)", () => {
    const a = render(<ContextRing usage={{ tokens: 30_400, contextWindow: 100_000 }} />);
    expect(a.getByTestId("context-ring-arc").getAttribute("data-tier")).toBe("neutral");
    a.unmount();
    const b = render(<ContextRing usage={{ tokens: 30_500, contextWindow: 100_000 }} />);
    expect(b.getByTestId("context-ring-arc").getAttribute("data-tier")).toBe("blue");
  });

  it("E2 shows % text, meter value and token tooltip", () => {
    const { getByRole } = render(<ContextRing usage={{ tokens: 127_000, contextWindow: 1_000_000 }} />);
    const meter = getByRole("meter");
    expect(meter.textContent).toBe("13%");
    expect(meter.getAttribute("aria-valuenow")).toBe("13");
    expect(meter.getAttribute("aria-valuemax")).toBe("100");
    expect(meter.getAttribute("title")).toBe("127.0k of 1.0M tokens");
  });

  it("E2 caps at 100% over the window; the tooltip keeps the real count; arc is red", () => {
    const { getByRole, getByTestId } = render(<ContextRing usage={{ tokens: 1_020_000, contextWindow: 1_000_000 }} />);
    const meter = getByRole("meter");
    expect(meter.textContent).toBe("100%");
    expect(meter.getAttribute("aria-valuenow")).toBe("100");
    expect(meter.getAttribute("title")).toBe("1.02M of 1.0M tokens");
    expect(getByTestId("context-ring-arc").getAttribute("data-tier")).toBe("red");
  });

  it.each([
    ["usage undefined", undefined],
    ["window 0", { tokens: 100, contextWindow: 0 }],
    ["tokens null", { tokens: null, contextWindow: 200_000 }],
  ])("E3 renders nothing when %s", (_label, usage) => {
    const { queryByRole, container } = render(<ContextRing usage={usage} />);
    expect(queryByRole("meter")).toBeNull();
    expect(container.firstChild).toBeNull();
  });
});
