/**
 * Manage-worktrees surface: a `Dialog size="lg"` hosting `<WorktreeList
 * mode="manage" />` (design D3), opened from the folder actions menu.
 *
 * Owns the three things the list itself does not: fetching, per-row removal
 * (delegated to `CloseWorktreeDialog` so the `active_sessions` and
 * `dirty_worktree` escalations are inherited unchanged, design D4), and the
 * bulk `remove-batch` path with per-row failure rendering.
 *
 * Batch retries MUST carry the original `deleteBranch` intent and the per-item
 * `sessionIds` the batch response returned — dropping either silently changes
 * what the user asked for.
 *
 * Prune is REPO-GLOBAL: it clears every stale registration, not the row whose
 * affordance was used, and the reported count says so (design D8).
 *
 * See change: manage-worktrees-filter-cleanup.
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useState } from "react";
import {
  fetchWorktrees,
  pruneWorktrees,
  type RemoveBatchItemResult,
  removeWorktreeBatch,
  type WorktreeEntry,
} from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CloseWorktreeDialog } from "./CloseWorktreeDialog.js";
import { WorktreeList } from "./WorktreeList.js";

interface Props {
  cwd: string;
  allSessions: DashboardSession[];
  onShutdownSession: (sessionId: string) => void;
  onClose: () => void;
}

export function ManageWorktreesDialog({ cwd, allSessions, onShutdownSession, onClose }: Props) {
  const [entries, setEntries] = useState<WorktreeEntry[] | null>(null);
  const [closing, setClosing] = useState<WorktreeEntry | null>(null);
  const [failures, setFailures] = useState<Record<string, { code: string; message?: string }>>({});
  const [pending, setPending] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setEntries(await fetchWorktrees(cwd));
  }, [cwd]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onRemoveSelected = useCallback(
    async (paths: string[], opts: { deleteBranch: boolean }) => {
      setPending(paths);
      setFailures({});
      // Retries must carry the ORIGINAL deleteBranch intent, not a default.
      const result = await removeWorktreeBatch(
        paths.map((p) => ({ cwd: p, deleteBranch: opts.deleteBranch })),
      );
      setPending([]);
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      const next: Record<string, { code: string; message?: string }> = {};
      for (const item of result.data?.results ?? ([] as RemoveBatchItemResult[])) {
        if (item.ok) continue;
        next[item.cwd] = {
          code: item.code,
          message: describeFailure(item),
        };
      }
      setFailures(next);
      await refresh();
    },
    [refresh],
  );

  const onPrune = useCallback(async () => {
    const result = await pruneWorktrees({ cwd });
    if (result.ok) {
      const n = result.data?.pruned ?? 0;
      setNotice(
        `${i18nT("worktree.prunedRepoWide", undefined, "Cleared")} ${n} ${i18nT(
          "worktree.staleRegistrationsRepoWide",
          undefined,
          "stale registration(s) across this repository",
        )}`,
      );
    } else {
      setNotice(result.error);
    }
    await refresh();
  }, [cwd, refresh]);

  const failureList = Object.entries(failures);

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="lg"
        title={i18nT("worktree.manageWorktrees", undefined, "Manage worktrees")}
        testId="manage-worktrees-dialog"
      >
        {notice && (
          <p className="text-xs text-[var(--text-secondary)]" data-testid="manage-worktrees-notice">
            {notice}
          </p>
        )}
        {failureList.length > 0 && (
          <div
            className="text-xs text-[var(--text-secondary)] border border-[var(--border-subtle)] rounded px-2 py-1"
            data-testid="manage-worktrees-failure-summary"
          >
            <span aria-hidden="true">⚠</span>{" "}
            {failureList.length} {i18nT("worktree.rowsFailedToRemove", undefined, "row(s) failed to remove")}
            <ul className="list-disc list-inside">
              {failureList.map(([path, f]) => (
                <li key={path}>
                  <a href={`#worktree-row-${encodeURIComponent(path)}`}>{path}</a> — {f.message ?? f.code}
                </li>
              ))}
            </ul>
          </div>
        )}
        {entries == null ? (
          <p className="text-xs text-[var(--text-secondary)]" data-testid="manage-worktrees-loading">
            {i18nT("common.loading2", undefined, "Loading…")}
          </p>
        ) : (
          <WorktreeList
            entries={entries}
            mode="manage"
            onRemove={(entry) => setClosing(entry)}
            onRemoveSelected={onRemoveSelected}
            onPrune={onPrune}
            failures={failures}
            pending={pending}
          />
        )}
      </Dialog>

      {closing && (
        <CloseWorktreeDialog
          cwd={closing.path}
          allSessions={allSessions}
          onShutdownSession={onShutdownSession}
          onClose={() => setClosing(null)}
          onRemoved={() => { void refresh(); }}
        />
      )}
    </>
  );
}

function describeFailure(item: RemoveBatchItemResult): string {
  switch (item.code) {
    case "active_sessions":
      // Carry the per-item sessionIds through so an escalation retry can use them.
      return `${item.sessionIds?.length ?? 0} ${i18nT("session.activeSessions", undefined, "active session(s)")}`;
    case "dirty_worktree":
      return i18nT("worktree.uncommittedChanges", undefined, "uncommitted changes");
    case "cwd_invalid":
      return i18nT("worktree.alreadyGone", undefined, "already gone");
    default:
      return item.code;
  }
}
