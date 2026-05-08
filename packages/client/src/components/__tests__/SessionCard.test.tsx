import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { SessionCard } from "../SessionCard.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

vi.mock("../../lib/api-context.js", () => ({
  getApiBase: () => "",
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
    const statusDot = container.querySelector(".bg-green-500");
    expect(statusDot).toBeTruthy();
  });

  it("should highlight when selected", () => {
    const session = makeSession();
    const { container } = render(
      <SessionCard session={session} {...defaultProps} selectedId="test-session" />
    );
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("border-blue-500/60");
    expect(card.className).toContain("backdrop-blur-sm");
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

  it("should NOT show cost when 0", () => {
    const session = makeSession({ cost: 0 });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("should show cost when > 0", () => {
    const session = makeSession({ cost: 0.42 });
    render(<SessionCard session={session} {...defaultProps} />);
    const costs = screen.getAllByText("$0.42");
    expect(costs.length).toBeGreaterThan(0);
  });

  it("should show ended status for ended sessions", () => {
    const session = makeSession({ status: "ended" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const statusDot = container.querySelector(".bg-\\[var\\(--bg-surface\\)\\]");
    expect(statusDot).toBeTruthy();
  });

  it("should show shutdown button when session is alive and onShutdown provided", () => {
    const onShutdown = vi.fn();
    const session = makeSession({ status: "active" });
    render(
      <SessionCard session={session} {...defaultProps} onShutdown={onShutdown} />
    );
    const shutdownBtn = screen.queryByTestId("session-close-btn");
    expect(shutdownBtn).toBeTruthy();
  });

  it("should show shutdown button for streaming session with confirmation", () => {
    const onShutdown = vi.fn();
    window.confirm = vi.fn(() => true);
    const session = makeSession({ status: "streaming" });
    render(
      <SessionCard session={session} {...defaultProps} onShutdown={onShutdown} />
    );
    const shutdownBtn = screen.getByTestId("session-close-btn");
    fireEvent.click(shutdownBtn);
    expect(window.confirm).toHaveBeenCalled();
    expect(onShutdown).toHaveBeenCalledWith("test-session");
  });

  it("should apply streaming pulse background when streaming", () => {
    const session = makeSession({ status: "streaming" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("bg-yellow-500/10");
    expect(card.className).toContain("animate-pulse");
  });

  it("should apply streaming pulse when resuming", () => {
    const session = makeSession({ status: "idle", resuming: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("bg-yellow-500/10");
  });

  it("should apply ask_user pulse when currentTool is ask_user", () => {
    const session = makeSession({ status: "streaming", currentTool: "ask_user" });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("bg-purple-500/10");
  });

  it("should apply card-unread-pulse when unread and idle", () => {
    const session = makeSession({ status: "idle", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-unread-pulse");
  });

  it("should show meta chips for git branch", () => {
    const session = makeSession({ gitBranch: "feature/x" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("feature/x")).toBeTruthy();
  });

  it("should show meta chips for git branch with PR number", () => {
    const session = makeSession({ gitBranch: "feature/x", gitPrNumber: 42 });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("feature/x · #42")).toBeTruthy();
  });

  it("should show meta chips for worktree", () => {
    const session = makeSession({ worktree: { path: "/tmp/shadow/x", branch: "shadow/x" } });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("shadow/x")).toBeTruthy();
  });

  it("should show meta chips for attached proposal", () => {
    const session = makeSession({ attachedProposal: "add-auth" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("add-auth")).toBeTruthy();
  });

  it("should render all meta chips in one row", () => {
    const session = makeSession({
      gitBranch: "feature/x",
      gitPrNumber: 42,
      worktree: { path: "/tmp/shadow/x", branch: "shadow/x" },
      attachedProposal: "add-auth",
    });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("feature/x · #42")).toBeTruthy();
    expect(screen.getByText("shadow/x")).toBeTruthy();
    expect(screen.getByText("add-auth")).toBeTruthy();
  });

  it("should render OpenSpec badge when phase or change is set", () => {
    const session = makeSession({ openspecPhase: "apply", openspecChange: "feat-x" });
    render(<SessionCard session={session} {...defaultProps} />);
    // OpenSpecActivityBadge renders the change name
    expect(screen.getByText(/feat-x/)).toBeTruthy();
  });

  it("should NOT render OpenSpec badge when no phase or change", () => {
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByText(/openspec/i)).toBeNull();
  });

  it("should show Resume/Fork buttons for ended sessions with sessionFile", () => {
    const onResume = vi.fn();
    const session = makeSession({ status: "ended", sessionFile: "/path/to/session.jsonl" });
    render(<SessionCard session={session} {...defaultProps} onResume={onResume} />);
    expect(screen.getByText("Resume")).toBeTruthy();
    expect(screen.getByText("Fork")).toBeTruthy();
  });

  it("should show hide/unhide buttons", () => {
    const onHide = vi.fn();
    const onUnhide = vi.fn();
    const session = makeSession();
    render(<SessionCard session={session} {...defaultProps} onHide={onHide} onUnhide={onUnhide} />);
    expect(screen.getByTestId("session-hide-btn")).toBeTruthy();
  });

  it("should NOT show shutdown button when session is ended", () => {
    const session = makeSession({ status: "ended" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.queryByTestId("session-close-btn")).toBeNull();
  });

  it("should show model when present", () => {
    const session = makeSession({ model: "claude-sonnet-4" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("claude-sonnet-4")).toBeTruthy();
  });

  it("should show model with thinking level", () => {
    const session = makeSession({ model: "claude-sonnet-4", thinkingLevel: "high" });
    render(<SessionCard session={session} {...defaultProps} />);
    expect(screen.getByText("claude-sonnet-4 (high)")).toBeTruthy();
  });
});
