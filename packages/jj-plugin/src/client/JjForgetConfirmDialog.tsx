/**
 * Two-step confirmation for `Forget workspace` when the server returned
 * HTTP 409 UNFOLDED_WORK. Lists the commits about to be lost and forces
 * the user to acknowledge before re-issuing with `force: true`.
 *
 * Per Decision 10: refuse-then-force keeps the user's mental model
 * ("forget means the work is gone") from quietly losing data.
 *
 * See change: add-jj-workspace-plugin.
 */
import React from "react";

export function JjForgetConfirmDialog({
  workspaceName,
  unfolded,
  onConfirm,
  onCancel,
}: {
  workspaceName: string;
  unfolded: string[];
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      data-testid="jj-forget-confirm-dialog"
    >
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onCancel} />
      <div className="relative bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg p-4 max-w-md mx-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Workspace <code>{workspaceName}</code> has unfolded commits
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">
          Forgetting this workspace will lose the following commits. They will
          remain in jj's op log (recoverable via{" "}
          <code className="font-mono">jj op restore</code>) for the retention
          window, but no longer reachable from any workspace.
        </p>
        <ul
          className="text-[11px] font-mono max-h-40 overflow-y-auto pl-4 list-disc text-[var(--text-secondary)]"
          data-testid="jj-unfolded-list"
        >
          {unfolded.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            data-testid="jj-forget-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded bg-red-600 text-white hover:bg-red-500"
            data-testid="jj-forget-force"
          >
            Forget anyway
          </button>
        </div>
      </div>
    </div>
  );
}
