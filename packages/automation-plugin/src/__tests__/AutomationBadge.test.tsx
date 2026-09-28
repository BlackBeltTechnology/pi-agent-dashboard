/**
 * AutomationBadge render matrix. See change: add-automation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AutomationBadge } from "../client/AutomationBadge.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(cleanup);

const base = (p: Partial<DashboardSession>): DashboardSession =>
  ({ id: "s", cwd: "/r", source: "dashboard", status: "running", startedAt: 0, ...p }) as DashboardSession;

describe("AutomationBadge", () => {
  it("renders nothing for a non-automation session", () => {
    const { queryByTestId } = render(<AutomationBadge session={base({})} />);
    expect(queryByTestId("automation-badge")).toBeNull();
  });

  it("renders the automation name for a run session", () => {
    const { getByTestId } = render(
      <AutomationBadge session={base({ kind: "automation", automationRun: { name: "nightly", runId: "r1" } })} />,
    );
    expect(getByTestId("automation-badge").textContent).toContain("nightly");
  });

  it("#E6 renders the fallback label for a legacy run with no run identity", () => {
    // A sidecar whose `kind` survived but whose `automationRun` was permanently
    // lost (pre-fix wipe) must still render an automation badge, not nothing.
    const { getByTestId } = render(<AutomationBadge session={base({ kind: "automation" })} />);
    const label = getByTestId("automation-badge").textContent ?? "";
    expect(label).toContain("automation");
    expect(label).not.toContain("nightly");
  });
});
