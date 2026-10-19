/**
 * Core-owned dialogs of the file-handler layer: first-overwrite notice, conflict
 * (Reload / Save as copy / Overwrite anyway / Cancel), the leave-guard confirm
 * and the cap-blocked "save or discard one" list. Renders the head of the
 * store's dialog queue; the layer mounts one instance.
 *
 * See change: add-editor-pane-file-handlers (D3, D5).
 */
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useI18n } from "../../../lib/i18n/i18n.js";
import type { DialogSpec, FileHandlerStore, GuardReason } from "./file-handler-store.js";

type Entry = { id: number; spec: DialogSpec };

const CONFIRM_KEYS: Record<GuardReason, { title: string; fallback: string }> = {
  "mode-switch": { title: "fileHandler.confirm.modeSwitch", fallback: "Switch view and discard unsaved edits?" },
  "close-tab": { title: "fileHandler.confirm.closeTab", fallback: "Close this tab and discard unsaved edits?" },
  refresh: { title: "fileHandler.confirm.refresh", fallback: "Reload from disk and discard unsaved edits?" },
  reload: { title: "fileHandler.confirm.reload", fallback: "Reload from disk and discard unsaved edits?" },
  disable: { title: "fileHandler.confirm.discard", fallback: "Discard the unsaved edits?" },
};

export function FileHandlerDialogs({ entry, store }: { entry: Entry | undefined; store: FileHandlerStore }) {
  const { t } = useI18n();
  if (!entry) return null;
  const { id, spec } = entry;
  const answer = (v: unknown) => store.answer(id, v);
  const cancel = () => store.cancelDialog(id);

  if (spec.kind === "first-overwrite") {
    return (
      <Dialog open onClose={cancel} title={t("fileHandler.firstOverwrite.title", { label: spec.label }, "Overwrite the file?")} size="sm" testId="file-handler-first-overwrite">
        <p className="text-sm text-[var(--text-secondary)]">{spec.notice}</p>
        <Dialog.Footer>
          <Dialog.Cancel onClick={cancel} testId="file-handler-first-overwrite-cancel">
            {t("common.cancel", undefined, "Cancel")}
          </Dialog.Cancel>
          <Dialog.Action intent="neutral" onClick={() => answer("copy")} testId="file-handler-first-overwrite-copy">
            {t("fileHandler.saveAsCopy", undefined, "Save as copy")}
          </Dialog.Action>
          <Dialog.Action intent="danger" onClick={() => answer("overwrite")} testId="file-handler-first-overwrite-overwrite">
            {t("fileHandler.overwrite", undefined, "Overwrite")}
          </Dialog.Action>
        </Dialog.Footer>
      </Dialog>
    );
  }

  if (spec.kind === "conflict") {
    return (
      <Dialog open onClose={cancel} title={t("fileHandler.conflict.title", undefined, "File changed on disk")} size="sm" testId="file-handler-conflict">
        <p className="text-sm text-[var(--text-secondary)]">
          {spec.gone
            ? t("fileHandler.conflict.gone", undefined, "The file no longer exists on disk. Your edits are still open here.")
            : t("fileHandler.conflict.changed", undefined, "The file was changed on disk after you opened it. Your edits are still open here.")}
        </p>
        {!spec.gone && (
          <p className="text-xs text-[var(--text-muted)]" data-testid="file-handler-conflict-warning">
            {t("fileHandler.conflict.overwriteWarning", undefined, "Overwrite anyway replaces the version currently on disk; the agent's or another change will be lost.")}
          </p>
        )}
        <Dialog.Footer>
          <Dialog.Cancel onClick={cancel} testId="file-handler-conflict-cancel">
            {t("common.cancel", undefined, "Cancel")}
          </Dialog.Cancel>
          {!spec.gone && (
            <Dialog.Action intent="neutral" onClick={() => answer("reload")} testId="file-handler-conflict-reload">
              {t("fileHandler.reloadFromDisk", undefined, "Reload from disk")}
            </Dialog.Action>
          )}
          <Dialog.Action intent="neutral" onClick={() => answer("copy")} testId="file-handler-conflict-copy">
            {t("fileHandler.saveAsCopy", undefined, "Save as copy")}
          </Dialog.Action>
          {!spec.gone && (
            <Dialog.Action intent="danger" onClick={() => answer("overwrite")} testId="file-handler-conflict-overwrite">
              {t("fileHandler.overwriteAnyway", undefined, "Overwrite anyway")}
            </Dialog.Action>
          )}
        </Dialog.Footer>
      </Dialog>
    );
  }

  if (spec.kind === "confirm") {
    const k = CONFIRM_KEYS[spec.reason];
    return (
      <Confirm
        open
        onClose={cancel}
        title={t(k.title, undefined, k.fallback)}
        message={
          spec.unknown
            ? t("fileHandler.confirm.unknown", { label: spec.label }, "{label} has not reported whether it holds unsaved edits, so they may be lost.")
            : t("fileHandler.confirm.dirty", { label: spec.label }, "{label} holds unsaved edits that will be lost.")
        }
        intent="danger"
        confirmLabel={t("fileHandler.confirm.action", undefined, "Discard edits")}
        cancelLabel={t("common.cancel", undefined, "Cancel")}
        onConfirm={() => answer(true)}
        testId="file-handler-confirm"
      />
    );
  }

  return (
    <Dialog open onClose={cancel} title={t("fileHandler.blocked.title", undefined, "Too many open editors")} size="sm" testId="file-handler-blocked">
      <p className="text-sm text-[var(--text-secondary)]">
        {t("fileHandler.blocked.body", undefined, "Every open editor holds unsaved edits. Save one in its tab, or discard one here, to open another.")}
      </p>
      <ul className="space-y-1">
        {spec.tabs.map((tab) => (
          <li key={tab.key} className="flex items-center gap-2 text-xs" data-testid="file-handler-blocked-item">
            <span className="flex-1 truncate">
              {tab.path} <span className="text-[var(--text-muted)]">({tab.label})</span>
            </span>
            <button
              type="button"
              className="rounded px-2 py-1 text-red-400 hover:bg-[var(--bg-hover)]"
              data-testid="file-handler-blocked-discard"
              onClick={() => answer({ discard: tab.key })}
            >
              {t("fileHandler.discard", undefined, "Discard")}
            </button>
          </li>
        ))}
      </ul>
      <Dialog.Footer>
        <Dialog.Cancel onClick={cancel} testId="file-handler-blocked-cancel">
          {t("common.cancel", undefined, "Cancel")}
        </Dialog.Cancel>
      </Dialog.Footer>
    </Dialog>
  );
}
