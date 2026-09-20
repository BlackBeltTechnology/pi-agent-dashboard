import { mdiCheck } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/util/clipboard.js";

interface Props {
  getText: () => string;
  icon: ReactNode;
  title: string;
  /** Optional test id for the button. */
  testId?: string;
}

export function CopyButton({ getText, icon, title, testId }: Props) {
  const [copied, setCopied] = useState(false);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The revert is a real 1500 ms timer, so an unmount inside that window
  // leaves a callback that fires against a dead tree. Under vitest/jsdom the
  // environment is gone by then and the setState throws `ReferenceError:
  // window is not defined`, reddening whatever suite was draining at the
  // time. Cancel on unmount.
  useEffect(
    () => () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    // `copyText` falls back to a hidden textarea + execCommand when the
    // Clipboard API is unavailable or rejects (plain-http tunnels); only a
    // true result shows the ✓. A genuine failure stays silent (no toast).
    // See change: fix-long-session-ux-degradation (D2).
    if (await copyText(getText())) {
      setCopied(true);
      // Re-clicking inside the window restarts the single timer rather than
      // orphaning the previous one.
      if (revertTimer.current) clearTimeout(revertTimer.current);
      revertTimer.current = setTimeout(() => {
        revertTimer.current = null;
        setCopied(false);
      }, 1500);
    }
  }, [getText]);

  return (
    <button
      onClick={handleClick}
      title={title}
      data-testid={testId}
      className="px-1.5 py-0.5 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded hover:bg-[var(--bg-surface)] transition-colors inline-flex items-center justify-center"
    >
      {copied ? <Icon path={mdiCheck} size={0.6} /> : icon}
    </button>
  );
}
