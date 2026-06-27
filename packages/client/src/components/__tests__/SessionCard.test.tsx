import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, renderHook } from "@testing-library/react";
import React from "react";
import { SessionCard, GroupGitInfo, branchCache } from "../SessionCard.js";
import { useSessionActions } from "../../hooks/useSessionActions.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

afterEach(() => cleanup());

function makeSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "test-session",
    cwd: "/home/user/project",
    source: "tui",
    status: "active",
    startedAt: Date.now() - 60000,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    ...overrides,
  };
}

const defaultProps = {
  selectedId: undefined,
  onSelect: () => {},
  now: Date.now(),
  showGitInfo: false,
  isHidden: false,
  onHide: () => {},
  onUnhide: () => {},
};

describe("SessionCard", () => {
  it("should render session name or fallback to cwd", () => {
    const session = makeSession({ name: "My Session" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("My Session")).toBeTruthy();
  });

  it("should show active status indicator", () => {
    const session = makeSession({ status: "active" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    // Status indicator is the source icon colored by the idle status token.
    const statusIcon = container.querySelector('[class*="status-idle"]');
    expect(statusIcon).toBeTruthy();
  });

  it("should highlight when selected", () => {
    const session = makeSession();
    const { container } = render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" />
    );
    const card = container.firstChild as HTMLElement;
    // Current selected-state styling uses a full blue border + blue tint
    // + ring, not the older `border-l-blue-500` left-accent.
    expect(card.className).toContain("border-blue-500/60");
  });

  it("should call onSelect when clicked", () => {
    const onSelect = vi.fn();
    const session = makeSession();
    const { container } = render(
      <SessionCard session={session} {...defaultProps} onSelect={onSelect} />
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("test-session");
  });

  it("should show cost when present", () => {
    const session = makeSession({ cost: 0.42 });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("$0.42")).toBeTruthy();
  });

  it("should show source badge via gutter title (TUI prefix)", () => {
    const session = makeSession({ source: "tui" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const titled = container.querySelector('[title^="TUI"]');
    expect(titled).toBeTruthy();
  });

  it("should show git branch when showGitInfo is true", () => {
    const session = makeSession({ gitBranch: "feature/test" });
    render(
      <SessionCard session={session} {...defaultProps} showGitInfo={true} />
    );
    expect(screen.getByText("feature/test")).toBeTruthy();
  });

  it("should hide git branch when showGitInfo is false", () => {
    const session = makeSession({ gitBranch: "feature/test" });
    render(
      <SessionCard session={session} {...defaultProps} showGitInfo={false} />
    );
    expect(screen.queryByText("feature/test")).toBeNull();
  });

  it("shows red dot when hasError", () => {
    const session = makeSession({ status: "active" });
    const { container } = render(
      <SessionCard session={session} {...defaultProps} hasError={true} />,
    );
    expect(container.querySelector('[class*="status-error"]')).toBeTruthy();
  });

  it("shows working-token pulsing icon when isRetrying without lastError", () => {
    const session = makeSession({ status: "active" });
    const { container } = render(
      <SessionCard session={session} {...defaultProps} isRetrying={true} />,
    );
    const icon = container.querySelector('[data-testid="session-status-icon"]') as HTMLElement;
    expect(icon.className).toContain("status-working");
    expect(icon.className).toContain("animate-pulse");
  });

  it("error icon wins over retry icon", () => {
    const session = makeSession({ status: "active" });
    const { container } = render(
      <SessionCard session={session} {...defaultProps} hasError={true} isRetrying={true} />,
    );
    expect(container.querySelector('[class*="status-error"]')).toBeTruthy();
    expect(container.querySelector('[class*="status-working"]')).toBeNull();
  });

  it("should show ended status for ended sessions", () => {
    const session = makeSession({ status: "ended" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    // Ended sessions render the source icon via the status-icon span using
    // a muted text color (rather than the active green/yellow/red palette).
    const statusIcon = container.querySelector('[data-testid="session-status-icon"]');
    expect(statusIcon).toBeTruthy();
    expect(statusIcon!.className).toContain("text-[var(--text-muted)]");
  });

  it("should show shutdown button when session is active and selected", () => {
    const onShutdown = vi.fn();
    const session = makeSession({ status: "active" });
    render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" onShutdown={onShutdown} />
    );
    const shutdownBtn = screen.queryByTestId("session-close-btn");
    expect(shutdownBtn).toBeTruthy();
  });

  it("should NOT show shutdown button when session is ended", () => {
    const onShutdown = vi.fn();
    const session = makeSession({ status: "ended" });
    render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" onShutdown={onShutdown} />
    );
    const shutdownBtn = screen.queryByTestId("shutdown-button");
    // Ended sessions should not have shutdown button
    expect(onShutdown).not.toHaveBeenCalled();
  });

  it("should show OpenSpec actions when selected and has changes", () => {
    const session = makeSession();
    const changes = [{ name: "feat-a", status: "in-progress" as const, completedTasks: 1, totalTasks: 3, artifacts: [] }];
    render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" openspecChanges={changes}
        onSendPrompt={() => {}} onAttachProposal={() => {}} onDetachProposal={() => {}} />
    );
    expect(screen.getByTestId("session-openspec-actions")).toBeTruthy();
  });

  it("should show OpenSpec actions even when not selected (renders on all cards with changes)", () => {
    const session = makeSession();
    const changes = [{ name: "feat-a", status: "in-progress" as const, completedTasks: 1, totalTasks: 3, artifacts: [] }];
    render(
      <SessionCard session={session} {...defaultProps} selectedId="other" openspecChanges={changes}
        onSendPrompt={() => {}} onAttachProposal={() => {}} onDetachProposal={() => {}} />
    );
    expect(screen.getByTestId("session-openspec-actions")).toBeTruthy();
  });

  it("should NOT show OpenSpec actions when no changes", () => {
    const session = makeSession();
    render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" />
    );
    expect(screen.queryByTestId("session-openspec-actions")).toBeNull();
  });

  it("should apply card-working-pulse animation when streaming", () => {
    const session = makeSession({ status: "streaming" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-working-pulse");
  });

  it("should apply card-working-pulse animation when resuming", () => {
    const session = makeSession({ status: "idle", resuming: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-working-pulse");
  });

  it("should NOT apply card-working-pulse animation when idle", () => {
    const session = makeSession({ status: "idle" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain("card-working-pulse");
  });

  it("should NOT apply card-working-pulse animation when ended", () => {
    const session = makeSession({ status: "ended" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain("card-working-pulse");
  });

  it("should apply card-input-stripes when currentTool is ask_user", () => {
    const session = makeSession({ status: "streaming", currentTool: "ask_user" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-input-stripes");
    expect(card.className).not.toContain("card-working-pulse");
  });

  it("should apply card-working-pulse when streaming with a non-ask_user tool", () => {
    const session = makeSession({ status: "streaming", currentTool: "Read" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-working-pulse");
    expect(card.className).not.toContain("card-input-stripes");
  });

  // Unread / gray stripes — see change: session-card-unread-stripes.
  it("should apply card-unread-pulse when unread and idle", () => {
    const session = makeSession({ status: "idle", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-unread-pulse");
    expect(card.className).not.toContain("card-working-pulse");
    expect(card.className).not.toContain("card-input-stripes");
  });

  it("should NOT apply card-unread-pulse when unread is false", () => {
    const session = makeSession({ status: "idle", unread: false });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain("card-unread-pulse");
  });

  it("should NOT apply card-unread-pulse when unread is undefined", () => {
    const session = makeSession({ status: "idle" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).not.toContain("card-unread-pulse");
  });

  it("streaming wins over unread (yellow takes precedence over gray)", () => {
    const session = makeSession({ status: "streaming", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-working-pulse");
    expect(card.className).not.toContain("card-unread-pulse");
  });

  it("ask_user wins over unread (purple takes precedence over gray)", () => {
    const session = makeSession({ status: "streaming", currentTool: "ask_user", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-input-stripes");
    expect(card.className).not.toContain("card-unread-pulse");
    expect(card.className).not.toContain("card-working-pulse");
  });

  it("ended-and-unread session still shows gray stripes", () => {
    const session = makeSession({ status: "ended", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-unread-pulse");
  });

  it("should show 'Needs you' (not 'Waiting for input') when currentTool is ask_user", () => {
    const session = makeSession({ status: "streaming", currentTool: "ask_user" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("Needs you")).toBeTruthy();
    expect(screen.queryByText("ask_user")).toBeNull();
    expect(screen.queryByText("Waiting for input")).toBeNull();
  });

  it("should show 'Idle' (not 'Waiting for input') for an idle, no-tool session", () => {
    const session = makeSession({ status: "idle" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("Idle")).toBeTruthy();
    expect(screen.queryByText("Waiting for input")).toBeNull();
  });

  it("blocked (ask_user) and idle labels are distinct strings", () => {
    const blocked = makeSession({ id: "b1", status: "streaming", currentTool: "ask_user" });
    const { unmount } = render(<SessionCard session={blocked} {...defaultProps} />);
    expect(screen.getByText("Needs you")).toBeTruthy();
    unmount();
    const idle = makeSession({ id: "i1", status: "idle" });
    render(<SessionCard session={idle} {...defaultProps} />);
    expect(screen.getByText("Idle")).toBeTruthy();
  });

  it("renders a distinct status-shape per state (needs-you filled vs idle ring)", () => {
    const blocked = makeSession({ id: "b2", status: "streaming", currentTool: "ask_user" });
    const { container: c1, unmount } = render(<SessionCard session={blocked} {...defaultProps} />);
    const blockedIcon = c1.querySelector('[data-testid="session-status-icon"]') as HTMLElement;
    expect(blockedIcon.getAttribute("data-status-shape")).toBe("needs-you");
    unmount();
    const idle = makeSession({ id: "i2", status: "idle" });
    const { container: c2 } = render(<SessionCard session={idle} {...defaultProps} />);
    const idleIcon = c2.querySelector('[data-testid="session-status-icon"]') as HTMLElement;
    expect(idleIcon.getAttribute("data-status-shape")).toBe("idle");
  });

  it("should render compact context bar inline with activity and cost", () => {
    const session = makeSession({ status: "streaming", currentTool: "Read", cost: 1.5 });
    render(
      <SessionCard
        session={session}
        {...defaultProps}
        contextUsage={{ tokens: 5000, contextWindow: 10000 }}
      />
    );
    // Context bar, activity indicator, and cost should all be in the same parent row
    const bar = screen.getByTestId("context-usage-bar");
    const row = bar.parentElement!;
    // Cost is in the same row
    expect(row.textContent).toContain("$1.50");
    // Activity indicator (tool name) is in the same row
    expect(row.textContent).toContain("Read");
    // Bar is compact (w-16, no percentage text)
    expect(bar.className).toContain("w-16");
    expect(screen.queryByTestId("context-usage-pct")).toBeNull();
  });

  it("should render compact context bar inline on mobile card", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const session = makeSession({ status: "streaming", cost: 2.0, model: "claude-4" });
    render(
      <SessionCard
        session={session}
        {...defaultProps}
        contextUsage={{ tokens: 3000, contextWindow: 10000 }}
      />
    );

    const bar = screen.getByTestId("context-usage-bar");
    const row = bar.parentElement!;
    // Cost and model in the same row
    expect(row.textContent).toContain("$2.00");
    expect(row.textContent).toContain("claude-4");
    // Bar is compact
    expect(bar.className).toContain("w-16");
    expect(screen.queryByTestId("context-usage-pct")).toBeNull();

    // Restore
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  // ── mobile attached-proposal chip ───────────────────────────────
  // See change: fix-mobile-attach-proposal-display.

  it("renders mobile-card-attached-chip on mobile when attachedProposal is set", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const session = makeSession({ attachedProposal: "add-auth" });
    render(<SessionCard session={session} {...defaultProps} />);

    const chip = screen.getByTestId("mobile-card-attached-chip");
    expect(chip.textContent).toContain("add-auth");

    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  // ── mobile PROCESS subcard ─────────────────────────────────────────────────────────
  // See change: redesign-process-list-activity-bar (task 4).

  it("mobile: activity bar full-width rows; drawer collapses to a chip", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const session = makeSession();
    const proc = { pid: 1, pgid: 1, command: "vitest --watch", elapsedMs: 60_000 } as any;
    const bashTool = { toolCallId: "tc-1", command: "npm test", startedAt: Date.now() - 5000 };
    const { getByTestId } = render(
      <SessionCard
        session={session}
        {...defaultProps}
        processes={[proc]}
        onKillProcess={() => {}}
        inflightBashTools={[bashTool]}
        onAbortTool={() => {}}
      />,
    );
    expect(getByTestId("session-activity-bar")).toBeTruthy();
    const chip = getByTestId("background-drawer-chip");
    expect(chip.textContent).toContain("1");

    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("mobile: tapping chip opens sheet with full process list", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const session = makeSession();
    const proc = { pid: 1, pgid: 1, command: "vitest --watch", elapsedMs: 60_000 } as any;
    const { getByTestId, queryByTestId } = render(
      <SessionCard
        session={session}
        {...defaultProps}
        processes={[proc]}
        onKillProcess={() => {}}
        inflightBashTools={[]}
        onAbortTool={() => {}}
      />,
    );
    expect(queryByTestId("background-drawer-sheet")).toBeNull();
    fireEvent.click(getByTestId("background-drawer-chip"));
    const sheet = getByTestId("background-drawer-sheet");
    expect(sheet.textContent).toContain("vitest --watch");

    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("does NOT render mobile-card-attached-chip when attachedProposal is null/undefined", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const sessionA = makeSession({ attachedProposal: null });
    const { unmount } = render(<SessionCard session={sessionA} {...defaultProps} />);
    expect(screen.queryByTestId("mobile-card-attached-chip")).toBeNull();
    unmount();

    const sessionB = makeSession({ attachedProposal: undefined });
    render(<SessionCard session={sessionB} {...defaultProps} />);
    expect(screen.queryByTestId("mobile-card-attached-chip")).toBeNull();

    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });

  it("renders mobile attached chip and OpenSpecActivityBadge simultaneously (different facts)", async () => {
    const { useMobile } = await import("../../hooks/useMobile.js");
    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);

    const session = makeSession({
      attachedProposal: "add-auth",
      openspecPhase: "apply",
      openspecChange: "fix-bug",
    } as Partial<DashboardSession>);
    render(<SessionCard session={session} {...defaultProps} />);

    expect(screen.getByTestId("mobile-card-attached-chip").textContent).toContain("add-auth");
    // OpenSpecActivityBadge renders its phase + change name; assert it's distinct.
    expect(screen.getByText(/fix-bug/)).toBeDefined();

    (useMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
  });
});

// Mock fetch for GroupGitInfo server-side branch lookup
const origFetch = globalThis.fetch;

describe("GroupGitInfo", () => {
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("renders branch icon as clickable button", () => {
    const onClick = vi.fn();
    const sessions = [makeSession({ gitBranch: "main" })];
    render(<GroupGitInfo sessions={sessions} cwd="/test" onBranchClick={onClick} />);
    const btn = screen.getByTestId("git-branch-btn");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  it("renders branch name for normal branch", () => {
    const sessions = [makeSession({ gitBranch: "feature/new" })];
    render(<GroupGitInfo sessions={sessions} cwd="/test" />);
    expect(screen.getByText("feature/new")).toBeTruthy();
  });

  it("renders detached HEAD (short SHA)", () => {
    const sessions = [makeSession({ gitBranch: "abc1234" })];
    render(<GroupGitInfo sessions={sessions} cwd="/test" />);
    expect(screen.getByText("abc1234")).toBeTruthy();
  });

  it("shows dimmed icon when no git branch info and fetch fails", () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fail"));
    const onClick = vi.fn();
    const sessions = [makeSession()];
    render(<GroupGitInfo sessions={sessions} cwd="/test" onBranchClick={onClick} />);
    const btn = screen.getByTestId("git-init-btn");
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });

  // ── folder-head precedence (refresh-folder-header-branch) ───────────────

  it("git_head_update overwrites a stale branchCache REST seed", () => {
    // Seed the module-level REST cache so first paint shows os/foo.
    branchCache.set("/seed", { branch: "os/foo", noGit: false });
    const sessions = [makeSession()]; // no gitBranch → uses seed
    const { rerender } = render(<GroupGitInfo sessions={sessions} cwd="/seed" />);
    expect(screen.getByText("os/foo")).toBeTruthy();
    // git_head_update arrives → folderBranch develop overrides the seed.
    rerender(<GroupGitInfo sessions={sessions} cwd="/seed" folderBranch="develop" />);
    expect(screen.getByText("develop")).toBeTruthy();
    expect(screen.queryByText("os/foo")).toBeNull();
    branchCache.delete("/seed");
  });

  it("folder HEAD outranks a leaked child-worktree branch", () => {
    const sessions = [makeSession({ gitBranch: "os/foo" })];
    render(<GroupGitInfo sessions={sessions} cwd="/repo" folderBranch="develop" />);
    expect(screen.getByText("develop")).toBeTruthy();
    expect(screen.queryByText("os/foo")).toBeNull();
  });

  it("with no folderBranch entry, falls back to session.gitBranch", () => {
    const sessions = [makeSession({ gitBranch: "os/foo" })];
    render(<GroupGitInfo sessions={sessions} cwd="/repo" />);
    expect(screen.getByText("os/foo")).toBeTruthy();
  });

  it("folderBranch null renders the Init git non-git state", () => {
    const sessions = [makeSession({ gitBranch: "os/foo" })];
    render(<GroupGitInfo sessions={sessions} cwd="/repo" folderBranch={null} />);
    expect(screen.getByTestId("git-init-btn")).toBeTruthy();
    expect(screen.getByText("Init git")).toBeTruthy();
  });
});

// ── Subcard structure (redesign-session-card-subcards) ────────────────────────

describe("SessionCard subcard structure", () => {
  it("renders OPENSPEC, GIT, PROCESS subcard titles in order when populated", () => {
    const session = makeSession({ gitBranch: "feature/test" });
    const changes = [{ name: "feat-a", status: "in-progress" as const, completedTasks: 1, totalTasks: 3, artifacts: [] }];
    const { container } = render(
      <SessionCard
        session={session}
        {...defaultProps}
        showGitInfo={true}
        openspecChanges={changes}
        onSendPrompt={() => {}}
        onAttachProposal={() => {}}
        onDetachProposal={() => {}}
        commands={[{ name: "flows:new" } as any]}
        processes={[{ pid: 123, pgid: 123, command: "node", elapsedMs: 1000 } as any]}
        onKillProcess={() => {}}
      />,
    );
    // Subcard titles are rendered as capsule legends (uppercase, rounded-full).
    const titles = Array.from(container.querySelectorAll(".uppercase.rounded-full")).map(
      (el) => el.textContent,
    );
    // MEMORY and FLOWS are intentionally absent (no plugin contributes in this
    // test — the plugin registry is not populated). See change:
    // add-flows-subcard for the new FLOWS subcard's wiring.
    // The STATUS subcard (session-card-badge slot) is absent here because no
    // plugin claims session-card-badge in this test.
    const filtered = titles.filter((t) => t && /^(OPENSPEC|GIT|STATUS|PROCESS|FLOWS|MEMORY)$/.test(t));
    expect(filtered).toEqual(["OPENSPEC", "GIT", "PROCESS"]);
  });

  it("hides FLOWS subcard when no plugin claims session-card-flows", () => {
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByText("FLOWS")).toBeNull();
  });

  it("hides PROCESS subcard when processes array is empty", () => {
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...defaultProps}
        processes={[]}
        onKillProcess={() => {}}
      />,
    );
    expect(screen.queryByText("PROCESS")).toBeNull();
  });

  // ── PROCESS subcard four-state matrix ──────────────────────────────────
  // See change: redesign-process-list-activity-bar (Mermaid state machine).
  // States: Hidden / ActiveOnly / OrphansOnly / Both.
  describe("PROCESS subcard composition (redesign-process-list-activity-bar)", () => {
    const proc = { pid: 123, pgid: 123, command: "vitest --watch", elapsedMs: 60_000 } as any;
    const bashTool = { toolCallId: "tc-1", command: "npm test", startedAt: Date.now() - 5000 };

    it("Hidden: empty activity + empty drawer → no PROCESS subcard", () => {
      const session = makeSession();
      render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[]}
          onKillProcess={() => {}}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(screen.queryByText("PROCESS")).toBeNull();
    });

    it("ActiveOnly: activity bar visible, drawer absent", () => {
      const session = makeSession();
      const { queryByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[]}
          onKillProcess={() => {}}
          inflightBashTools={[bashTool]}
          onAbortTool={() => {}}
        />,
      );
      expect(screen.getByText("PROCESS")).toBeTruthy();
      expect(queryByTestId("session-activity-bar")).toBeTruthy();
      expect(queryByTestId("background-drawer")).toBeNull();
      expect(queryByTestId("background-drawer-summary")).toBeNull();
    });

    it("OrphansOnly: drawer visible AND collapsed by default (no stored choice)", () => {
      const session = makeSession();
      const { getByTestId, queryByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(screen.getByText("PROCESS")).toBeTruthy();
      expect(queryByTestId("session-activity-bar")).toBeNull();
      // See change: persist-process-drawer-collapse — default is collapsed.
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("false");
    });

    it("stored processDrawerCollapsed=false renders the drawer expanded", () => {
      const session = makeSession({ processDrawerCollapsed: false });
      const { getByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("true");
    });

    it("stored processDrawerCollapsed=true renders the drawer collapsed", () => {
      const session = makeSession({ processDrawerCollapsed: true });
      const { getByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("false");
    });

    it("Both: activity bar visible AND drawer collapsed by default", () => {
      const session = makeSession();
      const { getByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          inflightBashTools={[bashTool]}
          onAbortTool={() => {}}
        />,
      );
      expect(screen.getByText("PROCESS")).toBeTruthy();
      expect(getByTestId("session-activity-bar")).toBeTruthy();
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("false");
    });

    it("toggle flips optimistically AND persists via onSetProcessDrawerCollapsed", () => {
      const onSetProcessDrawerCollapsed = vi.fn();
      // Stored expanded (collapsed=false); user clicks to collapse.
      const session = makeSession({ processDrawerCollapsed: false });
      const { getByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          onSetProcessDrawerCollapsed={onSetProcessDrawerCollapsed}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("true");
      fireEvent.click(getByTestId("background-drawer-summary"));
      // Optimistic local flip: now collapsed.
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("false");
      // Persisted the new collapsed value server-side.
      expect(onSetProcessDrawerCollapsed).toHaveBeenCalledWith(true);
    });

    it("reconciles when the authoritative processDrawerCollapsed changes (other client)", () => {
      const session = makeSession({ processDrawerCollapsed: true });
      const { getByTestId, rerender } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("false");
      // A broadcast from another client flips it to expanded.
      rerender(
        <SessionCard
          session={makeSession({ processDrawerCollapsed: false })}
          {...defaultProps}
          processes={[proc]}
          onKillProcess={() => {}}
          inflightBashTools={[]}
          onAbortTool={() => {}}
        />,
      );
      expect(getByTestId("background-drawer-summary").getAttribute("aria-expanded")).toBe("true");
    });

    it("activity bar stop button invokes onAbortTool with toolCallId", () => {
      const onAbortTool = vi.fn();
      const session = makeSession();
      const { getByTestId } = render(
        <SessionCard
          session={session}
          {...defaultProps}
          inflightBashTools={[bashTool]}
          onAbortTool={onAbortTool}
        />,
      );
      fireEvent.click(getByTestId("session-activity-stop"));
      expect(onAbortTool).toHaveBeenCalledWith("tc-1");
    });
  });

  it("hides MEMORY subcard when no plugin claims session-card-memory", () => {
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByText("MEMORY")).toBeNull();
  });

  it("hides OPENSPEC subcard when handlers are absent", () => {
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByText("OPENSPEC")).toBeNull();
  });

  it("hides WORKSPACE subcard when showGitInfo is false and no badge plugin", () => {
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} showGitInfo={false} />);
    expect(screen.queryByText("WORKSPACE")).toBeNull();
  });

  it("selected card retains blue accent ring after subcard refactor", () => {
    const session = makeSession();
    const { container } = render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" />,
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("border-blue-500/60");
    expect(card.className).toContain("ring-1");
    expect(card.className).toContain("ring-blue-500/30");
  });

  it("streaming session retains card-working-pulse on outer li", () => {
    const session = makeSession({ status: "streaming" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-working-pulse");
  });
});

// ── Status-tinted mosaic rail (left gutter) ─────────────────────────────
// See change: add-session-card-status-mosaic-rail.

describe("SessionCard left-gutter mosaic rail", () => {
  function railEl(container: HTMLElement): HTMLElement {
    const el = container.querySelector("[data-rail-bg]") as HTMLElement | null;
    if (!el) throw new Error("rail element not found");
    return el;
  }

  it("renders idle-token rail tint for idle/active sessions", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "idle" })} {...defaultProps} />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[color-mix(in_srgb,var(--status-idle)_40%,transparent)]");
  });

  it("renders working-token rail tint for streaming sessions", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "streaming" })} {...defaultProps} />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[color-mix(in_srgb,var(--status-working)_40%,transparent)]");
  });

  it("renders needs-you-token rail tint for chat-routed ask_user (not green/idle)", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "streaming", currentTool: "ask_user" })} {...defaultProps} />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[color-mix(in_srgb,var(--status-needs-you)_40%,transparent)]");
  });

  it("renders muted rail palette for ended sessions", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "ended" })} {...defaultProps} />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[var(--bg-surface)]");
  });

  it("renders red rail palette when hasError is true", () => {
    const { container } = render(
      <SessionCard
        session={makeSession({ status: "idle" })}
        {...defaultProps}
        hasError={true}
      />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[color-mix(in_srgb,var(--status-error)_40%,transparent)]");
  });

  it("selected idle session uses brighter -400/65 palette", () => {
    const { container } = render(
      <SessionCard
        session={makeSession({ status: "idle" })}
        {...defaultProps}
        selectedId="test-session"
      />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[color-mix(in_srgb,var(--status-idle)_65%,transparent)]");
  });

  it("selected streaming session uses brighter -400/65 palette", () => {
    const { container } = render(
      <SessionCard
        session={makeSession({ status: "streaming" })}
        {...defaultProps}
        selectedId="test-session"
      />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-[color-mix(in_srgb,var(--status-working)_65%,transparent)]");
  });

  it("rail bar is a centered capsule (rounded-full, 6px wide, top-2 bottom-2)", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "idle" })} {...defaultProps} />,
    );
    const bar = railEl(container).querySelector("[aria-hidden=true]") as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar!.className).toMatch(/absolute/);
    expect(bar!.className).toMatch(/left-1\/2/);
    expect(bar!.className).toMatch(/-translate-x-1\/2/);
    expect(bar!.className).toMatch(/w-1\.5/);
    expect(bar!.className).toMatch(/rounded-full/);
    expect(bar!.className).toMatch(/top-7/);
    expect(bar!.className).toMatch(/bottom-2/);
    // Status palette class is applied.
    expect(bar!.className).toContain("bg-[color-mix(in_srgb,var(--status-idle)_40%,transparent)]");
  });

  it("source icon sits in a circular tertiary-surface chip above the rail bar", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "idle" })} {...defaultProps} />,
    );
    const icon = container.querySelector("[data-testid='session-status-icon']") as HTMLElement | null;
    expect(icon).toBeTruthy();
    expect(icon!.className).toContain("bg-[var(--bg-tertiary)]");
    expect(icon!.className).toContain("rounded-full");
    expect(icon!.className).toMatch(/w-4/);
    expect(icon!.className).toMatch(/h-4/);
    // Chip sits above the rail bar via z-10.
    expect(icon!.className).toMatch(/z-10/);
  });
});

// ── Mobile parity ────────────────────────────────────────────────────────────

describe("SessionCard mobile branch unchanged by subcard refactor", () => {
  it("mobile card renders no subcard panels", async () => {
    const useMobileMod = await import("../../hooks/useMobile.js");
    (useMobileMod.useMobile as any).mockReturnValueOnce(true);
    const session = makeSession({ gitBranch: "main" });
    const changes = [{ name: "x", status: "in-progress" as const, completedTasks: 0, totalTasks: 1, artifacts: [] }];
    const { container } = render(
      <SessionCard
        session={session}
        {...defaultProps}
        showGitInfo={true}
        openspecChanges={changes}
        onSendPrompt={() => {}}
        onAttachProposal={() => {}}
        onDetachProposal={() => {}}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).toBeNull();
    expect(screen.queryByText("WORKSPACE")).toBeNull();
    expect(screen.queryByText("FLOWS")).toBeNull();
    // No inset subcard panels rendered (subcards use color-mix bg + rounded-lg).
    expect(container.querySelector("[class*='color-mix'].rounded-lg")).toBeNull();
  });
});

describe("SessionCard — OPENSPEC subcard visibility (auto-hide-empty-session-subcards)", () => {
  const baseProps = {
    ...defaultProps,
    onSendPrompt: () => {},
    onAttachProposal: () => {},
    onDetachProposal: () => {},
  };

  it("hides OPENSPEC subcard when openspecInitialized=false and pending=false (no openspec/ dir)", () => {
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={false}
        openspecPending={false}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).toBeNull();
  });

  it("hides OPENSPEC subcard when openspecInitialized=false and pending=false (also covers globally disabled — same payload)", () => {
    // Server broadcasts the same cleared shape for both "no openspec dir" and
    // "openspec.enabled === false". This scenario covers the disabled case.
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={false}
        openspecPending={false}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).toBeNull();
  });

  it("shows OPENSPEC subcard when pending=true (cold-boot)", () => {
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={false}
        openspecPending={true}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });

  it("shows OPENSPEC subcard when openspecInitialized=true even with empty changes (attach CTA)", () => {
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={true}
        openspecPending={false}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });

  it("shows OPENSPEC subcard for legacy callers (openspecInitialized undefined preserves visibility)", () => {
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        // openspecInitialized + openspecPending omitted — legacy parent
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });
});

describe("SessionCard — openspecHasDir (auto-hide-empty-session-subcards)", () => {
  const baseProps = {
    ...defaultProps,
    onSendPrompt: () => {},
    onAttachProposal: () => {},
    onDetachProposal: () => {},
  };

  it("shows OPENSPEC subcard when openspecHasDir=true even with initialized=false and no changes", () => {
    // Fresh `openspec init` project: openspec/ exists, openspec/changes/ does
    // not, openspec list errors out. The subcard must still render as an
    // init/attach affordance.
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={false}
        openspecPending={false}
        openspecHasDir={true}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });

  it("hides OPENSPEC subcard when openspecHasDir=false (truly not an OpenSpec project)", () => {
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={false}
        openspecPending={false}
        openspecHasDir={false}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).toBeNull();
  });

  it("shows OPENSPEC subcard when openspecHasDir=false but pending=true (cold-boot)", () => {
    // Edge case: openspecHasDir was probed before changes/ existed, but the
    // poll is still in flight. Keep the subcard visible so it doesn't blink.
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecHasDir={false}
        openspecPending={true}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });

  it("openspecHasDir takes precedence over openspecInitialized when both present", () => {
    // openspecHasDir=true wins even if openspecInitialized=false.
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={false}
        openspecPending={false}
        openspecHasDir={true}
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });

  it("falls back to legacy (initialized||pending) when openspecHasDir undefined", () => {
    // Old broadcast or legacy parent — backwards-compat check.
    const session = makeSession();
    render(
      <SessionCard
        session={session}
        {...baseProps}
        openspecChanges={[]}
        openspecInitialized={true}
        openspecPending={false}
        // openspecHasDir intentionally omitted
      />,
    );
    expect(screen.queryByText("OPENSPEC")).not.toBeNull();
  });
});

describe("SessionCard — +Session sibling-spawn button (session-card-plus-session-button)", () => {
  const spawnProps = { ...defaultProps, onSpawnSibling: () => {} };

  it("2.1 renders for a live session (status !== ended)", () => {
    const session = makeSession({ status: "streaming" });
    render(<SessionCard session={session} {...spawnProps} />);
    expect(screen.getByTestId("session-card-spawn-sibling")).toBeTruthy();
  });

  it("2.2 renders for an ended session alongside Fork", () => {
    const session = makeSession({ status: "ended", sessionFile: "/sess/x.jsonl" });
    render(<SessionCard session={session} {...spawnProps} onResume={() => {}} />);
    expect(screen.getByTestId("session-card-spawn-sibling")).toBeTruthy();
    expect(screen.getByText("Fork")).toBeTruthy();
  });

  it("2.3 renders even when sessionFile is absent (no Fork-style gating)", () => {
    const session = makeSession({ status: "ended", sessionFile: undefined });
    render(<SessionCard session={session} {...spawnProps} onResume={() => {}} />);
    // Fork is gated on sessionFile; +Session is not.
    expect(screen.queryByText("Fork")).toBeNull();
    expect(screen.getByTestId("session-card-spawn-sibling")).toBeTruthy();
  });

  it("2.4 click invokes handler with the session", () => {
    const onSpawnSibling = vi.fn();
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} onSpawnSibling={onSpawnSibling} />);
    fireEvent.click(screen.getByTestId("session-card-spawn-sibling"));
    expect(onSpawnSibling).toHaveBeenCalledWith(session);
  });

  it("2.5 cwdMissing → disabled attribute + tooltip changes", () => {
    const session = makeSession({ cwdMissing: true });
    render(<SessionCard session={session} {...spawnProps} />);
    const btn = screen.getByTestId("session-card-spawn-sibling") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("session's directory no longer exists");
  });

  it("2.6 no handler → button absent", () => {
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByTestId("session-card-spawn-sibling")).toBeNull();
  });
});

describe("SessionCard — +Session wiring through handleSpawnSession (session-card-plus-session-button)", () => {
  // Build a real handleSpawnSession from useSessionActions with stubbed deps,
  // then wire onSpawnSibling exactly as SessionList does:
  //   onSpawnSibling={(s) => onSpawnSession(s.cwd, s.attachedProposal || undefined)}
  // This exercises the full click → ws.send payload path (cwd, attachProposal
  // omission, requestId minting).
  //
  // NOTE: worktree sessions inherit the parent cwd unconditionally — a
  // worktree session's `cwd` is the worktree dir, so +Session spawns INSIDE
  // the worktree, never the main repo. Do not add gitWorktreeBase here; that
  // would change the clean-sibling semantic. See change:
  // session-card-plus-session-button (task 6.5).
  function setup() {
    const send = vi.fn();
    const { result } = renderHook(() =>
      useSessionActions({
        selectedId: undefined,
        send,
        navigate: () => {},
        setMobileOpen: () => {},
        sessions: new Map(),
        setSessions: () => {},
        setSessionStates: () => {},
        setSpawningCwds: () => {},
        setTerminals: () => {},
        clearSpawningCwd: () => {},
        spawnTimeoutsRef: { current: new Map() },
        pendingTerminalCwdRef: { current: null },
        terminals: new Map(),
        pendingSpawnsRef: { current: new Map() },
      } as any),
    );
    const onSpawnSession = result.current.handleSpawnSession;
    const onSpawnSibling = (s: any) => onSpawnSession(s.cwd, s.attachedProposal || undefined);
    return { send, onSpawnSibling };
  }

  it("4.1 click sends spawn_session with cwd + attachProposal + requestId", () => {
    const { send, onSpawnSibling } = setup();
    const session = makeSession({ cwd: "/project/foo", attachedProposal: "add-dark-mode" });
    render(<SessionCard session={session} {...defaultProps} onSpawnSibling={onSpawnSibling} />);
    fireEvent.click(screen.getByTestId("session-card-spawn-sibling"));
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload.type).toBe("spawn_session");
    expect(payload.cwd).toBe("/project/foo");
    expect(payload.attachProposal).toBe("add-dark-mode");
    expect(typeof payload.requestId).toBe("string");
    expect(payload.requestId.length).toBeGreaterThan(0);
  });

  it("4.2 click omits attachProposal key when parent has none", () => {
    const { send, onSpawnSibling } = setup();
    const session = makeSession({ cwd: "/project/bar", attachedProposal: undefined });
    render(<SessionCard session={session} {...defaultProps} onSpawnSibling={onSpawnSibling} />);
    fireEvent.click(screen.getByTestId("session-card-spawn-sibling"));
    const payload = send.mock.calls[0][0];
    expect(payload.cwd).toBe("/project/bar");
    expect("attachProposal" in payload).toBe(false);
    // Also true for empty-string proposal.
    send.mockClear();
    cleanup();
    const session2 = makeSession({ cwd: "/project/baz", attachedProposal: "" });
    render(<SessionCard session={session2} {...defaultProps} onSpawnSibling={onSpawnSibling} />);
    fireEvent.click(screen.getByTestId("session-card-spawn-sibling"));
    expect("attachProposal" in send.mock.calls[0][0]).toBe(false);
  });

  it("4.3 cwdMissing → button disabled, click does NOT send", () => {
    const { send, onSpawnSibling } = setup();
    const session = makeSession({ cwd: "/project/gone", cwdMissing: true });
    render(<SessionCard session={session} {...defaultProps} onSpawnSibling={onSpawnSibling} />);
    fireEvent.click(screen.getByTestId("session-card-spawn-sibling"));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("SessionCard — +Worktree button (session-card-plus-session-button)", () => {
  const wtProps = { ...defaultProps, onSpawnWorktree: () => {} };

  it("7.x renders when onSpawnWorktree supplied", () => {
    render(<SessionCard session={makeSession()} {...wtProps} />);
    const btn = screen.getByTestId("session-card-spawn-worktree");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Worktree");
    expect((btn as HTMLButtonElement).title).toBe("Create git worktree + spawn session inside it");
  });

  it("7.x absent when no handler", () => {
    render(<SessionCard session={makeSession()} {...defaultProps} />);
    expect(screen.queryByTestId("session-card-spawn-worktree")).toBeNull();
  });

  it("7.x absent when session is already a worktree session", () => {
    const session = makeSession({ gitWorktree: { name: "wt-x", base: "main" } as any });
    render(<SessionCard session={session} {...wtProps} />);
    expect(screen.queryByTestId("session-card-spawn-worktree")).toBeNull();
    // +Session is unaffected by the worktree gate.
    render(<SessionCard session={session} {...defaultProps} onSpawnSibling={() => {}} />);
    expect(screen.getByTestId("session-card-spawn-sibling")).toBeTruthy();
  });

  it("7.x click invokes handler with the session", () => {
    const onSpawnWorktree = vi.fn();
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} onSpawnWorktree={onSpawnWorktree} />);
    fireEvent.click(screen.getByTestId("session-card-spawn-worktree"));
    expect(onSpawnWorktree).toHaveBeenCalledWith(session);
  });

  it("7.x cwdMissing → disabled + tooltip changes", () => {
    const session = makeSession({ cwdMissing: true });
    render(<SessionCard session={session} {...wtProps} />);
    const btn = screen.getByTestId("session-card-spawn-worktree") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe("session's directory no longer exists");
  });

  it("7.x coexists with +Session", () => {
    render(<SessionCard session={makeSession()} {...defaultProps} onSpawnSibling={() => {}} onSpawnWorktree={() => {}} />);
    expect(screen.getByTestId("session-card-spawn-sibling")).toBeTruthy();
    expect(screen.getByTestId("session-card-spawn-worktree")).toBeTruthy();
  });
});
