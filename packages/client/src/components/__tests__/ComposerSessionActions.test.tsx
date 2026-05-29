import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ComposerSessionActions } from "../ComposerSessionActions.js";
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
    expect((screen.getByTestId("composer-archive-btn") as HTMLButtonElement).disabled).toBe(true);
  });

  it("IMPLEMENTING attached change: Explore disabled, Apply enabled, Archive disabled", () => {
    render(
      <ComposerSessionActions
        session={makeSession({ attachedProposal: "add-auth" })}
        changes={[implementingChange()]}
        openspecHasDir={true}
      />,
    );
    expect((screen.getByTestId("composer-explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("composer-apply-btn") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("composer-archive-btn") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("composer-archive-btn").getAttribute("title")).toBe("Complete tasks first");
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
    expect((screen.getByTestId("composer-explore-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("composer-apply-btn") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("composer-archive-btn") as HTMLButtonElement).disabled).toBe(true);
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
