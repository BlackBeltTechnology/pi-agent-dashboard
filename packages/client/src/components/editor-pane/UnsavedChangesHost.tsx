/**
 * Page-level host of the unsaved-changes dialog (`unsaved-dialog`): ONE dialog
 * listing every dirty tab in scope of a `confirmLeave`. Mounted once in `App`
 * beside `FileHandlerLayer` — outside every provider, so session-switch and
 * folder-pane leaves reach it. Cancel is first in DOM order, focused on open
 * (the `Dialog`'s own ✕ would otherwise take focus); Escape / backdrop = Cancel;
 * nothing is bound to Enter (no default Discard).
 *
 * See change: fix-file-link-editor-routing (D3, G2, G5).
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { type UnsavedStore, unsavedStore } from "./unsaved-store.js";

const BTN = "inline-flex min-h-[36px] items-center justify-center rounded px-3 text-xs font-semibold transition-colors disabled:opacity-40";

export function UnsavedChangesHost({ store = unsavedStore }: { store?: UnsavedStore }) {
  const { t } = useI18n();
  const { dialog } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogId = dialog?.id;
  // Re-focus Cancel after `Dialog`'s focus trap ran (it focuses the first focusable, the ✕).
  useEffect(() => {
    if (dialogId === undefined) return;
    const id = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [dialogId]);
  if (!dialog) return null;
  const cancel = () => store.resolveDialog("cancel");
  return (
    <Dialog open onClose={cancel} size="md" testId="unsaved-dialog" title={t("editor.unsaved.title", undefined, "Unsaved changes")}>
      <p className="text-sm text-[var(--text-secondary)]">
        {t("editor.unsaved.body", undefined, "Leaving now would lose the unsaved changes in:")}
      </p>
      <ul className="space-y-1 text-sm" data-testid="unsaved-list">
        {dialog.items.map((it) => (
          <li key={it.key} className="truncate font-medium text-[var(--text-primary)]">
            {it.label}
          </li>
        ))}
      </ul>
      <Dialog.Footer>
        <button
          ref={cancelRef}
          type="button"
          data-testid="unsaved-cancel"
          onClick={cancel}
          disabled={dialog.saving}
          className={`${BTN} border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]`}
        >
          {t("editor.unsaved.cancel", undefined, "Cancel")}
        </button>
        <button
          type="button"
          data-testid="unsaved-discard"
          onClick={() => store.resolveDialog("discard")}
          disabled={dialog.saving}
          className={`${BTN} border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)] hover:opacity-90`}
        >
          {t("editor.unsaved.discard", undefined, "Discard")}
        </button>
        <button
          type="button"
          data-testid="unsaved-save"
          onClick={() => store.resolveDialog("save")}
          disabled={dialog.saving}
          className={`${BTN} bg-[var(--accent-blue)] text-white hover:opacity-90`}
        >
          {dialog.saving ? t("editor.unsaved.saving", undefined, "Saving…") : t("editor.unsaved.save", undefined, "Save")}
        </button>
      </Dialog.Footer>
    </Dialog>
  );
}
