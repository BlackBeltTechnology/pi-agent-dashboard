import React from "react";
import { act, render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ComposerContextGroup,
  createSlotRegistry,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { absentData, archiveEntry, knownData, makeChange, stubArchiveApi, withOpenSpecMap } from "../../test-support/attachmentHarness.js";
import { ComposerSessionActions } from "../session/ComposerSessionActions.js";
import type { DashboardSession, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";

afterEach(() => cleanup());

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    name: "test",
    cwd: "/repo",
    source: "pi",
    status: "active",
    startedAt: Date.now(),
    model: "claude",
    ...over,
  } as DashboardSession;
}

const planningArtifacts = [{ id: "proposal" as const, status: "ready" as const }];
const implementingArtifacts = [
  { id: "proposal" as const, status: "done" as const },
  { id: "design" as const, status: "done" as const },
  { id: "specs" as const, status: "done" as const },
];

function implementingChange(): OpenSpecChange {
  return { name: "add-auth", status: "in-progress", completedTasks: 4, totalTasks: 12, artifacts: implementingArtifacts };
}
function completeChange(): OpenSpecChange {
  return { name: "add-auth", status: "complete", completedTasks: 12, totalTasks: 12, artifacts: implementingArtifacts };
}

describe("ComposerSessionActions", () => {
  it("returns nothing when session is undefined", () => {
    const { container } = render(<ComposerSessionActions session={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders OpenSpec group label + buttons when no proposal attached", () => {
    render(
      <ComposerSessionActions
        session={makeSession()}
        changes={[]}
        openspecHasDir={true}
      />,
    );
    expect(screen.getByTestId("composer-session-actions")).toBeTruthy();
    expect(screen.getByTestId("composer-openspec-group-label")).toBeTruthy();
    expect((screen.getByTestId("composer-explore-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
  });

  // Artifact chips replaced by the lifecycle bar + one primary + ⋯.
  // See change: redesign-composer-session-strip (D2).
  it("IMPLEMENTING attached change: Explore + Archive not standalone, Apply enabled", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir={true}
      />,
    );
    expect(screen.queryByTestId("composer-explore-btn")).toBeNull();
    const apply = screen.getByTestId("composer-apply-btn") as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    expect(apply.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
  });

  it("COMPLETE attached change: Archive is the primary; Verify inside ⋯", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[completeChange()]}
        openspecHasDir={true}
      />,
    );
    const archive = screen.getByTestId("composer-archive-btn") as HTMLButtonElement;
    expect(archive.disabled).toBe(false);
    expect(archive.getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByTestId("composer-verify-btn")).toBeNull();
    fireEvent.click(screen.getByTestId("composer-openspec-overflow-btn"));
    expect(screen.getByTestId("composer-openspec-overflow-menu").contains(screen.getByTestId("composer-verify-btn"))).toBe(true);
  });

  it("OpenSpec group hidden when openspecHasDir is false and not pending", () => {
    const { container } = render(
      <ComposerSessionActions
        session={makeSession()}
        changes={[]}
        openspecHasDir={false}
        openspecPending={false}
      />,
    );
    expect(screen.queryByTestId("composer-openspec-group-label")).toBeNull();
    expect(screen.queryByTestId("composer-explore-btn")).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it("fires onSendPrompt with /skill:openspec-apply-change <name> when Apply clicked", () => {
    const onSendPrompt = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir={true}
        onSendPrompt={onSendPrompt}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-apply-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-apply-change add-auth");
  });

  it("streaming session gates every action (aria-disabled, focusable) and locks Tasks", () => {
    const onSendPrompt = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ status: "streaming", attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir={true}
        onSendPrompt={onSendPrompt}
      />,
    );
    const apply = screen.getByTestId("composer-apply-btn") as HTMLButtonElement;
    expect(apply.getAttribute("aria-disabled")).toBe("true");
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(onSendPrompt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("composer-stepper-segment-tasks"));
    expect(screen.queryByTestId("tasks-popover")).toBeNull();
  });

  // Lifecycle-bar gating. See changes: compact-openspec-lifecycle-bar (E10, F13),
  // redesign-composer-session-strip (the composer now renders the bar itself).
  describe("lifecycle gating (E10)", () => {
    const impl1239 = (): OpenSpecChange => ({ ...implementingChange(), completedTasks: 12, totalTasks: 39 });

    it("unattached → enabled Explore, no Archive", () => {
      render(<ComposerSessionActions session={makeSession()} changes={[impl1239()]} openspecHasDir />);
      expect((screen.getByTestId("composer-explore-btn") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
    });

    it("attached IMPLEMENTING 12/39 → no Explore/Archive; Tasks segment shows the count", () => {
      render(<ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[impl1239()]} openspecHasDir />);
      expect(screen.queryByTestId("composer-explore-btn")).toBeNull();
      expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
      expect(screen.getByTestId("composer-stepper-segment-tasks").textContent).toContain("12/39");
      expect(screen.getByTestId("composer-stepper-tasks-fill").style.width).toBe("31%");
    });

    it("attached COMPLETE → enabled Archive", () => {
      render(<ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[completeChange()]} openspecHasDir />);
      expect(screen.getByTestId("composer-archive-btn").getAttribute("aria-disabled")).toBeNull();
    });

    it("skipped specs renders as skipped on the bar", () => {
      const c = { ...impl1239(), artifacts: [...implementingArtifacts.slice(0, 2), { id: "specs" as const, status: "skipped" as const }] };
      render(<ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[c]} openspecHasDir />);
      expect(screen.getByTestId("composer-stepper-segment-specs").getAttribute("data-state")).toBe("skipped");
    });
  });

  it("streaming: P segment reads, Tasks segment opens no popover (F13)", () => {
    const onReadArtifact = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ status: "streaming", attachedProposal: "add-auth" })}
        changes={[{ ...implementingChange(), completedTasks: 12, totalTasks: 39 }]}
        openspecHasDir
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-stepper-segment-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
    fireEvent.click(screen.getByTestId("composer-stepper-segment-tasks"));
    expect(screen.queryByTestId("tasks-popover")).toBeNull();
  });

  it("renders Git group label + worktree menu when session has gitWorktree", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ gitWorktree: { mainPath: "/main", name: "feat-x" } })}
        changes={[]}
        openspecHasDir={true}
        showGitInfo={true}
      />,
    );
    expect(screen.getByTestId("composer-git-group-label")).toBeTruthy();
    expect(screen.getByTestId("composer-git-group")).toBeTruthy();
  });

  it("does not render Git group when no worktree", () => {
    render(
      <ComposerSessionActions
        session={makeSession()}
        changes={[]}
        openspecHasDir={true}
        showGitInfo={true}
      />,
    );
    expect(screen.queryByTestId("composer-git-group-label")).toBeNull();
    expect(screen.queryByTestId("composer-git-group")).toBeNull();
  });
});

// ── composer-context-group contributions (move-quota-to-context-strip) ────────

/** A registry claiming `composer-context-group` with a `ComposerContextGroup`. */
function contextGroupRegistry(extra?: (r: ReturnType<typeof createSlotRegistry>) => void) {
  const registry = createSlotRegistry();
  registry.addClaim({
    pluginId: "quota",
    priority: 600,
    slot: "composer-context-group",
    Component: () => (
      <ComposerContextGroup label="Quota" testId="quota-context-group">
        <span data-testid="quota-chip">5h 14%</span>
      </ComposerContextGroup>
    ),
  });
  extra?.(registry);
  return registry;
}

function badgeRegistry(extra?: (r: ReturnType<typeof createSlotRegistry>) => void) {
  const registry = contextGroupRegistry(extra);
  registry.addClaim({
    pluginId: "badge",
    priority: 100,
    slot: "session-card-badge",
    Component: () => <span data-testid="fake-badge">RUN</span>,
  });
  return registry;
}

/** `a` precedes `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("ComposerSessionActions composer-context-group", () => {
  it("F1: group renders between Git and Status", () => {
    render(
      <PluginContextProvider registry={badgeRegistry()}>
        <ComposerSessionActions
          session={makeSession({ gitWorktree: { mainPath: "/main", name: "feat-x" } })}
          changes={[]}
          openspecHasDir={true}
          showGitInfo={true}
        />
      </PluginContextProvider>,
    );
    const git = screen.getByTestId("composer-git-group");
    const quota = screen.getByTestId("quota-context-group");
    const status = screen.getByTestId("composer-status-group-label");
    expect(precedes(git, quota)).toBe(true);
    expect(precedes(quota, status)).toBe(true);
  });

  it("F2: is not streaming-gated while host actions are disabled", () => {
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "quota",
      priority: 600,
      slot: "composer-context-group",
      Component: () => (
        <ComposerContextGroup label="Quota" testId="quota-context-group">
          <button type="button" data-testid="ctx-btn">open</button>
        </ComposerContextGroup>
      ),
    });
    render(
      <PluginContextProvider registry={registry}>
        <ComposerSessionActions
          session={makeSession({ status: "streaming" })}
          changes={[]}
          openspecHasDir={true}
        />
      </PluginContextProvider>,
    );
    // Plugin contribution stays interactive...
    expect((screen.getByTestId("ctx-btn") as HTMLButtonElement).disabled).toBe(false);
    // ...while host actions are gated by streaming.
    expect(screen.getByTestId("composer-explore-btn").getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
  });

  it("F3: the strip renders for a context-group claim even with no host group", () => {
    const session = makeSession(); // no worktree
    const { container, unmount } = render(
      <PluginContextProvider registry={contextGroupRegistry()}>
        <ComposerSessionActions session={session} changes={[]} openspecHasDir={false} openspecPending={false} />
      </PluginContextProvider>,
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId("quota-context-group")).toBeTruthy();
    unmount();

    const empty = render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <ComposerSessionActions session={session} changes={[]} openspecHasDir={false} openspecPending={false} />
      </PluginContextProvider>,
    );
    expect(empty.container.firstChild).toBeNull();
  });

  it("F5: with no claim the strip carries no extra divider", () => {
    const baseline = render(
      <PluginContextProvider registry={createSlotRegistry()}>
        <ComposerSessionActions
          session={makeSession({ gitWorktree: { mainPath: "/main", name: "feat-x" } })}
          changes={[]}
          openspecHasDir={true}
          showGitInfo={true}
        />
      </PluginContextProvider>,
    );
    const baselineDividers = baseline.container.querySelectorAll('[aria-hidden="true"]').length;
    expect(screen.queryByTestId("quota-context-group")).toBeNull();
    baseline.unmount();

    // A claim whose component returns null must leave the strip identical.
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "empty",
      priority: 100,
      slot: "composer-context-group",
      Component: () => null,
    });
    const withEmpty = render(
      <PluginContextProvider registry={registry}>
        <ComposerSessionActions
          session={makeSession({ gitWorktree: { mainPath: "/main", name: "feat-x" } })}
          changes={[]}
          openspecHasDir={true}
          showGitInfo={true}
        />
      </PluginContextProvider>,
    );
    expect(withEmpty.container.querySelectorAll('[aria-hidden="true"]').length).toBe(baselineDividers);
  });
});

// ── redesign-composer-session-strip scenarios ──────────────────────────────

const WT = { mainPath: "/main", name: "feat-x", base: "develop" };
const MIN = 60_000;
const openPr = (checks: "passing" | "failing", over: Partial<DashboardSession> = {}): Partial<DashboardSession> => ({
  gitWorktree: WT,
  gitPrNumber: 747,
  gitPrUrl: "https://gh/pr/747",
  gitPrState: "open",
  gitPrDraft: false,
  gitPrChecks: checks,
  gitPrCheckedAt: Date.now() - 1 * MIN,
  ...over,
});
const three: OpenSpecChange[] = [
  implementingChange(),
  { name: "b", status: "in-progress", completedTasks: 0, totalTasks: 3, artifacts: implementingArtifacts },
  { name: "c", status: "complete", completedTasks: 3, totalTasks: 3, artifacts: implementingArtifacts },
];

describe("unattached OpenSpec group (#E7)", () => {
  it.each([
    ["all", ["new", "propose", "explore", "apply", "archive"], true],
    ["core", ["propose", "explore", "apply", "archive"], false],
  ] as const)("wf %s, 3 changes → attach chip enabled; Explore; ⋯ per wf; no stepper, no archive", (_n, workflows, hasNew) => {
    render(
      <ComposerSessionActions
        session={makeSession()}
        changes={three}
        openspecHasDir
        onAttach={() => {}}
        openspecConfig={{ workflows: [...workflows] } as any}
      />,
    );
    const chip = screen.getByTestId("composer-attach-chip") as HTMLButtonElement;
    expect(chip.disabled).toBe(false);
    expect(screen.getByTestId("composer-explore-btn")).toBeTruthy();
    fireEvent.click(screen.getByTestId("composer-openspec-overflow-btn"));
    expect(!!screen.queryByTestId("composer-new-change-btn")).toBe(hasNew);
    expect(screen.getByTestId("composer-propose-btn")).toBeTruthy();
    expect(screen.queryByTestId("composer-openspec-stepper")).toBeNull();
    expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
  });

  it("0 changes → disabled 'No changes' chip", () => {
    render(<ComposerSessionActions session={makeSession()} changes={[]} openspecHasDir onAttach={() => {}} />);
    const chip = screen.getByTestId("composer-attach-chip") as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain("No changes");
  });

  it("flat picker (no groups) → onAttach(name)", () => {
    const onAttach = vi.fn();
    render(<ComposerSessionActions session={makeSession()} changes={three} openspecHasDir onAttach={onAttach} />);
    fireEvent.click(screen.getByTestId("composer-attach-chip"));
    fireEvent.click(screen.getByText("add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });

  it("grouped picker (groups present) → onAttach(name)", () => {
    const onAttach = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession()}
        changes={three}
        openspecHasDir
        onAttach={onAttach}
        groups={[{ id: "g1", name: "Group 1" } as any]}
        assignments={{ "add-auth": "g1" }}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-attach-chip"));
    fireEvent.click(screen.getByText("add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });
});

describe("attached OpenSpec group (#E8)", () => {
  it("IMPLEMENTING 12/39 → chip, letters bar 12/39, Apply, ⋯ with Explore… and no Detach; no standalone Explore", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[{ ...implementingChange(), completedTasks: 12, totalTasks: 39 }]}
        openspecHasDir
      />,
    );
    expect(screen.getByTestId("composer-change-chip").textContent).toContain("add-auth");
    expect(screen.getByTestId("composer-stepper-segment-tasks").textContent).toContain("12/39");
    expect(screen.getByTestId("composer-apply-btn")).toBeTruthy();
    expect(screen.queryByTestId("composer-explore-btn")).toBeNull();
    fireEvent.click(screen.getByTestId("composer-openspec-overflow-btn"));
    const menu = screen.getByTestId("composer-openspec-overflow-menu");
    expect(menu.textContent).toContain("Explore");
    expect(menu.querySelector("[data-testid$='detach-btn']")).toBeNull();
  });
});

describe("change chip popover (#F6)", () => {
  it("focus → Open proposal; Detach → onDetach once; Escape → focus back on chip; portalled outside the group", async () => {
    const onDetach = vi.fn();
    const onReadArtifact = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir
        onDetach={onDetach}
        onReadArtifact={onReadArtifact}
      />,
    );
    const chip = screen.getByTestId("composer-change-chip");
    fireEvent.click(chip);
    await act(async () => { await new Promise<void>((r) => requestAnimationFrame(() => r())); });
    const openProposal = screen.getByTestId("composer-change-open-proposal");
    expect(document.activeElement).toBe(openProposal);
    expect(screen.getByTestId("composer-openspec-container").contains(screen.getByTestId("composer-change-menu"))).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("composer-change-menu")).toBeNull();
    expect(document.activeElement).toBe(chip);
    fireEvent.click(chip);
    fireEvent.click(screen.getByTestId("composer-change-detach"));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("Open proposal reads the proposal artifact", () => {
    const onReadArtifact = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-change-chip"));
    fireEvent.click(screen.getByTestId("composer-change-open-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
  });
});

describe("Git identity segment (#E9)", () => {
  const ST = (over: Partial<NonNullable<DashboardSession["gitStatus"]>> = {}) => ({ dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0, ...over });
  const renderGit = (over: Partial<DashboardSession>) =>
    render(<ComposerSessionActions session={makeSession({ gitWorktree: WT, gitBranch: "os/x", ...over })} changes={[]} openspecHasDir={false} showGitInfo />);

  it("(a) dirty 3 ahead 2 → branch, base, 3 changed files, ↑2, no ↓", () => {
    renderGit({ gitStatus: ST({ dirtyCount: 3, ahead: 2 }) });
    expect(screen.getByTestId("composer-git-branch").textContent).toContain("os/x");
    expect(screen.getByTestId("composer-git-base").textContent).toContain("develop");
    expect(screen.getByTestId("composer-git-dirty").textContent).toContain("3");
    expect(screen.getByTestId("composer-git-dirty").textContent).toContain("3 changed files");
    expect(screen.getByTestId("composer-git-ahead").textContent).toContain("↑2");
    expect(screen.queryByTestId("composer-git-behind")).toBeNull();
    expect(screen.getByTestId("composer-git-identity").getAttribute("title")).toBe("feat-x — /main");
  });

  it("(b) base absent → no ←", () => {
    renderGit({ gitWorktree: { mainPath: "/main", name: "feat-x" } });
    expect(screen.queryByTestId("composer-git-base")).toBeNull();
  });

  it("(c) all zero → 'no local changes', never 'in sync'", () => {
    renderGit({ gitStatus: ST() });
    expect(screen.getByTestId("composer-git-clean").textContent).toContain("no local changes");
    expect(screen.getByTestId("composer-git-identity").textContent).not.toMatch(/in sync/i);
  });

  it("(d) status absent → no drift / no-changes marker", () => {
    renderGit({});
    expect(screen.queryByTestId("composer-git-clean")).toBeNull();
    expect(screen.queryByTestId("composer-git-dirty")).toBeNull();
    expect(screen.queryByTestId("composer-git-ahead")).toBeNull();
  });

  it("(e) branch absent → no ⎇ text", () => {
    renderGit({ gitBranch: undefined });
    expect(screen.queryByTestId("composer-git-branch")).toBeNull();
    expect(screen.getByTestId("composer-git-identity").textContent).not.toContain("⎇");
  });
});

describe("host group test ids (#E11)", () => {
  it("attached worktree session with a badge claim keeps all five legacy ids", () => {
    render(
      <PluginContextProvider registry={badgeRegistry()}>
        <ComposerSessionActions
          session={makeSession({ attachedProposal: "add-auth", gitWorktree: WT })}
          changes={[implementingChange()]}
          openspecHasDir
          showGitInfo
        />
      </PluginContextProvider>,
    );
    for (const id of ["composer-openspec-group-label", "composer-git-group-label", "composer-status-group-label", "composer-git-group", "composer-status-group"]) {
      expect(screen.getByTestId(id), id).toBeTruthy();
    }
    expect(screen.getByTestId("composer-status-group").tagName).toBe("FIELDSET");
    for (const c of ["composer-openspec-container", "composer-git-container", "composer-status-container"]) {
      expect(screen.getByTestId(c).getAttribute("role")).toBe("group");
    }
  });
});

describe("single filled primary in the composer (#E12)", () => {
  const filled = () => Array.from(document.querySelectorAll("[data-emphasis='filled']")).map((e) => e.getAttribute("data-testid"));
  it.each([
    ["COMPLETE + passing", completeChange(), "passing", "worktree-action-merge"],
    ["IMPLEMENTING + passing", implementingChange(), "passing", "composer-apply-btn"],
    ["COMPLETE + failing", completeChange(), "failing", "composer-archive-btn"],
  ] as const)("%s → exactly one filled: %s", (_n, change, checks, expected) => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth", ...openPr(checks) })}
        changes={[change]}
        openspecHasDir
        showGitInfo
      />,
    );
    expect(filled()).toEqual([expected]);
  });

  it("#X4: COMPLETE + open passing PR checked 20 min ago → Merge outlined, Archive filled", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth", ...openPr("passing", { gitPrCheckedAt: Date.now() - 20 * MIN }) })}
        changes={[completeChange()]}
        openspecHasDir
        showGitInfo
      />,
    );
    expect(filled()).toEqual(["composer-archive-btn"]);
    expect(screen.getByTestId("worktree-action-merge").getAttribute("data-emphasis")).toBe("outlined");
  });
});

describe("working = streaming ∨ retrying (#F7, composer half)", () => {
  it.each([
    ["idle", "active", false, false],
    ["streaming", "streaming", false, true],
    ["retrying", "active", true, true],
  ] as const)("%s → primary / Push / Merge gated iff working; chip + previews stay live", (_n, status, retrying, gated) => {
    const onReadArtifact = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ status, attachedProposal: "add-auth", ...openPr("passing") })}
        changes={[completeChange()]}
        openspecHasDir
        showGitInfo
        working={status === "streaming" || retrying}
        onReadArtifact={onReadArtifact}
      />,
    );
    for (const id of ["composer-archive-btn", "worktree-action-push", "worktree-action-merge"]) {
      const el = screen.getByTestId(id) as HTMLButtonElement;
      expect(el.getAttribute("aria-disabled"), id).toBe(gated ? "true" : null);
      expect(el.disabled, id).toBe(false); // focusable
      if (gated) expect(el.getAttribute("title"), id).toBe("Session is streaming");
    }
    if (gated) expect(document.querySelectorAll("[data-emphasis='filled']")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("composer-stepper-segment-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
    expect(screen.getByTestId("composer-change-chip").getAttribute("aria-disabled")).toBeNull();
  });
});

describe("ComposerSessionActions change chip for non-live attachments (resolve-archived-attached-proposal)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const base = { openspecReadiness: { state: "READY" as const }, onReadArtifact: vi.fn(), onDetach: vi.fn() };

  it("archived: chip menu offers Detach only — no active-preview 'Open proposal'", async () => {
    stubArchiveApi({ "/repo": [archiveEntry("2026-09-30-add-auth")] });
    render(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        {withOpenSpecMap(
          { "/repo": knownData() },
          <ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[]} {...base} />,
        )}
      </Router>,
    );
    await screen.findByTestId("attachment-archived-badge");
    fireEvent.click(screen.getByTestId("composer-change-chip"));
    expect(screen.queryByTestId("composer-change-open-proposal")).toBeNull();
    expect(screen.getByTestId("composer-change-detach")).toBeTruthy();
  });

  it("active in the main checkout (removed worktree): no 'Open proposal' either", async () => {
    stubArchiveApi({});
    render(
      <Router hook={memoryLocation({ path: "/" }).hook}>
        {withOpenSpecMap(
          { "/repo/.worktrees/os-x": absentData(), "/repo": knownData(makeChange("x")) },
          <ComposerSessionActions
            session={makeSession({ cwd: "/repo/.worktrees/os-x", status: "ended", attachedProposal: "x", gitWorktree: { mainPath: "/repo", name: "os-x" } as never })}
            changes={[]}
            {...base}
          />,
        )}
      </Router>,
    );
    await screen.findByTestId("attachment-main-checkout-badge");
    fireEvent.click(screen.getByTestId("composer-change-chip"));
    expect(screen.queryByTestId("composer-change-open-proposal")).toBeNull();
    expect(screen.getByTestId("composer-change-detach")).toBeTruthy();
  });

  it("live active attachment still offers 'Open proposal'", () => {
    stubArchiveApi({});
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        {...base}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-change-chip"));
    expect(screen.getByTestId("composer-change-open-proposal")).toBeTruthy();
  });
});
