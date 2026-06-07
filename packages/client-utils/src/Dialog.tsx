import React, {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { Icon } from "@mdi/react";
import { DialogPortal } from "./DialogPortal.js";
import { useFocusTrap } from "./useFocusTrap.js";

export type DialogSize = "sm" | "md" | "lg";
export type DialogIntent = "primary" | "danger" | "neutral";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Optional leading icon (mdi path string) rendered in the header. */
  icon?: string;
  size?: DialogSize;
  testId?: string;
  /** Used for aria-label when no `title` is given. */
  ariaLabel?: string;
  children: ReactNode;
}

const SIZE_MAX_W: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function Dialog({
  open,
  onClose,
  title,
  icon,
  size = "md",
  testId,
  ariaLabel,
  children,
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap(containerRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const hasHeader = Boolean(title || icon);

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          className="absolute inset-0 bg-black/60"
          onClick={onClose}
          data-testid={testId ? `${testId}-overlay` : undefined}
        />
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={!title ? ariaLabel : undefined}
          tabIndex={-1}
          data-testid={testId}
          className={`relative w-full mx-4 ${SIZE_MAX_W[size]} max-h-[80vh] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl p-5 space-y-4 focus:outline-none`}
        >
          {hasHeader && (
            <div className="flex items-center gap-3">
              {icon && (
                <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-md bg-[var(--accent-primary)]/15 text-[var(--accent-primary)]">
                  <Icon path={icon} size={0.85} />
                </div>
              )}
              {title && (
                <h3
                  id={titleId}
                  className="text-base font-semibold text-[var(--text-primary)]"
                >
                  {title}
                </h3>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </DialogPortal>
  );
}

// ── Footer composition ───────────────────────────────────────────────────

function DialogFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end items-center gap-2 pt-1">{children}</div>
  );
}

interface DialogCancelProps {
  onClick: () => void;
  children?: ReactNode;
  testId?: string;
}

function DialogCancel({ onClick, children = "Cancel", testId }: DialogCancelProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="text-xs px-3 py-1.5 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
    >
      {children}
    </button>
  );
}

const INTENT_CLASS: Record<DialogIntent, string> = {
  primary:
    "bg-[var(--accent-primary)] text-white hover:opacity-90 border border-transparent",
  danger: "bg-red-600 text-white hover:bg-red-500 border border-transparent",
  neutral:
    "bg-transparent border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
};

interface DialogActionProps {
  onClick: () => void;
  intent?: DialogIntent;
  disabled?: boolean;
  children: ReactNode;
  testId?: string;
}

function DialogAction({
  onClick,
  intent = "primary",
  disabled,
  children,
  testId,
}: DialogActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className={`text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${INTENT_CLASS[intent]}`}
    >
      {children}
    </button>
  );
}

Dialog.Footer = DialogFooter;
Dialog.Cancel = DialogCancel;
Dialog.Action = DialogAction;
