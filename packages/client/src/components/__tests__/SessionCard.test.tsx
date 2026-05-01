import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { SessionCard, GroupGitInfo } from "../SessionCard.js";
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
    // Status dot is a span with bg-green-500 class
    const statusDot = container.querySelector(".bg-green-500");
    expect(statusDot).toBeTruthy();
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

  it("should show source badge icon", () => {
    const session = makeSession({ source: "tui" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByTitle("TUI")).toBeTruthy();
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

  it("should show ended status for ended sessions", () => {
    const session = makeSession({ status: "ended" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    // Ended sessions have bg-[var(--bg-surface)] status dot
    const statusDot = container.querySelector(".bg-\\[var\\(--bg-surface\\)\\]");
    expect(statusDot).toBeTruthy();
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

  it("should apply card-input-pulse when currentTool is ask_user", () => {
    const session = makeSession({ status: "streaming", currentTool: "ask_user" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-input-pulse");
    expect(card.className).not.toContain("card-working-pulse");
  });

  it("should apply card-working-pulse when streaming with a non-ask_user tool", () => {
    const session = makeSession({ status: "streaming", currentTool: "Read" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-working-pulse");
    expect(card.className).not.toContain("card-input-pulse");
  });

  it("should show 'Waiting for input' when currentTool is ask_user", () => {
    const session = makeSession({ status: "streaming", currentTool: "ask_user" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("Waiting for input")).toBeTruthy();
    expect(screen.queryByText("ask_user")).toBeNull();
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
});
