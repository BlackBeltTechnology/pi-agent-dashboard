/**
 * Tests for the WORKSPACE-subcard worktree pill rendered inside `GitInfo`.
 *
 * Pins the §5 contract from `add-worktree-spawn-dialog`:
 *   - Pill renders when `session.gitWorktree` is set (after the branch line).
 *   - Pill is absent when `gitWorktree` is undefined.
 *   - Tooltip is `created from <base>` when `base` is known.
 *   - Tooltip is generic `git worktree` when `base` is absent.
 *   - Mobile branch never renders the pill (GitInfo isn't invoked there).
 *   - Branch text is unchanged for worktree sessions.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { GitInfo, SessionCard, WorktreePill } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

afterEach(() => cleanup());

function mkSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1",
    cwd: "/repo",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 1000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    gitBranch: "feat/dark",
    ...overrides,
  };
}

describe("WorktreePill (standalone)", () => {
  it("renders the pill with 'created from <base>' tooltip when base is known", () => {
    const session = mkSession({
      gitWorktree: { mainPath: "/repo", name: "feat-dark", base: "develop" },
    });
    render(<WorktreePill session={session} />);
    const pill = screen.getByTestId("worktree-pill");
    expect(pill).toBeTruthy();
    // Pill text contains both the literal 'worktree' label and the
    // worktree name (rendered as `worktree · <name>`).
    expect(pill.textContent).toContain("worktree");
    expect(screen.getByTestId("worktree-pill-name").textContent).toBe("feat-dark");
    expect(pill.getAttribute("title")).toBe("created from develop");
  });

  it("omits the name suffix when gitWorktree.name is empty", () => {
    // Defensive: if a future bridge ever sends an empty name we still
    // render the bare 'worktree' label rather than a dangling separator.
    const session = mkSession({
      gitWorktree: { mainPath: "/repo", name: "" },
    });
    render(<WorktreePill session={session} />);
    const pill = screen.getByTestId("worktree-pill");
    expect(pill.textContent).toBe("worktree");
    expect(screen.queryByTestId("worktree-pill-name")).toBeNull();
  });

  it("renders the pill with generic 'git worktree' tooltip when base is absent", () => {
    const session = mkSession({
      gitWorktree: { mainPath: "/repo", name: "feat-dark" },
    });
    render(<WorktreePill session={session} />);
    const pill = screen.getByTestId("worktree-pill");
    expect(pill.getAttribute("title")).toBe("git worktree");
  });

  it("renders nothing when gitWorktree is absent", () => {
    const session = mkSession({ gitWorktree: undefined });
    const { container } = render(<WorktreePill session={session} />);
    expect(container.querySelector("[data-testid='worktree-pill']")).toBeNull();
  });

  it("carries expected styling tokens", () => {
    const session = mkSession({
      gitWorktree: { mainPath: "/repo", name: "feat-dark" },
    });
    render(<WorktreePill session={session} />);
    const pill = screen.getByTestId("worktree-pill");
    const classes = pill.className;
    expect(classes).toContain("inline-flex");
    expect(classes).toContain("rounded-full");
    expect(classes).toContain("uppercase");
    expect(classes).toContain("text-[9px]");
  });
});

describe("GitInfo + worktree pill integration", () => {
  it("renders branch unchanged AND the pill after the branch line when cwd is a worktree", () => {
    const session = mkSession({
      gitBranch: "feat/dark",
      gitWorktree: { mainPath: "/repo", name: "feat-dark", base: "develop" },
    });
    const { container } = render(<GitInfo session={session} />);
    // Branch text preserved verbatim.
    expect(container.textContent).toContain("feat/dark");
    const pill = screen.getByTestId("worktree-pill");
    expect(pill).toBeTruthy();
    // Pill must appear AFTER the branch element in document order.
    const branchEl = container.querySelector("span.truncate, a.truncate");
    expect(branchEl).toBeTruthy();
    if (branchEl) {
      expect(branchEl.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("renders no pill for sessions in a plain checkout (gitWorktree absent)", () => {
    const session = mkSession({ gitBranch: "main", gitWorktree: undefined });
    const { container } = render(<GitInfo session={session} />);
    expect(container.querySelector("[data-testid='worktree-pill']")).toBeNull();
  });

  it("renders no GitInfo (and no pill) when session has no gitBranch", () => {
    const session = mkSession({ gitBranch: undefined });
    const { container } = render(<GitInfo session={session} />);
    expect(container.querySelector("[data-testid='worktree-pill']")).toBeNull();
  });
});

describe("SessionCard worktree pill — mobile vs desktop", () => {
  it("desktop SessionCard renders the pill for worktree sessions", async () => {
    const session = mkSession({
      gitBranch: "feat/dark",
      gitWorktree: { mainPath: "/repo", name: "feat-dark", base: "develop" },
    });
    render(
      <SessionCard
        session={session}
        selectedId={undefined}
        onSelect={() => {}}
        now={Date.now()}
        showGitInfo={true}
        isHidden={false}
        onHide={() => {}}
        onUnhide={() => {}}
      />,
    );
    expect(screen.getByTestId("worktree-pill")).toBeTruthy();
  });

  it("desktop SessionCard renders the pill for worktree sessions EVEN when showGitInfo=false (multi-session group)", () => {
    // Regression: in multi-session folder groups SessionList passes
    // showGitInfo=false; the WORKSPACE subcard previously skipped GitInfo
    // entirely, hiding the worktree pill. Worktree sessions must still
    // render their own GitInfo + pill because their branch differs from
    // the group's main-checkout branch shown in GroupGitInfo.
    const session = mkSession({
      gitBranch: "feat/dark",
      gitWorktree: { mainPath: "/repo", name: "feat-dark", base: "develop" },
    });
    render(
      <SessionCard
        session={session}
        selectedId={undefined}
        onSelect={() => {}}
        now={Date.now()}
        showGitInfo={false}
        isHidden={false}
        onHide={() => {}}
        onUnhide={() => {}}
      />,
    );
    expect(screen.getByTestId("worktree-pill")).toBeTruthy();
  });

  it("desktop SessionCard with showGitInfo=false renders NO pill for plain-checkout sessions", () => {
    // Inverse of the regression: non-worktree sessions in multi-session
    // groups must remain pill-free (and the WORKSPACE subcard collapses
    // entirely when no other claimant forces it open).
    const session = mkSession({ gitBranch: "main", gitWorktree: undefined });
    const { container } = render(
      <SessionCard
        session={session}
        selectedId={undefined}
        onSelect={() => {}}
        now={Date.now()}
        showGitInfo={false}
        isHidden={false}
        onHide={() => {}}
        onUnhide={() => {}}
      />,
    );
    expect(container.querySelector("[data-testid='worktree-pill']")).toBeNull();
  });

  it("mobile SessionCard does NOT render the pill (GitInfo is not invoked)", async () => {
    // Override the mocked hook to return true (mobile mode).
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);
    const session = mkSession({
      gitBranch: "feat/dark",
      gitWorktree: { mainPath: "/repo", name: "feat-dark", base: "develop" },
    });
    const { container } = render(
      <SessionCard
        session={session}
        selectedId={undefined}
        onSelect={() => {}}
        now={Date.now()}
        showGitInfo={true}
        isHidden={false}
        onHide={() => {}}
        onUnhide={() => {}}
      />,
    );
    expect(container.querySelector("[data-testid='worktree-pill']")).toBeNull();
  });
});
