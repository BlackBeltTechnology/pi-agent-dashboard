import React, { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../lib/i18n";

/** Canonical toast severity vocabulary. Single source of truth: other
 *  consumers (`useAsyncAction`, `useMessageHandler`) re-reference this type
 *  rather than redeclaring it. See change: unify-message-severity-colors. */
export type ToastVariant =
  | "error"
  | "warning"
  | "success"
  | "info"
  | "neutral";

/** Optional action affordance rendered as a button inside a toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  /** Defaults to "neutral" (subdued, no severity) when omitted. */
  variant?: ToastVariant;
  /** Optional action button (e.g. Retry). Renders when present. */
  action?: ToastAction;
  /** When true, the toast does not auto-dismiss (stays until acted on /
   *  manually closed). Defaults false → the current ~3s auto-dismiss. */
  noAutoDismiss?: boolean;
}

let nextId = 0;

// Every variant sources its box + close-button color from the shared
// --severity-* triple tokens (index.css). The close (×) reuses the variant's
// -fg at reduced opacity — one derivation, no separate -close token.
const VARIANT_CLASSES: Record<ToastVariant, { box: string; close: string }> = {
  error: {
    box: "bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)] border-[var(--severity-error-border)]",
    close: "text-[var(--severity-error-fg)]/70 hover:text-[var(--severity-error-fg)]",
  },
  warning: {
    box: "bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] border-[var(--severity-warning-border)]",
    close: "text-[var(--severity-warning-fg)]/70 hover:text-[var(--severity-warning-fg)]",
  },
  success: {
    box: "bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)] border-[var(--severity-success-border)]",
    close: "text-[var(--severity-success-fg)]/70 hover:text-[var(--severity-success-fg)]",
  },
  info: {
    box: "bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)] border-[var(--severity-info-border)]",
    close: "text-[var(--severity-info-fg)]/70 hover:text-[var(--severity-info-fg)]",
  },
  neutral: {
    box: "bg-[var(--severity-neutral-bg)] text-[var(--severity-neutral-fg)] border-[var(--severity-neutral-border)]",
    close: "text-[var(--severity-neutral-fg)]/70 hover:text-[var(--severity-neutral-fg)]",
  },
};

/** Simple auto-dismiss toast container. */
export function Toast({ messages, onDismiss }: {
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ message, onDismiss }: {
  message: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  const [visible, setVisible] = useState(true);

  const dismiss = useCallback(() => {
    setVisible(false);
    setTimeout(() => onDismiss(message.id), 300);
  }, [message.id, onDismiss]);

  useEffect(() => {
    if (message.noAutoDismiss) return;
    const timer = setTimeout(dismiss, 3000);
    return () => clearTimeout(timer);
  }, [message.noAutoDismiss, dismiss]);

  const styles = VARIANT_CLASSES[message.variant ?? "neutral"];

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 px-3 py-2 ${styles.box} text-sm rounded-lg shadow-lg border transition-opacity duration-300 max-w-sm ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="flex-1 whitespace-pre-line">{message.text}</span>
      {message.action && (
        <button
          type="button"
          onClick={() => {
            message.action?.onClick();
            dismiss();
          }}
          className="flex-shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
          data-testid="toast-action"
        >
          {message.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className={`${styles.close} flex-shrink-0 leading-none`}
        title={i18nT("common.dismiss", undefined, "Dismiss")}
        aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
      >
        ×
      </button>
    </div>
  );
}

/** Hook to manage toast messages. */
export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const showToast = (
    text: string,
    variant: ToastVariant = "neutral",
    opts?: { action?: ToastAction; noAutoDismiss?: boolean },
  ) => {
    const id = nextId++;
    setMessages((prev) => [
      ...prev,
      { id, text, variant, action: opts?.action, noAutoDismiss: opts?.noAutoDismiss },
    ]);
  };

  const dismissToast = (id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  return { messages, showToast, dismissToast };
}
