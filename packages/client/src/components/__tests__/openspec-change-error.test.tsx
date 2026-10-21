/**
 * A change whose `openspec status --all` entry carries an `error`:
 * board badge (#F1), blocked Continue/FF on the session card (#F7 clears),
 * the composer strip (#F5) and the mobile action menu (#F4).
 * See change: use-openspec-status-all.
 */
import type { DashboardSession, OpenSpecChange, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";
import { renderLanesDock, stubSessionDiffFetch } from "../chat/__tests__/dock-harness.js";
import { OpenSpecBoardView } from "../openspec/OpenSpecBoardView.js";
import { SessionOpenSpecActions } from "../openspec/SessionOpenSpecActions.js";
import { MobileActionMenu } from "../shell/MobileActionMenu.js";

vi.mock("../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {}, changeOrder: {} })),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(async () => {}),
  setChangeOrder: vi.fn(async () => {}),
}));
vi.mock("../../lib/openspec/openspec-config-api.js", () => ({
  useOpenSpecConfig: () => ({ profile: "custom", delivery: "both", workflows: ["continue", "ff", "apply", "explore", "verify", "archive"] }),
}));

const MSG = "Invalid YAML in metadata file";
const broken = (over: Partial<OpenSpecChange> = {}): OpenSpecChange => ({
  name: "add-auth",
  status: "no-tasks",
  completedTasks: 0,
  totalTasks: 0,
  artifacts: [],
  error: { code: "change_error", message: MSG },
  ...over,
});
const healthy = (name: string): OpenSpecChange => ({
  name,
  status: "in-progress",
  completedTasks: 1,
  totalTasks: 2,
  artifacts: [{ id: "proposal", status: "done" }],
});

const session = (over: Partial<DashboardSession> = {}): DashboardSession => ({
  id: "s1",
  cwd: "/p",
  source: "tui",
  status: "active",
  startedAt: Date.now(),
  attachedProposal: "add-auth",
  ...over,
});

const harness = (ui: React.ReactElement) => rtlRender(<RunConfigHarness value={makeRunConfig()}>{ui}</RunConfigHarness>);

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});
afterEach(() => cleanup());

describe("#F1 board card error badge", () => {
  const data: OpenSpecData = { initialized: true, changes: [broken(), healthy("fix-bug"), healthy("plan-ui")] };
  const props = () => ({
    cwd: "/p",
    data,
    sessions: [] as DashboardSession[],
    openspecMap: new Map([["/p", data]]),
    groupsState: { groups: [], assignments: {}, changeOrder: {} },
    onBack: vi.fn(), onRefresh: vi.fn(), onReadArtifact: vi.fn(), onNavigateToSession: vi.fn(),
    onOpenSpecs: vi.fn(), onOpenArchive: vi.fn(), onSpawnSession: vi.fn(), onSpawnAttachedWorktree: vi.fn(),
    onResumeSession: vi.fn(), onArchiveSession: vi.fn(), onSendPrompt: vi.fn(),
    onAttachProposal: vi.fn(), onDetachProposal: vi.fn(), onBulkArchive: vi.fn(),
    worktreeAvailability: { available: true },
  });

  it("shows a labelled badge with the message, all-todo bar, other cards unchanged, New session enabled", () => {
    harness(<OpenSpecBoardView {...props()} />);
    const card = screen.getByTestId("board-card-add-auth");
    const badge = within(card).getByTestId("openspec-error-badge");
    expect(badge.getAttribute("aria-label")).toContain(MSG);
    expect(badge.getAttribute("title")).toBe(MSG);
    expect(badge.getAttribute("tabindex")).toBe("0");
    const segments = card.querySelectorAll('[data-testid^="stepper-segment-"]');
    expect(segments.length).toBeGreaterThan(0);
    for (const s of Array.from(segments)) expect(s.getAttribute("data-state")).toBe("todo");
    // The other two cards render no badge.
    for (const other of ["fix-bug", "plan-ui"]) {
      expect(within(screen.getByTestId(`board-card-${other}`)).queryByTestId("openspec-error-badge")).toBeNull();
    }
    expect(screen.getAllByTestId("openspec-error-badge")).toHaveLength(1);
    expect((screen.getByTestId("card-new-session-add-auth") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("#F7 error clears on the session card", () => {
  const props = { onAttach: vi.fn(), onDetach: vi.fn(), onSendPrompt: vi.fn() };

  it("shows a focusable badge + blocked Continue, then restores normal PLANNING actions when the error clears", () => {
    const withError = broken({ artifacts: [] });
    const { rerender } = harness(<SessionOpenSpecActions session={session({ status: "idle" })} changes={[withError]} {...props} />);
    expect(screen.getByTestId("openspec-error-badge").getAttribute("aria-label")).toContain(MSG);
    const cont = screen.getByTestId("continue-btn") as HTMLButtonElement;
    expect(cont.getAttribute("aria-disabled")).toBe("true");
    expect(cont.getAttribute("title")).toBe(MSG);
    fireEvent.click(cont);
    expect(props.onSendPrompt).not.toHaveBeenCalled();

    const cleared: OpenSpecChange = { name: "add-auth", status: "no-tasks", completedTasks: 0, totalTasks: 0, artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "ready" }] };
    rerender(
      <RunConfigHarness value={makeRunConfig()}>
        <SessionOpenSpecActions session={session({ status: "idle" })} changes={[cleared]} {...props} />
      </RunConfigHarness>,
    );
    expect(screen.queryByTestId("openspec-error-badge")).toBeNull();
    const again = screen.getByTestId("continue-btn") as HTMLButtonElement;
    expect(again.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(again);
    expect(props.onSendPrompt).toHaveBeenCalledWith("/skill:openspec-continue-change add-auth");
  });
});

describe("#F5 composer dock OpenSpec lane", () => {
  it("Continue primary is aria-disabled, focusable, and describes itself with the message", () => {
    stubSessionDiffFetch(() => ({ body: { success: true, data: { files: [], isGitRepo: true } } }));
    renderLanesDock({
      input: {
        session: session({ cwd: "/repo" }),
        working: false,
        changes: [broken()],
        openspecHasDir: true,
        openspecReadiness: { state: "READY" },
        onReadArtifact: vi.fn(),
        onDetach: vi.fn(),
      },
    });
    const cont = screen.getByTestId("composer-continue-btn") as HTMLButtonElement;
    expect(cont.getAttribute("aria-disabled")).toBe("true");
    expect(cont.disabled).toBe(false); // stays focusable
    expect(cont.getAttribute("title")).toBe(MSG);
  });
});

describe("#F4 mobile action menu", () => {
  it("Continue and Fast-Forward rows are natively disabled for a broken attached change", () => {
    harness(<MobileActionMenu session={session({ status: "idle", cwd: "/project/foo" })} openspecChanges={[broken()]} onSendPrompt={vi.fn()} />);
    fireEvent.click(screen.getByTestId("mobile-kebab-btn"));
    const rows = Array.from(screen.getByTestId("mobile-action-menu").querySelectorAll("button"));
    const find = (text: string) => rows.find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
    for (const label of ["Continue", "Fast-Forward"]) {
      const row = find(label);
      expect(row, `${label} row`).toBeTruthy();
      expect(row!.disabled).toBe(true);
      expect(row!.getAttribute("title")).toBe(MSG);
    }
    expect(find("Explore")!.disabled).toBe(false); // not blocked by this rule
  });
});
