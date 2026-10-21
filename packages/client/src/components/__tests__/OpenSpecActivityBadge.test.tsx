/**
 * Phase badge paints the theme `--accent-<hue>-text` ramp, never palette classes.
 * See change: fix-folder-card-pill-contrast (test-plan #E4).
 */
import type { OpenSpecPhase } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { OpenSpecActivityBadge } from "../openspec/OpenSpecActivityBadge.js";

afterEach(() => cleanup());

const EXPECTED: Record<OpenSpecPhase, string> = {
  explore: "blue",
  continue: "blue",
  ff: "blue",
  new: "purple",
  "sync-specs": "purple",
  onboard: "purple",
  apply: "yellow",
  verify: "green",
  archive: "green",
};

describe("OpenSpecActivityBadge colour roles", () => {
  for (const [phase, hue] of Object.entries(EXPECTED) as [OpenSpecPhase, string][]) {
    it(`${phase} paints --accent-${hue}-text`, () => {
      const { container } = render(
        <OpenSpecActivityBadge phase={phase} changeName="c" completedTasks={4} totalTasks={12} />,
      );
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).toContain(`text-[var(--accent-${hue}-text)]`);
      expect(root.className).not.toMatch(/text-(blue|purple|cyan|yellow|green|emerald|teal|indigo)-\d{3}/);
    });
  }

  it("task count uses --text-secondary and no --text-muted anywhere", () => {
    const { container } = render(
      <OpenSpecActivityBadge phase="apply" changeName="c" completedTasks={4} totalTasks={12} />,
    );
    const count = Array.from(container.querySelectorAll("span")).find((s) => s.children.length === 0 && s.textContent?.includes("(4/12)"));
    expect(count?.className).toContain("text-[var(--text-secondary)]");
    expect(container.innerHTML).not.toContain("--text-muted");
    expect(container.innerHTML).not.toContain("--text-tertiary");
  });
});
