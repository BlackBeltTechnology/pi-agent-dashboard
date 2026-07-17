import type { CommandInfo, DashboardSession, ImageContent, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft, mdiCrosshairsGps, mdiFileCompare, mdiLinkOff, mdiPaperclip, mdiPencilOutline, mdiPlay, mdiPlayCircleOutline, mdiRefresh, mdiSourceFork, mdiViewGridOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { useMobile } from "../hooks/useMobile.js";
import type { SessionState } from "../lib/event-reducer.js";
import { t as i18nT } from "../lib/i18n";
import { getSessionDisplayName } from "../lib/session-display-name.js";
import { CountBadges } from "./CountBadges.js";
import { FooterSegmentSlot } from "./extension-ui/FooterSegmentSlot.js";
import { InlineRenameInput } from "./InlineRenameInput.js";
import { LayoutModeSwitch } from "./LayoutModeSwitch.js";
import { MobileActionMenu } from "./MobileActionMenu.js";
import { ArtifactLettersButton } from "./openspec-helpers.js";
// FlowLaunchDialog removed: flow launching is owned entirely by
// flows-plugin's command-route claims (/flows, /flows:new, etc.) and
// SessionFlowActionsClaim. See change: pluginize-flows-via-registry.
import { SearchableSelectDialog, type SelectOption } from "./SearchableSelectDialog.js";
import { useOptionalSessionDiff } from "./SessionDiffContext.js";
import { useOptionalSplitWorkspace } from "./SplitWorkspaceContext.js";
import { TagChip } from "./tags/TagChip.js";
import { TagEditor } from "./tags/TagEditor.js";

interface Props {
  session?: DashboardSession;
  state: SessionState;
  onRename?: (sessionId: string, name: string) => void;
  showBack?: boolean;
  onBack?: () => void;
  commands?: CommandInfo[];

  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  openspecChanges?: OpenSpecChange[];
  onAttachProposal?: (changeName: string) => void;
  onDetachProposal?: () => void;
  hasFileChanges?: boolean;
  onOpenDiffView?: () => void;
  onRefresh?: () => void;
  /** Open the artifact reader for an attached change. Wired into the
   *  ArtifactLettersButton rendered in both desktop and mobile headers.
   *  See change: add-attached-proposal-header-summary. */
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  /** Extension UI System (Phase 1): callback to open the modules picker. */
  onOpenExtensionModulePicker?: () => void;
  /** Resume / Fork the displayed session. Renders a green Resume + blue Fork
   *  pill pair in the desktop toolbar when session.status === "ended" AND
   *  session.sessionFile is set. Mobile path uses mobileActions.onResume.
   *  See change: resume-button-in-session-header. */
  onResume?: (mode: "continue" | "fork") => void;
  /** Union of all tags in use across sessions, for TagEditor autocomplete.
   *  See change: add-session-tags. */
  allTags?: string[];
  /** Replace the session's full user-tag list. When set, the desktop header
   *  renders the editable tag strip. See change: add-session-tags. */
  onSetTags?: (tags: string[]) => void;
  /** Seek to this session's card in the sidebar (expand fold-ancestors +
   *  scroll + flash). Desktop-only button; hidden on mobile. When omitted
   *  the button does not render. See change: add-seek-to-session-card. */
  onSeekToCard?: () => void;
  /** Mobile action menu props (only used on mobile) */
  mobileActions?: {
    openspecChanges?: OpenSpecChange[];
    onHide?: () => void;
    onUnhide?: () => void;
    onResume?: (mode: "continue" | "fork") => void;
    onShutdown?: () => void;
    onAttachProposal?: (changeName: string) => void;
    onDetachProposal?: () => void;
    onSendPrompt?: (text: string, images?: ImageContent[]) => void;
    onReadArtifact?: (changeName: string, artifactId: string) => void;
    onRefresh?: () => void;
  };
}

/** Separate attach/detach icon button for mobile session header */
function MobileAttachButton({ session, openspecChanges, onAttach, onDetach }: {
  session: DashboardSession;
  openspecChanges?: OpenSpecChange[];
  onAttach?: (changeName: string) => void;
  onDetach?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click/touch
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const attached = session.attachedProposal;
  const changes = openspecChanges ?? [];
  const hasChanges = changes.length > 0;

  // Nothing to show
  if (!attached && !hasChanges) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`p-2 min-w-[44px] min-h-[44px] flex items-center justify-center ${
          attached ? "text-blue-400" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        }`}
        aria-label={attached ? `Attached: ${attached}` : "Attach change"}
        data-testid="mobile-attach-btn"
      >
        <Icon path={mdiPaperclip} size={0.7} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-xl shadow-lg z-50 overflow-hidden" data-testid="mobile-attach-menu">
          {attached ? (
            <>
              <div className="px-4 py-2 text-xs text-blue-400 border-b border-[var(--border-primary)]">
                <Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{attached}
              </div>
              {onDetach && (
                <button
                  onClick={() => { setOpen(false); onDetach(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left min-h-[44px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                >
                  {i18nT("common.detach", undefined, "Detach")}
                </button>
              )}
            </>
          ) : (
            changes.map((change) => (
              <button
                key={change.name}
                onClick={() => { setOpen(false); onAttach?.(change.name); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left min-h-[44px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              >
                {change.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Mobile header: back + name + attach icon + kebab */
function MobileHeader({ session, showBack, onBack, isRenaming, onConfirmRename, onCancelRename, canRename, onStartRename, mobileActions, onReadArtifact }: {
  session: DashboardSession;
  showBack?: boolean;
  onBack?: () => void;
  isRenaming: boolean;
  onConfirmRename: (name: string) => void;
  onCancelRename: () => void;
  canRename: boolean;
  onStartRename: () => void;
  mobileActions?: SessionHeaderMobileActions;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
}) {
  // Look up the attached change in the polled openspecChanges list. When
  // present, render the artifact-letters pill + task counter inside the
  // existing mobile-header-attached-chip span.
  // See change: add-attached-proposal-header-summary.
  const attachedChange = session.attachedProposal
    ? mobileActions?.openspecChanges?.find((c) => c.name === session.attachedProposal)
    : undefined;
  const readArtifact = onReadArtifact ?? mobileActions?.onReadArtifact;
  // Row 1: back + name + attach button + kebab. Always present.
  // The attached-proposal chip used to live here too (between name and the
  // MobileAttachButton), but it crowded the title down to ~8-10 visible chars
  // on a 360px-wide phone. The chip now lives on row 2 so the title gets the
  // full width of row 1. See change: fix-mobile-header-and-orientation.
  const row1 = (
    <div className="flex items-center gap-1 min-h-[44px]">
      {showBack && onBack && (
        <button
          onClick={onBack}
          className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title={i18nT("common.goBack", undefined, "Go back")}
          data-testid="back-button"
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
      )}
      {isRenaming ? (
        <InlineRenameInput
          currentName={getSessionDisplayName(session)}
          onConfirm={onConfirmRename}
          onCancel={onCancelRename}
          className="font-medium flex-1"
        />
      ) : (
        <span className="font-medium truncate flex-1">{getSessionDisplayName(session)}</span>
      )}
      {mobileActions && (
        <MobileAttachButton
          session={session}
          openspecChanges={mobileActions.openspecChanges}
          onAttach={mobileActions.onAttachProposal}
          onDetach={mobileActions.onDetachProposal}
        />
      )}
      {/* Layout-mode switch (Chat│Split│Editor; no-op without a split provider). */}
      <LayoutModeSwitch />
      {mobileActions && (
        <MobileActionMenu
          session={session}
          openspecChanges={mobileActions.openspecChanges}
          onRename={canRename ? onStartRename : undefined}
          onHide={mobileActions.onHide}
          onUnhide={mobileActions.onUnhide}
          onResume={mobileActions.onResume}
          onShutdown={mobileActions.onShutdown}
          onAttachProposal={mobileActions.onAttachProposal}
          onDetachProposal={mobileActions.onDetachProposal}
          onSendPrompt={mobileActions.onSendPrompt}
          onReadArtifact={mobileActions.onReadArtifact}
          onRefresh={mobileActions.onRefresh}
        />
      )}
    </div>
  );

  // Row 2: attached-proposal chip. Read-only (action affordances stay in the
  // MobileAttachButton popover on row 1). The chip's data-testid, content,
  // tooltip, and reactivity are unchanged from fix-mobile-attach-proposal-display
  // — only its parent moved from row-1 sibling to row-2 sibling.
  // The previous max-w-[55%] is dropped because the chip no longer competes
  // with the title for horizontal space; the inner change-name span keeps its
  // truncate so very long names still ellipsize within the full row-2 width.
  // See change: fix-mobile-header-and-orientation.
  const chipRow = session.attachedProposal ? (
    <div className="flex items-center min-h-[20px] pl-1">
      <span
        className="text-[10px] text-blue-400 flex items-center gap-0.5 min-w-0"
        title={`Attached: ${session.attachedProposal}`}
        data-testid="mobile-header-attached-chip"
      >
        <Icon path={mdiPaperclip} size={0.4} />
        <span className="truncate min-w-0">{session.attachedProposal}</span>
        {attachedChange && attachedChange.artifacts.length > 0 && (
          <span className="flex-shrink-0">
            <ArtifactLettersButton
              artifacts={attachedChange.artifacts}
              changeName={attachedChange.name}
              onReadArtifact={readArtifact}
            />
          </span>
        )}
        {attachedChange && attachedChange.totalTasks > 0 && (
          <span
            className="text-[10px] text-[var(--text-muted)] flex-shrink-0"
            data-testid="attached-proposal-task-counter"
          >
            ({attachedChange.completedTasks}/{attachedChange.totalTasks})
          </span>
        )}
      </span>
    </div>
  ) : null;

  // When there's an attached proposal, render two rows. When there isn't, the
  // header stays a single-row container exactly as before — no empty row 2 is
  // reserved. See change: fix-mobile-header-and-orientation.
  return (
    <div className="px-2 py-1 border-b border-[var(--border-primary)] flex flex-col text-sm">
      {row1}
      {chipRow}
    </div>
  );
}

/** Type for mobile action props to keep interface clean */
type SessionHeaderMobileActions = NonNullable<Props["mobileActions"]>;

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function SessionHeader({ session, state, onRename, showBack, onBack, mobileActions, commands, onSendPrompt, openspecChanges, onAttachProposal, onDetachProposal, hasFileChanges, onOpenDiffView, onRefresh, onReadArtifact, onOpenExtensionModulePicker, onResume, allTags, onSetTags, onSeekToCard }: Props) {
  const [now, setNow] = useState(Date.now());
  const [isRenaming, setIsRenaming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openspecPickerOpen, setOpenspecPickerOpen] = useState(false);
  // Flow launcher button + dialogs removed: flow management is owned by
  // flows-plugin's command-route claims and SessionFlowActionsClaim.
  // See change: pluginize-flows-via-registry.

  const attached = session?.attachedProposal;
  const openspecOptions: SelectOption[] = (openspecChanges || []).map(c => {
    const stateLabels: Record<string, string> = {
      "no-tasks": "Planning",
      "in-progress": `Implementing — ${c.completedTasks}/${c.totalTasks} tasks`,
      "complete": `Complete — ${c.completedTasks}/${c.totalTasks} tasks`,
    };
    return {
      value: c.name,
      label: c.name,
      description: stateLabels[c.status] || c.status,
      badge: c.status === "complete" ? "✓" : c.status === "in-progress" ? `${c.completedTasks}/${c.totalTasks}` : undefined,
      badgeColor: c.status === "complete" ? "text-green-400" : "text-blue-400",
    };
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!session) {
    return (
      <div className="px-4 py-2 border-b border-[var(--border-primary)] text-sm text-[var(--text-tertiary)]">
        {i18nT("session.noSessionSelected", undefined, "No session selected")}
      </div>
    );
  }

  const duration = now - session.startedAt;
  const canRename = session.status !== "ended" && onRename;

  function handleConfirmRename(name: string) {
    setIsRenaming(false);
    if (onRename && session) {
      onRename(session.id, name);
    }
  }

  const isMobile = useMobile();

  // Mobile: compact header with back + name + attach icon + kebab
  if (isMobile) {
    return (
      <MobileHeader
        session={session}
        showBack={showBack}
        onBack={onBack}
        isRenaming={isRenaming}
        onConfirmRename={handleConfirmRename}
        onCancelRename={() => setIsRenaming(false)}
        canRename={!!canRename}
        onStartRename={() => setIsRenaming(true)}
        mobileActions={mobileActions}
        onReadArtifact={onReadArtifact}
      />
    );
  }

  // Desktop attached-change lookup for the artifact-letters pill + task counter.
  // See change: add-attached-proposal-header-summary.
  const desktopAttachedChange = attached
    ? openspecChanges?.find((c) => c.name === attached)
    : undefined;

  // Resume / Fork affordance gate: only render when the session is dead-but-resumable
  // AND a parent callback was supplied. The render gate replaces the dimmed elapsed-
  // duration span (a tombstone is meaningless) — see change: resume-button-in-session-header.
  const isEnded = session.status === "ended" && Boolean(session.sessionFile) && Boolean(onResume);

  // Desktop: full header
  return (
    <div className="px-4 py-2 border-b border-[var(--border-primary)] flex items-center gap-4 text-sm">
      {showBack && onBack && (
        <button
          onClick={onBack}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
          title={i18nT("common.goBack", undefined, "Go back")}
          data-testid="back-button"
        >
          <Icon path={mdiArrowLeft} size={0.65} />
        </button>
      )}
      {isRenaming ? (
        <InlineRenameInput
          currentName={getSessionDisplayName(session)}
          onConfirm={handleConfirmRename}
          onCancel={() => setIsRenaming(false)}
          className="font-medium"
        />
      ) : (
        <span className="font-medium flex items-center gap-1">
          <span
            onDoubleClick={() => canRename && setIsRenaming(true)}
            className={canRename ? "cursor-pointer" : ""}
          >
            {getSessionDisplayName(session)}
          </span>
          {canRename && (
            <button
              onClick={() => setIsRenaming(true)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
              title={i18nT("session.renameSession", undefined, "Rename session")}
            >
              <Icon path={mdiPencilOutline} size={0.5} />
            </button>
          )}
        </span>
      )}
      {/* Single view selector — sits after name+rename, immediately before Seek
          (change: redesign-split-layout-controls). Model + thinking level were
          dropped from the header (both already render on the session card); the
          pi version segment below is kept as the only per-session pi surface. */}
      <LayoutModeSwitch />
      {onSeekToCard && (
        <button
          type="button"
          onClick={onSeekToCard}
          className="ml-0.5 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
          title={i18nT("session.seekToCard", undefined, "Seek to this session's card in the sidebar")}
          data-testid="session-header-seek-card"
        >
          <Icon path={mdiCrosshairsGps} size={0.45} />
          {i18nT("session.seek", undefined, "Seek")}
        </button>
      )}
      {/* pi version the session actually runs, reported by the bridge. */}
      {/* See change: restore-pi-version-skew-surface. */}
      {session.piVersion && (
        <span className="text-[var(--text-tertiary)]" title="pi version">pi {session.piVersion}</span>
      )}
      {/* Extension UI System (Phase 2): footer-segment decorator slot. */}
      {/* See change: add-extension-ui-decorations. */}
      <FooterSegmentSlot session={session} />
      {/* Editable user-tag strip + read-only phase chip (D5: detail-header
          primary). See change: add-session-tags. */}
      {onSetTags && (
        <div className="flex items-center gap-1.5">
          <TagEditor tags={session.tags ?? []} allTags={allTags ?? []} onChange={onSetTags} />
          {session.openspecPhase && <TagChip label={session.openspecPhase} variant="exec" />}
        </div>
      )}
      {/* OpenSpec + Flow buttons */}
      <span className="flex-1" />
      {onAttachProposal && openspecChanges && openspecChanges.length > 0 && (
        attached ? (
          <span className="text-[10px] flex items-center gap-1 mr-2">
            <span className="text-blue-400"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{attached}</span>
            {desktopAttachedChange && desktopAttachedChange.artifacts.length > 0 && (
              <ArtifactLettersButton
                artifacts={desktopAttachedChange.artifacts}
                changeName={desktopAttachedChange.name}
                onReadArtifact={onReadArtifact}
              />
            )}
            {desktopAttachedChange && desktopAttachedChange.totalTasks > 0 && (
              <span
                className="text-[10px] text-[var(--text-muted)]"
                data-testid="attached-proposal-task-counter"
              >
                ({desktopAttachedChange.completedTasks}/{desktopAttachedChange.totalTasks})
              </span>
            )}
            {onDetachProposal && (
              <button
                onClick={onDetachProposal}
                className="text-[var(--text-muted)] hover:text-red-400 px-0.5"
                title={i18nT("openspec.detachChange", undefined, "Detach change")}
              >
                <Icon path={mdiLinkOff} size={0.45} />
              </button>
            )}
          </span>
        ) : (
          <button
            onClick={() => setOpenspecPickerOpen(true)}
            className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 mr-1"
            title={i18nT("openspec.attachOpenspecChange", undefined, "Attach OpenSpec change")}
          >
            <Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{i18nT("common.attach", undefined, "Attach")}
          </button>
        )
      )}
      {/* Flow launcher button removed: flows-plugin's SessionFlowActionsClaim
          contributes its own "Run flow" button via the
          session-card-action-bar slot. See change:
          pluginize-flows-via-registry. */}
      {/* Extension UI System (Phase 1): Modules entry point. Shown only when */}
      {/* the bridge has reported at least one module for this session. */}
      {/* See change: add-extension-ui-modal. */}
      {(session.uiModules?.length ?? 0) > 0 && onOpenExtensionModulePicker && (
        <button
          onClick={onOpenExtensionModulePicker}
          className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 mr-1"
          title={i18nT("packages.extensionModules", undefined, "Extension modules")}
          data-testid="open-extension-modules"
        >
          <Icon path={mdiViewGridOutline} size={0.4} className="inline mr-0.5" />{i18nT("packages.modules", undefined, "Modules")}
        </button>
      )}
      <ChangedFilesChip hasFileChanges={hasFileChanges} onOpenDiffView={onOpenDiffView} />
      {isEnded ? (
        <>
          <button
            onClick={() => onResume!("continue")}
            disabled={!!session.resuming}
            className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed mr-1"
            title={i18nT("session.resumeSessionContinueSameSession", undefined, "Resume session (continue same session)")}
            data-testid="header-resume-button"
          >
            <Icon path={mdiPlayCircleOutline} size={0.4} className="inline mr-0.5" />{i18nT("session.resume", undefined, "Resume")}
          </button>
          <button
            onClick={() => onResume!("fork")}
            disabled={!!session.resuming}
            className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={i18nT("session.forkSessionNewSessionFromThis", undefined, "Fork session (new session from this point)")}
            data-testid="header-fork-button"
          >
            <Icon path={mdiSourceFork} size={0.4} className="inline mr-0.5" />{i18nT("session.fork", undefined, "Fork")}
          </button>
        </>
      ) : (
        <span className="text-[var(--text-muted)]">{formatDuration(duration)}</span>
      )}
      {onRefresh && (
        <button
          onClick={() => { onRefresh(); setRefreshing(true); setTimeout(() => setRefreshing(false), 500); }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5"
          title={i18nT("session.refreshChat", undefined, "Refresh chat")}
        >
          <Icon path={mdiRefresh} size={0.6} className={refreshing ? "animate-spin" : ""} />
        </button>
      )}
      {openspecPickerOpen && onAttachProposal && (
        <SearchableSelectDialog
          title={i18nT("openspec.attachOpenspecChange2", undefined, "Attach OpenSpec Change")}
          options={openspecOptions}
          placeholder={i18nT("common.searchChanges", undefined, "Search changes...")}
          emptyMessage="No changes available"
          onSelect={(value) => {
            onAttachProposal(value);
            setOpenspecPickerOpen(false);
          }}
          onCancel={() => setOpenspecPickerOpen(false)}
        />
      )}
      {/* Flow picker + launch dialog removed; owned by flows-plugin
          command-route claims (/flows, /flows:new, /flows:edit,
          /flows:delete) and SessionFlowActionsClaim. See change:
          pluginize-flows-via-registry. */}
    </div>
  );
}

/**
 * Session-header changed-files summary chip (change: add-change-summary-table).
 * Shows `Changed files +X −Y · N` from the shared session diff. Prefers the
 * integrated `openChanges()` (opens the split Changes section); falls back to
 * the `/session/:id/diff` takeover route when no split workspace is mounted.
 */
function ChangedFilesChip({
  hasFileChanges,
  onOpenDiffView,
}: {
  hasFileChanges?: boolean;
  onOpenDiffView?: () => void;
}) {
  const ws = useOptionalSplitWorkspace();
  const diff = useOptionalSessionDiff();
  const files = diff?.data?.files ?? [];
  const nFiles = files.length;
  const totalAdditions = diff?.data?.totalAdditions;
  const totalDeletions = diff?.data?.totalDeletions;

  const visible = nFiles > 0 || hasFileChanges;
  const activate = ws?.openChanges ?? onOpenDiffView;
  if (!visible || !activate) return null;

  const hasCounts = totalAdditions !== undefined || totalDeletions !== undefined;
  return (
    <button
      type="button"
      onClick={() => activate()}
      data-testid="changed-files-chip"
      className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 mr-1 inline-flex items-center gap-1"
      title={i18nT("diff.viewChangedFiles", undefined, "View changed files")}
    >
      <Icon path={mdiFileCompare} size={0.4} className="inline" />
      <span>{i18nT("diff.changedFiles", undefined, "Changed Files")}</span>
      {hasCounts && <CountBadges additions={totalAdditions ?? 0} deletions={totalDeletions ?? 0} />}
      {nFiles > 0 && <span className="text-[var(--text-tertiary)]">· {nFiles}</span>}
    </button>
  );
}
