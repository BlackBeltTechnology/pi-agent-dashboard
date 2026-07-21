import React, { useState, useCallback, type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiCheck } from "@mdi/js";

interface Props {
  getText: () => string;
  icon: ReactNode;
  title: string;
}

export function CopyButton({ getText, icon, title }: Props) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — fail silently
    }
  }, [getText]);

  return (
    <button
      onClick={handleClick}
      title={title}
      className="px-1.5 py-0.5 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-surface)] transition-colors inline-flex items-center justify-center"
    >
      {copied ? <Icon path={mdiCheck} size={0.6} /> : icon}
    </button>
  );
}
