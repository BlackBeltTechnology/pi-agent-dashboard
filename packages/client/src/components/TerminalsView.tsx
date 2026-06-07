import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Icon } from "@mdi/react";
import { mdiPlus, mdiClose, mdiConsoleLine } from "@mdi/js";
import { TerminalView } from "./TerminalView.js";
import { InlineRenameInput } from "./InlineRenameInput.js";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";

interface Props {
  cwd: string;
  terminals: TerminalSession[];
  /** ID of the terminal to auto-select (e.g., newly created) */
  activeTerminalId?: string;
  onCreateTerminal: (cwd: string) => void;
  onKillTerminal: (terminalId: string) => void;
  onRenameTerminal: (terminalId: string, title: string) => void;
  onTerminalTitle?: (terminalId: string, title: string) => void;
}

export function TerminalsView({
  cwd,
  terminals: allTerminals,
  activeTerminalId,
  onCreateTerminal,
  onKillTerminal,
  onRenameTerminal,
  onTerminalTitle,
}: Props) {
  // Ephemeral terminals back inline interactive terminal cards in the chat
  // stream; they must not appear as content-area tabs.
  // See change: add-inline-terminal-card.
  const terminals = useMemo(() => allTerminals.filter((t) => !t.ephemeral), [allTerminals]);
  const [activeTabId, setActiveTabId] = useState<string | null>(activeTerminalId ?? null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Auto-select newly created terminals or first available
  useEffect(() => {
    if (activeTerminalId) {
      setActiveTabId(activeTerminalId);
    } else if (activeTabId && !terminals.find((t) => t.id === activeTabId)) {
      // Active tab was removed — select adjacent
      setActiveTabId(terminals.length > 0 ? terminals[terminals.length - 1].id : null);
    } else if (!activeTabId && terminals.length > 0) {
      setActiveTabId(terminals[0].id);
    }
  }, [terminals, activeTerminalId]);

  const handleClose = useCallback(
    (terminalId: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      onKillTerminal(terminalId);
      // Select adjacent tab
      if (activeTabId === terminalId) {
        const idx = terminals.findIndex((t) => t.id === terminalId);
        const next = terminals[idx + 1] ?? terminals[idx - 1];
        setActiveTabId(next?.id ?? null);
      }
    },
    [onKillTerminal, activeTabId, terminals],
  );

  const handleRename = useCallback(
    (terminalId: string, name: string) => {
      setRenamingId(null);
      onRenameTerminal(terminalId, name);
    },
    [onRenameTerminal],
  );

  // Empty state
  if (terminals.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-muted)] gap-4 p-8">
        <Icon path={mdiConsoleLine} size={2} className="opacity-30" />
        <p>No terminals. Click + New to create one.</p>
        <button
          onClick={() => onCreateTerminal(cwd)}
          className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-sm"
        >
          <span className="inline-flex items-center gap-1">
            <Icon path={mdiPlus} size={0.6} /> New Terminal
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 pt-3 pb-1">
        <div className="text-xs text-[var(--text-muted)] truncate">{cwd}</div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-4 py-1 border-b border-[var(--border-subtle)] overflow-x-auto flex-shrink-0">
        {terminals.map((t) => {
          const isActive = t.id === activeTabId;
          const displayName = t.title || t.shell?.split("/").pop() || "terminal";
          return (
            <div
              key={t.id}
              onClick={() => setActiveTabId(t.id)}
              onDoubleClick={() => setRenamingId(t.id)}
              className={`group flex items-center gap-1 px-3 py-1.5 rounded-t-md text-xs cursor-pointer transition-colors ${
                isActive
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)] border-b-2 border-cyan-500"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <Icon path={mdiConsoleLine} size={0.45} className="text-cyan-500 flex-shrink-0" />
              {renamingId === t.id ? (
                <InlineRenameInput
                  currentName={displayName}
                  onConfirm={(name) => handleRename(t.id, name)}
                  onCancel={() => setRenamingId(null)}
                />
              ) : (
                <span className="truncate max-w-[120px]">{displayName}</span>
              )}
              <button
                onClick={(e) => handleClose(t.id, e)}
                className="ml-1 p-0.5 text-[var(--text-tertiary)] hover:text-red-400 opacity-0 group-hover:opacity-100"
                title="Close terminal"
              >
                <Icon path={mdiClose} size={0.35} />
              </button>
            </div>
          );
        })}
        <button
          onClick={() => onCreateTerminal(cwd)}
          className="px-2 py-1.5 text-xs text-[var(--text-muted)] hover:text-cyan-400"
          title="New terminal"
        >
          <Icon path={mdiPlus} size={0.5} />
        </button>
      </div>

      {/* Terminal views — keep-alive: all mounted, CSS visibility toggle.
          Parent MUST be a flex column so each <TerminalView>'s `flex-1`
          claims residual height. With `relative` (block-level) the
          flex chain breaks and xterm renders at its default 24-row
          intrinsic height — the actual cause of the half-height
          rendering bug. See change: fix-terminal-half-height-dual-mount. */}
      <div className="flex-1 flex flex-col min-h-0">
        {terminals.map((t) => (
          <TerminalView
            key={t.id}
            terminalId={t.id}
            visible={t.id === activeTabId}
            terminalName={t.title || t.shell?.split("/").pop()}
            onTitle={onTerminalTitle}
            onClose={onKillTerminal}
          />
        ))}
      </div>
    </div>
  );
}
