import type { CommandInfo, DashboardSession, ImageContent, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft, mdiDockLeft, mdiFileCompare, mdiPlayCircleOutline, mdiSourceFork, mdiViewGridOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useMobile } from "../../hooks/useMobile.js";
import type { SessionState } from "../../lib/chat/event-reducer.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { getSessionDisplayName } from "../../lib/session/session-display-name.js";
import { isAcpSession, isRemoteOrigin } from "../../lib/session/session-origin-view.js";
import { useOptionalSessionDiff } from "../diff/SessionDiffContext.js";
import { FooterSegmentSlot } from "../extension-ui/FooterSegmentSlot.js";
import { InlineRenameInput } from "../primitives/InlineRenameInput.js";
// FlowLaunchDialog removed: flow launching is owned entirely by
// flows-plugin's command-route claims (/flows, /flows:new, etc.) and
// SessionFlowActionsClaim. See change: pluginize-flows-via-registry.
import { MobileActionMenu } from "../shell/MobileActionMenu.js";
import { LayoutModeSwitch } from "../split/LayoutModeSwitch.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { TagChip } from "../tags/TagChip.js";
import { TagEditor } from "../tags/TagEditor.js";
import { ContextRing, ContextRingButton, type ContextUsageValue } from "./ContextRing.js";
import { CountBadges } from "./CountBadges.js";
import { PiBelowFloorWarning } from "./PiBelowFloorWarning.js";
import { SessionClock } from "./SessionClock.js";
import { SessionTitleMenu } from "./SessionTitleMenu.js";
import { VaultBindingsChip } from "./VaultBindingsChip.js";

interface Props {
  session?: DashboardSession;
  state: SessionState;
  onRename?: (sessionId: string, name: string) => void;
  showBack?: boolean;
  onBack?: () => void;
  commands?: CommandInfo[];

  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  hasFileChanges?: boolean;
  onOpenDiffView?: () => void;
  /** Reload the transcript (title-menu item "Reload transcript"). */
  onRefresh?: () => void;
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
  /** Reveal this session's card in the sidebar (expand fold-ancestors +
   *  scroll + flash). Desktop-only; when omitted the Reveal button and menu
   *  item do not render. See changes: add-seek-to-session-card,
   *  reorganize-session-header. */
  onSeekToCard?: () => void;
  /** Context-window usage for the header ring. Falls back to `state.contextUsage`. */
  contextUsage?: ContextUsageValue;
  /** Effective `contextUsageBar` preference (override ?? global ?? true). Gates the ring. */
  showContextRing?: boolean;
  /** Renders the chat View menu. The header mounts it immediately after the
   *  layout switch; `iconOnly` is the mobile 44 px trigger. The caller owns the
   *  lazy import + Suspense. See change: reorganize-session-header. */
  renderViewMenu?: (opts: { iconOnly: boolean }) => React.ReactNode;
  /** Mobile action menu props (only used on mobile) */
  mobileActions?: {
    openspecChanges?: OpenSpecChange[];
    onArchive?: () => void;
    onResume?: (mode: "continue" | "fork") => void;
    onShutdown?: () => void;
    onAttachProposal?: (changeName: string) => void;
    onDetachProposal?: () => void;
    onSendPrompt?: (text: string, images?: ImageContent[]) => void;
    onReadArtifact?: (changeName: string, artifactId: string) => void;
    onRefresh?: () => void;
  };
}

/** Mobile header: one 48 px row — back, title, ring, layout menu, View, ⋯. */
function MobileHeader({ session, showBack, onBack, isRenaming, onConfirmRename, onCancelRename, canRename, onStartRename, mobileActions, contextUsage, showContextRing, cost, renderViewMenu }: {
  session: DashboardSession;
  showBack?: boolean;
  onBack?: () => void;
  isRenaming: boolean;
  onConfirmRename: (name: string) => void;
  onCancelRename: () => void;
  canRename: boolean;
  onStartRename: () => void;
  mobileActions?: SessionHeaderMobileActions;
  contextUsage?: ContextUsageValue;
  showContextRing: boolean;
  cost: number;
  renderViewMenu?: Props["renderViewMenu"];
}) {
  return (
    <div className="px-1 border-b border-[var(--border-primary)] flex flex-col text-sm">
      <div className="flex items-center min-h-12" data-testid="mobile-header-row">
        {showBack && onBack && (
          <button
            type="button"
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
            className="text-base font-semibold flex-1 min-w-0"
          />
        ) : (
          <span className="px-1 text-base font-semibold truncate flex-1 min-w-0" title={getSessionDisplayName(session)} data-testid="mobile-header-title">
            {getSessionDisplayName(session)}
          </span>
        )}
        {showContextRing && <ContextRingButton usage={contextUsage} cost={cost} />}
        {/* Layout-mode menu (Chat / Split / Editor; no-op without a split provider). */}
        <LayoutModeSwitch variant="menu" />
        {renderViewMenu?.({ iconOnly: true })}
        {mobileActions && (
          <MobileActionMenu
            session={session}
            openspecChanges={mobileActions.openspecChanges}
            onRename={canRename ? onStartRename : undefined}
            onArchive={mobileActions.onArchive}
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
      {/* See change: update-pi-core-1-0-adopt-apis. */}
      {session.piBelowFloor ? (
        <div className="py-0.5">
          <PiBelowFloorWarning session={session} />
        </div>
      ) : null}
      <VaultBindingsChip sessionId={session.id} />
    </div>
  );
}

/** Type for mobile action props to keep interface clean */
type SessionHeaderMobileActions = NonNullable<Props["mobileActions"]>;

/** Secondary chip button (32 px, 12 px label). */
const CHIP_BTN =
  "inline-flex items-center gap-1.5 min-h-8 px-2.5 rounded-md border text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed";
const CHIP_NEUTRAL = `${CHIP_BTN} border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`;

/** Meta line: tags, phase, pi version (or below-floor warning), clock, context ring. */
function HeaderMeta({ session, allTags, onSetTags, tagEditSignal, usage, showContextRing }: {
  session: DashboardSession;
  allTags?: string[];
  onSetTags?: (tags: string[]) => void;
  tagEditSignal: number;
  usage?: ContextUsageValue;
  showContextRing: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-xs text-[var(--text-secondary)]" data-testid="session-header-meta">
      {onSetTags && (
        <>
          <TagEditor tags={session.tags ?? []} allTags={allTags ?? []} onChange={onSetTags} openSignal={tagEditSignal} />
          {session.openspecPhase && <TagChip label={session.openspecPhase} variant="exec" />}
        </>
      )}
      {/* pi version the session actually runs, reported by the bridge.
          See change: restore-pi-version-skew-surface. */}
      {session.piBelowFloor ? (
        // See change: update-pi-core-1-0-adopt-apis.
        <PiBelowFloorWarning session={session} />
      ) : (
        session.piVersion && (
          <span className="@max-[760px]:hidden" title="pi version" data-testid="session-header-pi-version">
            pi {session.piVersion}
          </span>
        )
      )}
      <SessionClock startedAt={session.startedAt} lastActivityAt={session.lastActivityAt} ended={session.status === "ended"} />
      {showContextRing && <ContextRing usage={usage} />}
    </div>
  );
}

/** Trailing zone: Modules · Changed Files · Resume · Fork · layout switch · View. */
function HeaderTrailing({ session, isEnded, hasFileChanges, onOpenDiffView, onOpenExtensionModulePicker, onResume, renderViewMenu }: {
  session: DashboardSession;
  isEnded: boolean;
  hasFileChanges?: boolean;
  onOpenDiffView?: () => void;
  onOpenExtensionModulePicker?: () => void;
  onResume?: (mode: "continue" | "fork") => void;
  renderViewMenu?: Props["renderViewMenu"];
}) {
  return (
    <div className="flex items-center gap-2 shrink-0" data-testid="session-header-trailing">
      {/* Extension UI System (Phase 1): Modules entry point. Shown only when
          the bridge has reported at least one module for this session.
          See change: add-extension-ui-modal. */}
      {(session.uiModules?.length ?? 0) > 0 && onOpenExtensionModulePicker && (
        <button
          type="button"
          onClick={onOpenExtensionModulePicker}
          className={CHIP_NEUTRAL}
          title={i18nT("packages.extensionModules", undefined, "Extension modules")}
          data-testid="open-extension-modules"
        >
          <Icon path={mdiViewGridOutline} size={0.67} className="text-[var(--text-secondary)]" />
          {i18nT("packages.modules", undefined, "Modules")}
        </button>
      )}
      <ChangedFilesChip hasFileChanges={hasFileChanges} onOpenDiffView={onOpenDiffView} />
      {isEnded && (
        <>
          <button
            type="button"
            onClick={() => onResume!("continue")}
            disabled={!!session.resuming}
            className={`${CHIP_BTN} tint-action-green`}
            title={i18nT("session.resumeSessionContinueSameSession", undefined, "Resume session (continue same session)")}
            data-testid="header-resume-button"
          >
            <Icon path={mdiPlayCircleOutline} size={0.67} />
            {i18nT("session.resume", undefined, "Resume")}
          </button>
          <button
            type="button"
            onClick={() => onResume!("fork")}
            disabled={!!session.resuming}
            className={`${CHIP_BTN} tint-action-blue`}
            title={i18nT("session.forkSessionNewSessionFromThis", undefined, "Fork session (new session from this point)")}
            data-testid="header-fork-button"
          >
            <Icon path={mdiSourceFork} size={0.67} />
            {i18nT("session.fork", undefined, "Fork")}
          </button>
        </>
      )}
      <LayoutModeSwitch />
      {renderViewMenu?.({ iconOnly: false })}
    </div>
  );
}

export function SessionHeader({ session, state, onRename, showBack, onBack, mobileActions, hasFileChanges, onOpenDiffView, onRefresh, onOpenExtensionModulePicker, onResume, allTags, onSetTags, onSeekToCard, contextUsage, showContextRing = true, renderViewMenu }: Props) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [tagEditSignal, setTagEditSignal] = useState(0);
  const titleButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const wasRenamingRef = useRef(false);
  const isMobile = useMobile();
  // Flow launcher button + dialogs removed: flow management is owned by
  // flows-plugin's command-route claims and SessionFlowActionsClaim.
  // See change: pluginize-flows-via-registry.

  // After rename ends via Enter/Escape (not a blur to another control), focus
  // returns to the title button.
  useEffect(() => {
    if (wasRenamingRef.current && !isRenaming && restoreFocusRef.current) {
      titleButtonRef.current?.focus();
    }
    restoreFocusRef.current = false;
    wasRenamingRef.current = isRenaming;
  }, [isRenaming]);

  if (!session) {
    return (
      <div className="px-4 py-2 border-b border-[var(--border-primary)] text-sm text-[var(--text-tertiary)]">
        {i18nT("session.noSessionSelected", undefined, "No session selected")}
      </div>
    );
  }

  const canRename = session.status !== "ended" && onRename;
  const usage = contextUsage ?? state.contextUsage;

  function endRename() {
    // Enter / Escape leave the input focused; a blur to another control does not.
    restoreFocusRef.current = document.activeElement?.tagName === "INPUT";
    setIsRenaming(false);
  }

  function handleConfirmRename(name: string) {
    endRename();
    if (onRename && session) {
      onRename(session.id, name);
    }
  }

  // Mobile: one 48 px row.
  if (isMobile) {
    return (
      <MobileHeader
        session={session}
        showBack={showBack}
        onBack={onBack}
        isRenaming={isRenaming}
        onConfirmRename={handleConfirmRename}
        onCancelRename={endRename}
        canRename={!!canRename}
        onStartRename={() => setIsRenaming(true)}
        mobileActions={mobileActions}
        contextUsage={usage}
        showContextRing={showContextRing}
        cost={state.cost}
        renderViewMenu={renderViewMenu}
      />
    );
  }

  // Resume / Fork affordance gate: only render when the session is dead-but-resumable
  // AND a parent callback was supplied. See change: resume-button-in-session-header.
  // Remote-origin sessions have their files on ANOTHER host — the server
  // refuses resume/fork with HTTP 409, so the affordance is not offered.
  // See change: add-pi-gateway-transport-identity.
  const isEnded = session.status === "ended" && Boolean(session.sessionFile) && Boolean(onResume) && !isRemoteOrigin(session) && !isAcpSession(session);

  function onHeaderKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "F2" || !canRename || isRenaming) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return;
    e.preventDefault();
    setIsRenaming(true);
  }

  const displayName = getSessionDisplayName(session);

  // Desktop: 48 px row of three zones (leading / middle / trailing). The header
  // is a CSS container: below 760 px the meta line drops under the title and
  // labels collapse to icons. See change: reorganize-session-header.
  return (
    <div className="@container relative z-popover border-b border-[var(--border-primary)] text-sm" onKeyDown={onHeaderKeyDown} data-testid="session-header">
      <div className="flex items-center gap-3 px-4 py-2 min-h-12" data-testid="session-header-row">
        {/* Leading: back + title (menu button) + Reveal, with the meta line. */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {showBack && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="shrink-0 inline-flex items-center justify-center min-w-8 min-h-8 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              title={i18nT("common.goBack", undefined, "Go back")}
              aria-label={i18nT("common.goBack", undefined, "Go back")}
              data-testid="back-button"
            >
              <Icon path={mdiArrowLeft} size={0.75} />
            </button>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0 min-w-0 @max-[760px]:flex-col @max-[760px]:items-stretch @max-[760px]:gap-0">
            <span className="inline-flex items-center gap-0.5 min-w-0 max-w-full @max-[760px]:self-start">
              {isRenaming ? (
                <InlineRenameInput
                  currentName={displayName}
                  onConfirm={handleConfirmRename}
                  onCancel={endRename}
                  className="text-base font-semibold min-w-0"
                />
              ) : (
                <SessionTitleMenu
                  name={displayName}
                  buttonRef={titleButtonRef}
                  onRename={canRename ? () => setIsRenaming(true) : undefined}
                  onReveal={onSeekToCard}
                  onEditTags={onSetTags ? () => setTagEditSignal((n) => n + 1) : undefined}
                  onReload={onRefresh}
                />
              )}
              {onSeekToCard && (
                <button
                  type="button"
                  onClick={onSeekToCard}
                  className="shrink-0 inline-flex items-center justify-center min-w-8 min-h-8 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  title={i18nT("session.revealInSidebar", undefined, "Reveal in sidebar")}
                  aria-label={i18nT("session.revealInSidebar", undefined, "Reveal in sidebar")}
                  data-testid="session-header-seek-card"
                >
                  <Icon path={mdiDockLeft} size={0.75} />
                </button>
              )}
            </span>
            <HeaderMeta
              session={session}
              allTags={allTags}
              onSetTags={onSetTags}
              tagEditSignal={tagEditSignal}
              usage={usage}
              showContextRing={showContextRing}
            />
          </div>
        </div>
        {/* Middle: extension-ui footer segments + vault chip. */}
        <div className="flex items-center gap-2 min-w-0 shrink">
          {/* Extension UI System (Phase 2): footer-segment decorator slot.
              See change: add-extension-ui-decorations. */}
          <FooterSegmentSlot session={session} />
          {/* Vault key state for this session (hidden without bindings). See change: add-credential-vault. */}
          <VaultBindingsChip sessionId={session.id} />
        </div>
        {/* Trailing: Modules · Changed Files · Resume · Fork · layout switch · View. */}
        <HeaderTrailing
          session={session}
          isEnded={isEnded}
          hasFileChanges={hasFileChanges}
          onOpenDiffView={onOpenDiffView}
          onOpenExtensionModulePicker={onOpenExtensionModulePicker}
          onResume={onResume}
          renderViewMenu={renderViewMenu}
        />
      </div>
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
      className={CHIP_NEUTRAL}
      title={i18nT("diff.changedFiles", undefined, "Changed Files")}
    >
      <Icon path={mdiFileCompare} size={0.67} className="text-[var(--text-secondary)]" />
      <span className="@max-[760px]:sr-only">{i18nT("diff.changedFiles", undefined, "Changed Files")}</span>
      {hasCounts && <CountBadges additions={totalAdditions ?? 0} deletions={totalDeletions ?? 0} />}
      {nFiles > 0 && <span className="text-[var(--text-tertiary)]">· {nFiles}</span>}
    </button>
  );
}
