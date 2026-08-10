import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCog, mdiFlash, mdiHelpCircle, mdiMonitor, mdiTelevision, mdiWeb } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSessionDisplayName } from "../../lib/session/session-display-name.js";
import { InlineRenameInput } from "../primitives/InlineRenameInput.js";
import { PiLogo } from "../primitives/PiLogo.js";

interface Props {
  sessions: DashboardSession[];
  selectedId?: string;
  onSelect: (sessionId: string) => void;
  onRename?: (sessionId: string, name: string) => void;
  /** Set of session IDs that have an active error */
  errorSessionIds?: Set<string>;
}

const sourceIcons: Record<string, ReactNode> = {
  tui: <Icon path={mdiMonitor} size={0.55} />,
  zed: <Icon path={mdiFlash} size={0.55} />,
  tmux: <Icon path={mdiTelevision} size={0.55} />,
  dashboard: <Icon path={mdiWeb} size={0.55} />,
  unknown: <Icon path={mdiHelpCircle} size={0.55} />,
};

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  streaming: "bg-yellow-500 animate-pulse",
  idle: "bg-green-500",
  ended: "bg-[var(--bg-surface)]",
};

function formatTokens(n?: number): string {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n?: number): string {
  if (!n) return "$0.00";
  return `$${n.toFixed(4)}`;
}

export function SessionSidebar({ sessions, selectedId, onSelect, onRename, errorSessionIds }: Props) {
  const [, navigate] = useLocation();
  const active = sessions.filter((s) => s.status !== "ended");
  const ended = sessions.filter((s) => s.status === "ended");
  const [renamingId, setRenamingId] = useState<string | null>(null);

  function handleConfirmRename(sessionId: string, name: string) {
    setRenamingId(null);
    onRename?.(sessionId, name);
  }

  return (
    <div className="w-72 border-r border-[var(--border-primary)] overflow-y-auto flex flex-col">
      <div className="p-3 border-b border-[var(--border-primary)]">
        <button onClick={() => navigate("/")} className="flex items-center leading-none text-blue-500 hover:text-blue-400 transition-colors" title={i18nT("common.home2", undefined, "Home")}>
          <PiLogo size={24} />
        </button>
      </div>

      {/* Active sessions */}
      {active.length === 0 ? (
        <div className="p-4 text-sm text-[var(--text-tertiary)]">{i18nT("session.noActiveSessions", undefined, "No active sessions")}</div>
      ) : (
        <ul>
          {active.map((session) => (
            <li
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`px-3 py-2 cursor-pointer border-b border-[var(--border-primary)] hover:bg-[var(--bg-hover)] ${
                selectedId === session.id ? "bg-[var(--bg-tertiary)]" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${errorSessionIds?.has(session.id) ? "bg-red-500" : (statusColors[session.status] ?? "bg-[var(--bg-surface)]")}`}
                />
                {renamingId === session.id ? (
                  <InlineRenameInput
                    currentName={getSessionDisplayName(session)}
                    onConfirm={(name) => handleConfirmRename(session.id, name)}
                    onCancel={() => setRenamingId(null)}
                    className="flex-1"
                  />
                ) : (
                  <span
                    className="text-sm font-medium truncate flex-1"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (onRename) setRenamingId(session.id);
                    }}
                  >
                    {getSessionDisplayName(session)}
                  </span>
                )}
                <span className="text-xs inline-flex" title={session.source}>
                  {sourceIcons[session.source] ?? <Icon path={mdiHelpCircle} size={0.55} />}
                </span>
              </div>
              <div className="ml-4 mt-0.5 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                {session.model && <span className="truncate">{session.model}</span>}
              </div>
              <div className="ml-4 mt-0.5 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                <span title={i18nT("common.tokensIn", undefined, "Tokens in")}>↓{formatTokens(session.tokensIn)}</span>
                <span title={i18nT("common.tokensOut", undefined, "Tokens out")}>↑{formatTokens(session.tokensOut)}</span>
                <span>{formatCost(session.cost)}</span>
                {session.currentTool && (
                  <span className="text-yellow-500 inline-flex items-center gap-0.5"><Icon path={mdiCog} size={0.5} /> {session.currentTool}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Ended sessions */}
      {ended.length > 0 && (
        <details className="border-t border-[var(--border-primary)]">
          <summary className="px-3 py-2 text-xs text-[var(--text-tertiary)] cursor-pointer hover:bg-[var(--bg-hover)]">
            {i18nT("common.ended", undefined, "Ended (")}{ended.length})
          </summary>
          <ul>
            {ended.map((session) => (
              <li
                key={session.id}
                onClick={() => onSelect(session.id)}
                className={`px-3 py-2 cursor-pointer border-b border-[var(--border-primary)] hover:bg-[var(--bg-hover)] opacity-60 ${
                  selectedId === session.id ? "bg-[var(--bg-tertiary)]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--bg-surface)] flex-shrink-0" />
                  <span className="text-sm truncate">
                    {getSessionDisplayName(session)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
