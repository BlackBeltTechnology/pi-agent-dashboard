import React, { type ReactNode } from "react";
import { Dialog, type DialogIntent } from "./Dialog.js";

interface ConfirmProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  /** Optional rich content rendered between the message and the footer. */
  body?: ReactNode;
  intent?: DialogIntent;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  testId?: string;
}

/**
 * Thin preset over `Dialog` for the common title-message-confirm-cancel
 * shape. Delegates all chrome (portal, overlay, focus, ARIA, dismissal) to
 * `Dialog`. `onConfirm` does NOT auto-close — the caller controls dismissal.
 *
 * See change: unify-dialog-system (design.md D7).
 */
export function Confirm({
  open,
  onClose,
  title,
  message,
  body,
  intent = "primary",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  testId,
}: ConfirmProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm" testId={testId}>
      <p className="text-sm text-[var(--text-secondary)]">{message}</p>
      {body}
      <Dialog.Footer>
        <Dialog.Cancel
          onClick={onClose}
          testId={testId ? `${testId}-cancel` : undefined}
        >
          {cancelLabel}
        </Dialog.Cancel>
        <Dialog.Action
          onClick={onConfirm}
          intent={intent}
          testId={testId ? `${testId}-action` : undefined}
        >
          {confirmLabel}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
