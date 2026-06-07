import React, { useRef, useEffect, useCallback } from "react";
import { Icon } from "@mdi/react";
import { mdiConsoleLine } from "@mdi/js";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { TerminalView } from "./TerminalView.js";

/**
 * Inline interactive terminal card rendered in the chat stream.
 *
 * Live  → bounded fixed-height `TerminalView` reattached to the ephemeral PTY
 *         via `terminalId` (xterm internal scrollback for scrolling inside the
 *         card; the chat page scrolls past it).
 * Frozen → read-only xterm replaying the captured transcript (preserves ANSI;
 *         scrollable; no PTY socket, input disabled).
 *
 * Independent from the LLM — output never enters agent context.
 * See change: add-inline-terminal-card.
 */

const CARD_HEIGHT_PX = 320; // ~16 rows + header at fontSize 13

function getTerminalTheme(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: get("--bg-primary") || "#0a0a0a",
    foreground: get("--text-primary") || "#e5e5e5",
  };
}

function FrozenTranscript({ transcript }: { transcript: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const terminal = new Terminal({
      scrollback: 10000,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, monospace",
      theme: getTerminalTheme(),
      cursorBlink: false,
      disableStdin: true,
      allowProposedApi: true,
    });
    terminal.open(containerRef.current);
    terminal.write(transcript);
    return () => terminal.dispose();
  }, [transcript]);

  return (
    <div
      ref={containerRef}
      className="min-h-0 overflow-hidden"
      style={{ height: CARD_HEIGHT_PX - 30, padding: "4px" }}
    />
  );
}

interface Props {
  terminalId: string;
  closed: boolean;
  transcript: string;
  onClose: (terminalId: string) => void;
}

export function InlineTerminalCard({ terminalId, closed, transcript, onClose }: Props) {
  const handleClose = useCallback(() => onClose(terminalId), [onClose, terminalId]);

  return (
    <div className="my-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-hidden">
      {closed ? (
        <>
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)] text-sm text-[var(--text-secondary)]">
            <Icon path={mdiConsoleLine} size={0.6} className="text-[var(--text-tertiary)]" />
            <span className="truncate">Terminal closed</span>
            <span className="ml-auto text-xs text-[var(--text-tertiary)]">read-only transcript</span>
          </div>
          <FrozenTranscript transcript={transcript} />
        </>
      ) : (
        <TerminalView
          terminalId={terminalId}
          visible={true}
          heightPx={CARD_HEIGHT_PX}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
