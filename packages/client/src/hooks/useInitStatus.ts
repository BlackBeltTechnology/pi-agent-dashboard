/**
 * Single shared `GET /api/git/worktree/init-status` probe for a row.
 *
 * The row's `FolderInitScope` calls this once and feeds the result to BOTH the
 * tier-0 `FolderActionBanner` (setup / init / re-trust / failure rungs) and the
 * folder actions menu's Project setup tally, avoiding a double probe per row.
 * `refetch` re-issues the probe (after a hook run flips the gate, or a spawned
 * project-init session ends). Fail-open: `fetchWorktreeInitStatus` returns
 * `hasHook:false` on error.
 *
 * See change: distinguish-initialize-actions, add-folder-action-banner.
 */
import { useCallback, useEffect, useState } from "react";
import { fetchWorktreeInitStatus, type WorktreeInitStatus } from "../lib/git/git-api.js";
import { logRejection } from "../lib/report-error.js";

export function useInitStatus(cwd: string): { status: WorktreeInitStatus | null; refetch: () => void } {
  const [status, setStatus] = useState<WorktreeInitStatus | null>(null);

  const refetch = useCallback(() => {
    void fetchWorktreeInitStatus(cwd).then(setStatus);
  }, [cwd]);

  useEffect(() => {
    let alive = true;
    // Effect callbacks must return void/cleanup, so the promise is discarded
    // with a stated handler. See change: cleanup-client-plugin-promises.
    void fetchWorktreeInitStatus(cwd)
      .then((s) => { if (alive) setStatus(s); })
      .catch(logRejection("useInitStatus.fetch"));
    return () => { alive = false; };
  }, [cwd]);

  return { status, refetch };
}
