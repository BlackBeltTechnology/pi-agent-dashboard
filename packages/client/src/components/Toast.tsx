import React, { useEffect, useState } from "react";

export type ToastVariant = "error" | "success" | "info";

export interface ToastMessage {
  id: number;
  text: string;
  /** Defaults to "error" (legacy red styling) when omitted. */
  variant?: ToastVariant;
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(message.id), 300);
    }, 3000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(() => onDismiss(message.id), 300);
  };

  const styles = VARIANT_CLASSES[message.variant ?? "error"];

  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 px-3 py-2 ${styles.box} text-sm rounded-lg shadow-lg border transition-opacity duration-300 max-w-sm ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className="flex-1 whitespace-pre-line">{message.text}</span>
      <button
        onClick={handleDismiss}
        className={`${styles.close} flex-shrink-0 leading-none`}
        title="Dismiss"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/** Hook to manage toast messages. */
export function useToast() {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const showToast = (text: string, variant: ToastVariant = "error") => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, text, variant }]);
  };

  const dismissToast = (id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  return { messages, showToast, dismissToast };
}
