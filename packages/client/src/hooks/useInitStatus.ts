/**
 * Single shared `GET /api/git/worktree/init-status` probe for a row.
 *
 * The folder-action-bar row calls this once and feeds the result to BOTH the
 * scaffold `ProjectInitButton` and the hook-run `WorktreeInitButton`, avoiding
 * a double probe per row. `refetch` re-issues the probe (used after a hook run
 * flips the gate). Fail-open: `fetchWorktreeInitStatus` returns `hasHook:false`
 * on error.
 *
 * See change: distinguish-initialize-actions.
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
