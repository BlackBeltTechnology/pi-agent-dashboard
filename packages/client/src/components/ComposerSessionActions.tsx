import React, { useState } from "react";
import { Icon } from "@mdi/react";
import {
  mdiCompassOutline,
  mdiPlayCircleOutline,
  mdiCheckCircleOutline,
  mdiArchiveOutline,
  mdiFormatListChecks,
  mdiChevronRight,
  mdiFastForward,
} from "@mdi/js";
import type { DashboardSession, OpenSpecChange, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildOpenSpecTooltips } from "./SessionOpenSpecActions.js";
import {
  SessionCardBadgeSlot,
  WorkspaceActionBarSlot,
  useSlotHasClaimsForSession,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { WorktreeActionsMenu } from "./WorktreeActionsMenu.js";
import { TasksPopover } from "./TasksPopover.js";
import { ExploreDialog } from "./ExploreDialog.js";
import { DialogPortal } from "./DialogPortal.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

/**
 * ComposerSessionActions — slim inline session-action row mounted inside
 * the StatusBar (model-selector row), not inside CommandInput.
 *
 * No stepper here (per user feedback: progress line lives only in sidecard).
 * No box / header / per-group labels — pure flex row of buttons + plugin
 * slot contributions, so it composes inside the existing 1-line StatusBar.
 *
 * Mirrors sidecard action gating: Explore disabled when attached, Archive
 * disabled until COMPLETE, everything disabled while streaming (refresh
 * exempted).
 *
 * See change: redesign-session-card-and-composer (7.x, refined per
 * statusbar-inline feedback).
 */
interface Props {
  session?: DashboardSession;
  changes?: OpenSpecChange[];
  openspecHasDir?: boolean;
  openspecPending?: boolean;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onAttach?: (changeName: string) => void;
  onDetach?: () => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onBulkArchive?: () => void;
  onRefresh?: () => void;
  allSessions?: DashboardSession[];
  onShutdownSession?: (sessionId: string) => void;
  showGitInfo?: boolean;
}

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  testId,
}: {
  icon: string;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title ?? label}
      data-testid={testId}
      className="inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon path={icon} size={0.45} />
      {label && <span>{label}</span>}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="inline-block h-3 w-px bg-[var(--border-secondary)] mx-0.5 flex-shrink-0" />;
}

function GroupLabel({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mr-0.5 flex-shrink-0"
    >
      {children}
    </span>
  );
}

export function ComposerSessionActions({
  session,
  changes,
  openspecHasDir,
  openspecPending,
  onSendPrompt,
  showGitInfo,
  allSessions,
  onShutdownSession,
}: Props) {
  // Hooks must run unconditionally.
  const safeSession = session ?? (undefined as unknown as DashboardSession);
  const hasBadge = useSlotHasClaimsForSession("session-card-badge", safeSession);
  const hasJjActions = useSlotHasClaimsForSession("workspace-action-bar", safeSession);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  if (!session) return null;

  const attached = session.attachedProposal ?? null;
  const change = attached ? changes?.find((c) => c.name === attached) : undefined;
  const changeState = change ? deriveChangeState(change) : null;
  const streaming = session.status === "streaming";
  const isEnded = session.status === "ended";

  const showOpenSpec = !isEnded && (openspecHasDir !== false || openspecPending === true);
  const showJj = hasBadge || hasJjActions;
  const showGit = (!!showGitInfo || !!session.gitWorktree) && !!session.gitWorktree;

  const tips = buildOpenSpecTooltips({ attached, state: changeState, streaming });

  // Nothing to render? Bail early so we don't add an empty group to StatusBar.
  if (!showOpenSpec && !showJj && !showGit) return null;

  return (
    <div
      data-testid="composer-session-actions"
      className="flex items-center gap-1 flex-wrap"
    >
      {showOpenSpec && (
        <>
          <GroupLabel testId="composer-openspec-group-label">OpenSpec</GroupLabel>
          <IconButton
            icon={mdiCompassOutline}
            label="Explore"
            onClick={() => setExploreOpen(true)}
            disabled={!!attached || streaming}
            title={streaming ? "Session is streaming" : tips.explore}
            testId="composer-explore-btn"
          />
          {attached && changeState === ChangeState.PLANNING && (
            <>
              <IconButton
                icon={mdiChevronRight}
                label="Continue"
                onClick={() => onSendPrompt?.(`/skill:openspec-continue-change ${attached}`)}
                disabled={streaming}
                testId="composer-continue-btn"
              />
              <IconButton
                icon={mdiFastForward}
                label="FF"
                onClick={() => onSendPrompt?.(`/skill:openspec-ff-change ${attached}`)}
                disabled={streaming}
                testId="composer-ff-btn"
              />
            </>
          )}
          {attached && (changeState === ChangeState.READY || changeState === ChangeState.IMPLEMENTING) && (
            <IconButton
              icon={mdiPlayCircleOutline}
              label="Apply"
              onClick={() => onSendPrompt?.(`/skill:openspec-apply-change ${attached}`)}
              disabled={streaming}
              testId="composer-apply-btn"
            />
          )}
          {attached && changeState === ChangeState.COMPLETE && (
            <IconButton
              icon={mdiCheckCircleOutline}
              label="Verify"
              onClick={() => onSendPrompt?.(`/skill:openspec-verify-change ${attached}`)}
              disabled={streaming}
              testId="composer-verify-btn"
            />
          )}
          {attached && change && change.totalTasks > 0 && (
            <IconButton
              icon={mdiFormatListChecks}
              label={`Tasks ${change.completedTasks}/${change.totalTasks}`}
              onClick={() => setTasksOpen(true)}
              disabled={streaming}
              testId="composer-tasks-btn"
            />
          )}
          <IconButton
            icon={mdiArchiveOutline}
            label="Archive"
            onClick={() => setArchiveConfirm(true)}
            disabled={!attached || streaming || changeState !== ChangeState.COMPLETE}
            title={tips.archive}
            testId="composer-archive-btn"
          />
        </>
      )}

      {showGit && (
        <>
          <Divider />
          <GroupLabel testId="composer-git-group-label">Git</GroupLabel>
          <span
            data-testid="composer-git-group"
            className="inline-flex items-center gap-1 flex-wrap"
          >
            <WorktreeActionsMenu
              session={session}
              allSessions={allSessions ?? []}
              onShutdownSession={onShutdownSession ?? (() => { /* unwired */ })}
            />
          </span>
        </>
      )}

      {showJj && (
        <>
          <Divider />
          <GroupLabel testId="composer-jj-group-label">JJ</GroupLabel>
          {hasBadge && <SessionCardBadgeSlot session={session} />}
          {hasJjActions && <WorkspaceActionBarSlot session={session} />}
        </>
      )}

      {tasksOpen && attached && (
        <TasksPopover
          cwd={session.cwd}
          change={attached}
          onClose={() => setTasksOpen(false)}
        />
      )}
      {exploreOpen && (
        <DialogPortal>
          <ExploreDialog
            changeName={attached ?? ""}
            onSend={(text, images) => {
              const prefix = attached ? `/skill:openspec-explore ${attached}\n` : `/skill:openspec-explore\n`;
              onSendPrompt?.(`${prefix}${text}`, images);
              setExploreOpen(false);
            }}
            onClose={() => setExploreOpen(false)}
          />
        </DialogPortal>
      )}
      {archiveConfirm && attached && (
        <DialogPortal>
          <ConfirmDialog
            message={`Archive "${attached}"?`}
            confirmLabel="Archive"
            onConfirm={() => {
              onSendPrompt?.(`/skill:openspec-archive-change ${attached}`);
              setArchiveConfirm(false);
            }}
            onCancel={() => setArchiveConfirm(false)}
          />
        </DialogPortal>
      )}
    </div>
  );
}
