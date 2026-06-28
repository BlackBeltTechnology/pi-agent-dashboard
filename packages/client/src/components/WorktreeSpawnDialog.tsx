/**
 * Fullscreen dialog launched by the folder-action-bar's `+Worktree`
 * button. Two stacked sections:
 *
 *   1. Existing worktrees of the repo — each row is one-click `[Spawn →]`.
 *   2. Create a new worktree — base picker + new-branch input + path
 *      preview. On submit: POST /api/git/worktree, then auto-spawn a pi
 *      session in the returned path.
 *
 * See change: add-worktree-spawn-dialog.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import {
  cleanupOrphanWorktreePath,
  createWorktree,
  createWorktreeFromPr,
  fetchBranches,
  fetchGitHead,
  fetchWorktrees,
  probePathExists,
  type CreateWorktreeError,
  type HeadInfo,
  type WorktreeEntry,
} from "../lib/git-api.js";
import type { PullRequestInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  resolveCheckoutLocalName,
  resolveDefaultBase,
  slugifyBranch,
} from "@blackbelt-technology/pi-dashboard-shared/git-worktree-helpers.js";
import type { GitBranchEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { BranchCombobox } from "./BranchCombobox.js";
import { PrCombobox } from "./PrCombobox.js";
import { t as i18nT } from "../lib/i18n";

// Ternary source toggle (change: worktree-checkout-existing-branch),
// widening the binary "branch"/"pr" toggle introduced by
// add-worktree-from-pull-request:
//   fork     — fork a new branch off a base ref (`git worktree add -b`).
//   checkout — check out an existing branch ref (no `-b`).
//   pr       — check out an open pull request.
type SourceMode = "fork" | "checkout" | "pr";

interface Props {
  /** Cwd to scope the dialog to (folder header's path). */
  cwd: string;
  /**
   * Optional initial value for the new-branch input. When omitted the
   * input renders empty (current behavior). When supplied, prefills the
   * branch name so the user can confirm or edit. The dialog never mutates
   * the slug derivation — it just seeds the input.
   * See change: openspec-worktree-spawn-button.
   */
  initialBranch?: string;
  /**
   * Optional change name to forward through `onSpawn.opts.attachProposal`.
   * Never displayed inside the dialog — invisible carry-through so the
   * parent's `spawn_session` call binds the new session to a proposal.
   * See change: openspec-worktree-spawn-button.
   */
  attachProposal?: string;
  /**
   * Called when the user chooses to spawn a pi session in a worktree path.
   * `gitWorktreeBase` is supplied when the dialog created a new worktree
   * (so the server can persist it to `.meta.json`); absent when the user
   * picked an existing worktree.
   * `attachProposal` is forwarded so the eventual spawn_session auto-
   * attaches to the named OpenSpec change.
   */
  onSpawn: (
    worktreePath: string,
    opts?: { gitWorktreeBase?: string; attachProposal?: string },
  ) => void;
  onCancel: () => void;
  /**
   * Fired at the TOP of every submit path (existing-worktree row click and
   * create-new submit), BEFORE any `createWorktree`/spawn call. `parentCwd`
   * is the dialog's `cwd` prop so the host renders a placeholder in the
   * group that will host the new worktree session. Optional (back-compat).
   * See change: add-worktree-spawn-placeholder-card.
   */
  onSpawnStart?: (parentCwd: string) => void;
  /**
   * Fired when `createWorktree` rejects or returns a non-ok result. Lets the
   * host remove the placeholder immediately while the dialog stays open
   * showing the error. Optional (back-compat).
   * See change: add-worktree-spawn-placeholder-card.
   */
  onSpawnAbort?: (parentCwd: string) => void;
}

interface LoadedData {
  worktrees: WorktreeEntry[];
  head: HeadInfo;
  localBranches: GitBranchEntry[];
  remoteBranches: GitBranchEntry[];
}

export function WorktreeSpawnDialog({ cwd, onSpawn, onCancel, initialBranch, attachProposal, onSpawnStart, onSpawnAbort }: Props) {
  const [data, setData] = useState<LoadedData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState(initialBranch ?? "");
  // Dirty-flag: flips on first user onChange of the branch input. Mount-
  // time seeding from `initialBranch` does NOT flip the flag (no onChange
  // fires for initial useState value). Used by the `attachProposal`
  // reactive effect to decide whether to overwrite the field.
  // See change: auto-fill-branch-from-proposal-in-worktree-dialog.
  const [branchDirty, setBranchDirty] = useState(false);
  const [base, setBase] = useState("");
  const [pathOverride, setPathOverride] = useState<string | null>(null);
  // Default mode (change: worktree-checkout-existing-branch):
  //   attachProposal set   → "fork"     (proposal-driven ⊕+ flow).
  //   attachProposal unset → "checkout" (plain +Worktree).
  // "pr" is never the auto-pick (preserves the lazy-load contract). The
  // initializer runs once; later attachProposal changes do NOT re-flip
  // the mode — the user stays in control after first paint.
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    () => (attachProposal && attachProposal.length > 0 ? "fork" : "checkout"),
  );
  const [selectedPr, setSelectedPr] = useState<PullRequestInfo | null>(null);
  const [ghUnavailable, setGhUnavailable] = useState<"gh_not_found" | "gh_not_authed" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<CreateWorktreeError | null>(null);
  // Orphan-path state (change: openspec-worktree-spawn-button):
  //  - `orphanDetected` flips true when the derived path exists on disk
  //    but isn't in the worktree list (debounced probe in an effect).
  //  - `cleaningOrphan` blocks the submit during the cleanup round-trip.
  //  - `orphanError` surfaces refuse-arm codes (looks_like_worktree, etc.)
  //    inline next to the warning.
  //  - `autoRetryArmed` is a one-shot: after a successful post-submit
  //    cleanup we resubmit ONCE; if it fails again we stop.
  const [orphanDetected, setOrphanDetected] = useState(false);
  const [cleaningOrphan, setCleaningOrphan] = useState(false);
  const [orphanError, setOrphanError] = useState<{ code: string; message: string } | null>(null);
  const [autoRetryArmed, setAutoRetryArmed] = useState(false);
  // Worktree initialization moved out of this dialog into the gated
  // folder-action-bar Initialize button. See change: generalize-worktree-init-hook.

  // ── load existing worktrees + head + branches in parallel ─────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [worktrees, head, branchList] = await Promise.all([
          fetchWorktrees(cwd),
          fetchGitHead(cwd),
          fetchBranches(cwd),
        ]);
        if (cancelled) return;
        const localBranches = branchList.branches.filter((b) => !b.isRemote);
        const remoteBranches = branchList.branches.filter((b) => b.isRemote);
        const loaded: LoadedData = { worktrees, head, localBranches, remoteBranches };
        setData(loaded);
        // Compute initial base via the shared fallback helper.
        const def = resolveDefaultBase({
          currentBranch: head.branch,
          localBranches: localBranches.map((b) => b.name),
          remoteBranches: remoteBranches.map((b) => b.name),
        });
        if (def.ok) setBase(def.base);
      } catch (err: any) {
        if (cancelled) return;
        setLoadError(err?.message ?? "failed to load worktree dialog");
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  // ── derived state ───────────────────────────────────────
  // Path slug source depends on mode: fork slugs the new branch name;
  // checkout slugs the LOCAL name of the picked branch ref so `origin/foo`
  // previews as `.worktrees/foo` (not `origin-foo`). A LOCAL branch whose
  // name contains a slash (`openspec/foo`) keeps its full name so the
  // preview/orphan-check path matches the server's actual target.
  // See change: fix-worktree-checkout-local-slash-path.
  const slug = useMemo(() => {
    if (sourceMode === "checkout") {
      const baseIsLocalBranch = data?.localBranches.some((b) => b.name === base) ?? false;
      return slugifyBranch(resolveCheckoutLocalName(base, baseIsLocalBranch));
    }
    return slugifyBranch(newBranch);
  }, [sourceMode, newBranch, base, data]);
  const derivedPath = useMemo(() => {
    if (!data || !slug) return "";
    // Path preview: <repo>/.worktrees/<slug>. The repo root is the main
    // worktree's path returned by listWorktrees. Server is authoritative
    // — this is purely for user feedback.
    const main = data.worktrees.find((w) => w.isMain);
    if (!main) return `.worktrees/${slug}`;
    return joinPath(main.path, ".worktrees", slug);
  }, [data, slug]);
  // PR-mode derived path.
  const prDerivedPath = useMemo(() => {
    if (!data || !selectedPr) return "";
    const main = data.worktrees.find((w) => w.isMain);
    if (!main) return `.worktrees/pr-${selectedPr.number}`;
    return joinPath(main.path, ".worktrees", `pr-${selectedPr.number}`);
  }, [data, selectedPr]);
  const effectivePath = pathOverride ?? (sourceMode === "pr" ? prDerivedPath : derivedPath);
  const checkoutMode = sourceMode === "checkout";
  const allBranches = useMemo<GitBranchEntry[]>(() => {
    if (!data) return [];
    return [...data.localBranches, ...data.remoteBranches];
  }, [data]);

  // Fork needs a new branch name + base; checkout needs only a branch
  // ref. See change: worktree-checkout-existing-branch.
  const canSubmitFork =
    !!data &&
    !submitting &&
    newBranch.trim().length > 0 &&
    base.trim().length > 0 &&
    slug.length > 0;

  const canSubmitCheckout =
    !!data &&
    !submitting &&
    base.trim().length > 0;

  const canSubmitPr =
    !!data &&
    !submitting &&
    selectedPr !== null;

  const canSubmit =
    sourceMode === "pr" ? canSubmitPr : checkoutMode ? canSubmitCheckout : canSubmitFork;

  // ── handlers ───────────────────────────────────────────────────────────
  // Always include attachProposal in opts when the prop was supplied;
  // never invent it. See change: openspec-worktree-spawn-button.
  const buildOpts = useCallback(
    (gitWorktreeBase?: string): { gitWorktreeBase?: string; attachProposal?: string } | undefined => {
      const opts: { gitWorktreeBase?: string; attachProposal?: string } = {};
      if (gitWorktreeBase) opts.gitWorktreeBase = gitWorktreeBase;
      if (attachProposal) opts.attachProposal = attachProposal;
      return Object.keys(opts).length > 0 ? opts : undefined;
    },
    [attachProposal],
  );
  // Existing worktree rows spawn directly. Any required initialization is
  // a separate gated action (the folder-action-bar Initialize button).
  const handleSpawnExisting = useCallback((entry: WorktreeEntry) => {
    onSpawnStart?.(cwd);
    onSpawn(entry.path, buildOpts());
  }, [onSpawn, buildOpts, onSpawnStart, cwd]);

  const handleCreateAndSpawn = useCallback(async (override?: { mode?: SourceMode; base?: string }) => {
    if (!data) return;
    // `override` lets a recovery flow (branch_exists → reuse as checkout)
    // resubmit with explicit mode/base instead of waiting for React state
    // to flush. When absent we read live state as before.
    // See change: fix-worktree-fork-orphan-branch-recovery.
    const mode = override?.mode ?? sourceMode;
    const submitBase = override?.base ?? base;
    const isCheckout = mode === "checkout";
    // On an override resubmit always let the server re-derive the path:
    // the fork's slug/pathOverride doesn't apply to the checkout slug.
    const submitPath = override ? null : pathOverride;
    // Signal the host to render a placeholder NOW, covering the
    // createWorktree latency window. See change:
    // add-worktree-spawn-placeholder-card.
    onSpawnStart?.(cwd);
    setSubmitting(true);
    setSubmitError(null);
    let res;
    try {
      if (mode === "pr" && selectedPr) {
        res = await createWorktreeFromPr({
          cwd,
          prNumber: selectedPr.number,
          ...(submitPath ? { path: submitPath } : {}),
        });
      } else {
        // Checkout mode omits `newBranch` entirely so the server runs
        // `git worktree add <path> <base>` without `-b`. Fork mode sends
        // it. See change: worktree-checkout-existing-branch.
        res = await createWorktree({
          cwd,
          base: submitBase,
          ...(isCheckout ? {} : { newBranch }),
          ...(submitPath ? { path: submitPath } : {}),
        });
      }
    } catch (err: any) {
      // Network failure, JSON parse error, or any other thrown exception.
      // Remove the placeholder; keep the dialog open showing the error.
      onSpawnAbort?.(cwd);
      setSubmitting(false);
      setSubmitError({
        ok: false,
        code: "network_failure",
        error: err?.message ?? "network failure or unexpected error",
      });
      return;
    }
    setSubmitting(false);
    if (!res.ok) {
      // createWorktree returned a stable error code (branch_in_use, etc.).
      // Remove the placeholder; dialog stays open rendering the error.
      onSpawnAbort?.(cwd);
      setSubmitError(res);
      return;
    }
    // Worktree created clean; spawn the session. Both branch modes carry
    // the base through as gitWorktreeBase; PR mode does not.
    onSpawn(res.path, buildOpts(mode === "pr" ? undefined : submitBase));
  }, [data, cwd, base, newBranch, sourceMode, selectedPr, pathOverride, onSpawn, buildOpts, onSpawnStart, onSpawnAbort]);

  // Recovery for fork mode's branch_exists: the branch lingers without a
  // worktree (orphan from a prior failed/cleaned attempt). Checking it out
  // reuses the branch instead of re-forking it. Switch the UI to checkout
  // mode (keeps state consistent if THIS retry also fails) and resubmit
  // once via the explicit override so we don't read stale state.
  // See change: fix-worktree-fork-orphan-branch-recovery.
  const handleReuseAsCheckout = useCallback(() => {
    const orphanBranch = newBranch.trim();
    if (!orphanBranch) return;
    setSourceMode("checkout");
    setBase(orphanBranch);
    setPathOverride(null);
    setSubmitError(null);
    setAutoRetryArmed(true);
    void handleCreateAndSpawn({ mode: "checkout", base: orphanBranch });
  }, [newBranch, handleCreateAndSpawn]);

  // Clean-up the orphan path then optionally auto-retry submit.
  const handleCleanOrphan = useCallback(async (autoResubmit: boolean) => {
    if (!effectivePath) return;
    setCleaningOrphan(true);
    setOrphanError(null);
    const result = await cleanupOrphanWorktreePath({ cwd, path: effectivePath });
    setCleaningOrphan(false);
    if (!result.ok) {
      setOrphanError({ code: result.code, message: result.error });
      return;
    }
    setOrphanDetected(false);
    if (autoResubmit) {
      setSubmitError(null);
      // One-shot retry. If THIS fails too, we stop — no infinite loop.
      setAutoRetryArmed(true);
      void handleCreateAndSpawn();
    }
  }, [cwd, effectivePath, handleCreateAndSpawn]);

  // One-shot auto-retry safety net: if `handleCreateAndSpawn` succeeded
  // after cleanup, disarm. If it failed again, the error renders normally
  // and `autoRetryArmed` stays true but is never read again (no second
  // retry triggered). The flag is purely a marker for tests + diagnostics.
  useEffect(() => {
    if (autoRetryArmed && !submitting && !submitError) {
      setAutoRetryArmed(false);
    }
  }, [autoRetryArmed, submitting, submitError]);

  // Reset error when the user edits the form after a failure.
  useEffect(() => {
    if (submitError) setSubmitError(null);
    if (orphanError) setOrphanError(null);
    // We intentionally watch only the inputs, not submitError itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newBranch, base, pathOverride, selectedPr, sourceMode]);

  // Reset path override when switching modes.
  useEffect(() => {
    setPathOverride(null);
  }, [sourceMode]);

  // ── Reactive `attachProposal` effect ─────────────────────────────────
  // When the parent re-renders with a changed `attachProposal`, update
  // the branch input — unless the user has typed (branchDirty). When
  // cleared (undefined/empty), revert to `initialBranch ?? ""`.
  // See change: auto-fill-branch-from-proposal-in-worktree-dialog.
  useEffect(() => {
    if (branchDirty) return;
    if (attachProposal && attachProposal.length > 0) {
      setNewBranch("os/" + attachProposal);
    } else {
      setNewBranch(initialBranch ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachProposal]);

  // ── orphan-path detection (debounced) ──────────────────────────────────
  // Watches `effectivePath`. When it exists on disk AND isn't in the
  // worktree list, set `orphanDetected = true` so the warning + Clean-up
  // button render. Cancellable via AbortController for stale-probe safety.
  // See change: openspec-worktree-spawn-button.
  useEffect(() => {
    if (!data || !effectivePath) {
      setOrphanDetected(false);
      return;
    }
    const isRegistered = data.worktrees.some((w) => w.path === effectivePath);
    if (isRegistered) {
      setOrphanDetected(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      probePathExists({ cwd, path: effectivePath, signal: controller.signal }).then((exists) => {
        setOrphanDetected(exists);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [data, cwd, effectivePath]);

  // ── render ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <DialogChrome onCancel={onCancel} title={i18nT("auto.worktree_session", undefined, "+Worktree Session")}>
        <div className="text-red-400" data-testid="worktree-dialog-load-error">{loadError}</div>
      </DialogChrome>
    );
  }
  if (!data) {
    return (
      <DialogChrome onCancel={onCancel} title={i18nT("auto.worktree_session", undefined, "+Worktree Session")}>
        <div className="text-[var(--text-muted)]" data-testid="worktree-dialog-loading">{i18nT("auto.loading", undefined, "Loading…")}</div>
      </DialogChrome>
    );
  }

  const hasUsableBase = base.trim().length > 0;

  return (
    <DialogChrome onCancel={onCancel} title={i18nT("auto.worktree_session", undefined, "+Worktree Session")}>
      {/* ── existing worktrees ─────────────────────────────────────── */}
      <section className="mb-6" data-testid="worktree-dialog-existing">
        <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
          {i18nT("auto.existing_worktrees_of_this_repo", undefined, "Existing worktrees of this repo")}
        </h4>
        <div className="rounded border border-[var(--border-subtle)] overflow-hidden">
          {data.worktrees.map((wt) => (
            <button
              key={wt.path}
              type="button"
              onClick={() => handleSpawnExisting(wt)}
              data-testid={`worktree-row-${wt.isMain ? "main" : encodeURIComponent(wt.path)}`}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] last:border-b-0 disabled:opacity-60"
            >
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {wt.detached ? "(detached)" : wt.branch ?? "(none)"}
              </span>
              <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">{wt.path}</span>
              {wt.isMain && (
                <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-full px-1.5 py-px">main</span>
              )}
              <span className="text-[11px] text-blue-400">{i18nT("auto.session_2", undefined, "+Session →")}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── create new ─────────────────────────────────────────────── */}
      <section data-testid="worktree-dialog-create">
        <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
          {i18nT("auto.create_a_new_worktree", undefined, "Create a new worktree")}
        </h4>

        {/* Source mode toggle. Ternary (change: worktree-checkout-existing-branch)
            widening the binary toggle from add-worktree-from-pull-request. */}
        <div className="flex gap-2 mb-3" data-testid="worktree-source-toggle">
          <button
            type="button"
            onClick={() => setSourceMode("fork")}
            data-testid="worktree-source-fork"
            className={`px-2 py-0.5 text-[11px] rounded border ${
              sourceMode === "fork"
                ? "border-blue-500 text-blue-400 bg-blue-500/10"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {i18nT("auto.fork_to_new_branch", undefined, "Fork to new branch")}
          </button>
          <button
            type="button"
            onClick={() => setSourceMode("checkout")}
            data-testid="worktree-source-checkout"
            className={`px-2 py-0.5 text-[11px] rounded border ${
              sourceMode === "checkout"
                ? "border-blue-500 text-blue-400 bg-blue-500/10"
                : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {i18nT("auto.check_out_existing_branch", undefined, "Check out existing branch")}
          </button>
          <button
            type="button"
            onClick={() => !ghUnavailable && setSourceMode("pr")}
            disabled={!!ghUnavailable}
            data-testid="worktree-source-pr"
            className={`px-2 py-0.5 text-[11px] rounded border ${
              ghUnavailable
                ? "border-[var(--border-subtle)] text-[var(--text-muted)] opacity-50 cursor-not-allowed"
                : sourceMode === "pr"
                  ? "border-blue-500 text-blue-400 bg-blue-500/10"
                  : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {i18nT("auto.from_a_pull_request", undefined, "From a pull request")}
          </button>
          {ghUnavailable && (
            <span className="text-[10px] text-[var(--text-muted)] self-center" data-testid="worktree-gh-hint">
              {ghUnavailable === "gh_not_found"
                ? "Install gh to checkout PRs"
                : "Authenticate gh to checkout PRs"}
            </span>
          )}
        </div>

        <div className="space-y-2">
          {sourceMode !== "pr" ? (
            <>
              <label className="block">
                {/* Label reads "Branch" in checkout mode (the picker selects
                    the branch to check out), "Base branch" in fork mode
                    (the picker selects the fork base).
                    See change: worktree-checkout-existing-branch. */}
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  {checkoutMode ? "Branch" : "Base branch"}
                </span>
                <BranchCombobox
                  data-testid="worktree-base-combobox"
                  branches={allBranches}
                  value={base}
                  onChange={setBase}
                  placeholder={hasUsableBase ? undefined : "no usable default base — pick one"}
                />
              </label>

              {/* New-branch input renders ONLY in fork mode (checkout reuses
                  the existing branch). See change: worktree-checkout-existing-branch. */}
              {!checkoutMode && (
                <label className="block">
                  <span className="text-[11px] text-[var(--text-tertiary)]">{i18nT("auto.new_branch_name", undefined, "New branch name")}</span>
                  <input
                    data-testid="worktree-new-branch-input"
                    value={newBranch}
                    onChange={(e) => { setNewBranch(e.target.value); setBranchDirty(true); }}
                    placeholder="feat/dark-mode"
                    className="w-full mt-0.5 px-2 py-1 text-sm rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] font-mono"
                  />
                </label>
              )}
            </>
          ) : (
            <label className="block">
              <span className="text-[11px] text-[var(--text-tertiary)]">{i18nT("auto.pull_request", undefined, "Pull request")}</span>
              <PrCombobox
                cwd={cwd}
                value={selectedPr}
                onChange={setSelectedPr}
                onGhUnavailable={(code) => {
                  setGhUnavailable(code);
                  // Fall back out of PR mode when gh is unavailable.
                  setSourceMode("checkout");
                }}
                data-testid="worktree-pr-combobox"
              />
            </label>
          )}

          <label className="block">
            <span className="text-[11px] text-[var(--text-tertiary)]">{i18nT("auto.path", undefined, "Path")}</span>
            <input
              data-testid="worktree-path-input"
              value={effectivePath}
              onChange={(e) => setPathOverride(e.target.value)}
              placeholder={
                sourceMode === "pr"
                  ? prDerivedPath || "(select a PR to derive)"
                  : checkoutMode
                    ? derivedPath || "(pick a branch to derive)"
                    : derivedPath || "(enter a branch name to derive)"
              }
              className="w-full mt-0.5 px-2 py-1 text-sm rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] font-mono text-[var(--text-tertiary)]"
            />
          </label>
        </div>

        {/* Orphan-path warning + clean-up affordance. Renders BEFORE
            submit when the derived path is an orphan, and also AFTER
            submit when the server's path_exists envelope carries
            orphanLikely:true. See change: openspec-worktree-spawn-button. */}
        {(orphanDetected || submitError?.orphanLikely) && (
          <div
            className="mt-3 p-2 rounded border border-yellow-500/40 bg-yellow-500/5 text-[11px]"
            data-testid="worktree-dialog-orphan-warning"
          >
            <p className="text-yellow-300">
              {i18nT("auto.this_path_exists_but_isn_t", undefined, "This path exists but isn't a registered worktree — likely an orphan from a previous failed attempt.")}
            </p>
            {orphanError && (
              <p className="mt-1 text-red-400" data-testid="worktree-dialog-orphan-error">
                <span className="font-mono">{orphanError.code}</span>: {orphanError.message}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                disabled={cleaningOrphan}
                onClick={() => handleCleanOrphan(!!submitError?.orphanLikely)}
                data-testid="worktree-dialog-orphan-cleanup"
                className="px-2 py-0.5 text-[11px] rounded border border-yellow-500/40 text-yellow-200 hover:bg-yellow-500/10 disabled:opacity-50"
              >
                {cleaningOrphan ? "Cleaning…" : submitError?.orphanLikely ? "Clean up + retry" : "Clean up"}
              </button>
            </div>
          </div>
        )}
        {submitError && (
          <div className="mt-3 text-[11px]" data-testid="worktree-dialog-error">
            <div className={errorClass(submitError.code)}>
              <span className="font-mono">{submitError.code}</span>: {submitError.error}
            </div>
            {/* branch_exists recovery: the branch lingers without a worktree.
                Offer a one-click reuse-as-checkout (mirrors orphan-path
                cleanup). See change: fix-worktree-fork-orphan-branch-recovery. */}
            {submitError.code === "branch_exists" && (
              <button
                type="button"
                onClick={handleReuseAsCheckout}
                data-testid="worktree-dialog-branch-reuse"
                className="mt-1 px-2 py-0.5 text-[11px] rounded border border-yellow-500/40 text-yellow-200 hover:bg-yellow-500/10"
              >
                {i18nT("auto.check_out_this_branch_instead", undefined, "Check out this branch instead →")}
              </button>
            )}
            {submitError.stderr && (
              <details className="mt-1">
                <summary className="text-[var(--text-muted)] cursor-pointer">{i18nT("auto.git_stderr", undefined, "git stderr")}</summary>
                <pre className="mt-1 text-[10px] whitespace-pre-wrap bg-[var(--bg-tertiary)] p-2 rounded border border-[var(--border-subtle)] max-h-32 overflow-auto">{submitError.stderr}</pre>
              </details>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            data-testid="worktree-dialog-cancel"
            className="px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {i18nT("auto.cancel", undefined, "Cancel")}
          </button>
          <button
            type="button"
            disabled={!canSubmit || orphanDetected || cleaningOrphan}
            onClick={() => void handleCreateAndSpawn()}
            data-testid="worktree-dialog-create-submit"
            className="px-3 py-1 text-sm rounded bg-blue-500/80 hover:bg-blue-500 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-muted)] text-white"
          >
            {submitting ? "Creating…" : "Create +Session →"}
          </button>
        </div>

        <p className="mt-3 text-[10px] text-[var(--text-muted)]">
          {i18nT("auto.new_worktrees_start_clean_copy", undefined, "New worktrees start clean — copy")} <code className="font-mono">.env</code> {i18nT("auto.and_run_install_steps_manually", undefined, "and run install steps manually.")}
        </p>
        {data.head.hasSubmodules && (
          <p
            className="mt-1 text-[10px] text-yellow-400/80"
            data-testid="worktree-dialog-submodule-note"
          >
            {i18nT("auto.this_repo_uses_submodules_they_will", undefined, "This repo uses submodules; they will not be initialized in the new worktree.")}
          </p>
        )}
      </section>
    </DialogChrome>
  );
}

/** Outer fullscreen chrome (overlay + dismissable card). Matches the */
/* PinDirectoryDialog look so the dialog feels native to the app. */
function DialogChrome({
  children,
  onCancel,
  title,
}: {
  children: React.ReactNode;
  onCancel: () => void;
  title: string;
}) {
  return (
    <Dialog open onClose={onCancel} title={title} size="lg" testId="worktree-spawn-dialog">
        {children}
    </Dialog>
  );
}

/** Map a stable error code to a tailwind tone. */
function errorClass(code: string): string {
  switch (code) {
    case "branch_in_use":
    case "branch_exists":
    case "path_exists":
      return "text-yellow-400";
    case "base_not_found":
    case "cwd_invalid":
      return "text-orange-400";
    default:
      return "text-red-400";
  }
}

/** Tiny path-join that works with `/` and `\` separators safely. */
function joinPath(...parts: string[]): string {
  // Drop empty segments and collapse to native separator. We can't infer
  // the platform from a single path string, so default to `/` and let
  // the path preview be slightly off on Windows — server is authoritative.
  return parts.filter((p) => p.length > 0).join("/").replace(/\/+/g, "/");
}
