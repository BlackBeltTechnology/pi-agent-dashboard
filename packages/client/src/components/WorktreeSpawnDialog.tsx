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
  bootstrapExistingWorktree,
  cleanupOrphanWorktreePath,
  createWorktree,
  fetchBranches,
  fetchGitHead,
  fetchWorktreeBootstrapStatus,
  fetchWorktrees,
  probePathExists,
  type BootstrapStatus,
  type CreateWorktreeError,
  type HeadInfo,
  type WorktreeEntry,
} from "../lib/git-api.js";
import {
  subscribeBootstrap,
  type WorktreeBootstrapEvent,
} from "../lib/worktree-bootstrap-bus.js";
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
  // ── Bootstrap state (change: harden-worktree-spawn) ──────────────────
  // Per-row bootstrap-status probe results. Map<path, status | null> —
  // null = probe in flight, undefined = not yet probed.
  const [bootstrapStatusByPath, setBootstrapStatusByPath] = useState<Map<string, BootstrapStatus | null>>(
    () => new Map(),
  );
  // Active install state: `idle` when no install in flight; `installing`
  // while subscribed to worktree_bootstrap_* events; `failed` after a
  // terminal failure. On `done` the dialog auto-spawns and unmounts via
  // onSpawn (callback closes us), so there's no explicit "done" phase.
  const [bootstrap, setBootstrap] = useState<{
    phase: "idle" | "installing" | "failed";
    requestId?: string;
    cwd?: string;
    tail?: string;
    errorCode?: string;
    errorMessage?: string;
    errorStderr?: string;
  }>({ phase: "idle" });
  // After bootstrap completes successfully, what to do next — set before
  // creating/installing. Read inside the bus listener to dispatch spawn.
  const onBootstrapDoneRef = useRef<(() => void) | null>(null);

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

  // ── Per-row bootstrap probe (change: harden-worktree-spawn) ──────────
  //
  // For each existing worktree row, fire one bootstrap-status probe. Use
  // `null` as a tombstone for in-flight, then write the resolved status.
  // Fail-open: when the probe rejects, leave the entry undefined so the
  // row falls back to the unconditional `Spawn →` button.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setBootstrapStatusByPath((prev) => {
      const next = new Map(prev);
      for (const wt of data.worktrees) {
        if (!next.has(wt.path)) next.set(wt.path, null);
      }
      return next;
    });
    for (const wt of data.worktrees) {
      fetchWorktreeBootstrapStatus(wt.path).then(
        (status) => {
          if (cancelled) return;
          setBootstrapStatusByPath((prev) => {
            const next = new Map(prev);
            next.set(wt.path, status);
            return next;
          });
        },
        () => {
          if (cancelled) return;
          // Drop the in-flight marker so the row falls back to `Spawn →`.
          setBootstrapStatusByPath((prev) => {
            const next = new Map(prev);
            next.delete(wt.path);
            return next;
          });
        },
      );
    }
    return () => { cancelled = true; };
  }, [data]);

  // ── Bus subscription (change: harden-worktree-spawn) ─────────────────
  //
  // While `bootstrap.phase === "installing"` we listen for worktree_
  // bootstrap_* events tagged with our requestId. On done we invoke the
  // captured onBootstrapDoneRef (which spawns pi); on failed we move to
  // the `failed` phase so the error renders inline.
  useEffect(() => {
    if (bootstrap.phase !== "installing" || !bootstrap.requestId) return;
    const unsub = subscribeBootstrap(bootstrap.requestId, (ev: WorktreeBootstrapEvent) => {
      if (ev.type === "worktree_bootstrap_progress") {
        setBootstrap((prev) => prev.requestId === ev.requestId ? { ...prev, tail: ev.line } : prev);
      } else if (ev.type === "worktree_bootstrap_done") {
        const cb = onBootstrapDoneRef.current;
        onBootstrapDoneRef.current = null;
        setBootstrap({ phase: "idle" });
        if (cb) cb();
      } else if (ev.type === "worktree_bootstrap_failed") {
        onBootstrapDoneRef.current = null;
        setBootstrap({
          phase: "failed",
          requestId: ev.requestId,
          cwd: ev.cwd,
          errorCode: ev.code,
          errorMessage: ev.message,
          errorStderr: ev.stderr,
        });
      }
    });
    return () => { unsub(); };
  }, [bootstrap.phase, bootstrap.requestId]);

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
  // Mint a requestId for an install run. Uses crypto.randomUUID() when
  // available, falls back to a non-cryptographic sequence for older
  // contexts (only used as a correlation token, no security implication).
  const mintRequestId = useCallback(() => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }, []);

  const handleSpawnExisting = useCallback((entry: WorktreeEntry) => {
    const status = bootstrapStatusByPath.get(entry.path);
    // Healthy / not-required / probe-failed → spawn immediately.
    if (!status || !status.needsBootstrap) {
      onSpawn(entry.path, buildOpts());
      return;
    }
    // Bootstrap required — run install via the bootstrap-existing route,
    // stream progress, then spawn pi on done. The same listener effect
    // handles the bus events; here we just kick it off.
    const requestId = mintRequestId();
    onBootstrapDoneRef.current = () => onSpawn(entry.path, buildOpts());
    setBootstrap({ phase: "installing", requestId, cwd: entry.path });
    // Server returns the final HTTP response when install finishes,
    // but the bus already fired done/failed by then. We use the bus as
    // the source of truth; the HTTP result is a safety net.
    bootstrapExistingWorktree({ cwd: entry.path, requestId }).then(
      (res) => {
        if (!res.ok) {
          // Edge: bus event was suppressed (e.g. ws closed mid-flight).
          // Promote HTTP error to the failed phase so the user sees it.
          setBootstrap((prev) => prev.phase === "installing" && prev.requestId === requestId
            ? { phase: "failed", requestId, cwd: entry.path, errorCode: res.code, errorMessage: res.error, errorStderr: res.stderr ?? "" }
            : prev,
          );
        }
      },
      (err) => {
        setBootstrap((prev) => prev.phase === "installing" && prev.requestId === requestId
          ? { phase: "failed", requestId, cwd: entry.path, errorCode: "network_failure", errorMessage: err?.message ?? "network failure", errorStderr: "" }
          : prev,
        );
      },
    );
  }, [bootstrapStatusByPath, mintRequestId, onSpawn, buildOpts]);

  const handleCreateAndSpawn = useCallback(async () => {
    if (!data) return;
    setSubmitting(true);
    setSubmitError(null);
    // Mint requestId BEFORE the HTTP call so the server can stream events
    // to the right ws. The bus is subscribed once `bootstrap.phase` flips.
    const requestId = mintRequestId();
    // Optimistic: assume the bootstrap step will run. If the server
    // returns `bootstrap.ran === false` we close the installing phase
    // immediately. See change: harden-worktree-spawn.
    setBootstrap({ phase: "installing", requestId });
    onBootstrapDoneRef.current = null; // Set after server returns the path.
    let res;
    try {
      res = await createWorktree({
        cwd,
        base,
        newBranch,
        requestId,
        ...(pathOverride ? { path: pathOverride } : {}),
      });
    } catch (err: any) {
      // Network failure, JSON parse error, or any other thrown exception.
      setSubmitting(false);
      setBootstrap({ phase: "idle" });
      setSubmitError({
        ok: false,
        code: "network_failure",
        error: err?.message ?? "network failure or unexpected error",
      });
      return;
    }
    setSubmitting(false);
    if (!res.ok) {
      setBootstrap({ phase: "idle" });
      // bootstrap_failed envelope from the server already routed through
      // the bus listener — don't double-surface. For every other error
      // code, show the inline error.
      if (res.code !== "bootstrap_failed") setSubmitError(res);
      return;
    }
    // Bootstrap-skipped path: server returned without running install.
    // Spawn immediately and close out the (unused) installing phase.
    if (!res.bootstrap || res.bootstrap.ran === false) {
      setBootstrap({ phase: "idle" });
      onSpawn(res.path, buildOpts(base));
      return;
    }
    // Bootstrap actually ran AND HTTP succeeded — the bus must have
    // delivered worktree_bootstrap_done already (HTTP response is held
    // until the install finishes). The bus listener has cleared phase.
    onSpawn(res.path, buildOpts(base));
  }, [data, cwd, base, newBranch, pathOverride, onSpawn, buildOpts, mintRequestId]);

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
          {data.worktrees.map((wt) => {
            const status = bootstrapStatusByPath.get(wt.path);
            const needs = !!status && status.needsBootstrap;
            const installing = bootstrap.phase === "installing" && bootstrap.cwd === wt.path;
            return (
              <button
                key={wt.path}
                type="button"
                onClick={() => handleSpawnExisting(wt)}
                disabled={installing}
                data-testid={`worktree-row-${wt.isMain ? "main" : encodeURIComponent(wt.path)}`}
                {...(needs ? { "data-testid-needs-bootstrap": "true" } : {})}
                title={needs
                  ? `${wt.path} needs node_modules — click to run install then spawn.`
                  : undefined}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--bg-tertiary)] border-b border-[var(--border-subtle)] last:border-b-0 disabled:opacity-60"
              >
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  {wt.detached ? "(detached)" : wt.branch ?? "(none)"}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] truncate flex-1">{wt.path}</span>
                {wt.isMain && (
                  <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border border-[var(--border-subtle)] rounded-full px-1.5 py-px">main</span>
                )}
                {installing ? (
                  <span className="text-[11px] text-yellow-300">Installing…</span>
                ) : needs ? (
                  <span className="text-[11px] text-yellow-300" data-testid={`worktree-row-${wt.isMain ? "main" : encodeURIComponent(wt.path)}-needs-bootstrap`}>
                    ⚠ Install deps + Spawn →
                  </span>
                ) : (
                  <span className="text-[11px] text-blue-400">Spawn →</span>
                )}
              </button>
            );
          })}
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
              onChange={(e) => setNewBranch(e.target.value)}
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

        {/* Bootstrap progress / failure surface (change: harden-worktree-spawn) */}
        {bootstrap.phase === "installing" && (
          <div className="mt-3 text-[11px]" data-testid="worktree-dialog-bootstrap-progress">
            <div className="text-yellow-300 mb-1">Installing dependencies…</div>
            {bootstrap.tail && (
              <pre className="text-[10px] whitespace-pre-wrap bg-[var(--bg-tertiary)] p-2 rounded border border-[var(--border-subtle)] max-h-40 overflow-auto font-mono" data-testid="worktree-dialog-bootstrap-tail">{bootstrap.tail}</pre>
            )}
          </div>
        )}
        {bootstrap.phase === "failed" && (
          <div className="mt-3 text-[11px]" data-testid="worktree-dialog-bootstrap-error">
            <div className="text-red-400">
              <span className="font-mono">{bootstrap.errorCode ?? "bootstrap_failed"}</span>: {bootstrap.errorMessage}
            </div>
            {bootstrap.errorStderr && (
              <details className="mt-1">
                <summary className="text-[var(--text-muted)] cursor-pointer">install stderr</summary>
                <pre className="mt-1 text-[10px] whitespace-pre-wrap bg-[var(--bg-tertiary)] p-2 rounded border border-[var(--border-subtle)] max-h-32 overflow-auto">{bootstrap.errorStderr}</pre>
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
            disabled={!canSubmit || orphanDetected || cleaningOrphan || bootstrap.phase === "installing"}
            onClick={handleCreateAndSpawn}
            data-testid="worktree-dialog-create-submit"
            className="px-3 py-1 text-sm rounded bg-blue-500/80 hover:bg-blue-500 disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-muted)] text-white"
          >
            {bootstrap.phase === "installing"
              ? "Installing…"
              : submitting ? "Creating…" : "Create + Spawn →"}
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
