/**
 * AutomationBoard / Triage tests: empty-runs (archived) filter + definitions
 * list. The api module is mocked. See change: add-automation-plugin.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";
import { encodeFolderPath } from "../client/folder-encoding.js";

const automations: DiscoveredAutomation[] = [
  { name: "nightly", scope: "folder", dir: "/r/.pi/automation/nightly", valid: true },
  { name: "broken", scope: "folder", dir: "/r/.pi/automation/broken", valid: false, error: "bad kind" },
];
const runs: RunRecord[] = [
  { runId: "2026-06-19-nightly", name: "nightly", status: "done", dir: "/d1", startedAt: 1 },
  { runId: "2026-06-20-nightly", name: "nightly", status: "done", dir: "/d2", startedAt: 2, archived: true },
];

vi.mock("../client/api.js", () => ({
  listAutomations: vi.fn(async () => automations),
  listRuns: vi.fn(async (scope: string) => (scope === "folder" ? runs : [])),
  getRunResult: vi.fn(async () => null),
  createAutomation: vi.fn(async () => ({ ok: true })),
}));

import { listAutomations } from "../client/api.js";
import { AutomationBoard } from "../client/AutomationBoard.js";

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const params = { encodedCwd: encodeFolderPath("/r") };

describe("AutomationBoard", () => {
  it("mounts via the shell-overlay route and scopes to the decoded cwd", async () => {
    const { getByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("automation-board")).toBeTruthy());
    expect(vi.mocked(listAutomations)).toHaveBeenCalledWith("/r");
  });

  it("rejects an undecodable encodedCwd instead of running unscoped queries", async () => {
    const { getByTestId } = render(<AutomationBoard params={{ encodedCwd: "!!!not-base64!!!" }} />);
    await waitFor(() => expect(getByTestId("automation-board-invalid")).toBeTruthy());
    expect(vi.mocked(listAutomations)).not.toHaveBeenCalled();
  });

  it("renders a Back action wired to onBack", async () => {
    const onBack = vi.fn();
    const { getByTestId } = render(<AutomationBoard params={params} onBack={onBack} />);
    fireEvent.click(getByTestId("automation-board-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("lists definitions incl. invalid markers", async () => {
    const { getByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    expect(getByTestId("automation-def-broken").textContent).toContain("invalid");
  });

  it("hides archived runs by default and reveals them with the toggle", async () => {
    const { getByTestId, queryByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("automation-run-2026-06-19-nightly")).toBeTruthy());
    // Archived run hidden by default.
    expect(queryByTestId("automation-run-2026-06-20-nightly")).toBeNull();
    // Toggle "Show archived".
    fireEvent.click(getByTestId("automation-show-all"));
    await waitFor(() => expect(getByTestId("automation-run-2026-06-20-nightly")).toBeTruthy());
  });
});
