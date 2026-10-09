/**
 * AutomationRunMonitor render: live status while running, result.md on end.
 * api + markdown primitive mocked. See change: add-automation-plugin.
 */

import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../client/api.js", () => ({
  getRunResult: vi.fn(async () => "Found 1 regression."),
  getRunBySessionId: vi.fn(async () => ({ status: "done", runId: "r1", name: "nightly", result: "# findings" })),
}));

import { AutomationRunMonitor } from "../client/AutomationRunMonitor.js";
import { getRunBySessionId } from "../client/api.js";
import { encodeFolderPath } from "../client/folder-encoding.js";

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

  // test-plan #F3: a resident running session keeps today's behaviour.
  it("a resident running session shows the live hint and no archived link", () => {
    const { getByTestId, queryByTestId } = wrap(
      <AutomationRunMonitor session={run("active")} params={{ sid: "run-sess", encodedCwd: encodeFolderPath("/r") }} />,
    );
    expect(getByTestId("run-live-hint")).toBeTruthy();
    expect(queryByTestId("run-archived-transcript")).toBeNull();
    expect(vi.mocked(getRunBySessionId)).not.toHaveBeenCalled();
  });

  // test-plan #F2: the run session was archived (not resident) → resolve the
  // run from the run store by session id. See change: archive-service-sessions-on-end.
  it("an archived (non-resident) run session renders the run-store status, result and an archived transcript link", async () => {
    const { getByTestId, queryByTestId } = wrap(
      <AutomationRunMonitor params={{ sid: "run-sess", encodedCwd: encodeFolderPath("/r") }} />,
    );
    await waitFor(() => expect(getByTestId("md").textContent).toBe("# findings"));
    expect(vi.mocked(getRunBySessionId)).toHaveBeenCalledWith("/r", "run-sess");
    expect(getByTestId("run-status").textContent).toBe("done");
    expect(queryByTestId("run-live-hint")).toBeNull();
    const link = getByTestId("run-archived-transcript") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/session/run-sess?archived=1");
  });
});
