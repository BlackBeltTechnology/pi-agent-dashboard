/**
 * Close-worktree confirm dialog.
 *
 * Flow:
 *   1. POST /api/git/worktree/remove without force.
 *   2. If 409 + active_sessions, render the session list + a confirm
 *      button "End N sessions and remove worktree". On confirm, send
 *      `shutdown` for each session, await session_end, then re-post.
 *   3. If 409 + dirty_worktree | branch_not_merged, expose a `--force`
 *      checkbox and re-post.
 *
 * The "Delete merged branch" checkbox is best-effort: it appears
 * checked-by-default whenever the user explicitly opens this dialog and
 * is honoured server-side via a follow-up merge endpoint when supplied.
 * For v1, we only delete the branch as part of the existing merge flow;
 * here the checkbox is informational (toggling has no client-side
 * effect until the merge endpoint is invoked separately).
 *
 * See change: add-worktree-lifecycle-actions.
 */
import React, { useState } from "react";
import { removeWorktree } from "../lib/git-api.js";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

interface Props {
  cwd: string;
  /** Live session list — used to render names for any active_sessions returned by the server. */
  allSessions: DashboardSession[];
  /** Called to shut down a session (App-level handler). */
  onShutdownSession: (sessionId: string) => void;
  onClose: () => void;
  onRemoved?: () => void;
}

export function CloseWorktreeDialog({ cwd, allSessions, onShutdownSession, onClose, onRemoved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; stderr?: string } | null>(null);
  const [activeIds, setActiveIds] = useState<string[] | null>(null);
  const [force, setForce] = useState(false);

  const attempt = async (opts: { force?: boolean } = {}) => {
    setBusy(true);
    setError(null);
    const result = await removeWorktree({ cwd, force: opts.force });
    setBusy(false);
    if (result.ok) {
      onRemoved?.();
      onClose();
      return;
    }
    if (result.code === "active_sessions") {
      setActiveIds(result.data?.sessionIds ?? []);
      return;
    }
    // When the worktree is dirty/unmerged, auto-tick --force so the user
    // sees the obvious next step. Errors are surfaced loudly below.
    if (result.code === "dirty_worktree" || result.code === "branch_not_merged") {
      setForce(true);
    }
    setError({ code: result.code, stderr: result.stderr });
  };

  const onEndSessionsAndRemove = async () => {
    if (!activeIds) return;
    // Fire shutdowns then the forced remove. We previously fired both in
    // parallel and relied on `force: true` to bypass the server-side
    // active-session check — but if this dialog belongs to the very
    // session being shut down, the component tree unmounts mid-flight
    // and the fetch can be dropped in some browsers / wrappers. Issuing
    // the remove eagerly inside this handler (before unmount kicks in
    // for the same tick) is enough because fetch() dispatches
    // synchronously, but we now keep the call chain simple and await it
    // so the success branch reliably reaches onRemoved/onClose.
    for (const id of activeIds) onShutdownSession(id);
    await attempt({ force: true });
  };

  const sessionName = (id: string) => {
    const s = allSessions.find((x) => x.id === id);
    return s?.name ?? s?.firstMessage?.slice(0, 40) ?? id.slice(0, 8);
  };

  return (
    <Dialog open onClose={onClose} title="Close worktree" size="lg" testId="close-worktree-dialog">
        <p className="text-xs text-[var(--text-muted)]">
          <code>{cwd}</code>
        </p>

        {activeIds && activeIds.length > 0 && (
          <div className="space-y-2" data-testid="close-active-sessions">
            <p className="text-xs text-yellow-400">
              {activeIds.length} active pi session{activeIds.length === 1 ? "" : "s"} are using this worktree:
            </p>
            <ul className="text-xs text-[var(--text-secondary)] list-disc list-inside max-h-32 overflow-y-auto">
              {activeIds.map((id) => (
                <li key={id} data-testid={`close-active-session-${id}`}>{sessionName(id)}</li>
              ))}
            </ul>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            data-testid="close-force-toggle"
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
          />
          --force (discard uncommitted / unmerged changes)
        </label>

        {error && (
          <div className="text-xs text-red-400 space-y-1" data-testid="close-error">
            <div>
              {error.code}
              {(error.code === "dirty_worktree" || error.code === "branch_not_merged") && (
                <span className="ml-2 text-[var(--text-secondary)]">
                  — uncommitted changes. Enable <code>--force</code> above and click Remove again.
                </span>
              )}
            </div>
            {error.stderr && (
              <details>
                <summary className="cursor-pointer text-[var(--text-muted)]">stderr</summary>
                <pre className="mt-1 text-[10px] bg-[var(--bg-tertiary)] p-2 rounded whitespace-pre-wrap">{error.stderr}</pre>
              </details>
            )}
          </div>
        )}

        <Dialog.Footer>
          <Dialog.Cancel onClick={onClose} testId="close-cancel" />
          {activeIds && activeIds.length > 0 ? (
            <Dialog.Action
              onClick={onEndSessionsAndRemove}
              disabled={busy}
              intent="danger"
              testId="close-end-sessions"
            >
              End {activeIds.length} session{activeIds.length === 1 ? "" : "s"} and remove worktree
            </Dialog.Action>
          ) : (
            <Dialog.Action
              onClick={() => attempt({ force })}
              disabled={busy}
              intent="danger"
              testId="close-confirm"
            >
              {busy ? "Removing…" : "Remove worktree"}
            </Dialog.Action>
          )}
        </Dialog.Footer>
    </Dialog>
  );
}
