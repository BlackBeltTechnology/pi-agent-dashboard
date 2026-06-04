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
import {
  cleanupOrphanWorktreePath,
  createWorktree,
  fetchBranches,
  fetchGitHead,
  fetchWorktrees,
  probePathExists,
  type CreateWorktreeError,
  type HeadInfo,
  type WorktreeEntry,
} from "../lib/git-api.js";
import {
  resolveDefaultBase,
  slugifyBranch,
} from "@blackbelt-technology/pi-dashboard-shared/git-worktree-helpers.js";

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
}

interface LoadedData {
  worktrees: WorktreeEntry[];
  head: HeadInfo;
  localBranches: string[];
  remoteBranches: string[];
}

export function WorktreeSpawnDialog({ cwd, onSpawn, onCancel, initialBranch, attachProposal }: Props) {
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
        const localBranches = branchList.branches.filter((b) => !b.isRemote).map((b) => b.name);
        const remoteBranches = branchList.branches.filter((b) => b.isRemote).map((b) => b.name);
        const loaded: LoadedData = { worktrees, head, localBranches, remoteBranches };
        setData(loaded);
        // Compute initial base via the shared fallback helper.
        const def = resolveDefaultBase({
          currentBranch: head.branch,
          localBranches,
          remoteBranches,
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
  const slug = useMemo(() => slugifyBranch(newBranch), [newBranch]);
  const derivedPath = useMemo(() => {
    if (!data || !slug) return "";
    // Path preview: <repo>/.worktrees/<slug>. The repo root is the main
    // worktree's path returned by listWorktrees. Server is authoritative
    // — this is purely for user feedback.
    const main = data.worktrees.find((w) => w.isMain);
    if (!main) return `.worktrees/${slug}`;
    return joinPath(main.path, ".worktrees", slug);
  }, [data, slug]);
  const effectivePath = pathOverride ?? derivedPath;
  const allBranches = useMemo(() => {
    if (!data) return [] as string[];
    return [...data.localBranches, ...data.remoteBranches];
  }, [data]);

  const canSubmit =
    !!data &&
    !submitting &&
    newBranch.trim().length > 0 &&
    base.trim().length > 0 &&
    slug.length > 0;

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
    onSpawn(entry.path, buildOpts());
  }, [onSpawn, buildOpts]);

  const handleCreateAndSpawn = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setSubmitError(null);
    let res;
    try {
      res = await createWorktree({
        cwd,
        base,
        newBranch,
        ...(pathOverride ? { path: pathOverride } : {}),
      });
    } catch (err: any) {
      // Network failure, JSON parse error, or any other thrown exception.
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
      setSubmitError(res);
      return;
    }
    // Worktree created clean; spawn the session. Initialization (if the
    // project declares a hook) is a separate gated Initialize action.
    onSpawn(res.path, buildOpts(base));
  }, [data, cwd, base, newBranch, pathOverride, onSpawn, buildOpts]);

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
  }, [newBranch, base, pathOverride]);

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
      <DialogChrome onCancel={onCancel} title="+Worktree Session">
        <div className="text-red-400" data-testid="worktree-dialog-load-error">{loadError}</div>
      </DialogChrome>
    );
  }
  if (!data) {
    return (
      <DialogChrome onCancel={onCancel} title="+Worktree Session">
        <div className="text-[var(--text-muted)]" data-testid="worktree-dialog-loading">Loading…</div>
      </DialogChrome>
    );
  }

  const hasUsableBase = base.trim().length > 0;

  return (
    <DialogChrome onCancel={onCancel} title="+Worktree Session">
      {/* ── existing worktrees ─────────────────────────────────────── */}
      <section className="mb-6" data-testid="worktree-dialog-existing">
        <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Existing worktrees of this repo
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
              <span className="text-[11px] text-blue-400">+Session →</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── create new ─────────────────────────────────────────────── */}
      <section data-testid="worktree-dialog-create">
        <h4 className="text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2">
          Create a new worktree
        </h4>
        <div className="space-y-2">
          <label className="block">
            <span className="text-[11px] text-[var(--text-tertiary)]">Base branch</span>
            <select
              data-testid="worktree-base-select"
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className="w-full mt-0.5 px-2 py-1 text-sm rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
            >
              {!hasUsableBase && <option value="">no usable default base — pick one</option>}
              {allBranches.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] text-[var(--text-tertiary)]">New branch name</span>
            <input
              data-testid="worktree-new-branch-input"
              value={newBranch}
              onChange={(e) => { setNewBranch(e.target.value); setBranchDirty(true); }}
              placeholder="feat/dark-mode"
              className="w-full mt-0.5 px-2 py-1 text-sm rounded border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] font-mono"
            />
          </label>

          <label className="block">
            <span className="text-[11px] text-[var(--text-tertiary)]">Path</span>
            <input
              data-testid="worktree-path-input"
              value={effectivePath}
              onChange={(e) => setPathOverride(e.target.value)}
              placeholder={derivedPath || "(enter a branch name to derive)"}
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
              This path exists but isn't a registered worktree — likely an orphan from a previous failed attempt.
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
            {submitError.stderr && (
              <details className="mt-1">
                <summary className="text-[var(--text-muted)] cursor-pointer">git stderr</summary>
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
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || orphanDetected || cleaningOrphan}
            onClick={handleCreateAndSpawn}
            data-testid="worktree-dialog-create-submit"
            className="px-3 py-1 text-sm rounded bg-blue-500/80 hover:bg-blue-500 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-muted)] text-white"
          >
            {submitting ? "Creating…" : "Create +Session →"}
          </button>
        </div>

        <p className="mt-3 text-[10px] text-[var(--text-muted)]">
          New worktrees start clean — copy <code className="font-mono">.env</code> and run install steps manually.
        </p>
        {data.head.hasSubmodules && (
          <p
            className="mt-1 text-[10px] text-yellow-400/80"
            data-testid="worktree-dialog-submodule-note"
          >
            This repo uses submodules; they will not be initialized in the new worktree.
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
  // Escape-to-cancel for keyboard-driven users.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-[60]">
      <div
        className="bg-[var(--bg-secondary)] rounded-lg p-6 w-full max-w-xl border border-[var(--border-secondary)]"
        data-testid="worktree-spawn-dialog"
      >
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        {children}
      </div>
    </div>
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
