/**
 * "Initialize" control for a directory / worktree row — hook-run only.
 *
 * Probes `GET /api/git/worktree/init-status` (or consumes the row's shared
 * probe) and renders a control when the row declares a hook AND either the gate
 * reports `needsInit` OR the hook is untrusted. The control labels itself by
 * reason (folder-action-bar spec):
 *   - `needsInit === true`                    → "Initialize"
 *   - `needsInit === false && trusted === false` → "Review & trust changes"
 *     (the hook was edited after last trust; granting trust clears the control
 *     without running an init when the gate is already satisfied)
 *
 * Execution feedback comes from the cwd-keyed `worktree-init-store` (shared with
 * auto-on-spawn + refresh): a friendly `WorktreeInitChip` (status + elapsed +
 * ghost last-line + opt-in log) replaces the old raw `<pre>` wall. Failure is
 * sticky + retryable; success flashes then collapses via the store.
 *
 * Untrusted hooks first show a trust-confirm dialog; on confirm the run
 * re-issues with `confirmHash`. Fail-open: any probe error hides the control.
 *
 * See change: generalize-worktree-init-hook, distinguish-initialize-actions,
 * friendlier-worktree-init.
 */

import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { mdiCogPlayOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchWorktreeInitStatus,
  runWorktreeInit,
  type WorktreeInitHook,
  type WorktreeInitStatus,
} from "../lib/git-api.js";
import { t as i18nT } from "../lib/i18n";
import { initStore, useInitRun } from "../lib/worktree-init-store.js";
import { WorktreeInitChip } from "./WorktreeInitChip.js";

function describeRun(hook: WorktreeInitHook): string {
  return hook.run.type === "script"
    ? `command: ${hook.run.command}`
    : `agent prompt: ${hook.run.prompt}${hook.run.model ? ` (model ${hook.run.model})` : ""}`;
}

interface Props {
  cwd: string;
  /**
   * Shared init-status from the row's single probe. When provided (including
   * `null` while the row's fetch is in flight), the row owns the probe and this
   * component does NOT self-fetch. When `undefined`, it self-probes (standalone
   * use). See change: distinguish-initialize-actions.
   */
  status?: WorktreeInitStatus | null;
  /** Row-provided refetch, invoked after a run flips the gate. */
  onStatusChange?: () => void;
}

export function WorktreeInitButton({ cwd, status: externalStatus, onStatusChange }: Props) {
  const [internalStatus, setInternalStatus] = useState<WorktreeInitStatus | null>(null);
  // The row owns the probe when it passes a `status` prop (even `null`).
  const rowOwnsProbe = externalStatus !== undefined;
  const status = rowOwnsProbe ? externalStatus : internalStatus;
  const [confirm, setConfirm] = useState<{ hook: WorktreeInitHook; hash: string } | null>(null);
  const run = useInitRun(cwd);

  const refetch = useCallback(() => {
    if (onStatusChange) { onStatusChange(); return Promise.resolve(); }
    return fetchWorktreeInitStatus(cwd).then(setInternalStatus);
  }, [cwd, onStatusChange]);

  // Lazy per-row probe — skipped when the row owns the shared probe.
  useEffect(() => {
    if (rowOwnsProbe) return;
    let alive = true;
    fetchWorktreeInitStatus(cwd).then((s) => { if (alive) setInternalStatus(s); });
    return () => { alive = false; };
  }, [cwd, rowOwnsProbe]);

  // When a run reaches `done`, re-probe so the gate flips and the control hides.
  const wasDone = useRef(false);
  useEffect(() => {
    if (run?.phase === "done" && !wasDone.current) { wasDone.current = true; void refetch(); }
    if (!run || run.phase === "running") wasDone.current = false;
  }, [run, refetch]);

  const doRun = useCallback(async (confirmHash?: string) => {
    initStore.startRun(cwd);
    try {
      const res = await runWorktreeInit({ cwd, confirmHash });
      if (res.ok) {
        // ran:false (already_initialized / no_hook) has no ws terminal event —
        // resolve the optimistic run here; a real run's done arrives via ws.
        if (!res.ran) { initStore.dismiss(cwd); void refetch(); }
        else initStore.markDone(cwd);
      } else if (res.untrusted) {
        initStore.dismiss(cwd);
        setConfirm({ hook: res.hook, hash: res.hash });
      } else {
        initStore.markFailed(cwd, res.code, res.error, res.stderr);
      }
    } catch (err) {
      initStore.markFailed(cwd, "network_failure", err instanceof Error ? err.message : "init failed");
    }
  }, [cwd, refetch]);

  // Show when init is needed, OR when a hook exists but isn't trusted yet.
  const showButton = !!status && status.hasHook === true && (status.trusted === false || status.needsInit === true);
  // Re-trust label: hook edited (trusted:false) but gate already satisfied.
  const reTrust = !!status && status.hasHook === true && status.trusted === false && status.needsInit === false;
  const label = reTrust ? "Review & trust changes" : "Initialize";

  // Live run feedback takes over the row while a run is in flight / terminal.
  if (run) {
    return (
      <WorktreeInitChip
        run={run}
        variant="manual"
        onRetry={run.phase === "failed" ? () => { void doRun(); } : undefined}
      />
    );
  }

  if (!showButton) return null;

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void doRun(); }}
        data-testid="worktree-init-btn"
        className="text-[10px] px-1.5 py-0.5 rounded border text-amber-400 border-amber-500/40 bg-amber-500/5 hover:text-amber-300 hover:border-amber-500/70"
        title={i18nT("auto.initialize_this_checkout_run_its_declared", undefined, "Initialize this checkout (run its declared worktree-init hook)")}
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiCogPlayOutline} size={0.5} />
          {label}
        </span>
      </button>

      {confirm && (
        <Confirm
          open
          title={i18nT("auto.run_worktree_init_hook", undefined, "Run worktree-init hook?")}
          message={
            `Run this project's worktree-init hook?\n\ngate: ${confirm.hook.gate}\n${describeRun(confirm.hook)}\n\n` +
            `This executes repo-provided code on your machine.`
          }
          confirmLabel="Run"
          onConfirm={() => { const hash = confirm.hash; setConfirm(null); void doRun(hash); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
