/**
 * AutomationBoard tests: definition cards (trigger summary, enabled state),
 * per-row actions by validity, recent-runs table + archived filter, and
 * delete-with-confirmation wired to the DELETE route. api mocked.
 *
 * See change: add-automation-plugin, redesign-automation-editor-and-board.
 */

import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeFolderPath } from "../client/folder-encoding.js";
import type { AutomationConfig, DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";

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
  { runId: "2026-06-19-nightly", name: "nightly", status: "done", dir: "/d1", startedAt: 2, findings: 3 },
  { runId: "2026-06-20-nightly", name: "nightly", status: "done", dir: "/d2", startedAt: 1, archived: true, findings: 0 },
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
  stopAutomationRun: vi.fn(async () => ({ ok: true })),
  getAutomationDefinition: vi.fn(async () => ({ config: nightlyConfig, promptBody: "x" })),
  listTriggerKinds: vi.fn(async () => []),
  isGitCapable: vi.fn(async () => false),
}));

import { AutomationBoard } from "../client/AutomationBoard.js";
import { listAutomations, listRuns as listRunsMock } from "../client/api.js";

// The overflow menu renders through the `ui:popover` primitive (body portal).
// Provide the real Popover so its content mounts + dismisses like production;
// menu content lands in document.body, so query it via `screen`, not the
// container-scoped queries returned by render().
function renderBoard(props: React.ComponentProps<typeof AutomationBoard>) {
  return render(
    withUiPrimitiveProvider({ [UI_PRIMITIVE_KEYS.popover]: Popover }, <AutomationBoard {...props} />),
  );
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  // Reset the default impl so a per-test mockImplementation override (Stop
  // test) does not leak into later tests.
  vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? runs : []));
});

const params = { encodedCwd: encodeFolderPath("/r") };

describe("AutomationBoard", () => {
  it("mounts via the shell-overlay route and scopes to the decoded cwd", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-board")).toBeTruthy());
    expect(vi.mocked(listAutomations)).toHaveBeenCalledWith("/r");
  });

  it("rejects an undecodable encodedCwd instead of running unscoped queries", async () => {
    const { getByTestId } = renderBoard({ params: { encodedCwd: "!!!not-base64!!!" } });
    await waitFor(() => expect(getByTestId("automation-board-invalid")).toBeTruthy());
    expect(vi.mocked(listAutomations)).not.toHaveBeenCalled();
  });

  it("renders a Back action wired to onBack", async () => {
    const onBack = vi.fn();
    const { getByTestId } = renderBoard({ params, onBack });
    fireEvent.click(getByTestId("automation-board-back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders definition cards with trigger summary + enabled state", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    expect(getByTestId("automation-summary-nightly").textContent).toContain("schedule: 0 9 * * 1");
    expect(getByTestId("automation-enabled-nightly").textContent).toBe("enabled");
  });

  it("shows full actions for valid cards and only Edit/Delete (under overflow) for invalid", async () => {
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    // valid → run/toggle direct; edit/delete under the ⋯ overflow. Run-now
    // carries the stable `automation-run-now` testid, scoped per card row.
    expect(within(getByTestId("automation-def-nightly")).getByTestId("automation-run-now")).toBeTruthy();
    expect(getByTestId("toggle-nightly")).toBeTruthy();
    expect(queryByTestId("edit-nightly")).toBeNull();
    fireEvent.click(getByTestId("overflow-nightly"));
    expect(screen.getByTestId("edit-nightly")).toBeTruthy();
    expect(screen.getByTestId("delete-nightly")).toBeTruthy();
    // invalid → no run/toggle; only edit/delete under overflow
    expect(within(getByTestId("automation-def-broken")).queryByTestId("automation-run-now")).toBeNull();
    expect(queryByTestId("toggle-broken")).toBeNull();
    fireEvent.click(getByTestId("overflow-broken"));
    expect(screen.getByTestId("edit-broken")).toBeTruthy();
    expect(screen.getByTestId("delete-broken")).toBeTruthy();
    expect(getByTestId("automation-error-broken").textContent).toContain("bad kind");
  });

  it("the row's run-now control fires a run-now via the API", async () => {
    const { runAutomationNow } = await import("../client/api.js");
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    const row = getByTestId("automation-def-nightly");
    expect(row.className).toContain("auto-row");
    const btn = within(row).getByTestId("automation-run-now") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(runAutomationNow).toHaveBeenCalledWith("folder", "/r", "nightly"));
  });

  it("applies session-card visuals: rail, status dot, headless icon, status pill", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    // enabled (valid, not disabled, not running) → green palette
    expect(getByTestId("automation-rail-nightly").className).toContain("bg-green-500/40");
    expect(getByTestId("automation-dot-nightly").className).toContain("bg-green-500");
    expect(getByTestId("automation-source-icon-nightly")).toBeTruthy();
    expect(getByTestId("automation-enabled-nightly").textContent).toBe("enabled");
    // invalid → red palette
    expect(getByTestId("automation-rail-broken").className).toContain("bg-red-500/40");
    expect(getByTestId("automation-enabled-broken").textContent).toBe("invalid");
  });

  it("shows mode meta on the card and the repo crumb in the header", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-mode-nightly")).toBeTruthy());
    expect(getByTestId("automation-mode-nightly").textContent).toContain("local");
    expect(getByTestId("automation-repo-crumb").textContent).toBe("r");
  });

  it("renders a per-card last-run summary with findings + result link", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-last-run-nightly")).toBeTruthy());
    const text = getByTestId("automation-last-run-nightly").textContent ?? "";
    expect(text).toContain("done");
    expect(text).toContain("3 findings");
    expect(getByTestId("last-run-link-nightly").textContent).toContain("result");
  });

  it("shows Stop (not Run now) for a running automation and calls /stop", async () => {
    const { stopAutomationRun } = await import("../client/api.js");
    const runningRuns: RunRecord[] = [
      { runId: "2026-06-21-nightly", name: "nightly", status: "running", dir: "/d3", startedAt: 3 },
    ];
    const api = await import("../client/api.js");
    vi.mocked(api.listRuns).mockImplementation(async (scope: string) => (scope === "folder" ? runningRuns : []));
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
    expect(within(getByTestId("automation-def-nightly")).queryByTestId("automation-run-now")).toBeNull();
    fireEvent.click(getByTestId("stop-nightly"));
    await waitFor(() => expect(stopAutomationRun).toHaveBeenCalledWith("folder", "/r", "2026-06-21-nightly"));
  });

  it("runs table shows findings + status-specific link", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("run-findings-2026-06-19-nightly")).toBeTruthy());
    expect(getByTestId("run-findings-2026-06-19-nightly").textContent).toContain("3 findings");
    expect(getByTestId("run-result-2026-06-19-nightly").textContent).toContain("result");
  });

  it("recent-runs table renders rows with a result link; archived filter preserved", async () => {
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-run-2026-06-19-nightly")).toBeTruthy());
    expect(getByTestId("run-result-2026-06-19-nightly")).toBeTruthy();
    expect(queryByTestId("automation-run-2026-06-20-nightly")).toBeNull();
    fireEvent.click(getByTestId("automation-show-all"));
    await waitFor(() => expect(getByTestId("automation-run-2026-06-20-nightly")).toBeTruthy());
  });

  it("delete requires confirmation and calls the DELETE route with scope+name", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("overflow-nightly")).toBeTruthy());

    fireEvent.click(getByTestId("overflow-nightly"));
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId("delete-nightly"));
    expect(deleteAutomation).not.toHaveBeenCalled();

    fireEvent.click(getByTestId("overflow-nightly"));
    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId("delete-nightly"));
    await waitFor(() => expect(deleteAutomation).toHaveBeenCalledWith("folder", "/r", "nightly"));
    confirmSpy.mockRestore();
  });

  it("renders the overflow menu in a body portal (escapes the card's overflow-hidden clip)", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("overflow-nightly")).toBeTruthy());
    fireEvent.click(getByTestId("overflow-nightly"));
    // Menu + items land in the popover primitive's body portal, not inside
    // the clipped card <li>.
    const menu = screen.getByTestId("overflow-menu-nightly");
    expect(menu).toBeTruthy();
    expect(document.body.contains(menu)).toBe(true);
    const card = getByTestId("automation-def-nightly");
    expect(card.contains(menu)).toBe(false);
    expect(screen.getByTestId("edit-nightly")).toBeTruthy();
    expect(screen.getByTestId("delete-nightly")).toBeTruthy();
  });

  it("dismisses the overflow menu on outside click and Esc without invoking Edit/Delete", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("overflow-nightly")).toBeTruthy());

    // Outside mousedown closes the menu.
    fireEvent.click(getByTestId("overflow-nightly"));
    expect(screen.getByTestId("overflow-menu-nightly")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByTestId("overflow-menu-nightly")).toBeNull());

    // Esc closes the menu.
    fireEvent.click(getByTestId("overflow-nightly"));
    expect(screen.getByTestId("overflow-menu-nightly")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("overflow-menu-nightly")).toBeNull());

    // Neither dismissal fired the destructive action.
    expect(deleteAutomation).not.toHaveBeenCalled();
  });
});

// ── Fan-out: parent occurrence discloses its children ───────────────────────
// See change: add-automation-concurrent-spawn.
describe("AutomationBoard fan-out", () => {
  const parentWithChildren: RunRecord = {
    runId: "2026-07-01-fan",
    name: "nightly",
    status: "done",
    dir: "/p",
    startedAt: 10,
    findings: 7,
    warning: "bounded to 4 concurrent spawn(s); 6 child(ren) not spawned",
    children: ["c0", "c1", "c2"],
    childRuns: [
      { runId: "c0", name: "nightly", status: "done", dir: "/p/c0", startedAt: 10, findings: 2, actionLabel: "flows.run:A", parentRunId: "2026-07-01-fan", sessionId: "s0" },
      { runId: "c1", name: "nightly", status: "error", dir: "/p/c1", startedAt: 10, findings: 0, actionLabel: "core.skill:B", parentRunId: "2026-07-01-fan", sessionId: "s1" },
      { runId: "c2", name: "nightly", status: "done", dir: "/p/c2", startedAt: 10, findings: 5, actionLabel: "flows.run:C", parentRunId: "2026-07-01-fan", sessionId: "s2" },
    ],
  };

  beforeEach(() => {
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) =>
      scope === "folder" ? [parentWithChildren] : [],
    );
  });

  it("F1: renders a parent row that expands to its child rows", async () => {
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-run-2026-07-01-fan")).toBeTruthy());
    // Aggregate findings on the parent.
    expect(getByTestId("run-findings-2026-07-01-fan").textContent).toContain("7");
    // Children hidden until expanded (occurrence is one unit).
    expect(queryByTestId("automation-child-run-c0")).toBeNull();
    fireEvent.click(getByTestId("run-expand-2026-07-01-fan"));
    await waitFor(() => expect(getByTestId("automation-child-run-c0")).toBeTruthy());
    // Each child row shows its own action label + status + findings.
    expect(getByTestId("child-action-c0").textContent).toContain("flows.run:A");
    expect(getByTestId("child-action-c1").textContent).toContain("core.skill:B");
    expect(getByTestId("child-findings-c2").textContent).toContain("5");
    expect(getByTestId("child-result-c1")).toBeTruthy();
  });

  it("F2: surfaces the truncation warning on the parent row", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("run-warning-2026-07-01-fan")).toBeTruthy());
    expect(getByTestId("run-warning-2026-07-01-fan").textContent).toContain("6");
  });

  it("F3: a child never renders as an independent top-level run row", async () => {
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-run-2026-07-01-fan")).toBeTruthy());
    // Children are not top-level run rows (the occurrence is one unit).
    expect(queryByTestId("automation-run-c0")).toBeNull();
    expect(queryByTestId("automation-run-c1")).toBeNull();
  });
});
