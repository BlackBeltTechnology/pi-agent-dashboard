/**
 * AutomationBoard tests: definition cards (trigger summary, enabled state),
 * per-row actions by validity, recent-runs table + archived filter, and
 * delete-with-confirmation wired to the DELETE route. api mocked.
 *
 * See change: add-automation-plugin, redesign-automation-editor-and-board.
 */

import { encodeFolderPath } from "@blackbelt-technology/dashboard-plugin-runtime/sdk";
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  listActions: vi.fn(async () => []),
}));

import { AutomationBoard } from "../client/AutomationBoard.js";
import { listAutomations, listRuns as listRunsMock } from "../client/api.js";

// Result / Log render as markdown inside `ui:dialog` (polish-automation-board D7).
function MockMarkdown({ content }: { content: string }) {
  return <div data-testid="mock-markdown">{content}</div>;
}

// The overflow menu renders through the `ui:popover` primitive (body portal).
// Provide the real Popover so its content mounts + dismisses like production;
// menu content lands in document.body, so query it via `screen`, not the
// container-scoped queries returned by render().
function renderBoard(props: React.ComponentProps<typeof AutomationBoard>) {
  return render(
    withUiPrimitiveProvider(
      {
        [UI_PRIMITIVE_KEYS.popover]: Popover,
        [UI_PRIMITIVE_KEYS.dialog]: Dialog as never,
        [UI_PRIMITIVE_KEYS.markdownContent]: MockMarkdown as never,
        // The editor (opened by Edit / the name) needs these; stubs suffice here.
        [UI_PRIMITIVE_KEYS.modelSelector]: (() => null) as never,
        [UI_PRIMITIVE_KEYS.thinkingLevelSelector]: (() => null) as never,
      },
      <AutomationBoard cwd="/r" {...props} />,
    ),
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
    const { getByTestId } = renderBoard({ params: { encodedCwd: "!!!not-base64!!!" }, cwd: undefined });
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
    // Humanised schedule; the raw cron stays available on hover (polish-automation-board).
    expect(getByTestId("automation-summary-nightly").textContent).toContain("Mondays at 09:00");
    expect(getByTestId("automation-summary-nightly").getAttribute("title")).toBe("0 9 * * 1");
    expect(getByTestId("automation-enabled-nightly").textContent).toBe("enabled");
  });

  it("shows full actions for valid cards; Edit is a visible card button and only Delete sits under overflow", async () => {
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    // valid → run/toggle/edit direct; only delete under the ⋯ overflow (polish-automation-board E1)
    expect(getByTestId("run-now-nightly")).toBeTruthy();
    expect(getByTestId("toggle-nightly")).toBeTruthy();
    expect(getByTestId("automation-def-nightly").contains(getByTestId("edit-nightly"))).toBe(true);
    fireEvent.click(getByTestId("overflow-nightly"));
    expect(screen.getByTestId("overflow-menu-nightly").querySelector('[data-testid="edit-nightly"]')).toBe(null);
    expect(screen.getByTestId("delete-nightly")).toBeTruthy();
    // invalid → no run/toggle; Edit still visible, Delete under overflow
    expect(queryByTestId("run-now-broken")).toBeNull();
    expect(queryByTestId("toggle-broken")).toBeNull();
    fireEvent.click(getByTestId("overflow-broken"));
    expect(getByTestId("automation-def-broken").contains(getByTestId("edit-broken"))).toBe(true);
    expect(screen.getByTestId("delete-broken")).toBeTruthy();
    expect(getByTestId("automation-error-broken").textContent).toContain("bad kind");
  });

  it("applies session-card visuals: rail, status dot, headless icon, status pill", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-def-nightly")).toBeTruthy());
    // enabled (valid, not disabled, not running) → idle status token
    expect(getByTestId("automation-rail-nightly").className).toContain("bg-[var(--status-idle)]");
    expect(getByTestId("automation-dot-nightly").className).toContain("bg-[var(--status-idle)]");
    expect(getByTestId("automation-source-icon-nightly")).toBeTruthy();
    expect(getByTestId("automation-enabled-nightly").textContent).toBe("enabled");
    // invalid → error status token
    expect(getByTestId("automation-rail-broken").className).toContain("bg-[var(--status-error)]");
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
    expect(getByTestId("last-run-link-nightly").textContent).toContain("Result");
  });

  it("shows Stop (not Run now) for a running automation and calls /stop", async () => {
    const { stopAutomationRun } = await import("../client/api.js");
    const runningRuns: RunRecord[] = [
      { runId: "2026-06-21-nightly", name: "nightly", status: "running", dir: "/d3", startedAt: 3 },
    ];
    const api = await import("../client/api.js");
    vi.mocked(api.listRuns).mockImplementation(async (scope: string) => (scope === "folder" ? runningRuns : []));
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
    expect(queryByTestId("run-now-nightly")).toBeNull();
    fireEvent.click(getByTestId("stop-nightly"));
    await waitFor(() => expect(stopAutomationRun).toHaveBeenCalledWith("folder", "/r", "2026-06-21-nightly"));
  });

  it("runs table shows findings + status-specific link", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("run-findings-2026-06-19-nightly")).toBeTruthy());
    expect(getByTestId("run-findings-2026-06-19-nightly").textContent).toContain("3 findings");
    expect(getByTestId("run-result-2026-06-19-nightly").textContent).toContain("Result");
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
    expect(menu.contains(screen.getByTestId("edit-nightly"))).toBe(false);
    expect(menu.contains(screen.getByTestId("delete-nightly"))).toBe(true);
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
    warning: "bounded to 4 concurrent session(s); 6 child(ren) not started",
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

// ── polish-automation-board: per-automation history, links, orphan Stop ─────
// See change: polish-automation-board (design D7, D8, D10, D11).
describe("AutomationBoard run history + navigation", () => {
  const H = 3_600_000;
  const base = Date.now();
  const run = (runId: string, extra: Partial<RunRecord> = {}): RunRecord => ({
    runId, name: "nightly", status: "done", dir: `/d/${runId}`, startedAt: base - H, endedAt: base - H + 61_000, ...extra,
  });
  const api = async () => await import("../client/api.js");

  // test-plan #E17
  it("E17: same-named folder and global automations keep separate histories", async () => {
    const both: DiscoveredAutomation[] = [
      { name: "x", scope: "folder", dir: "/r/.pi/automation/x", valid: true, config: nightlyConfig },
      { name: "x", scope: "global", dir: "/h/.pi/automation/x", valid: true, config: nightlyConfig },
    ];
    vi.mocked(listAutomations).mockResolvedValueOnce(both);
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) =>
      scope === "folder"
        ? [run("f1", { name: "x", scope: "folder" }), run("f2", { name: "x", scope: "folder", startedAt: base - 2 * H })]
        : [run("g1", { name: "x", scope: "global" })],
    );
    const { container } = renderBoard({ params });
    await waitFor(() => expect(container.querySelectorAll('[data-testid^="automation-run-"]').length).toBe(3));
    const cards = container.querySelectorAll('[data-testid="automation-def-x"]');
    expect(cards).toHaveLength(2);
    const ids = (card: Element) => [...card.querySelectorAll('[data-testid^="automation-run-"]')].map((e) => e.getAttribute("data-testid"));
    expect(ids(cards[0]!)).toEqual(["automation-run-f1", "automation-run-f2"]);
    expect(ids(cards[1]!)).toEqual(["automation-run-g1"]);
  });

  // test-plan #E18
  it("E18: latest 3 by default, Show all reveals the rest, archived only with the toggle; chip only above 0", async () => {
    const five = [
      run("r1", { startedAt: base - 1 * H, findings: 0 }),
      run("r2", { startedAt: base - 2 * H, findings: 2 }),
      run("r3", { startedAt: base - 3 * H, findings: 0 }),
      run("r4", { startedAt: base - 4 * H, findings: 0 }),
      run("r5", { startedAt: base - 5 * H, findings: 0, archived: true }),
    ];
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? five : []));
    const { getByTestId, queryByTestId, container } = renderBoard({ params });
    const rows = () => container.querySelectorAll('[data-testid^="automation-run-"]').length;
    await waitFor(() => expect(rows()).toBe(3));
    expect(getByTestId("run-findings-r2").textContent).toBe("2 findings");
    expect(container.textContent).not.toContain("0 findings");
    expect(getByTestId("run-history-all-nightly").textContent).toBe("Show all (4)");
    fireEvent.click(getByTestId("run-history-all-nightly"));
    expect(rows()).toBe(4);
    expect(queryByTestId("automation-run-r5")).toBe(null);
    fireEvent.click(getByTestId("automation-show-all"));
    expect(getByTestId("automation-run-r5").textContent).toContain("archived");
  });

  // test-plan #E19
  it("E19: secondary link by status — Monitor, Monitor, Result, Result, Log; a parent expands instead", async () => {
    const rowsIn = [
      run("running", { status: "running", sessionId: "s-a", tracked: true, endedAt: undefined, startedAt: base - 1 * H }),
      run("orphan", { status: "running", sessionId: "s-b", orphaned: true, endedAt: undefined, startedAt: base - 2 * H }),
      run("done", { sessionId: "s-c", startedAt: base - 3 * H }),
      run("stopped", { status: "stopped", sessionId: "s-d", startedAt: base - 4 * H, error: "stopped by user" }),
      run("error", { status: "error", sessionId: "s-e", startedAt: base - 5 * H, error: "boom" }),
      run("parent", { startedAt: base - 6 * H, children: ["k"], childRuns: [run("k", { parentRunId: "parent", sessionId: "s-k" })] }),
    ];
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? rowsIn : []));
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("run-history-all-nightly")).toBeTruthy());
    fireEvent.click(getByTestId("run-history-all-nightly"));
    const link = (id: string) => getByTestId(`run-result-${id}`).textContent;
    expect([link("running"), link("orphan"), link("done"), link("stopped"), link("error")]).toEqual([
      "Monitor", "Monitor", "Result", "Result", "Log",
    ]);
    expect(queryByTestId("run-result-parent")).toBe(null);
    expect(getByTestId("run-expand-parent").getAttribute("aria-expanded")).toBe("false");
    expect(getByTestId("run-label-done").getAttribute("title")).toBe("done");
    expect(getByTestId("run-label-done").textContent).not.toContain("done");
  });

  it("Open session navigates to the live view only for a tracked running run, else the archived view; Monitor opens the run route", async () => {
    const rowsIn = [
      run("live", { status: "running", sessionId: "s-live", tracked: true, endedAt: undefined, startedAt: base - 1 * H }),
      run("old", { sessionId: "s-old", startedAt: base - 2 * H }),
    ];
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? rowsIn : []));
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("run-session-old")).toBeTruthy());
    fireEvent.click(getByTestId("run-session-old"));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/session/s-old?archived=1");
    fireEvent.click(getByTestId("run-session-live"));
    expect(`${window.location.pathname}${window.location.search}`).toBe("/session/s-live");
    fireEvent.click(getByTestId("run-result-live"));
    expect(window.location.pathname).toBe(`/folder/${encodeFolderPath("/r")}/automations/run/s-live`);
  });

  // task 5.10 — markdown in the ui:dialog primitive, never a raw <pre> panel.
  it("Result opens the run's result.md as markdown inside a dialog", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("run-result-2026-06-19-nightly")).toBeTruthy());
    fireEvent.click(getByTestId("run-result-2026-06-19-nightly"));
    await waitFor(() => expect(screen.getByTestId("mock-markdown").textContent).toBe("findings here"));
    const panel = screen.getByTestId("run-result-panel");
    expect(panel.closest('[role="dialog"]') ?? panel.querySelector('[role="dialog"]') ?? (panel.getAttribute("role") === "dialog" ? panel : null)).not.toBe(null);
    expect(document.querySelector("pre")).toBe(null);
  });

  // test-plan #E20
  it("E20: Edit is visible without the overflow; the name opens the editor; overflow holds only Delete", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("edit-nightly").textContent).toBe("Edit"));
    fireEvent.click(getByTestId("automation-name-nightly"));
    await waitFor(() => expect(screen.getByTestId("create-automation-dialog")).toBeTruthy());
    fireEvent.click(getByTestId("overflow-nightly"));
    const items = screen.getByTestId("overflow-menu-nightly").querySelectorAll("button");
    expect([...items].map((b) => b.getAttribute("data-testid"))).toEqual(["delete-nightly"]);
  });

  it("closing the editor returns focus to the control that opened it", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("edit-nightly")).toBeTruthy());
    const edit = getByTestId("edit-nightly");
    edit.focus();
    fireEvent.click(edit);
    const dialog = await waitFor(() => screen.getByTestId("create-automation-dialog"));
    const cancel = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!;
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByTestId("create-automation-dialog")).toBe(null));
    expect(document.activeElement).toBe(edit);
  });

  // test-plan #E22
  it("E22: an empty folder explains automations and offers + Create Automation", async () => {
    vi.mocked(listAutomations).mockResolvedValueOnce([]);
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-empty")).toBeTruthy());
    expect(getByTestId("automation-empty").textContent).toContain("runs a prompt, skill or flow");
    expect(getByTestId("automation-empty-create").textContent).toBe("+ Create Automation");
  });

  // test-plan #F7
  it("F7: the running stripe sits on the rail and the running pill, not the card root", async () => {
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) =>
      scope === "folder" ? [run("live", { status: "running", tracked: true, endedAt: undefined })] : [],
    );
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
    const card = getByTestId("automation-def-nightly");
    expect(getByTestId("automation-rail-nightly").contains(getByTestId("automation-rail-stripe-nightly"))).toBe(true);
    expect(getByTestId("automation-enabled-nightly").contains(getByTestId("automation-pill-stripe-nightly"))).toBe(true);
    const stripeParents = [...card.querySelectorAll(".card-stripes-fx")].map((el) => el.parentElement);
    expect(stripeParents.includes(card)).toBe(false);
    expect(card.className).not.toContain("card-stripes");
  });
});

describe("AutomationBoard orphaned run + honest Stop", () => {
  const orphan: RunRecord = {
    runId: "orph", name: "nightly", status: "running", dir: "/d/orph", startedAt: Date.now() - 600_000,
    sessionId: "s-orph", orphaned: true, tracked: false, sessionConnected: true, scope: "folder",
  };
  const stopped: RunRecord = { ...orphan, status: "stopped", orphaned: false, endedAt: Date.now(), error: "stopped by user" };

  beforeEach(() => {
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? [orphan] : []));
  });

  it("shows the orphaned pill and a notice naming connectivity, with a session link", async () => {
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-orphan-notice-nightly")).toBeTruthy());
    expect(getByTestId("automation-enabled-nightly").textContent).toBe("orphaned");
    expect(getByTestId("automation-orphan-notice-nightly").textContent).toContain("still connected");
    expect(getByTestId("orphan-session-nightly").textContent).toContain("Open session");
  });

  // test-plan #F3
  it("F3: Stop opens a confirm; Esc dismisses it without stopping", async () => {
    const { stopAutomationRun } = await import("../client/api.js");
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
    fireEvent.click(getByTestId("stop-nightly"));
    expect(screen.getByTestId("stop-confirm-nightly").textContent).toContain("Stop this run?");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("stop-confirm-nightly")).toBe(null));
    expect(vi.mocked(stopAutomationRun).mock.calls).toHaveLength(0);
  });

  // test-plan #F4
  it("F4: the notice reports the honest outcome; Stop is disabled while pending", async () => {
    const { stopAutomationRun } = await import("../client/api.js");
    const texts: Record<string, string> = {};
    for (const outcome of ["killed", "not-found", "unconfirmed"] as const) {
      let resolve!: (v: { ok: boolean; outcome: typeof outcome }) => void;
      vi.mocked(stopAutomationRun).mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
      const { getByTestId, unmount } = renderBoard({ params });
      await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
      fireEvent.click(getByTestId("stop-nightly"));
      fireEvent.click(screen.getByTestId("stop-confirm-yes-nightly"));
      await waitFor(() => expect((getByTestId("stop-nightly") as HTMLButtonElement).disabled).toBe(true));
      resolve({ ok: true, outcome });
      await waitFor(() => expect(getByTestId("automation-stop-notice-nightly").textContent?.length).toBeGreaterThan(0));
      texts[outcome] = getByTestId("automation-stop-notice-nightly").textContent ?? "";
      unmount();
    }
    expect(texts.killed).toContain("process is gone");
    expect(texts["not-found"]).not.toContain("process is gone");
    expect(texts.unconfirmed).not.toContain("process is gone");
    expect(texts.unconfirmed).toContain("may still be running");
  });

  // test-plan #F5
  it("F5: after Stop and refetch the card converges to stopped + Run now, no orphan notice", async () => {
    const { stopAutomationRun } = await import("../client/api.js");
    vi.mocked(stopAutomationRun).mockImplementationOnce(async () => {
      vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? [stopped] : []));
      return { ok: true, outcome: "killed" };
    });
    const { getByTestId, queryByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
    fireEvent.click(getByTestId("stop-nightly"));
    fireEvent.click(screen.getByTestId("stop-confirm-yes-nightly"));
    await waitFor(() => expect(getByTestId("run-now-nightly").textContent).toContain("Run now"));
    expect(queryByTestId("automation-orphan-notice-nightly")).toBe(null);
    expect(getByTestId("automation-run-orph").textContent).toContain("stopped");
  });

  // test-plan #X6
  it("X6: a rejected stop request shows an error notice and Stop is still offered", async () => {
    const { stopAutomationRun } = await import("../client/api.js");
    vi.mocked(stopAutomationRun).mockRejectedValueOnce(new Error("network down"));
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("stop-nightly")).toBeTruthy());
    fireEvent.click(getByTestId("stop-nightly"));
    fireEvent.click(screen.getByTestId("stop-confirm-yes-nightly"));
    await waitFor(() => expect(getByTestId("automation-stop-notice-nightly").textContent).toContain("network down"));
    expect(getByTestId("automation-stop-notice-nightly").getAttribute("data-tone")).toBe("error");
    expect((getByTestId("stop-nightly") as HTMLButtonElement).disabled).toBe(false);
  });
});

// A single-action automation is a PARENT occurrence whose sessionId lives on
// the child; the card summary + orphan notice must resolve through the child.
// See change: polish-automation-board (sessionBearer).
describe("AutomationBoard parent-occurrence session bearer", () => {
  const now = Date.now();
  function parentOrphan(childConnected: boolean): RunRecord {
    const kid: RunRecord = {
      runId: "occ-c0", name: "nightly", status: "running", dir: "/d/occ/c0", startedAt: now - 600_000,
      parentRunId: "occ", sessionId: "s-kid", orphaned: true, sessionConnected: childConnected, tracked: false,
    };
    return {
      runId: "occ", name: "nightly", status: "running", dir: "/d/occ", startedAt: now - 600_000,
      orphaned: true, tracked: false, scope: "folder", children: ["occ-c0"], childRuns: [kid],
    };
  }

  it("the orphan notice + session link come from the child, not the parent", async () => {
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? [parentOrphan(true)] : []));
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-orphan-notice-nightly")).toBeTruthy());
    // Parent has no sessionId; the notice still reads "still connected" from the child.
    expect(getByTestId("automation-orphan-notice-nightly").textContent).toContain("still connected");
    expect(getByTestId("orphan-session-nightly")).toBeTruthy();
    fireEvent.click(getByTestId("orphan-session-nightly"));
    // The child is orphaned (not tracked-running) → archived view.
    expect(`${window.location.pathname}${window.location.search}`).toBe("/session/s-kid?archived=1");
  });

  it("a disconnected child makes the notice say so", async () => {
    vi.mocked(listRunsMock).mockImplementation(async (scope: string) => (scope === "folder" ? [parentOrphan(false)] : []));
    const { getByTestId } = renderBoard({ params });
    await waitFor(() => expect(getByTestId("automation-orphan-notice-nightly")).toBeTruthy());
    expect(getByTestId("automation-orphan-notice-nightly").textContent).toContain("not connected");
  });
});
