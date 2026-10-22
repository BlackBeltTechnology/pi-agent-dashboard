/**
 * Bulk-close summary confirmation (`bulk-close-confirm`): names every terminal
 * and unsaved handler tab a bulk close would end, with the reason. Three
 * buttons, Cancel first in DOM order and explicitly focused on open (the
 * `Dialog` puts its own ✕ first, which would otherwise take focus).
 *
 * See change: scope-anchor-editor-pane-controls (D6).
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useEffect, useRef } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";

export interface BulkCloseItem {
  key: string;
  name: string;
  reason: "terminal" | "unsaved";
}

export interface BulkCloseConfirmProps {
  items: readonly BulkCloseItem[];
  /** Tabs that stay open under "Close all but these N". */
  keptCount: number;
  onCancel: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}

export function BulkCloseConfirm({ items, keptCount, onCancel, onKeep, onDiscard }: BulkCloseConfirmProps) {
  const { t } = useI18n();
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Re-focus Cancel after `Dialog`'s own focus trap ran (it focuses the first
  // focusable, the ✕). Re-runs when the listed set changes (re-shown dialog).
  const itemsSig = items.map((i) => i.key).join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the signature re-focuses on a re-listed dialog
  useEffect(() => {
    const id = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [itemsSig]);
  const reasonText = (r: BulkCloseItem["reason"]) =>
    r === "terminal"
      ? t("editor.bulkClose.reasonTerminal", undefined, "terminal: closing ends its process")
      : t("editor.bulkClose.reasonUnsaved", undefined, "unsaved changes will be lost");
  const BTN =
    "inline-flex min-h-[36px] items-center justify-center rounded px-3 text-xs font-semibold transition-colors";
  return (
    <Dialog
      open
      onClose={onCancel}
      size="md"
      testId="bulk-close-confirm"
      title={t("editor.bulkClose.title", undefined, "Some tabs need your attention")}
    >
      <p className="text-sm text-[var(--text-secondary)]">
        {t("editor.bulkClose.body", undefined, "Closing these tabs ends a terminal or discards unsaved changes:")}
      </p>
      <ul className="space-y-1 text-sm" data-testid="bulk-close-list">
        {items.map((it) => (
          <li key={it.key} className="flex items-baseline gap-2">
            <span className="truncate font-medium text-[var(--text-primary)]">{it.name}</span>
            <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{reasonText(it.reason)}</span>
          </li>
        ))}
      </ul>
      <Dialog.Footer>
        <button
          ref={cancelRef}
          type="button"
          data-testid="bulk-close-cancel"
          onClick={onCancel}
          className={`${BTN} border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]`}
        >
          {t("editor.bulkClose.cancel", undefined, "Cancel")}
        </button>
        <button
          type="button"
          data-testid="bulk-close-keep"
          onClick={onKeep}
          className={`${BTN} border border-[var(--border-primary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`}
        >
          {t("editor.bulkClose.keep", { count: keptCount }, "Close all but these {count}")}
        </button>
        <button
          type="button"
          data-testid="bulk-close-discard"
          onClick={onDiscard}
          className={`${BTN} border border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)] hover:opacity-90`}
        >
          {t("editor.bulkClose.discard", undefined, "Close all & discard")}
        </button>
      </Dialog.Footer>
    </Dialog>
  );
}
