import type { DashboardSession, OpenSpecChange, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { CORE_WORKFLOWS, EXPANDED_WORKFLOWS } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { absentData, archiveEntry, knownData, stubArchiveApi, withOpenSpecMap } from "../../test-support/attachmentHarness.js";
import { makeRunConfig, RunConfigHarness } from "../../test-support/runConfigHarness.js";
import { formatProposePrompt } from "../openspec/ProposeDialog.js";
import { SessionOpenSpecActions } from "../openspec/SessionOpenSpecActions.js";

// TasksPopover (opened by the Tasks segment) fetches on mount.
vi.mock("../../lib/openspec/openspec-tasks-api.js", () => ({
  fetchTasks: vi.fn(async () => ({ tasks: [], header: "" })),
  toggleTask: vi.fn(),
  LineMismatchError: class extends Error {},
}));

const coreConfig: OpenSpecConfig = { profile: "core", delivery: "both", workflows: [...CORE_WORKFLOWS] };
const expandedConfig: OpenSpecConfig = { profile: "expanded", delivery: "both", workflows: [...EXPANDED_WORKFLOWS] };

afterEach(() => cleanup());

// SessionOpenSpecActions mounts the OpenSpec dialogs, which consume the
// run-config context; wrap every render in the provider.
const render = (ui: React.ReactElement) =>
  rtlRender(<RunConfigHarness value={makeRunConfig()}>{ui}</RunConfigHarness>);

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/project/foo",
    source: "tui",
    status: "idle",
    startedAt: Date.now(),
    ...overrides,
  };
}

// PLANNING: not all artifacts done
const planningChange: OpenSpecChange = {
  name: "add-auth",
  status: "in-progress",
  completedTasks: 2,
  totalTasks: 5,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "ready" },
  ],
};

// READY: all artifacts done, status no-tasks
const readyChange: OpenSpecChange = {
  name: "ready-change",
  status: "no-tasks",
  completedTasks: 0,
  totalTasks: 0,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "done" },
  ],
};

// IMPLEMENTING: all artifacts done, status in-progress
const implementingChange: OpenSpecChange = {
  name: "impl-change",
  status: "in-progress",
  completedTasks: 2,
  totalTasks: 5,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "done" },
  ],
};

// COMPLETE: all artifacts done, status complete
const completeChange: OpenSpecChange = {
  name: "fix-bug",
  status: "complete",
  completedTasks: 3,
  totalTasks: 3,
  artifacts: [
    { id: "proposal", status: "done" },
    { id: "design", status: "done" },
    { id: "specs", status: "done" },
    { id: "tasks", status: "done" },
  ],
};

const defaultProps = {
  onAttach: vi.fn(),
  onDetach: vi.fn(),
  onSendPrompt: vi.fn(),
};

describe("SessionOpenSpecActions", () => {
  // --- Combo box ---

  it("shows attach button when no proposal attached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange, completeChange]}
        {...defaultProps}
      />,
    );
    const btn = screen.getByTestId("attach-combo") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe("Attach change...");
  });

  it("attach button is disabled when no changes", () => {
    render(
      <SessionOpenSpecActions session={makeSession()} changes={[]} {...defaultProps} />,
    );
    const btn = screen.getByTestId("attach-combo") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("No changes");
  });

  it("opens searchable dialog when attach button clicked", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[completeChange, planningChange]}
        {...defaultProps}
      />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    // Dialog should be open with change names visible
    expect(screen.getByText("add-auth")).toBeTruthy();
    expect(screen.getByText("fix-bug")).toBeTruthy();
  });

  it("calls onAttach when change selected from dialog", () => {
    const onAttach = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        {...defaultProps}
        onAttach={onAttach}
      />,
    );
    fireEvent.click(screen.getByTestId("attach-combo"));
    fireEvent.click(screen.getByText("add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });

  // --- Unattached active state: + Change, Explore ---

  it("shows + Change and Explore buttons when active and unattached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.getByTestId("new-change-btn")).toBeTruthy();
    expect(screen.getByTestId("explore-unattached-btn")).toBeTruthy();
  });

  // --- propose vs new split (change: split-propose-button) ---

  it("core profile shows Propose + Explore, NOT Change", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        openspecConfig={coreConfig}
        {...defaultProps}
      />,
    );
    expect(screen.getByTestId("propose-btn")).toBeTruthy();
    expect(screen.getByTestId("explore-unattached-btn")).toBeTruthy();
    expect(screen.queryByTestId("new-change-btn")).toBeNull();
  });

  it("expanded profile shows BOTH Change and Propose (has new + propose)", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        openspecConfig={expandedConfig}
        {...defaultProps}
      />,
    );
    expect(screen.getByTestId("new-change-btn")).toBeTruthy();
    expect(screen.getByTestId("propose-btn")).toBeTruthy();
  });

  it("Propose button opens a name-only dialog and dispatches /skill:openspec-propose", () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession()}
        changes={[planningChange]}
        openspecConfig={coreConfig}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("propose-btn"));
    expect(screen.getByTestId("propose-dialog")).toBeTruthy();
    // Name-only: no description field like NewChangeDialog has.
    expect(screen.getByTestId("propose-name")).toBeTruthy();
    expect(screen.queryByTestId("new-change-description")).toBeNull();
    fireEvent.change(screen.getByTestId("propose-name"), { target: { value: "add-dark-mode" } });
    fireEvent.click(screen.getByTestId("propose-send"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-propose add-dark-mode");
  });

  it("hides + Change and Explore when ended and unattached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ status: "ended" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByTestId("new-change-btn")).toBeNull();
    expect(screen.queryByTestId("explore-unattached-btn")).toBeNull();
  });

  it("does not show + Change when a change is attached", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    expect(screen.queryByTestId("new-change-btn")).toBeNull();
  });

  // --- Attached header: badge + one primary + ⋯ overflow ---
  // See change: compact-openspec-lifecycle-bar (test-plan E6–E9, F1–F7, X1).

  it("renders attached proposal name with text-blue-400", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[planningChange]}
        {...defaultProps}
      />,
    );
    const badge = screen.getByTestId("attached-badge");
    const nameSpan = badge.querySelector(".text-blue-400");
    expect(nameSpan).toBeTruthy();
    expect(nameSpan!.textContent).toBe("add-auth");
  });

  it("Continue sends correct prompt", () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "active" })}
        changes={[planningChange]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("continue-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-continue-change add-auth");
  });

  it("Apply sends correct prompt", () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "ready-change", status: "active" })}
        changes={[readyChange]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("apply-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-apply-change ready-change");
  });

  // --- Bulk Archive ---

  describe("bulk archive", () => {
    const completedChange: OpenSpecChange = {
      name: "done-feat",
      status: "complete",
      completedTasks: 4,
      totalTasks: 4,
      artifacts: [
        { id: "proposal", status: "done" },
        { id: "tasks", status: "done" },
      ],
    };

    // Bulk Archive hidden in unattached branch per user feedback
    // ("archive and bulk archive is meaningless when no openspec attached").
    // See change: redesign-session-card-and-composer (cleanup-pass).
    it("hides Bulk Archive in the unattached branch even with completed changes", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession()}
          changes={[planningChange, completedChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("bulk-archive-btn")).toBeNull();
    });

    it("hides Bulk Archive button when no completed changes", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession()}
          changes={[planningChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("bulk-archive-btn")).toBeNull();
    });

    // Bulk-archive confirmation + streaming-disabled paths are now
    // exercised through the folder-level UI (FolderOpenSpecSection) since
    // the per-session card no longer surfaces Bulk Archive at all.
    // See change: redesign-session-card-and-composer (cleanup-pass).

    it("hides Bulk Archive on attached session with completed changes", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "add-auth" })}
          changes={[planningChange, completedChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.queryByTestId("bulk-archive-btn")).toBeNull();
    });

    it.skip("shows Bulk Archive on unattached session with same sibling completed change (REMOVED — unattached now has no archive surface)", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession()}
          changes={[planningChange, completedChange]}
          onAttach={vi.fn()}
          onDetach={vi.fn()}
          onSendPrompt={vi.fn()}
          onBulkArchive={vi.fn()}
        />,
      );
      expect(screen.getByTestId("bulk-archive-btn")).toBeTruthy();
    });
  });

  // --- Lifecycle header: primary by state + workflow gating (E6) ---

  const allCfg = expandedConfig;
  const minusArchiveCfg: OpenSpecConfig = { ...expandedConfig, workflows: expandedConfig.workflows.filter((w) => w !== "archive") };

  const openMenu = () => {
    fireEvent.click(screen.getByTestId("openspec-overflow-btn"));
    return screen.getByTestId("openspec-overflow-menu");
  };
  const menuIds = (menu: HTMLElement) =>
    Array.from(menu.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"));

  const assertNoLegacy = () => {
    expect(screen.queryByTestId("state-pill")).toBeNull();
    expect(screen.queryByTestId("explore-btn")).toBeNull();
    const archive = screen.queryByTestId("archive-btn") as HTMLButtonElement | null;
    if (archive) expect(archive.disabled).toBe(false);
  };

  describe("primary action by state (E6)", () => {
    it.each([
      ["PLANNING/all", "add-auth", planningChange, allCfg, "continue-btn"],
      ["PLANNING/core", "add-auth", planningChange, coreConfig, null],
      ["READY/all", "ready-change", readyChange, allCfg, "apply-btn"],
      ["IMPLEMENTING/all", "impl-change", implementingChange, allCfg, "apply-btn"],
      ["COMPLETE/all", "fix-bug", completeChange, allCfg, "archive-btn"],
      ["COMPLETE/minus-archive", "fix-bug", completeChange, minusArchiveCfg, "verify-btn"],
    ] as const)("%s → %s", (_l, name, change, cfg, primary) => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: name, status: "idle" })}
          changes={[change]}
          {...defaultProps}
          openspecConfig={cfg}
        />,
      );
      const candidates = ["continue-btn", "ff-btn", "apply-btn", "archive-btn", "verify-btn"];
      const visible = candidates.filter((id) => screen.queryByTestId(id));
      expect(visible).toEqual(primary ? [primary] : []);
      assertNoLegacy();
    });
  });

  // --- ⋯ contents by state (E7) ---

  describe("overflow menu contents (E7)", () => {
    const implIsComplete: OpenSpecChange = { ...implementingChange, isComplete: true };
    it.each([
      ["PLANNING", "add-auth", planningChange, ["ff-btn", "explore-menu-item", "detach-btn"]],
      ["READY", "ready-change", readyChange, ["explore-menu-item", "detach-btn"]],
      ["IMPLEMENTING+isComplete", "impl-change", implIsComplete, ["archive-anyway-btn", "explore-menu-item", "detach-btn"]],
      ["IMPLEMENTING", "impl-change", implementingChange, ["explore-menu-item", "detach-btn"]],
      ["COMPLETE", "fix-bug", completeChange, ["verify-btn", "explore-menu-item", "detach-btn"]],
    ] as const)("%s", (_l, name, change, expected) => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: name, status: "idle" })}
          changes={[change]}
          {...defaultProps}
          openspecConfig={allCfg}
        />,
      );
      const btn = screen.getByTestId("openspec-overflow-btn");
      expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
      expect(btn.getAttribute("aria-expanded")).toBe("false");
      const menu = openMenu();
      expect(btn.getAttribute("aria-expanded")).toBe("true");
      expect(menuIds(menu)).toEqual(expected);
      for (const b of Array.from(menu.querySelectorAll("button"))) expect(b.querySelector("svg")).toBeTruthy();
    });

    it("Archive anyway… from the menu opens the confirm and dispatches archive", () => {
      const onSendPrompt = vi.fn();
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "idle" })}
          changes={[implIsComplete]}
          {...defaultProps}
          onSendPrompt={onSendPrompt}
        />,
      );
      openMenu();
      fireEvent.click(screen.getByTestId("archive-anyway-btn"));
      expect(screen.getByText(/3 of 5 tasks are unchecked/)).toBeTruthy();
      fireEvent.click(screen.getByTestId("archive-anyway-confirm-action"));
      expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-archive-change impl-change");
    });
  });

  // --- Ended + not-found (E8) ---

  describe("ended and not-found branches (E8)", () => {
    it("ended attached → bar, no primary, ⋯ holds only Detach", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "impl-change", status: "ended" })}
          changes={[implementingChange]}
          {...defaultProps}
        />,
      );
      expect(screen.getByTestId("openspec-stepper")).toBeTruthy();
      expect(screen.queryByTestId("apply-btn")).toBeNull();
      expect(screen.queryByTestId("detach-btn")).toBeNull();
      expect(menuIds(openMenu())).toEqual(["detach-btn"]);
    });

    it("attached change missing → badge + ⋯ with only Detach, no bar", () => {
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "archived-change" })}
          changes={[planningChange]}
          {...defaultProps}
        />,
      );
      expect(screen.getByText(/archived-change/)).toBeTruthy();
      expect(screen.queryByTestId("openspec-stepper")).toBeNull();
      expect(screen.queryByTestId("detach-btn")).toBeNull();
      expect(menuIds(openMenu())).toEqual(["detach-btn"]);
    });
  });

  // --- Unattached regression guard (E9) ---

  it("unattached active: combo + Change + enabled Explore, no Archive (E9)", () => {
    render(
      <SessionOpenSpecActions session={makeSession({ status: "active" })} changes={[planningChange]} {...defaultProps} />,
    );
    expect(screen.getByTestId("attach-combo")).toBeTruthy();
    expect(screen.getByTestId("new-change-btn")).toBeTruthy();
    expect((screen.getByTestId("explore-unattached-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("archive-btn")).toBeNull();
    expect(screen.queryByTestId("openspec-overflow-btn")).toBeNull();
  });

  // --- Segment clicks (F1) ---

  const impl1239: OpenSpecChange = { ...implementingChange, name: "add-auth", completedTasks: 12, totalTasks: 39 };

  it("Design segment reads the artifact; Tasks segment opens TasksPopover (F1)", () => {
    const onReadArtifact = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "idle" })}
        changes={[impl1239]}
        {...defaultProps}
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("stepper-segment-design"));
    expect(onReadArtifact).toHaveBeenCalledTimes(1);
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "design");
    fireEvent.click(screen.getByTestId("stepper-segment-tasks"));
    expect(screen.getByTestId("tasks-popover")).toBeTruthy();
  });

  // --- Archive segment gating (F2) ---

  describe("Archive segment (F2)", () => {
    const complete: OpenSpecChange = { ...completeChange, name: "add-auth" };

    it("COMPLETE + idle → confirm → archive prompt", () => {
      const onSendPrompt = vi.fn();
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "add-auth", status: "idle" })}
          changes={[complete]}
          {...defaultProps}
          onSendPrompt={onSendPrompt}
          openspecConfig={allCfg}
        />,
      );
      fireEvent.click(screen.getByTestId("stepper-segment-archive"));
      fireEvent.click(screen.getByTestId("archive-confirm-action"));
      expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-archive-change add-auth");
    });

    it.each([
      ["COMPLETE streaming", complete, "streaming"],
      ["IMPLEMENTING", { ...implementingChange, name: "add-auth" }, "idle"],
    ] as const)("%s → inert div, no dialog", (_l, change, status) => {
      const onSendPrompt = vi.fn();
      render(
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: "add-auth", status })}
          changes={[change]}
          {...defaultProps}
          onSendPrompt={onSendPrompt}
        />,
      );
      const seg = screen.getByTestId("stepper-segment-archive");
      expect(seg.tagName).toBe("DIV");
      fireEvent.click(seg);
      expect(screen.queryByTestId("archive-confirm")).toBeNull();
      expect(onSendPrompt).not.toHaveBeenCalled();
    });
  });

  // --- Streaming (F3) ---

  it("streaming: previews open, Tasks locked, primary aria-disabled, menu disabled except Detach (F3)", () => {
    const onReadArtifact = vi.fn();
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "streaming" })}
        changes={[impl1239]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("stepper-segment-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
    fireEvent.click(screen.getByTestId("stepper-segment-tasks"));
    expect(screen.queryByTestId("tasks-popover")).toBeNull();
    const primary = screen.getByTestId("apply-btn");
    expect(primary.getAttribute("aria-disabled")).toBe("true");
    expect(primary.getAttribute("title")).toBe("Session is streaming");
    fireEvent.click(primary);
    expect(onSendPrompt).not.toHaveBeenCalled();
    const menu = openMenu();
    for (const b of Array.from(menu.querySelectorAll("button"))) {
      expect((b as HTMLButtonElement).disabled).toBe(b.getAttribute("data-testid") !== "detach-btn");
    }
  });

  // --- Keyboard menu (F5) ---

  it("⋯ open focuses the first enabled item; Escape closes and refocuses ⋯ (F5)", async () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "ready-change", status: "idle" })}
        changes={[readyChange]}
        {...defaultProps}
      />,
    );
    const btn = screen.getByTestId("openspec-overflow-btn");
    btn.focus();
    fireEvent.click(btn);
    await act(async () => { await new Promise<void>((r) => requestAnimationFrame(() => r())); });
    expect(document.activeElement).toBe(screen.getByTestId("explore-menu-item"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("openspec-overflow-menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("openspec-overflow-btn"));
  });

  // --- Change-scoped Explore (F6) ---

  it("Explore… sends a change-scoped explore prompt (F6)", async () => {
    const onSendPrompt = vi.fn();
    render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status: "idle" })}
        changes={[impl1239]}
        {...defaultProps}
        onSendPrompt={onSendPrompt}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByTestId("explore-menu-item"));
    fireEvent.change(screen.getByTestId("explore-textarea"), { target: { value: "what does step 3 mean?" } });
    fireEvent.click(screen.getByTestId("explore-send"));
    await waitFor(() =>
      expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-explore add-auth\nwhat does step 3 mean?", undefined),
    );
  });

  // --- Detach via ⋯ (F7) ---

  it.each(["idle", "ended"] as const)("Detach via ⋯ (%s) → onDetach, then unattached combo (F7)", (status) => {
    const onDetach = vi.fn();
    const { rerender } = render(
      <SessionOpenSpecActions
        session={makeSession({ attachedProposal: "add-auth", status })}
        changes={[impl1239]}
        {...defaultProps}
        onDetach={onDetach}
      />,
    );
    openMenu();
    fireEvent.click(screen.getByTestId("detach-btn"));
    expect(onDetach).toHaveBeenCalledOnce();
    rerender(
      <RunConfigHarness value={makeRunConfig()}>
        <SessionOpenSpecActions
          session={makeSession({ attachedProposal: null, status })}
          changes={[impl1239]}
          {...defaultProps}
          onDetach={onDetach}
        />
      </RunConfigHarness>,
    );
    expect(screen.getByTestId("attach-combo")).toBeTruthy();
  });

  // --- Change vanishes between renders (X1) ---

  it("attached change removed between renders → bar + primary gone, badge + ⋯ remain (X1)", () => {
    const { rerender } = render(
      <SessionOpenSpecActions session={makeSession({ attachedProposal: "add-auth", status: "idle" })} changes={[impl1239]} {...defaultProps} />,
    );
    expect(screen.getByTestId("apply-btn")).toBeTruthy();
    rerender(
      <RunConfigHarness value={makeRunConfig()}>
        <SessionOpenSpecActions session={makeSession({ attachedProposal: "add-auth", status: "idle" })} changes={[]} {...defaultProps} />
      </RunConfigHarness>,
    );
    expect(screen.queryByTestId("openspec-stepper")).toBeNull();
    expect(screen.queryByTestId("apply-btn")).toBeNull();
    expect(screen.getByText(/add-auth/)).toBeTruthy();
    expect(menuIds(openMenu())).toEqual(["detach-btn"]);
  });
});

// review r2: Bulk Archive shares the working gate (streaming ∨ retrying, D9).
// See change: redesign-composer-session-strip.
describe("SessionOpenSpecActions — working gate covers retrying", () => {
  it("unattached + working (retrying) → New/Propose/Explore aria-disabled with the reason", () => {
    render(
      <SessionOpenSpecActions
        session={makeSession({ status: "idle" })}
        changes={[readyChange]}
        {...defaultProps}
        working
      />,
    );
    for (const id of ["new-change-btn", "propose-btn", "explore-unattached-btn"]) {
      const el = screen.getByTestId(id);
      expect(el.getAttribute("aria-disabled"), id).toBe("true");
      expect(el.getAttribute("title"), id).toBe("Session is streaming");
    }
  });
});

// --- Archived / missing / unresolved attachment headers (resolve-archived-attached-proposal) ---
describe("attachment resolution headers", () => {
  const props = { onAttach: vi.fn(), onSendPrompt: vi.fn(), onDetach: vi.fn() };
  const menuIds = (menu: HTMLElement) => Array.from(menu.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"));
  const openMenu = () => {
    fireEvent.click(screen.getByTestId("openspec-overflow-btn"));
    return screen.getByTestId("openspec-overflow-menu");
  };
  afterEach(() => vi.unstubAllGlobals());

  it.each(["idle", "ended"] as const)("F1 archived header (%s): badge, P D T letters, only Detach, no lifecycle", async (status) => {
    stubArchiveApi({ "/project/foo": [archiveEntry("2026-09-30-add-auth")] });
    render(
      withOpenSpecMap(
        { "/project/foo": knownData() },
        <SessionOpenSpecActions session={makeSession({ attachedProposal: "add-auth", status })} changes={[]} {...props} />,
      ),
    );
    const badge = await screen.findByTestId("attachment-archived-badge");
    expect(badge.textContent).toBe("Archived 2026-09-30");
    expect(screen.getAllByTestId("artifact-letter").map((l) => l.textContent)).toEqual(["P", "D", "T"]);
    expect(screen.queryByTestId("openspec-stepper")).toBeNull();
    for (const id of ["continue-btn", "ff-btn", "apply-btn", "archive-btn", "verify-btn"]) expect(screen.queryByTestId(id)).toBeNull();
    expect(menuIds(openMenu())).toEqual(["detach-btn"]);
  });

  it("F13 Detach on an archived attachment calls onDetach", async () => {
    stubArchiveApi({ "/project/foo": [archiveEntry("2026-09-30-add-auth")] });
    const onDetach = vi.fn();
    render(
      withOpenSpecMap(
        { "/project/foo": knownData() },
        <SessionOpenSpecActions session={makeSession({ attachedProposal: "add-auth" })} changes={[]} {...props} onDetach={onDetach} />,
      ),
    );
    await screen.findByTestId("attachment-archived-badge");
    fireEvent.click(within(openMenu()).getByTestId("detach-btn"));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("F2 missing: muted Not found badge with hint title; only Detach", async () => {
    stubArchiveApi({ "/project/foo": [] });
    render(
      withOpenSpecMap(
        { "/project/foo": knownData() },
        <SessionOpenSpecActions session={makeSession({ attachedProposal: "gone" })} changes={[]} {...props} />,
      ),
    );
    const badge = await screen.findByTestId("attachment-not-found-badge");
    expect(badge.textContent).toBe("Not found");
    expect(badge.getAttribute("title")).toBe("Not in active changes or archive (pull may be needed)");
    expect(menuIds(openMenu())).toEqual(["detach-btn"]);
  });

  it.each([
    ["loading", {}, {}],
    ["disabled", { "/project/foo": { initialized: false, changes: [], readiness: { state: "OPTED_OUT" } } }, {}],
    ["error", { "/project/foo": knownData() }, { "/project/foo": "error" as const }],
  ])("F3 unresolved (%s): bare name, no badge, only Detach", async (_r, map, archives) => {
    stubArchiveApi(archives);
    render(
      withOpenSpecMap(
        map as never,
        <SessionOpenSpecActions session={makeSession({ attachedProposal: "add-auth" })} changes={[]} {...props} />,
      ),
    );
    await waitFor(() => expect(screen.getByText(/add-auth/)).toBeTruthy());
    expect(screen.queryByTestId("attachment-archived-badge")).toBeNull();
    expect(screen.queryByTestId("attachment-not-found-badge")).toBeNull();
    expect(menuIds(openMenu())).toEqual(["detach-btn"]);
  });

  it("X3 slow archive fetch: bare header first, then the Archived badge", async () => {
    stubArchiveApi({ "/project/foo": [archiveEntry("2026-09-30-add-auth")] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const fast = (globalThis.fetch as unknown as (u: string) => Promise<Response>);
    vi.stubGlobal("fetch", vi.fn(async (u: string) => { await gate; return fast(u); }));
    render(
      withOpenSpecMap(
        { "/project/foo": knownData() },
        <SessionOpenSpecActions session={makeSession({ attachedProposal: "add-auth" })} changes={[]} {...props} />,
      ),
    );
    expect(screen.queryByTestId("attachment-not-found-badge")).toBeNull();
    expect(screen.queryByTestId("attachment-archived-badge")).toBeNull();
    await act(async () => { release(); });
    expect(await screen.findByTestId("attachment-archived-badge")).toBeTruthy();
  });

  it("removed worktree: archived under mainPath", async () => {
    stubArchiveApi({ "/repo": [archiveEntry("2026-09-30-add-auth")] });
    render(
      withOpenSpecMap(
        { "/repo/.worktrees/os-add-auth": absentData(), "/repo": knownData() },
        <SessionOpenSpecActions
          session={makeSession({ cwd: "/repo/.worktrees/os-add-auth", attachedProposal: "add-auth", status: "ended", gitWorktree: { mainPath: "/repo", name: "os-add-auth" } as never })}
          changes={[]}
          {...props}
        />,
      ),
    );
    expect(await screen.findByTestId("attachment-archived-badge")).toBeTruthy();
  });
});
