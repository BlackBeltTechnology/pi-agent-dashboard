/**
 * Merge confirm dialog for worktree → base merges.
 * - Fetches `/api/git/worktree/diff-stat` on open.
 * - Renders 5-line summary + insertion/deletion counts.
 * - Offers "Delete branch after merge" checkbox.
 * - On submit, calls `mergeWorktree`. Surfaces conflict stderr inside
 *   a collapsed <details> block.
 *
 * See change: add-worktree-lifecycle-actions.
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import React, { useEffect, useState } from "react";
import { fetchWorktreeDiffStat, mergeWorktree } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  onClose: () => void;
  onMerged?: (result: { mergeSha: string; branchDeleted: boolean }) => void;
}

export function MergeConfirmDialog({ cwd, onClose, onMerged }: Props) {
  const [stat, setStat] = useState<{ summary: string; filesChanged: number; insertions: number; deletions: number; base: string; branch: string } | null>(null);
  const [statError, setStatError] = useState<string | null>(null);
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; stderr?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWorktreeDiffStat(cwd).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setStat(r.data);
      else setStatError(r.ok ? "no data" : r.error);
    }).catch((e) => { if (!cancelled) setStatError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [cwd]);

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    const result = await mergeWorktree({ cwd, deleteBranch });
    setBusy(false);
    if (result.ok && result.data) {
      onMerged?.(result.data);
      onClose();
      return;
    }
    if (!result.ok) setError({ code: result.code, stderr: result.stderr });
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("worktree.mergeWorktree", undefined, "Merge worktree")} size="lg" testId="merge-confirm-dialog">
        {stat ? (
          <div className="space-y-1">
            <div className="text-[11px] text-[var(--text-muted)]">
              <code>{stat.branch}</code> → <code>{stat.base}</code>
            </div>
            <pre data-testid="merge-diff-stat" className="text-[11px] bg-[var(--bg-tertiary)] p-2 rounded whitespace-pre-wrap overflow-x-auto">{stat.summary || "(no changes)"}</pre>
            <div className="text-[11px] text-[var(--text-muted)]">
              {stat.filesChanged} file{stat.filesChanged === 1 ? "" : "s"} · +{stat.insertions} -{stat.deletions}
            </div>
          </div>
        ) : statError ? (
          <p className="text-xs text-red-400">{i18nT("common.couldnTLoadDiff", undefined, "Couldn't load diff:")} {statError}</p>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">{i18nT("status.loadingDiff", undefined, "Loading diff…")}</p>
        )}
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            data-testid="merge-delete-branch"
            checked={deleteBranch}
            onChange={(e) => setDeleteBranch(e.target.checked)}
          />
          {i18nT("git.deleteBranchAfterMerge", undefined, "Delete branch after merge")}
        </label>
        {error && (
          <div className="text-xs text-red-400 space-y-1" data-testid="merge-error">
            <div>{error.code === "merge_conflict" ? "Merge conflict — main checkout was left clean." : error.code === "dirty_main" ? "Main checkout has uncommitted changes." : error.code}</div>
            {error.stderr && (
              <details>
                <summary className="cursor-pointer text-[var(--text-muted)]">{i18nT("terminal.showStderr", undefined, "Show stderr")}</summary>
                <pre className="mt-1 text-[10px] bg-[var(--bg-tertiary)] p-2 rounded whitespace-pre-wrap">{error.stderr}</pre>
              </details>
            )}
          </div>
        )}
        <Dialog.Footer>
          <Dialog.Cancel onClick={onClose} testId="merge-cancel" />
          <Dialog.Action
            onClick={onConfirm}
            disabled={busy || !stat || stat.filesChanged === 0}
            testId="merge-confirm"
          >
            {busy ? "Merging…" : "Merge"}
          </Dialog.Action>
        </Dialog.Footer>
    </Dialog>
  );
}
