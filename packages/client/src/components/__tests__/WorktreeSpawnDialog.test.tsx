/**
 * Component tests for `WorktreeSpawnDialog`. Pins the §6 contract:
 *
 *  - On mount, fetches getHead + listWorktrees + listBranches in parallel.
 *  - Loading state visible until all three resolve.
 *  - Existing-worktree rows: click → onSpawn(path) without gitWorktreeBase.
 *  - Create form: default base picked via the shared fallback helper;
 *    typing into newBranch updates the live path preview via slugifyBranch.
 *  - Submit → createWorktree → onSpawn(path, { gitWorktreeBase: base }).
 *  - Error responses render inline with the stable code, and stderr is
 *    rendered in a collapsed <details>.
 *  - Cancel button calls onCancel; Escape key does too.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorktreeSpawnDialog } from "../WorktreeSpawnDialog.js";

const {
  fetchGitHead,
  fetchWorktrees,
  fetchBranches,
  createWorktree,
  probePathExists,
  cleanupOrphanWorktreePath,
  fetchWorktreeBootstrapStatus,
  bootstrapExistingWorktree,
} = vi.hoisted(() => ({
  fetchGitHead: vi.fn(),
  fetchWorktrees: vi.fn(),
  fetchBranches: vi.fn(),
  createWorktree: vi.fn(),
  probePathExists: vi.fn(),
  cleanupOrphanWorktreePath: vi.fn(),
  fetchWorktreeBootstrapStatus: vi.fn(),
  bootstrapExistingWorktree: vi.fn(),
}));

vi.mock("../../lib/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git-api.js")>("../../lib/git-api.js");
  return {
    ...actual,
    fetchGitHead,
    fetchWorktrees,
    fetchBranches,
    createWorktree,
    probePathExists,
    cleanupOrphanWorktreePath,
    fetchWorktreeBootstrapStatus,
    bootstrapExistingWorktree,
  };
});

// Default the bootstrap-status probe to "not_required" so existing tests
// see no change in behaviour; new tests override per case.
beforeEach(() => {
  fetchWorktreeBootstrapStatus.mockResolvedValue({ needsBootstrap: false, reason: "not_required" });
  bootstrapExistingWorktree.mockResolvedValue({ ok: true, bootstrap: { ran: true, durationMs: 100 } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function defaultMocks(opts: {
  head?: { branch: string | null; detached: boolean; sha: string | null };
  worktrees?: Array<{ path: string; branch: string | null; isMain: boolean; detached?: boolean; bare?: boolean; sha?: string }>;
  localBranches?: string[];
  remoteBranches?: string[];
} = {}) {
  const head = opts.head ?? { branch: "main", detached: false, sha: "abc1234" };
  const worktrees = (opts.worktrees ?? [
    { path: "/repo", branch: "main", isMain: true },
  ]).map((w) => ({ sha: "", bare: false, detached: false, ...w }));
  const local = opts.localBranches ?? ["main", "develop"];
  const remote = opts.remoteBranches ?? [];
  fetchGitHead.mockResolvedValue(head);
  fetchWorktrees.mockResolvedValue(worktrees);
  fetchBranches.mockResolvedValue({
    current: head.branch ?? "HEAD",
    detached: head.detached,
    branches: [
      ...local.map((name) => ({ name, isRemote: false, isCurrent: name === head.branch })),
      ...remote.map((name) => ({ name, isRemote: true, isCurrent: false })),
    ],
  });
}

// Default mocks for the orphan-probe + cleanup APIs that newly-fetched on
// every render. Override in specific tests as needed.
beforeEach(() => {
  probePathExists.mockResolvedValue(false);
  cleanupOrphanWorktreePath.mockResolvedValue({ ok: true });
});

describe("WorktreeSpawnDialog — loading + existing worktrees", () => {
  it("shows a loading placeholder until all three fetches resolve", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    expect(screen.getByTestId("worktree-dialog-loading")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("worktree-dialog-loading")).toBeNull());
    expect(screen.getByTestId("worktree-dialog-existing")).toBeTruthy();
  });

  it("renders one row per existing worktree (incl. main)", async () => {
    defaultMocks({
      worktrees: [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo/.worktrees/feat-x", branch: "feat/x", isMain: false },
        { path: "/repo/.worktrees/fix-42", branch: "fix/42", isMain: false },
      ],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId("worktree-dialog-loading")).toBeNull());
    expect(screen.getByTestId("worktree-row-main")).toBeTruthy();
    expect(
      screen.getByTestId(`worktree-row-${encodeURIComponent("/repo/.worktrees/feat-x")}`),
    ).toBeTruthy();
  });

  it("clicking an existing-worktree row calls onSpawn(path) without gitWorktreeBase", async () => {
    defaultMocks({
      worktrees: [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo/.worktrees/feat-x", branch: "feat/x", isMain: false },
      ],
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-row-main"));
    fireEvent.click(
      screen.getByTestId(`worktree-row-${encodeURIComponent("/repo/.worktrees/feat-x")}`),
    );
    expect(onSpawn).toHaveBeenCalledTimes(1);
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-x", undefined);
  });
});

describe("WorktreeSpawnDialog — initialBranch + attachProposal props", () => {
  it("prefills the new-branch input from initialBranch on first paint", async () => {
    defaultMocks();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={() => {}}
        onCancel={() => {}}
        initialBranch="os/add-dark-mode"
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const input = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    expect(input.value).toBe("os/add-dark-mode");
    // Path preview reflects the slugified initial branch immediately.
    const pathInput = screen.getByTestId("worktree-path-input") as HTMLInputElement;
    expect(pathInput.value).toBe("/repo/.worktrees/os-add-dark-mode");
  });

  it("submit flow forwards attachProposal alongside gitWorktreeBase", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/os-add-dark-mode",
      branch: "os/add-dark-mode",
      excludeAppended: true,
    });
    const onSpawn = vi.fn();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={onSpawn}
        onCancel={() => {}}
        initialBranch="os/add-dark-mode"
        attachProposal="add-dark-mode"
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    expect(onSpawn).toHaveBeenCalledWith(
      "/repo/.worktrees/os-add-dark-mode",
      { gitWorktreeBase: "main", attachProposal: "add-dark-mode" },
    );
  });

  it("existing-worktree row click forwards attachProposal when set", async () => {
    defaultMocks({
      worktrees: [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo/.worktrees/feat-x", branch: "feat/x", isMain: false },
      ],
    });
    const onSpawn = vi.fn();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={onSpawn}
        onCancel={() => {}}
        attachProposal="add-dark-mode"
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-row-main"));
    fireEvent.click(
      screen.getByTestId(`worktree-row-${encodeURIComponent("/repo/.worktrees/feat-x")}`),
    );
    expect(onSpawn).toHaveBeenCalledWith(
      "/repo/.worktrees/feat-x",
      { attachProposal: "add-dark-mode" },
    );
  });

  it("opts.attachProposal is undefined when prop omitted (backward-compat)", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/feat-y",
      branch: "feat/y",
      excludeAppended: true,
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/y" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    const callOpts = onSpawn.mock.calls[0][1];
    expect(callOpts).toEqual({ gitWorktreeBase: "main" });
    expect(callOpts.attachProposal).toBeUndefined();
  });
});

describe("WorktreeSpawnDialog — create form", () => {
  it("defaults base via the shared resolver (current branch wins when local)", async () => {
    defaultMocks({
      head: { branch: "feature", detached: false, sha: "x" },
      localBranches: ["main", "develop", "feature"],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const sel = screen.getByTestId("worktree-base-select") as HTMLSelectElement;
    expect(sel.value).toBe("feature");
  });

  it("falls through to develop when detached", async () => {
    defaultMocks({
      head: { branch: null, detached: true, sha: "abc" },
      localBranches: ["main", "develop", "master"],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const sel = screen.getByTestId("worktree-base-select") as HTMLSelectElement;
    expect(sel.value).toBe("develop");
  });

  it("path preview updates live as user types newBranch (slugified)", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const input = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "feat/Dark Mode!" } });
    const pathInput = screen.getByTestId("worktree-path-input") as HTMLInputElement;
    expect(pathInput.value).toBe("/repo/.worktrees/feat-dark-mode");
  });

  it("submit calls createWorktree then onSpawn with gitWorktreeBase", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/feat-x",
      branch: "feat/x",
      excludeAppended: true,
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));

    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/x" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));

    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    // requestId is added by change harden-worktree-spawn (correlates ws
    // events to this dialog). Assert the rest with objectContaining.
    expect(createWorktree).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      base: "main",
      newBranch: "feat/x",
    }));
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-x", { gitWorktreeBase: "main" });
  });

  it("submit disabled when newBranch is empty", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const submitBtn = screen.getByTestId("worktree-dialog-create-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("renders structured error inline with stable code + stderr details on failure", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: false,
      code: "branch_in_use",
      error: "branch is already checked out in another worktree",
      stderr: "fatal: 'feat/x' is already checked out at '/repo'",
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));

    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/x" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));

    const errEl = await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    expect(errEl.textContent).toContain("branch_in_use");
    expect(errEl.textContent).toContain("already checked out");
    // stderr in a collapsed details
    const summary = errEl.querySelector("summary");
    expect(summary?.textContent).toBe("git stderr");
  });

  it("clears inline error when the user edits the form after a failure", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({ ok: false, code: "git_failed", error: "boom" });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/x" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/y" },
    });
    await waitFor(() => expect(screen.queryByTestId("worktree-dialog-error")).toBeNull());
  });
});

describe("WorktreeSpawnDialog — load-error path", () => {
  it("renders load error when fetchGitHead rejects", async () => {
    defaultMocks();
    fetchGitHead.mockRejectedValueOnce(new Error("not a git repository"));
    render(<WorktreeSpawnDialog cwd="/some" onSpawn={() => {}} onCancel={() => {}} />);
    const err = await waitFor(() => screen.getByTestId("worktree-dialog-load-error"));
    expect(err.textContent).toContain("not a git repository");
  });
});

describe("WorktreeSpawnDialog — submodule footnote", () => {
  it("renders the submodule note when readHead reports hasSubmodules: true", async () => {
    defaultMocks({ head: { branch: "main", detached: false, sha: "x" } });
    // Override the default head mock with one that flags submodules.
    fetchGitHead.mockResolvedValueOnce({ branch: "main", detached: false, sha: "x", hasSubmodules: true });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    expect(screen.getByTestId("worktree-dialog-submodule-note")).toBeTruthy();
  });

  it("omits the submodule note when no .gitmodules", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    expect(screen.queryByTestId("worktree-dialog-submodule-note")).toBeNull();
  });
});

describe("WorktreeSpawnDialog — orphan-path detection + cleanup", () => {
  it("shows inline warning + Clean-up button when derived path is an orphan", async () => {
    defaultMocks();
    probePathExists.mockResolvedValue(true);
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} initialBranch="feat/x" />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    await waitFor(() => screen.getByTestId("worktree-dialog-orphan-warning"));
    expect(screen.getByTestId("worktree-dialog-orphan-cleanup")).toBeTruthy();
    // Submit button disabled while orphan blocks the path.
    const submitBtn = screen.getByTestId("worktree-dialog-create-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
  });

  it("clean-up click calls API → warning collapses → submit re-enables", async () => {
    defaultMocks();
    probePathExists.mockResolvedValue(true);
    cleanupOrphanWorktreePath.mockResolvedValue({ ok: true });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} initialBranch="feat/x" />);
    await waitFor(() => screen.getByTestId("worktree-dialog-orphan-warning"));
    // Make subsequent probes return false (the dir is now gone).
    probePathExists.mockResolvedValue(false);
    fireEvent.click(screen.getByTestId("worktree-dialog-orphan-cleanup"));
    await waitFor(() => expect(cleanupOrphanWorktreePath).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("worktree-dialog-orphan-warning")).toBeNull());
    const submitBtn = screen.getByTestId("worktree-dialog-create-submit") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(false);
  });

  it("submit returns path_exists + orphanLikely:true → warning + Clean-up below error", async () => {
    defaultMocks();
    // Initial probe: not orphan (e.g. path-preview matches registered).
    probePathExists.mockResolvedValue(false);
    createWorktree.mockResolvedValue({
      ok: false,
      code: "path_exists",
      error: "target path already exists: /repo/.worktrees/feat-x",
      orphanLikely: true,
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    // Warning AND error both visible; cleanup button reads "Clean up + retry".
    expect(screen.getByTestId("worktree-dialog-orphan-warning")).toBeTruthy();
    expect(screen.getByTestId("worktree-dialog-orphan-cleanup").textContent).toContain("Clean up + retry");
  });

  it("submit returns path_exists + orphanLikely:false → plain error, no Clean-up", async () => {
    defaultMocks();
    probePathExists.mockResolvedValue(false);
    createWorktree.mockResolvedValue({
      ok: false,
      code: "path_exists",
      error: "target path already exists",
      orphanLikely: false,
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    expect(screen.queryByTestId("worktree-dialog-orphan-warning")).toBeNull();
    expect(screen.queryByTestId("worktree-dialog-orphan-cleanup")).toBeNull();
  });

  it("orphan cleanup refuse-arm renders inline orphan error", async () => {
    defaultMocks();
    probePathExists.mockResolvedValue(true);
    cleanupOrphanWorktreePath.mockResolvedValue({
      ok: false,
      code: "looks_like_worktree",
      error: "directory contains a .git entry; refuse to delete",
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} initialBranch="feat/x" />);
    await waitFor(() => screen.getByTestId("worktree-dialog-orphan-warning"));
    fireEvent.click(screen.getByTestId("worktree-dialog-orphan-cleanup"));
    const orphanErr = await waitFor(() => screen.getByTestId("worktree-dialog-orphan-error"));
    expect(orphanErr.textContent).toContain("looks_like_worktree");
  });
});

describe("WorktreeSpawnDialog — dismissal", () => {
  it("Cancel button calls onCancel", async () => {
    defaultMocks();
    const onCancel = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={onCancel} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-dialog-cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Escape key calls onCancel", async () => {
    defaultMocks();
    const onCancel = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={onCancel} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// ── Bootstrap UX (change: harden-worktree-spawn) ────────────────────────
// Per-row probe degrades the action button when node_modules is missing;
// clicking the degraded variant routes through bootstrapExistingWorktree
// + the worktree-bootstrap bus. Bus interaction is exercised by routing
// events through `dispatchBootstrapEvent` since the dialog subscribes to
// the singleton bus directly.

import {
  dispatchBootstrapEvent,
  __resetBootstrapBusForTests,
} from "../../lib/worktree-bootstrap-bus.js";

describe("WorktreeSpawnDialog — bootstrap probe + degraded button", () => {
  beforeEach(() => __resetBootstrapBusForTests());

  it("healthy row keeps Spawn → button", async () => {
    defaultMocks({
      worktrees: [{ path: "/repo", branch: "main", isMain: true }],
    });
    fetchWorktreeBootstrapStatus.mockResolvedValue({ needsBootstrap: false, reason: "ok" });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-row-main"));
    // Wait one micro-tick for probe resolution.
    await waitFor(() => expect(fetchWorktreeBootstrapStatus).toHaveBeenCalled());
    // The row label should still be Spawn → (no ⚠ badge).
    const row = screen.getByTestId("worktree-row-main");
    expect(row.textContent).toMatch(/Spawn →/);
    expect(row.textContent).not.toMatch(/Install deps/);
  });

  it("row with no_node_modules shows ⚠ Install deps + Spawn → badge", async () => {
    defaultMocks({
      worktrees: [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo-sibling", branch: "feat/x", isMain: false },
      ],
    });
    fetchWorktreeBootstrapStatus.mockImplementation(async (cwd: string) => {
      if (cwd === "/repo-sibling") return { needsBootstrap: true, reason: "no_node_modules" };
      return { needsBootstrap: false, reason: "ok" };
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-row-main"));
    await waitFor(() => {
      const row = screen.getByTestId(`worktree-row-${encodeURIComponent("/repo-sibling")}`);
      expect(row.textContent).toMatch(/Install deps/);
    });
  });

  it("probe rejection falls back to Spawn → (fail-open)", async () => {
    defaultMocks({ worktrees: [{ path: "/repo", branch: "main", isMain: true }] });
    fetchWorktreeBootstrapStatus.mockRejectedValue(new Error("network"));
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-row-main"));
    await waitFor(() => expect(fetchWorktreeBootstrapStatus).toHaveBeenCalled());
    const row = screen.getByTestId("worktree-row-main");
    expect(row.textContent).toMatch(/Spawn →/);
    expect(row.textContent).not.toMatch(/Install deps/);
  });
});

describe("WorktreeSpawnDialog — bootstrap-then-spawn (existing row)", () => {
  beforeEach(() => __resetBootstrapBusForTests());

  it("clicking ⚠ row triggers bootstrapExistingWorktree, awaits bus done, then onSpawn", async () => {
    defaultMocks({
      worktrees: [{ path: "/repo", branch: "main", isMain: true }],
    });
    fetchWorktreeBootstrapStatus.mockResolvedValue({ needsBootstrap: true, reason: "no_node_modules" });
    let capturedRequestId: string | undefined;
    bootstrapExistingWorktree.mockImplementation(async (params: { cwd: string; requestId?: string }) => {
      capturedRequestId = params.requestId;
      // Don't resolve immediately; the bus event drives the spawn.
      return new Promise(() => {});
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => expect(fetchWorktreeBootstrapStatus).toHaveBeenCalled());
    // Click the degraded row.
    fireEvent.click(screen.getByTestId("worktree-row-main"));
    await waitFor(() => expect(bootstrapExistingWorktree).toHaveBeenCalled());
    expect(capturedRequestId).toBeDefined();
    // Progress arm visible.
    await waitFor(() => screen.getByTestId("worktree-dialog-bootstrap-progress"));
    // Simulate the bus delivering a done event for our requestId.
    dispatchBootstrapEvent({
      type: "worktree_bootstrap_done",
      requestId: capturedRequestId!,
      cwd: "/repo",
      durationMs: 123,
    });
    await waitFor(() => expect(onSpawn).toHaveBeenCalledWith("/repo", undefined));
  });

  it("bootstrap_failed shows error + does NOT spawn", async () => {
    defaultMocks({
      worktrees: [{ path: "/repo", branch: "main", isMain: true }],
    });
    fetchWorktreeBootstrapStatus.mockResolvedValue({ needsBootstrap: true, reason: "no_node_modules" });
    let capturedRequestId: string | undefined;
    bootstrapExistingWorktree.mockImplementation(async (params: { cwd: string; requestId?: string }) => {
      capturedRequestId = params.requestId;
      return new Promise(() => {});
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => expect(fetchWorktreeBootstrapStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("worktree-row-main"));
    await waitFor(() => expect(bootstrapExistingWorktree).toHaveBeenCalled());
    dispatchBootstrapEvent({
      type: "worktree_bootstrap_failed",
      requestId: capturedRequestId!,
      cwd: "/repo",
      code: "install_nonzero_exit",
      message: "lockfile drift",
      stderr: "npm ERR! sync",
    });
    await waitFor(() => screen.getByTestId("worktree-dialog-bootstrap-error"));
    expect(onSpawn).not.toHaveBeenCalled();
  });

  it("progress events render in the live-tail panel", async () => {
    defaultMocks({ worktrees: [{ path: "/repo", branch: "main", isMain: true }] });
    fetchWorktreeBootstrapStatus.mockResolvedValue({ needsBootstrap: true, reason: "no_node_modules" });
    let capturedRequestId: string | undefined;
    bootstrapExistingWorktree.mockImplementation(async (params: { cwd: string; requestId?: string }) => {
      capturedRequestId = params.requestId;
      return new Promise(() => {});
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(fetchWorktreeBootstrapStatus).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("worktree-row-main"));
    await waitFor(() => expect(bootstrapExistingWorktree).toHaveBeenCalled());
    dispatchBootstrapEvent({
      type: "worktree_bootstrap_progress",
      requestId: capturedRequestId!,
      cwd: "/repo",
      line: "added 123 packages\n",
    });
    await waitFor(() => {
      const tail = screen.getByTestId("worktree-dialog-bootstrap-tail");
      expect(tail.textContent).toContain("added 123 packages");
    });
  });
});

describe("WorktreeSpawnDialog — Create + Spawn bootstrap integration", () => {
  beforeEach(() => __resetBootstrapBusForTests());

  it("Create + Spawn forwards requestId to createWorktree", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/feat-x",
      branch: "feat/x",
      excludeAppended: true,
      bootstrap: { ran: false, skippedReason: "not_required" },
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(createWorktree).toHaveBeenCalled());
    const call = createWorktree.mock.calls[0][0];
    expect(typeof call.requestId).toBe("string");
    expect(call.requestId.length).toBeGreaterThan(0);
  });

  it("bootstrap.ran=false response: spawn immediately, no progress surface", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/feat-x",
      branch: "feat/x",
      excludeAppended: true,
      bootstrap: { ran: false, skippedReason: "not_required" },
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), { target: { value: "feat/x" } });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/feat-x", { gitWorktreeBase: "main" });
  });
});
