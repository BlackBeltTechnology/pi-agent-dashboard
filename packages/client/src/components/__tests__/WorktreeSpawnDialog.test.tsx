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
 *
 * Ternary source toggle (change: worktree-checkout-existing-branch):
 *  - Default mode is "checkout" when attachProposal is absent, "fork" when
 *    it is set. Fork-mode tests below explicitly select fork mode via the
 *    `worktree-source-fork` toggle (see `enterFork`).
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorktreeSpawnDialog } from "../worktree/WorktreeSpawnDialog.js";

const {
  fetchGitHead,
  fetchWorktrees,
  fetchBranches,
  createWorktree,
  probePathExists,
  cleanupOrphanWorktreePath,
} = vi.hoisted(() => ({
  fetchGitHead: vi.fn(),
  fetchWorktrees: vi.fn(),
  fetchBranches: vi.fn(),
  createWorktree: vi.fn(),
  probePathExists: vi.fn(),
  cleanupOrphanWorktreePath: vi.fn(),
}));

vi.mock("../../lib/git/git-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/git/git-api.js")>("../../lib/git/git-api.js");
  return {
    ...actual,
    fetchGitHead,
    fetchWorktrees,
    fetchBranches,
    createWorktree,
    probePathExists,
    cleanupOrphanWorktreePath,
  };
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

// Wait for the create section to load, then select fork mode. The toggle
// only renders after the parallel fetches resolve, so this implicitly
// waits for load. Use in fork-mode tests that don't pass `attachProposal`
// (default mode is now "checkout"). See change: worktree-checkout-existing-branch.
async function enterFork() {
  await waitFor(() => screen.getByTestId("worktree-source-fork"));
  fireEvent.click(screen.getByTestId("worktree-source-fork"));
}

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

// ── Ternary source toggle + default-mode (change: worktree-checkout-existing-branch) ──
describe("WorktreeSpawnDialog — source toggle + default mode", () => {
  it("renders a three-way toggle in the create section", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    expect(screen.getByTestId("worktree-source-fork").textContent).toContain("Fork to new branch");
    expect(screen.getByTestId("worktree-source-checkout").textContent).toContain("Check out existing branch");
    expect(screen.getByTestId("worktree-source-pr").textContent).toContain("From a pull request");
  });

  it("defaults to checkout mode when attachProposal is undefined", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    // Checkout mode: picker labelled "Branch", no new-branch input.
    expect(screen.getByText("Branch")).toBeTruthy();
    expect(screen.queryByTestId("worktree-new-branch-input")).toBeNull();
  });

  it("defaults to fork mode when attachProposal is provided", async () => {
    defaultMocks();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-foo"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    // Fork mode: new-branch input present, seeded from attachProposal.
    const input = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    expect(input.value).toBe("os/add-foo");
  });

  it("checkout mode submit calls createWorktree with no newBranch field", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/stale-feature",
      branch: "stale-feature",
      excludeAppended: true,
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    // Default checkout mode; base defaults to "main" via the resolver.
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    const payload = createWorktree.mock.calls[0]![0];
    expect(payload).not.toHaveProperty("newBranch");
    expect(payload).toMatchObject({ cwd: "/repo", base: "main" });
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/stale-feature", { gitWorktreeBase: "main" });
  });

  it("checkout mode renders branch_in_use with the holding-worktree path inline", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: false,
      code: "branch_in_use",
      error: "branch is already checked out in another worktree at '/repo/.worktrees/bar'",
      stderr: "fatal: 'main' is already used by worktree at '/repo/.worktrees/bar'",
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    const errEl = await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    expect(errEl.textContent).toContain("branch_in_use");
    expect(errEl.textContent).toContain("/repo/.worktrees/bar");
  });

  it("checkout mode path preview drops the remote prefix (origin/foo → foo)", async () => {
    defaultMocks({
      head: { branch: "main", detached: false, sha: "x" },
      localBranches: ["main"],
      remoteBranches: ["origin/old-experiment"],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    // Pick the remote-only branch. BranchCombobox renders an input we can
    // drive via the combobox trigger; simplest is to set base through the
    // path preview after selecting — instead assert the slug rule directly
    // by typing into the combobox value via fireEvent on its trigger text.
    // The combobox is a custom control; drive base by selecting the option.
    fireEvent.click(screen.getByTestId("worktree-base-combobox"));
    const option = await waitFor(() => screen.getByText("origin/old-experiment"));
    fireEvent.click(option);
    const pathInput = screen.getByTestId("worktree-path-input") as HTMLInputElement;
    expect(pathInput.value).toBe("/repo/.worktrees/old-experiment");
  });

  it("checkout mode keeps a LOCAL slashed branch name intact (openspec/foo → openspec-foo)", async () => {
    // Regression: a local branch whose name contains a slash must NOT be
    // treated as a remote ref. The preview path must match the server's
    // actual target (.worktrees/openspec-...), else orphan/path-exists
    // checks run against the wrong path and contradict each other.
    defaultMocks({
      head: { branch: "develop", detached: false, sha: "x" },
      localBranches: ["develop", "openspec/inline-raw-html-image-tags"],
      remoteBranches: [],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-base-combobox"));
    const option = await waitFor(() =>
      screen.getByText("openspec/inline-raw-html-image-tags"),
    );
    fireEvent.click(option);
    const pathInput = screen.getByTestId("worktree-path-input") as HTMLInputElement;
    expect(pathInput.value).toBe(
      "/repo/.worktrees/openspec-inline-raw-html-image-tags",
    );
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
    await enterFork();
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
    await enterFork();
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
    const trigger = screen.getByTestId("worktree-base-combobox");
    expect(trigger.textContent).toContain("feature");
  });

  it("falls through to develop when detached", async () => {
    defaultMocks({
      head: { branch: null, detached: true, sha: "abc" },
      localBranches: ["main", "develop", "master"],
    });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const trigger = screen.getByTestId("worktree-base-combobox");
    expect(trigger.textContent).toContain("develop");
  });

  it("path preview updates live as user types newBranch (slugified)", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await enterFork();
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
    await enterFork();

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

  it("submit disabled when newBranch is empty (fork mode)", async () => {
    defaultMocks();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await enterFork();
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
    await enterFork();

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
    await enterFork();
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

  // change: fix-worktree-fork-orphan-branch-recovery. Fork hits a lingering
  // branch (no worktree); a one-click "Check out this branch instead"
  // resubmits in checkout mode (no newBranch, base = the orphan branch).
  it("branch_exists offers reuse-as-checkout that resubmits in checkout mode", async () => {
    defaultMocks();
    // First submit (fork) fails branch_exists; second (checkout) succeeds.
    createWorktree
      .mockResolvedValueOnce({ ok: false, code: "branch_exists", error: 'branch "os/foo" already exists' })
      .mockResolvedValueOnce({
        ok: true,
        path: "/repo/.worktrees/os-foo",
        branch: "os/foo",
        excludeAppended: false,
      });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await enterFork();
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "os/foo" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));

    const reuseBtn = await waitFor(() => screen.getByTestId("worktree-dialog-branch-reuse"));
    fireEvent.click(reuseBtn);

    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    // Second createWorktree call is checkout: base = orphan branch, no newBranch.
    const lastCall = createWorktree.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual(expect.objectContaining({ cwd: "/repo", base: "os/foo" }));
    expect(lastCall).not.toHaveProperty("newBranch");
    expect(onSpawn).toHaveBeenCalledWith("/repo/.worktrees/os-foo", { gitWorktreeBase: "os/foo" });
  });

  it("reuse-as-checkout button only renders for branch_exists, not other errors", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({ ok: false, code: "git_failed", error: "boom" });
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />);
    await enterFork();
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/x" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    expect(screen.queryByTestId("worktree-dialog-branch-reuse")).toBeNull();
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
    await enterFork();
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
    await enterFork();
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
    await enterFork();
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
    await enterFork();
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
    await enterFork();
    await waitFor(() => screen.getByTestId("worktree-dialog-orphan-warning"));
    fireEvent.click(screen.getByTestId("worktree-dialog-orphan-cleanup"));
    const orphanErr = await waitFor(() => screen.getByTestId("worktree-dialog-orphan-error"));
    expect(orphanErr.textContent).toContain("looks_like_worktree");
  });
});

describe("WorktreeSpawnDialog — initialBranch + attachProposal props (variant)", () => {
  it("prefills the new-branch input from initialBranch (fork-selected)", async () => {
    defaultMocks();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        initialBranch="os/add-dark-mode"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    await enterFork();
    const input = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    expect(input.value).toBe("os/add-dark-mode");
  });

  it("forwards attachProposal through onSpawn opts on create-and-spawn", async () => {
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
        initialBranch="os/add-dark-mode"
        attachProposal="add-dark-mode"
        onSpawn={onSpawn}
        onCancel={() => {}}
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
        attachProposal="add-dark-mode"
        onSpawn={onSpawn}
        onCancel={() => {}}
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

  it("omits attachProposal from opts when prop is unset (backward-compat)", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/feat-x",
      branch: "feat/x",
      excludeAppended: true,
    });
    const onSpawn = vi.fn();
    render(<WorktreeSpawnDialog cwd="/repo" onSpawn={onSpawn} onCancel={() => {}} />);
    await enterFork();
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feat/x" },
    });
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    expect(onSpawn).toHaveBeenCalledWith(
      "/repo/.worktrees/feat-x",
      { gitWorktreeBase: "main" },
    );
    // explicit: no attachProposal key in opts
    const opts = onSpawn.mock.calls[0]![1];
    expect(opts.attachProposal).toBeUndefined();
  });
});

describe("WorktreeSpawnDialog — reactive attachProposal", () => {
  it("mount with attachProposal sets branch to os/<name> + path preview", async () => {
    defaultMocks();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-foo"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    const input = screen.getByTestId("worktree-new-branch-input") as HTMLInputElement;
    expect(input.value).toBe("os/add-foo");
    const pathInput = screen.getByTestId("worktree-path-input") as HTMLInputElement;
    expect(pathInput.value).toBe("/repo/.worktrees/os-add-foo");
  });

  it("attachProposal arriving after mount does not flip mode, but seeds branch (visible after flip to fork)", async () => {
    defaultMocks();
    const { rerender } = render(
      <WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    // Default checkout mode: no new-branch input.
    expect(screen.queryByTestId("worktree-new-branch-input")).toBeNull();
    rerender(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-foo"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    // Mode does NOT auto-flip: still checkout, still no input.
    expect(screen.queryByTestId("worktree-new-branch-input")).toBeNull();
    // The reactive branch seeding still applies once the user flips to fork.
    fireEvent.click(screen.getByTestId("worktree-source-fork"));
    expect((screen.getByTestId("worktree-new-branch-input") as HTMLInputElement).value).toBe("os/add-foo");
  });

  it("user-typed branch wins over later attachProposal change", async () => {
    defaultMocks();
    const { rerender } = render(
      <WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />,
    );
    await enterFork();
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "feature/x" },
    });
    rerender(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-foo"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByTestId("worktree-new-branch-input") as HTMLInputElement).value).toBe("feature/x");
  });

  it("attachProposal cleared while pristine reverts to initialBranch (empty)", async () => {
    defaultMocks();
    const { rerender } = render(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-foo"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    expect((screen.getByTestId("worktree-new-branch-input") as HTMLInputElement).value).toBe("os/add-foo");
    rerender(
      <WorktreeSpawnDialog cwd="/repo" onSpawn={() => {}} onCancel={() => {}} />,
    );
    expect((screen.getByTestId("worktree-new-branch-input") as HTMLInputElement).value).toBe("");
  });

  it("attachProposal swap while dirty is ignored", async () => {
    defaultMocks();
    const { rerender } = render(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-foo"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.change(screen.getByTestId("worktree-new-branch-input"), {
      target: { value: "os/other" },
    });
    rerender(
      <WorktreeSpawnDialog
        cwd="/repo"
        attachProposal="add-bar"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByTestId("worktree-new-branch-input") as HTMLInputElement).value).toBe("os/other");
  });

  it("backward-compat: initialBranch alone unchanged when attachProposal omitted (fork-selected)", async () => {
    defaultMocks();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        initialBranch="os/preset"
        onSpawn={() => {}}
        onCancel={() => {}}
      />,
    );
    await enterFork();
    expect((screen.getByTestId("worktree-new-branch-input") as HTMLInputElement).value).toBe("os/preset");
  });
});

// ── onSpawnStart / onSpawnAbort lifecycle (change: add-worktree-spawn-placeholder-card) ──
describe("WorktreeSpawnDialog — placeholder lifecycle callbacks", () => {
  it("fires onSpawnStart(cwd) at submit BEFORE createWorktree resolves", async () => {
    defaultMocks();
    const order: string[] = [];
    const onSpawnStart = vi.fn(() => { order.push("start"); });
    // Defer the createWorktree resolution so we can assert ordering.
    let resolveCreate!: (v: any) => void;
    createWorktree.mockImplementation(() => {
      order.push("createWorktree");
      return new Promise((res) => { resolveCreate = res; });
    });
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={() => {}}
        onCancel={() => {}}
        onSpawnStart={onSpawnStart}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    // onSpawnStart fired with the parent cwd, before createWorktree.
    expect(onSpawnStart).toHaveBeenCalledWith("/repo");
    await waitFor(() => expect(createWorktree).toHaveBeenCalled());
    expect(order).toEqual(["start", "createWorktree"]);
    resolveCreate({ ok: true, path: "/repo/.worktrees/x", branch: "x" });
  });

  it("fires onSpawnStart(cwd) on an existing-worktree row click", async () => {
    defaultMocks({
      worktrees: [
        { path: "/repo", branch: "main", isMain: true },
        { path: "/repo/.worktrees/feat-x", branch: "feat/x", isMain: false },
      ],
    });
    const onSpawnStart = vi.fn();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={() => {}}
        onCancel={() => {}}
        onSpawnStart={onSpawnStart}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-row-main"));
    fireEvent.click(
      screen.getByTestId(`worktree-row-${encodeURIComponent("/repo/.worktrees/feat-x")}`),
    );
    expect(onSpawnStart).toHaveBeenCalledWith("/repo");
  });

  it("fires onSpawnAbort(cwd) when createWorktree returns a non-ok result; dialog stays open with error", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: false,
      code: "branch_in_use",
      error: "branch is already checked out in another worktree",
    });
    const onSpawnAbort = vi.fn();
    const onSpawn = vi.fn();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={onSpawn}
        onCancel={() => {}}
        onSpawnStart={() => {}}
        onSpawnAbort={onSpawnAbort}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    const errEl = await waitFor(() => screen.getByTestId("worktree-dialog-error"));
    expect(onSpawnAbort).toHaveBeenCalledWith("/repo");
    expect(onSpawn).not.toHaveBeenCalled();
    // Dialog remains open rendering the error code.
    expect(errEl.textContent).toContain("branch_in_use");
    expect(screen.getByTestId("worktree-spawn-dialog")).toBeTruthy();
  });

  it("does NOT fire onSpawnAbort when createWorktree succeeds", async () => {
    defaultMocks();
    createWorktree.mockResolvedValue({
      ok: true,
      path: "/repo/.worktrees/feat-x",
      branch: "feat/x",
    });
    const onSpawnAbort = vi.fn();
    const onSpawn = vi.fn();
    render(
      <WorktreeSpawnDialog
        cwd="/repo"
        onSpawn={onSpawn}
        onCancel={() => {}}
        onSpawnStart={() => {}}
        onSpawnAbort={onSpawnAbort}
      />,
    );
    await waitFor(() => screen.getByTestId("worktree-dialog-existing"));
    fireEvent.click(screen.getByTestId("worktree-dialog-create-submit"));
    await waitFor(() => expect(onSpawn).toHaveBeenCalled());
    expect(onSpawnAbort).not.toHaveBeenCalled();
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
