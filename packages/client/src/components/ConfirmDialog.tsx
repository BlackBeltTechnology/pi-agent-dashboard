import React, { type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiCheck } from "@mdi/js";

interface Props {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional content rendered between the message and buttons */
  extra?: ReactNode;
}

export function ConfirmDialog({ message, confirmLabel = "Confirm", onConfirm, onCancel, extra }: Props) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" data-testid="confirm-dialog">
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onCancel} />
      <div className="relative bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg p-4 max-w-sm mx-4 space-y-3">
        <p className="text-sm text-[var(--text-secondary)]">{message}</p>
        {extra}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            data-testid="confirm-cancel"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="text-xs px-3 py-1.5 rounded bg-red-600 text-[var(--text-primary)] hover:bg-red-500"
            data-testid="confirm-ok"
          >
            <Icon path={mdiCheck} size={0.45} className="inline mr-0.5" />{confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
