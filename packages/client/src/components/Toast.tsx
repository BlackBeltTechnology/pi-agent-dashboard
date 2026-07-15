import React, { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../lib/i18n";

export type ToastVariant = "error" | "success" | "info";

/** Optional action affordance rendered as a button inside a toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
  /** Defaults to "error" (legacy red styling) when omitted. */
  variant?: ToastVariant;
  /** Optional action button (e.g. Retry). Renders when present. */
  action?: ToastAction;
  /** When true, the toast does not auto-dismiss (stays until acted on /
   *  manually closed). Defaults false → the current ~3s auto-dismiss. */
  noAutoDismiss?: boolean;
}

let nextId = 0;

const VARIANT_CLASSES: Record<ToastVariant, { box: string; close: string }> = {
  error: {
    box: "bg-red-900/90 text-red-200 border-red-800",
    close: "text-red-300/70 hover:text-red-100",
  },
  success: {
    box: "bg-green-900/90 text-green-200 border-green-800",
    close: "text-green-300/70 hover:text-green-100",
  },
  info: {
    box: "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-primary)]",
    close: "text-[var(--text-muted)] hover:text-[var(--text-primary)]",
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

  const styles = VARIANT_CLASSES[message.variant ?? "error"];

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
    variant: ToastVariant = "error",
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
