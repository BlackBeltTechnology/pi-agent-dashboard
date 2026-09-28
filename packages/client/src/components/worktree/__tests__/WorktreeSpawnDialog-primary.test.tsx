/**
 * Primary-action recipe + "new session" copy on the worktree / OpenSpec
 * surfaces (test-plan E6, E9).
 *
 * E6 — a DISABLED primary keeps legible text: `--text-secondary` on
 *   `--bg-tertiary`, never white on a greyed blue (design D4).
 * E9 — the D9 labels render their "new" copy exactly. The goal-plugin
 *   (`autoRespawnLabel`) and automation-plugin (`fieldCount`) rows are pinned
 *   in their own packages' suites (GoalForm.test.tsx,
 *   CreateAutomationDialog.test.tsx), whose harnesses already render them.
 *
 * Harness glue copied from components/__tests__/WorktreeSpawnDialog.test.tsx
 * and OpenSpecBoardView.test.tsx.
 * See change: align-ui-with-theme-tokens (tasks 5.6, 5.20).
 */
import type { DashboardSession, OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchGitHead, fetchWorktrees, fetchBranches, createWorktree, probePathExists, cleanupOrphanWorktreePath } = vi.hoisted(() => ({
  fetchGitHead: vi.fn(),
  fetchWorktrees: vi.fn(),
  fetchBranches: vi.fn(),
  createWorktree: vi.fn(),
  probePathExists: vi.fn(),
  cleanupOrphanWorktreePath: vi.fn(),
}));

vi.mock("../../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/git/git-api.js")>("../../../lib/git/git-api.js");
  return { ...actual, fetchGitHead, fetchWorktrees, fetchBranches, createWorktree, probePathExists, cleanupOrphanWorktreePath };
});
vi.mock("../../../lib/openspec/openspec-groups-api.js", () => ({
  fetchGroups: vi.fn(async () => ({ schemaVersion: 1, groups: [], assignments: {}, changeOrder: {} })),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setAssignment: vi.fn(async () => {}),
  setChangeOrder: vi.fn(async () => {}),
}));
vi.mock("../../../lib/openspec/openspec-config-api.js", () => ({
  useOpenSpecConfig: () => ({ profile: "custom", delivery: "both", workflows: [] }),
}));

import { OpenSpecBoardView } from "../../openspec/OpenSpecBoardView.js";
import { WorktreeSpawnDialog } from "../WorktreeSpawnDialog.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  probePathExists.mockResolvedValue(false);
  cleanupOrphanWorktreePath.mockResolvedValue({ ok: true });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  });
});

function gitMocks(opts: { localBranches?: string[]; worktrees?: Array<{ path: string; branch: string; isMain: boolean }> } = {}) {
  const worktrees = (opts.worktrees ?? [{ path: "/repo", branch: "main", isMain: true }]).map((w) => ({ sha: "", bare: false, detached: false, ...w }));
  fetchGitHead.mockResolvedValue({ branch: "main", detached: false, sha: "abc1234" });
  fetchWorktrees.mockResolvedValue(worktrees);
  fetchBranches.mockResolvedValue({
    current: "main",
    detached: false,
    branches: (opts.localBranches ?? ["main", "develop"]).map((name) => ({ name, isRemote: false, isCurrent: name === "main" })),
  });
}

async function enterFork() {
  await waitFor(() => screen.getByTestId("worktree-source-fork"));
  fireEvent.click(screen.getByTestId("worktree-source-fork"));
}

describe("WorktreeSpawnDialog — primary action recipe (E6)", () => {
  it("disabled Create keeps --text-secondary on --bg-tertiary; enabled uses --accent-solid + white", async () => {
    gitMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await enterFork(); // fork mode with an empty branch name → cannot submit
    const btn = screen.getByTestId("worktree-dialog-create-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("disabled:bg-[var(--bg-tertiary)]");
    expect(btn.className).toContain("disabled:text-[var(--text-secondary)]");
    expect(btn.className).toContain("bg-[var(--accent-solid)]");
    expect(btn.className).toContain("text-white");
    expect(btn.className).not.toMatch(/disabled:text-\[var\(--text-muted\)\]/);
    expect(btn.className).toContain("focus-ring");
  });

  it("pressed source toggle is --tint-blue-* and exposes aria-pressed", async () => {
    gitMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await enterFork();
    const fork = screen.getByTestId("worktree-source-fork");
    expect(fork.getAttribute("aria-pressed")).toBe("true");
    expect(fork.className).toContain("bg-[var(--tint-blue-bg)]");
    expect(fork.className).toContain("text-[var(--tint-blue-fg)]");
    expect(screen.getByTestId("worktree-source-checkout").getAttribute("aria-pressed")).toBe("false");
  });
});

describe("new-session copy — exact D9 labels (E9)", () => {
  it("git.spawnIntoThatWorktree → 'New session in that worktree →'", async () => {
    gitMocks({
      localBranches: ["main", "os/taken"],
      worktrees: [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo/.worktrees/os-taken", branch: "os/taken", isMain: false },
      ],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await enterFork();
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), { target: { value: "os/taken" } });
    const btn = await waitFor(() => screen.getByTestId("worktree-collision-spawn"));
    expect(btn.textContent).toBe("New session in that worktree →");
  });

  it("OpenSpec board row: session.spawnASessionAttachedToThis + session.createSpawn", () => {
    const data: OpenSpecData = {
      initialized: true,
      changes: [{ name: "add-auth", status: "in-progress", completedTasks: 1, totalTasks: 2, artifacts: [], groupId: null }],
    };
    const session: DashboardSession = { id: "s1", cwd: "/p", source: "tui", status: "active", startedAt: Date.now() };
    render(
      <OpenSpecBoardView
        {...({
          cwd: "/p", data, sessions: [session],
          openspecMap: new Map([["/p", data]]),
          groupsState: { groups: [], assignments: {}, changeOrder: {} },
          onBack: vi.fn(), onRefresh: vi.fn(), onReadArtifact: vi.fn(), onNavigateToSession: vi.fn(),
          onOpenSpecs: vi.fn(), onOpenArchive: vi.fn(), onSpawnSession: vi.fn(), onSpawnAttachedWorktree: vi.fn(),
          onResumeSession: vi.fn(), onArchiveSession: vi.fn(), onSendPrompt: vi.fn(),
          onAttachProposal: vi.fn(), onDetachProposal: vi.fn(), onBulkArchive: vi.fn(),
          worktreeAvailability: { available: true },
        } as React.ComponentProps<typeof OpenSpecBoardView>)}
      />,
    );
    expect(screen.getByTestId("card-new-session-add-auth").getAttribute("title")).toBe("New session for this proposal");
    expect(screen.getByTestId("card-new-worktree-add-auth").getAttribute("title")).toBe("New worktree session for this proposal");
    fireEvent.click(screen.getByTestId("board-new-proposal"));
    expect(screen.getByTestId("np-create").textContent).toBe("Create & start session");
  });
});
