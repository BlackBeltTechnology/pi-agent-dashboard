/**
 * Confirm dialog for a destructive global tag delete. Names the tag, states
 * the carrying-session blast radius (global across folders/projects), and warns
 * the action is not undoable and that the tag reappears if a session re-adds it
 * (derived-union). On confirm, dispatches `remove_tag_globally`.
 * See change: sidebar-tag-collapse-and-delete.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useI18n } from "../../lib/i18n/i18n.js";

interface Props {
  tag: string;
  /** How many sessions currently carry the tag (client-derived count). */
  count: number;
  onConfirm: () => void;
  onClose: () => void;
}

export function TagDeleteConfirmDialog({ tag, count, onConfirm, onClose }: Props) {
  const { t } = useI18n();
  return (
    <Dialog
      open
      onClose={onClose}
      title={t("tags.removeFromAllSessions", undefined, "Remove tag from all sessions")}
      size="sm"
      testId="tag-delete-confirm"
    >
      <p className="text-sm text-[var(--text-secondary)]">
        Remove <span className="font-semibold text-[var(--text-primary)]">#{tag}</span> from{" "}
        <span className="font-semibold text-[var(--text-primary)]">
          {count} session{count === 1 ? "" : "s"}
        </span>{" "}
        across all folders?
      </p>
      <p className="text-xs text-[var(--text-muted)]">
        This is not undoable. The tag will reappear if any session re-adds it.
      </p>
      <Dialog.Footer>
        <Dialog.Cancel onClick={onClose} testId="tag-delete-cancel" />
        <Dialog.Action intent="danger" onClick={() => { onConfirm(); onClose(); }} testId="tag-delete-confirm-btn">
          Remove tag
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
