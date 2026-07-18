import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import { mdiClose, mdiConsoleLine, mdiPencilOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { formatRelativeTime } from "../../lib/util/format.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { InlineRenameInput } from "../primitives/InlineRenameInput.js";

interface Props {
  terminal: TerminalSession;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  onRename?: (id: string, title: string) => void;
  now: number;
}

export function TerminalCard({ terminal, selectedId, onSelect, onClose, onRename, now }: Props) {
  const isSelected = selectedId === terminal.id;
  const [isRenaming, setIsRenaming] = useState(false);
  const displayName = terminal.title || terminal.shell.split("/").pop() || "terminal";

  function handleConfirmRename(name: string) {
    setIsRenaming(false);
    onRename?.(terminal.id, name);
  }

  return (
    <div
      onClick={() => onSelect(terminal.id)}
      data-testid="terminal-card"
      className={`cursor-pointer rounded-xl border-l-2 border-l-cyan-500 border border-[var(--border-subtle)] shadow-md shadow-[var(--shadow-card)] transition-all duration-200 ${
        isSelected
          ? "bg-[var(--bg-selected)] border-[var(--accent-blue)]/40"
          : "bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      <div className="px-3 py-2">
        {/* Row 1: icon + name + actions */}
        <div className="flex items-center gap-2">
          <Icon path={mdiConsoleLine} size={0.55} className="text-cyan-500 flex-shrink-0" />

          {isRenaming ? (
            <InlineRenameInput
              currentName={displayName}
              onConfirm={handleConfirmRename}
              onCancel={() => setIsRenaming(false)}
            />
          ) : (
            <span className="text-sm truncate flex-1 text-[var(--text-primary)]">
              {displayName}
            </span>
          )}

          <span className="text-[11px] text-[var(--text-muted)] flex-shrink-0">
            {formatRelativeTime(now - terminal.createdAt)}
          </span>

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover/sortable:opacity-100 transition-opacity">
            {onRename && (
              <button
                onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}
                className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                title={i18nT("terminal.renameTerminal", undefined, "Rename terminal")}
              >
                <Icon path={mdiPencilOutline} size={0.45} />
              </button>
            )}
            {onClose && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(terminal.id); }}
                className="p-0.5 text-[var(--text-tertiary)] hover:text-red-400"
                title={i18nT("terminal.closeTerminalSigterm", undefined, "Close terminal (SIGTERM)")}
              >
                <Icon path={mdiClose} size={0.45} />
              </button>
            )}
          </div>
        </div>

        {/* Row 2: cwd */}
        <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 ml-5 truncate">
          {terminal.cwd}
        </div>
      </div>
    </div>
  );
}
