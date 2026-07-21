import type { DashboardSession, ImageContent, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArchiveOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiClose,
  mdiCompassOutline,
  mdiDotsVertical,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFastForward,
  mdiLinkVariant,
  mdiPencilOutline,
  mdiPlay,
  mdiPlayCircleOutline,
  mdiRefresh,
  mdiSourceBranch,
  mdiSourceFork,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { ExploreDialog } from "../openspec/ExploreDialog.js";
import { NewChangeDialog } from "../openspec/NewChangeDialog.js";

interface Props {
  session: DashboardSession;
  openspecChanges?: OpenSpecChange[];
  onRename?: () => void;
  onHide?: () => void;
  onUnhide?: () => void;
  onResume?: (mode: "continue" | "fork") => void;
  onShutdown?: () => void;
  onAttachProposal?: (changeName: string) => void;
  onDetachProposal?: () => void;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onRefresh?: () => void;
}

function MenuRow({ icon, label, onClick, danger, disabled }: {
  icon: string;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left min-h-[44px] ${
        disabled
          ? "text-[var(--text-muted)] opacity-40 cursor-not-allowed"
          : danger
            ? "text-red-400 hover:bg-red-500/10"
            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      }`}
    >
      <Icon path={icon} size={0.7} />
      <span>{label}</span>
    </button>
  );
}

export function MobileActionMenu({ session, openspecChanges, onRename, onHide, onUnhide, onResume, onShutdown, onAttachProposal, onDetachProposal, onSendPrompt, onReadArtifact, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [newChangeOpen, setNewChangeOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isAlive = session.status !== "ended";
  const isHidden = !!session.hidden;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Also close on touch outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("touchstart", handler);
    return () => document.removeEventListener("touchstart", handler);
  }, [open]);

  function act(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <>
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        aria-label={i18nT("session.sessionActions", undefined, "Session actions")}
        data-testid="mobile-kebab-btn"
      >
        <Icon path={mdiDotsVertical} size={0.8} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-lg z-50 overflow-hidden" data-testid="mobile-action-menu">
          {/* Git info row (non-interactive) */}
          {session.gitBranch && (
            <div className="px-4 py-2 text-xs text-[var(--text-tertiary)] flex items-center gap-2 border-b border-[var(--border-primary)]">
              <Icon path={mdiSourceBranch} size={0.55} />
              <span className="truncate">{session.gitBranch}</span>
              {session.gitPrNumber != null && (
                <>
                  <span>·</span>
                  {session.gitPrUrl ? (
                    <a href={session.gitPrUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-0.5">
                      #{session.gitPrNumber} <Icon path={mdiLinkVariant} size={0.4} />
                    </a>
                  ) : (
                    <span>#{session.gitPrNumber}</span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Rename */}
          {isAlive && onRename && (
            <MenuRow icon={mdiPencilOutline} label={i18nT("common.rename", undefined, "Rename")} onClick={() => act(onRename)} />
          )}

          {/* Hide / Unhide */}
          {isHidden ? (
            onUnhide && <MenuRow icon={mdiEyeOutline} label={i18nT("session.showSession", undefined, "Show session")} onClick={() => act(onUnhide)} />
          ) : (
            onHide && <MenuRow icon={mdiEyeOffOutline} label={i18nT("session.hideSession", undefined, "Hide session")} onClick={() => act(onHide)} />
          )}

          {/* Resume / Fork */}
          {onResume && session.sessionFile && (
            <>
              {(!isAlive || isHidden) && (
                <MenuRow icon={mdiPlay} label={i18nT("session.resume", undefined, "Resume")} onClick={() => act(() => onResume("continue"))} />
              )}
              <MenuRow icon={mdiSourceFork} label={i18nT("session.fork", undefined, "Fork")} onClick={() => act(() => onResume("fork"))} />
            </>
          )}

          {/* OpenSpec commands (unattached: Explore + New Change) */}
          {!session.attachedProposal && isAlive && onSendPrompt && (
            <>
              <div className="px-4 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider border-t border-[var(--border-primary)]">
                {i18nT("openspec.openspec", undefined, "OpenSpec")}
              </div>
              <MenuRow icon={mdiCompassOutline} label={i18nT("common.explore", undefined, "Explore")} onClick={() => act(() => setExploreOpen(true))} />
              <MenuRow icon={mdiChevronRight} label={i18nT("openspec.newChange2", undefined, "+ New Change")} onClick={() => act(() => setNewChangeOpen(true))} />
            </>
          )}

          {/* OpenSpec commands (when a change is attached) */}
          {session.attachedProposal && openspecChanges && (() => {
            const attached = session.attachedProposal;
            const change = openspecChanges.find((c) => c.name === attached);
            if (!change) return null;
            const state = deriveChangeState(change);
            return (
              <>
                <div className="px-4 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider border-t border-[var(--border-primary)]">
                  {i18nT("openspec.openspec3", undefined, "OpenSpec:")} {attached}
                </div>
                {(() => {
                  const actionsDisabled = session.status === "streaming";
                  return (
                    <>
                      {onSendPrompt && (
                        <MenuRow icon={mdiCompassOutline} label={i18nT("common.explore", undefined, "Explore")} onClick={() => act(() => onSendPrompt(`/skill:openspec-explore ${attached}`))} disabled={actionsDisabled} />
                      )}
                      {state === ChangeState.PLANNING && onSendPrompt && (
                        <>
                          <MenuRow icon={mdiChevronRight} label={i18nT("common.continue", undefined, "Continue")} onClick={() => act(() => onSendPrompt(`/skill:openspec-continue-change ${attached}`))} disabled={actionsDisabled} />
                          <MenuRow icon={mdiFastForward} label={i18nT("git.fastForward", undefined, "Fast-Forward")} onClick={() => act(() => onSendPrompt(`/skill:openspec-ff-change ${attached}`))} disabled={actionsDisabled} />
                        </>
                      )}
                      {(state === ChangeState.READY || state === ChangeState.IMPLEMENTING) && onSendPrompt && (
                        <MenuRow icon={mdiPlayCircleOutline} label={i18nT("common.apply", undefined, "Apply")} onClick={() => act(() => onSendPrompt(`/skill:openspec-apply-change ${attached}`))} disabled={actionsDisabled} />
                      )}
                      {state === ChangeState.COMPLETE && onSendPrompt && (
                        <>
                          <MenuRow icon={mdiCheckCircleOutline} label={i18nT("common.verify", undefined, "Verify")} onClick={() => act(() => onSendPrompt(`/skill:openspec-verify-change ${attached}`))} disabled={actionsDisabled} />
                          <MenuRow icon={mdiArchiveOutline} label={i18nT("openspec.archive", undefined, "Archive")} onClick={() => act(() => onSendPrompt(`/skill:openspec-archive-change ${attached}`))} disabled={actionsDisabled} />
                        </>
                      )}
                    </>
                  );
                })()}
              </>
            );
          })()}

          {/* OpenSpec detach */}
          {session.attachedProposal && onDetachProposal && (
            <MenuRow icon={mdiLinkVariant} label={`Detach: ${session.attachedProposal}`} onClick={() => act(onDetachProposal)} />
          )}

          {/* Refresh Chat */}
          {onRefresh && (
            <MenuRow icon={mdiRefresh} label={i18nT("session.refreshChat2", undefined, "Refresh Chat")} onClick={() => act(onRefresh)} />
          )}

          {/* Exit */}
          {isAlive && onShutdown && (
            <MenuRow icon={mdiClose} label={i18nT("session.exitSession", undefined, "Exit session")} onClick={() => {
              if (session.status === "streaming") {
                if (!window.confirm("Session is currently running. Exit anyway?")) return;
              }
              act(onShutdown);
            }} danger />
          )}
        </div>
      )}
    </div>

      {/* Dialogs rendered outside the menu via portal */}
      {exploreOpen && (
        <DialogPortal><ExploreDialog
          changeName=""
          onSend={(text, images) => {
            onSendPrompt?.(`/skill:openspec-explore\n${text}`, images);
            setExploreOpen(false);
          }}
          onClose={() => setExploreOpen(false)}
        /></DialogPortal>
      )}
      {newChangeOpen && (
        <DialogPortal><NewChangeDialog
          onSend={(prompt) => {
            onSendPrompt?.(prompt);
            setNewChangeOpen(false);
          }}
          onClose={() => setNewChangeOpen(false)}
        /></DialogPortal>
      )}
    </>
  );
}
