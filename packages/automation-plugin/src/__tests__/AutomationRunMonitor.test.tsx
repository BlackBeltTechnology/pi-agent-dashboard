/**
 * AutomationRunMonitor render: live status while running, result.md on end.
 * api + markdown primitive mocked. See change: add-automation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

vi.mock("../client/api.js", () => ({
  getRunResult: vi.fn(async () => "Found 1 regression."),
}));

import { AutomationRunMonitor } from "../client/AutomationRunMonitor.js";

const MockMarkdown: React.FC<{ content: string }> = ({ content }) => <div data-testid="md">{content}</div>;
const wrap = (ui: React.ReactElement) => render(withUiPrimitiveProvider({ "ui:markdown-content": MockMarkdown }, ui));

afterEach(cleanup);

const run = (status: DashboardSession["status"]): DashboardSession =>
  ({
    id: "run-sess",
    cwd: "/r",
    source: "dashboard",
    status,
    startedAt: 0,
    kind: "automation",
    automationRun: { name: "nightly", runId: "2026-06-19-nightly" },
  }) as DashboardSession;

describe("AutomationRunMonitor", () => {
  it("shows running status + live hint while the run is active", () => {
    const { getByTestId } = wrap(<AutomationRunMonitor session={run("active")} />);
    expect(getByTestId("run-status").textContent).toBe("running");
    expect(getByTestId("run-live-hint")).toBeTruthy();
  });

  it("renders captured result.md once the run has ended", async () => {
    const { getByTestId } = wrap(<AutomationRunMonitor session={run("ended")} />);
    expect(getByTestId("run-status").textContent).toBe("completed");
    await waitFor(() => expect(getByTestId("md").textContent).toContain("Found 1 regression"));
  });
});
