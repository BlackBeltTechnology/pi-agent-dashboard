/**
 * AutomationBoard tests: definition cards (trigger summary, enabled state),
 * per-row actions by validity, recent-runs table + archived filter, and
 * delete-with-confirmation wired to the DELETE route. api mocked.
 *
 * See change: add-automation-plugin, redesign-automation-editor-and-board.
 */
import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import type { AutomationConfig, DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";
import { encodeFolderPath } from "../client/folder-encoding.js";

const nightlyConfig: AutomationConfig = {
  on: { kind: "schedule", cron: "0 9 * * 1" },
  action: { kind: "prompt", prompt: "./prompt.md" },
  model: "@fast",
  mode: "local",
  sandbox: "workspace-write",
  concurrency: "skip",
};

const automations: DiscoveredAutomation[] = [
  { name: "nightly", scope: "folder", dir: "/r/.pi/automation/nightly", valid: true, config: nightlyConfig },
  { name: "broken", scope: "folder", dir: "/r/.pi/automation/broken", valid: false, error: "bad kind" },
];
const runs: RunRecord[] = [
  { runId: "2026-06-19-nightly", name: "nightly", status: "done", dir: "/d1", startedAt: 1 },
  { runId: "2026-06-20-nightly", name: "nightly", status: "done", dir: "/d2", startedAt: 2, archived: true },
];

const { deleteAutomation } = vi.hoisted(() => ({ deleteAutomation: vi.fn(async () => true) }));

vi.mock("../client/api.js", () => ({
  listAutomations: vi.fn(async () => automations),
  listRuns: vi.fn(async (scope: string) => (scope === "folder" ? runs : [])),
  getRunResult: vi.fn(async () => "findings here"),
  createAutomation: vi.fn(async () => ({ ok: true })),
  updateAutomation: vi.fn(async () => ({ ok: true })),
  deleteAutomation,
  runAutomationNow: vi.fn(async () => ({ ok: true })),
  getAutomationDefinition: vi.fn(async () => ({ config: nightlyConfig, promptBody: "x" })),
  listTriggerKinds: vi.fn(async () => []),
  isGitCapable: vi.fn(async () => false),
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

  it("renders definition cards with trigger summary + enabled state", async () => {
    const { getByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    expect(getByTestId("automation-summary-nightly").textContent).toContain("schedule: 0 9 * * 1");
    expect(getByTestId("automation-enabled-nightly").textContent).toBe("enabled");
  });

  it("shows full actions for valid cards and only Edit/Delete for invalid", async () => {
    const { getByTestId, queryByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    // valid → run/toggle/edit/delete
    expect(getByTestId("run-now-nightly")).toBeTruthy();
    expect(getByTestId("toggle-nightly")).toBeTruthy();
    expect(getByTestId("edit-nightly")).toBeTruthy();
    expect(getByTestId("delete-nightly")).toBeTruthy();
    // invalid → only edit/delete
    expect(queryByTestId("run-now-broken")).toBeNull();
    expect(queryByTestId("toggle-broken")).toBeNull();
    expect(getByTestId("edit-broken")).toBeTruthy();
    expect(getByTestId("delete-broken")).toBeTruthy();
    expect(getByTestId("automation-error-broken").textContent).toContain("bad kind");
  });

  it("recent-runs table renders rows with a result link; archived filter preserved", async () => {
    const { getByTestId, queryByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("automation-run-2026-06-19-nightly")).toBeTruthy());
    expect(getByTestId("run-result-2026-06-19-nightly")).toBeTruthy();
    expect(queryByTestId("automation-run-2026-06-20-nightly")).toBeNull();
    fireEvent.click(getByTestId("automation-show-all"));
    await waitFor(() => expect(getByTestId("automation-run-2026-06-20-nightly")).toBeTruthy());
  });

  it("delete requires confirmation and calls the DELETE route with scope+name", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { getByTestId } = render(<AutomationBoard params={params} />);
    await waitFor(() => expect(getByTestId("delete-nightly")).toBeTruthy());

    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(getByTestId("delete-nightly"));
    expect(deleteAutomation).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(getByTestId("delete-nightly"));
    await waitFor(() => expect(deleteAutomation).toHaveBeenCalledWith("folder", "/r", "nightly"));
    confirmSpy.mockRestore();
  });
});
