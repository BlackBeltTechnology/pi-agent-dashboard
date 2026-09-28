import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ComposerContextGroup,
  createSlotRegistry,
  PluginContextProvider,
} from "@blackbelt-technology/dashboard-plugin-runtime";
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

  it("IMPLEMENTING attached change: Explore + Archive hidden, Apply enabled", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir={true}
      />,
    );
    expect(screen.queryByTestId("composer-explore-btn")).toBeNull();
    expect((screen.getByTestId("composer-apply-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
  });

  it("COMPLETE attached change: Archive enabled", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[completeChange()]}
        openspecHasDir={true}
      />,
    );
    expect((screen.getByTestId("composer-archive-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("composer-verify-btn")).toBeTruthy();
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

  it("streaming session disables every action button", () => {
    // Refresh button moved to StatusBar `leading` slot — lives in App.tsx now.
    render(
      <ComposerSessionActions
        session={makeSession({ status: "streaming", attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir={true}
      />,
    );
    expect((screen.getByTestId("composer-apply-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("composer-artifact-t") as HTMLButtonElement).disabled).toBe(true);
  });

  // Lifecycle-bar gating. See change: compact-openspec-lifecycle-bar (E10, F13).
  describe("lifecycle gating (E10)", () => {
    const impl1239 = (): OpenSpecChange => ({ ...implementingChange(), completedTasks: 12, totalTasks: 39 });

    it("unattached → enabled Explore, no Archive", () => {
      render(<ComposerSessionActions session={makeSession()} changes={[impl1239()]} openspecHasDir />);
      expect((screen.getByTestId("composer-explore-btn") as HTMLButtonElement).disabled).toBe(false);
      expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
    });

    it("attached IMPLEMENTING 12/39 → no Explore/Archive; T chip is a count chip", () => {
      render(<ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[impl1239()]} openspecHasDir />);
      expect(screen.queryByTestId("composer-explore-btn")).toBeNull();
      expect(screen.queryByTestId("composer-archive-btn")).toBeNull();
      const chip = screen.getByTestId("composer-artifact-t");
      expect(chip.textContent).toContain("12/39");
      expect(chip.getAttribute("aria-label")).toBe("Tasks 12 of 39 done");
      const bar = chip.querySelector<HTMLElement>("[data-testid='composer-tasks-underline']");
      expect(bar?.style.width).toBe("31%");
    });

    it("attached COMPLETE → enabled Archive", () => {
      render(<ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[completeChange()]} openspecHasDir />);
      expect((screen.getByTestId("composer-archive-btn") as HTMLButtonElement).disabled).toBe(false);
    });

    it("skipped specs renders as done", () => {
      const c = { ...impl1239(), artifacts: [...implementingArtifacts.slice(0, 2), { id: "specs" as const, status: "skipped" as const }] };
      render(<ComposerSessionActions session={makeSession({ attachedProposal: "add-auth" })} changes={[c]} openspecHasDir />);
      expect(screen.getByTestId("composer-artifact-s").getAttribute("data-state")).toBe("done");
    });
  });

  it("streaming: P chip reads, tasks chip disabled with no popover (F13)", () => {
    const onReadArtifact = vi.fn();
    render(
      <ComposerSessionActions
        session={makeSession({ status: "streaming", attachedProposal: "add-auth" })}
        changes={[{ ...implementingChange(), completedTasks: 12, totalTasks: 39 }]}
        openspecHasDir
        onReadArtifact={onReadArtifact}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-artifact-p"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
    const t = screen.getByTestId("composer-artifact-t") as HTMLButtonElement;
    expect(t.disabled).toBe(true);
    fireEvent.click(t);
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
    expect((screen.getByTestId("composer-explore-btn") as HTMLButtonElement).disabled).toBe(true);
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
