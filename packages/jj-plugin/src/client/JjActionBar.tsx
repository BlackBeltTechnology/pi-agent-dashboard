/**
 * Action bar rendered on session cards inside a jj repo (or, for the
 * opt-in init affordance, inside a plain git repo).
 *
 * Three real buttons live here:
 *   - "+ Workspace" (any jj session) → opens name dialog → POST /api/jj/workspace/add
 *   - "Fold back"   (workspace cards) → opens JjFoldBackDialog
 *   - "Forget"      (workspace cards) → POST /api/jj/workspace/forget;
 *                                       on 409 UNFOLDED_WORK shows a
 *                                       confirm dialog listing commits
 *                                       and re-issues with force:true.
 *
 * The "Enable jj workspaces" plain-git affordance is rendered via
 * `JjInitAffordance` (separate component, only mounted when the
 * `showInitColocatedSuggestion` plugin config flag is true).
 *
 * See change: add-jj-workspace-plugin.
 */
import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiPlus, mdiMerge, mdiCloseCircleOutline } from "@mdi/js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { addWorkspace, forgetWorkspace } from "./api.js";
import { JjForgetConfirmDialog } from "./JjForgetConfirmDialog.js";
import { JjFoldBackDialog } from "./JjFoldBackDialog.js";

const NAME_RE = /^[a-z0-9-]+$/;

export function JjActionBar({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<string[] | null>(null);
  const [foldBackOpen, setFoldBackOpen] = useState(false);

  const jjState = session.jjState;
  if (!jjState?.isJjRepo) return null;

  const isInWorkspace = Boolean(jjState.workspaceName);
  const workspaceName = jjState.workspaceName;
  const isDefaultWorkspace = workspaceName === "default";

  const onAddWorkspace = async () => {
    const name = window.prompt(
      "New jj workspace name (lowercase, digits, dashes):",
      "agent-1",
    );
    if (!name) return;
    if (!NAME_RE.test(name)) {
      setError("Invalid name. Use only lowercase letters, digits, and dashes.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      // For non-default workspaces, fromCwd should be the repo root, not
      // the workspace cwd. We pass the session cwd verbatim — the server
      // resolves it. baseRev is auto-derived server-side from the source's
      // current bookmark.
      const result = await addWorkspace({
        fromCwd: session.cwd,
        name,
      });
      if (!result.ok) {
        setError(result.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const onForgetWorkspace = async (force: boolean) => {
    if (!workspaceName) return;
    setError(null);
    setBusy(true);
    try {
      const result = await forgetWorkspace({
        cwd: session.cwd,
        name: workspaceName,
        force,
      });
      if (result.ok) {
        setUnfolded(null);
        return;
      }
      if (result.status === 409 && result.code === "UNFOLDED_WORK") {
        const data = result.data as { unfolded?: string[] } | undefined;
        setUnfolded(data?.unfolded ?? []);
        return;
      }
      setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="jj-action-bar" className="flex items-center gap-1 text-[10px]">
      <button
        type="button"
        disabled={busy}
        onClick={onAddWorkspace}
        title="Create a new jj workspace and spawn a session in it"
        className="inline-flex items-center px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        data-testid="jj-add-workspace"
      >
        <Icon path={mdiPlus} size={0.45} className="inline mr-0.5" />
        Workspace
      </button>

      {isInWorkspace && !isDefaultWorkspace && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setFoldBackOpen(true)}
          title="Fold the workspace's commits back onto trunk"
          className="inline-flex items-center px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          data-testid="jj-fold-back"
        >
          <Icon path={mdiMerge} size={0.45} className="inline mr-0.5" />
          Fold back
        </button>
      )}

      {isInWorkspace && !isDefaultWorkspace && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onForgetWorkspace(false)}
          title="Forget this workspace and remove its directory"
          className="inline-flex items-center px-1.5 py-[1px] rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-red-400 disabled:opacity-50"
          data-testid="jj-forget-workspace"
        >
          <Icon path={mdiCloseCircleOutline} size={0.45} className="inline mr-0.5" />
          Forget
        </button>
      )}

      {error && (
        <span
          className="text-[10px] text-red-400"
          data-testid="jj-action-bar-error"
        >
          {error}
        </span>
      )}

      {unfolded && workspaceName && (
        <JjForgetConfirmDialog
          workspaceName={workspaceName}
          unfolded={unfolded}
          onCancel={() => setUnfolded(null)}
          onConfirm={() => {
            setUnfolded(null);
            onForgetWorkspace(true);
          }}
        />
      )}

      {foldBackOpen && workspaceName && (
        <JjFoldBackDialog
          workspaceName={workspaceName}
          onClose={() => setFoldBackOpen(false)}
        />
      )}
    </div>
  );
}
