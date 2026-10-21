/**
 * Flow badge paints `--accent-<hue>-text` per status; Abort is a red tint triple.
 * See change: fix-folder-card-pill-contrast (test-plan #E6).
 */
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FlowActivityBadge } from "../FlowActivityBadge.js";

afterEach(() => cleanup());

const CASES = [
  ["running", "blue"],
  ["success", "green"],
  ["error", "red"],
  ["aborted", "orange"],
] as const;

describe("FlowActivityBadge colour roles", () => {
  for (const [status, hue] of CASES) {
    it(`${status} paints --accent-${hue}-text`, () => {
      const { container } = render(
        <FlowActivityBadge flowName="f" status={status} agentsDone={1} agentsTotal={3} onAbort={() => {}} />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain(`text-[var(--accent-${hue}-text)]`);
      expect(root.className).not.toMatch(/-(blue|green|red|orange)-\d{3}/);
    });
  }

  it("Abort uses the --tint-red triple at 12px", () => {
    render(<FlowActivityBadge flowName="f" status="running" agentsDone={1} agentsTotal={3} onAbort={() => {}} />);
    const abort = screen.getByTitle("Abort running flow");
    expect(abort.className).toContain("text-[var(--tint-red-fg)]");
    expect(abort.className).toContain("bg-[var(--tint-red-bg)]");
    expect(abort.className).toContain("border-[var(--tint-red-border)]");
    expect(abort.className).toContain("text-[12px]");
    expect(abort.className).not.toMatch(/-red-\d{3}/);
  });
});
