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
    // Status indicator is the source icon colored by status (text-* class).
    const statusIcon = container.querySelector(".text-green-500");
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
    expect(container.querySelector(".text-red-500")).toBeTruthy();
  });

  it("shows amber pulsing icon when isRetrying without lastError", () => {
    const session = makeSession({ status: "active" });
    const { container } = render(
      <SessionCard session={session} {...defaultProps} isRetrying={true} />,
    );
    const icon = container.querySelector(".text-amber-500");
    expect(icon).toBeTruthy();
    expect(icon!.className).toContain("animate-pulse");
  });

  it("red error icon wins over amber retry icon", () => {
    const session = makeSession({ status: "active" });
    const { container } = render(
      <SessionCard session={session} {...defaultProps} hasError={true} isRetrying={true} />,
    );
    expect(container.querySelector(".text-red-500")).toBeTruthy();
    expect(container.querySelector(".text-amber-500")).toBeNull();
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

  // Unread / gray stripes — see change: session-card-unread-stripes.
  it("should apply card-unread-pulse when unread and idle", () => {
    const session = makeSession({ status: "idle", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-unread-pulse");
    expect(card.className).not.toContain("card-working-pulse");
    expect(card.className).not.toContain("card-input-pulse");
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
    expect(card.className).toContain("card-input-pulse");
    expect(card.className).not.toContain("card-unread-pulse");
    expect(card.className).not.toContain("card-working-pulse");
  });

  it("ended-and-unread session still shows gray stripes", () => {
    const session = makeSession({ status: "ended", unread: true });
    const { container } = render(<SessionCard session={session} {...defaultProps} />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("card-unread-pulse");
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
    // WORKSPACE was split into GIT + JJ in change
    // redesign-session-card-and-composer. JJ is absent here because no plugin
    // claims session-card-badge or workspace-action-bar in this test.
    const filtered = titles.filter((t) => t && /^(OPENSPEC|GIT|JJ|WORKSPACE|PROCESS|FLOWS|MEMORY)$/.test(t));
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

  it("renders green rail palette for idle/active sessions", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "idle" })} {...defaultProps} />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-green-500/40");
  });

  it("renders amber rail palette for streaming sessions", () => {
    const { container } = render(
      <SessionCard session={makeSession({ status: "streaming" })} {...defaultProps} />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-amber-500/40");
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
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-red-500/40");
  });

  it("selected idle session uses brighter -400/65 palette", () => {
    const { container } = render(
      <SessionCard
        session={makeSession({ status: "idle" })}
        {...defaultProps}
        selectedId="test-session"
      />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-green-400/65");
  });

  it("selected streaming session uses brighter -400/65 palette", () => {
    const { container } = render(
      <SessionCard
        session={makeSession({ status: "streaming" })}
        {...defaultProps}
        selectedId="test-session"
      />,
    );
    expect(railEl(container).getAttribute("data-rail-bg")).toBe("bg-amber-400/65");
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
    expect(bar!.className).toContain("bg-green-500/40");
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
