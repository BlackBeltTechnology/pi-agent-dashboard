import React, {
  useId,
  useRef,
  type ReactNode,
} from "react";
import { mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { DialogPortal } from "./DialogPortal.js";
import { useEscapeDismiss } from "./escape-stack.js";
import { useFocusTrap } from "./useFocusTrap.js";

export type DialogSize = "sm" | "md" | "lg" | "full";
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
  /** Edge-to-edge body: drop the inner padding, clip overflow, and establish a
   *  flex COLUMN context so a self-framed child (e.g. a chat/detail view with
   *  its own header) fills the dialog as a single window and manages its own
   *  scroll. The panel carries only a `max-h` cap and no definite height, so a
   *  flush child must size itself `flex-1 min-h-0` — an `h-full` child resolves
   *  against an indefinite parent, grows to content, and its own
   *  `overflow-y-auto` never becomes a scroller. The built-in ✕ is suppressed
   *  in this mode (see `showClose`). See change:
   *  improve-flow-graph-dialog-and-card-interaction,
   *  fix-flush-dialog-scroll-and-close-collision. */
  flush?: boolean;
  /** Restore the built-in ✕ under `flush`. For a flush child that renders no
   *  header (and therefore no dismissal affordance) of its own — notably a
   *  third-party plugin dialog. A flush child with NO focusable element of its
   *  own MUST set this, or the focus trap falls back to the container and
   *  keyboard users get no target and no visible exit. Ignored when `flush` is
   *  false (the ✕ always renders there). See change:
   *  fix-flush-dialog-scroll-and-close-collision. */
  showClose?: boolean;
  children: ReactNode;
}

const SIZE_MAX_W: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  full: "max-w-[95vw]",
};

// `full` gets a taller cap (near-fullscreen wide stage, e.g. horizontal flow
// graphs); sm/md/lg keep the 80vh column cap. See change:
// improve-flow-graph-dialog-and-card-interaction.
const SIZE_MAX_H: Record<DialogSize, string> = {
  sm: "max-h-[80vh]",
  md: "max-h-[80vh]",
  lg: "max-h-[80vh]",
  full: "max-h-[92vh]",
};

export function Dialog({
  open,
  onClose,
  title,
  icon,
  size = "md",
  testId,
  ariaLabel,
  flush = false,
  showClose = false,
  children,
}: DialogProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useFocusTrap(containerRef, open);

  // Escape dismissal routes through the shared escape-stack: onClose fires only
  // when this dialog is the topmost registered layer, so an overlay opened above
  // it consumes the Escape first. See change: fix-stacked-escape-closes-layers.
  useEscapeDismiss(open, onClose);

  if (!open) return null;

  const hasHeader = Boolean(title || icon);
  // A flush child is self-framed: it renders its own header and its own back
  // affordance, and the panel reserves no corner for the ✕ (there is no header
  // branch to apply `pr-8`). Rendering it anyway paints a duplicate dismissal
  // control on top of whatever the child put there.
  const renderClose = !flush || showClose;

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-dialog flex items-center justify-center">
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
          className={`relative w-full mx-4 ${SIZE_MAX_W[size]} ${SIZE_MAX_H[size]} ${flush ? "overflow-hidden flex flex-col min-h-0" : "overflow-y-auto p-5 space-y-4"} bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg shadow-xl focus:outline-none`}
        >
          {/* Standard close affordance on every non-flush dialog (Escape +
              backdrop also close). Absolutely positioned; the headered branch
              reserves its corner with `pr-8`. Suppressed under `flush` unless
              `showClose` opts it back in. */}
          {renderClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-testid={testId ? `${testId}-close` : undefined}
              className="absolute top-3 right-3 z-10 flex items-center justify-center w-7 h-7 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
            >
              <Icon path={mdiClose} size={0.8} />
            </button>
          )}
          {hasHeader && (
            <div className="flex items-center gap-3 pr-8">
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
