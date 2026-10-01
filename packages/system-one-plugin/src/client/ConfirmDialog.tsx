/**
 * Modal confirmation: `role="dialog"`, `aria-modal`, labelled title, focus on
 * the safe action (Cancel), focus trap, Escape closes, focus returns to the
 * opener (ui-contract accessibility invariant 5).
 * See change: add-system-one-registry.
 */
import type React from "react";
import { useEffect, useRef } from "react";

export interface ConfirmDialogProps {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: ConfirmDialogProps): React.ReactElement {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => opener?.focus?.();
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  };
  return (
    <div className="fixed inset-0 z-dialog grid place-items-center bg-[var(--bg-overlay)] p-4" onKeyDown={onKey}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="s1-confirm-title"
        className="flex w-full max-w-[30rem] flex-col gap-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]"
      >
        <h2 id="s1-confirm-title" className="m-0 text-base font-semibold text-[var(--text-primary)]">
          {title}
        </h2>
        <div className="flex flex-col gap-2 text-[13px] text-[var(--text-secondary)]">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            ref={cancel}
            type="button"
            className="rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-1.5 text-sm text-[var(--text-primary)]"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--accent-primary-strong)] px-3 py-1.5 text-sm font-semibold text-white"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
