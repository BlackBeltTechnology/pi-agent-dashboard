/**
 * CreateGoalDialog — shared modal wrapper around `GoalForm`.
 *
 * Both goal create surfaces (`FolderGoalsSection · + Goal`,
 * `GoalsBoardClaim · + New Goal`) open this one dialog instead of rendering
 * the form inline, for parity with the automation plugin's
 * `CreateAutomationDialog`. The overlay + card classes are copied verbatim
 * from that dialog so the two plugins present an identical create surface.
 *
 * The dialog owns the `createGoal(cwd, payload)` POST (mirrors
 * `CreateAutomationDialog` calling `createAutomation` itself); the caller
 * supplies `onCreated` for post-create side-effects (refetch / navigate).
 * `GoalForm` is reused unchanged — same fields, same payload, same testids.
 *
 * See change: redesign-goal-create-dialog (tasks 1.1–1.3). Mockup screen A.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { GoalForm, type GoalFormPayload } from "./GoalForm.js";
import { createGoal } from "./goals-api.js";

export interface CreateGoalDialogProps {
  /** Folder cwd the goal is created for. */
  cwd: string;
  onClose: () => void;
  /** Fired after a successful create, before the dialog closes. */
  onCreated?: () => void;
}

export function CreateGoalDialog({ cwd, onClose, onCreated }: CreateGoalDialogProps): React.ReactElement {
  const t = useT();
  const folderLeaf = cwd.split("/").pop() || cwd;

  const submit = async (payload: GoalFormPayload): Promise<void> => {
    await createGoal(cwd, payload);
    onCreated?.();
    onClose();
  };

  return (
    <div
      data-testid="goal-create-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-lg bg-[var(--bg-primary)] p-4 space-y-4 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold flex-1 truncate" data-testid="goal-create-dialog-title">
            {t("newGoalTitle", { folder: folderLeaf }, `New goal · ${folderLeaf}`)}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            title={t("close", undefined, "Close")}
            aria-label={t("closeDialog", undefined, "Close dialog")}
            data-testid="goal-create-dialog-close"
          >
            ✕
          </button>
        </div>
        <GoalForm onSubmit={submit} onCancel={onClose} />
      </div>
    </div>
  );
}
