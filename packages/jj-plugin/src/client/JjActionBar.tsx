/**
 * Action bar rendered on session cards inside a jj repo (or, for the
 * opt-in init affordance, inside a plain git repo).
 *
 * Three real buttons live here:
 *   - "+ Workspace" (any jj session) → opens name dialog → POST /api/jj/workspace/add
 *   - "Fold back"   (workspace cards) → opens the fold-back dialog (ui:dialog shell)
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
import { useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { UiDialogComponent } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { addWorkspace, forgetWorkspace } from "./api.js";

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
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);

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
        <Dialog
          open
          onClose={() => setUnfolded(null)}
          title={`Workspace ${workspaceName} has unfolded commits`}
          size="md"
          testId="jj-forget-confirm-dialog"
        >
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
          <Dialog.Footer>
            <Dialog.Cancel onClick={() => setUnfolded(null)} testId="jj-forget-cancel" />
            <Dialog.Action
              intent="danger"
              onClick={() => {
                setUnfolded(null);
                onForgetWorkspace(true);
              }}
              testId="jj-forget-force"
            >
              Forget anyway
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog>
      )}

      {foldBackOpen && workspaceName && (
        <FoldBackDialog
          Dialog={Dialog}
          workspaceName={workspaceName}
          onClose={() => setFoldBackOpen(false)}
        />
      )}
    </div>
  );
}

type FoldMode = "preserve" | "squash" | "pr";

/**
 * Pre-flight dialog for the fold-back operation. Renders inside the unified
 * `ui:dialog` shell. Doesn't run jj itself — builds a skill prompt and copies
 * it to the clipboard. See change: unify-dialog-system (migrated from the
 * standalone fold-back dialog component).
 */
function FoldBackDialog({
  Dialog,
  workspaceName,
  onClose,
}: {
  Dialog: UiDialogComponent;
  workspaceName: string;
  onClose: () => void;
}): React.ReactElement {
  const [mode, setMode] = useState<FoldMode>("preserve");
  const [copied, setCopied] = useState(false);

  const prompt = buildFoldBackPrompt(workspaceName, mode);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Fold workspace ${workspaceName} onto trunk`}
      size="lg"
      testId="jj-fold-back-dialog"
    >
      <p className="text-xs text-[var(--text-secondary)]">
        This skill never invokes <code className="font-mono">git commit</code>
        {" "}or <code className="font-mono">git merge</code>. The new commit on
        trunk is produced by <code className="font-mono">jj git push --bookmark</code>,
        which translates jj history into git refs safely.
      </p>

      <fieldset className="space-y-1.5 text-xs text-[var(--text-secondary)]">
        <legend className="font-semibold mb-1 text-[var(--text-primary)]">Mode</legend>
        {[
          { value: "preserve", label: "Preserve commit history (recommended)" },
          { value: "squash", label: "Squash into a single commit" },
          { value: "pr", label: "Open a PR instead (requires gh CLI)" },
        ].map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="jj-fold-mode"
              value={opt.value}
              checked={mode === opt.value}
              onChange={() => setMode(opt.value as FoldMode)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="text-[10px] font-mono bg-[var(--bg-primary)] p-2 rounded border border-[var(--border-secondary)] max-h-32 overflow-y-auto whitespace-pre-wrap">
        {prompt}
      </div>

      <Dialog.Footer>
        <Dialog.Cancel onClick={onClose} testId="jj-fold-cancel" />
        <Dialog.Action onClick={onCopy} testId="jj-fold-copy">
          {copied ? "Copied!" : "Copy prompt"}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}

export function buildFoldBackPrompt(workspaceName: string, mode: FoldMode): string {
  const modeLine =
    mode === "preserve"
      ? "Use the default flavor (preserve commit history)."
      : mode === "squash"
      ? "Use `mode: squash` to collapse the workspace into one commit."
      : "Use `mode: pr` to push the bookmark and open a GitHub PR.";
  return [
    `Run the jj-workspace-fold-back skill for workspace \`${workspaceName}\`.`,
    modeLine,
    "Bookmark name: workspace name verbatim.",
    "Stop and report if any precondition fails (dirty index, conflicts, empty working copy, non-colocated repo).",
  ].join(" ");
}
