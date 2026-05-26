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
import { DialogPortal } from "./DialogPortal.js";
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
    setError({ code: result.code, stderr: result.stderr });
  };

  const onEndSessionsAndRemove = async () => {
    if (!activeIds) return;
    // Fire shutdowns in parallel with the forced remove. The server's
    // active-session check is skipped when `force: true`, so we don't
    // need to wait for bridges to deregister — critical because
    // shutting down our own card's session unmounts this component
    // before any setTimeout could fire.
    for (const id of activeIds) onShutdownSession(id);
    void attempt({ force: true });
  };

  const sessionName = (id: string) => {
    const s = allSessions.find((x) => x.id === id);
    return s?.name ?? s?.firstMessage?.slice(0, 40) ?? id.slice(0, 8);
  };

  return (
    <DialogPortal>
    <div className="fixed inset-0 z-[60] flex items-center justify-center" data-testid="close-worktree-dialog">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg p-4 max-w-lg w-full mx-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Close worktree</h3>
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
            <div>{error.code}</div>
            {error.stderr && (
              <details>
                <summary className="cursor-pointer text-[var(--text-muted)]">stderr</summary>
                <pre className="mt-1 text-[10px] bg-[var(--bg-tertiary)] p-2 rounded whitespace-pre-wrap">{error.stderr}</pre>
              </details>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            data-testid="close-cancel"
          >
            Cancel
          </button>
          {activeIds && activeIds.length > 0 ? (
            <button
              onClick={onEndSessionsAndRemove}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
              data-testid="close-end-sessions"
            >
              End {activeIds.length} session{activeIds.length === 1 ? "" : "s"} and remove worktree
            </button>
          ) : (
            <button
              onClick={() => attempt({ force })}
              disabled={busy}
              className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
              data-testid="close-confirm"
            >
              {busy ? "Removing…" : "Remove worktree"}
            </button>
          )}
        </div>
      </div>
    </div>
    </DialogPortal>
  );
}
