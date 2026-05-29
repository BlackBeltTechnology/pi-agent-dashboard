import React from "react";
import { Icon } from "@mdi/react";
import {
  mdiCompassOutline,
  mdiPlayCircleOutline,
  mdiCheckCircleOutline,
  mdiArchiveOutline,
  mdiFormatListChecks,
  mdiChevronRight,
  mdiFastForward,
  mdiRefresh,
} from "@mdi/js";
import type { DashboardSession, OpenSpecChange, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { OpenSpecStepper } from "./OpenSpecStepper.js";
import { buildOpenSpecTooltips } from "./SessionOpenSpecActions.js";
import {
  SessionCardBadgeSlot,
  WorkspaceActionBarSlot,
  useSlotHasClaimsForSession,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { WorktreeActionsMenu } from "./WorktreeActionsMenu.js";
import { getSessionDisplayName } from "../lib/session-display-name.js";

/**
 * ComposerSessionActions — a horizontal session-action strip rendered above
 * the composer textarea inside CommandInput.
 *
 * Mirrors the same OpenSpec/Git/JJ action gating as the sidecard so users
 * don't lose context while typing. Surfaces the compact OpenSpec stepper.
 *
 * See change: redesign-session-card-and-composer (7.x).
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
  /** Full session list — forwarded into WorktreeActionsMenu. Optional. */
  allSessions?: DashboardSession[];
  onShutdownSession?: (sessionId: string) => void;
  showGitInfo?: boolean;
}

function StripButton({
  label,
  icon,
  onClick,
  disabled,
  title,
  testId,
  variant,
}: {
  label?: string;
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
  variant?: "neutral" | "primary" | "danger";
}) {
  const variantClass =
    variant === "primary" ? "border-blue-500/40 text-blue-400 hover:border-blue-500/60"
    : variant === "danger" ? "border-red-500/40 text-red-400 hover:border-red-500/60"
    : "border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title ?? label}
      data-testid={testId}
      className={`text-[10px] px-1.5 py-0.5 rounded border ${variantClass} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      <Icon path={icon} size={0.45} className="inline mr-0.5" />
      {label}
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="inline-block h-3.5 w-px bg-[var(--border-secondary)] mx-1 flex-shrink-0" />;
}

export function ComposerSessionActions({
  session,
  changes,
  openspecHasDir,
  openspecPending,
  onSendPrompt,
  onAttach,
  onDetach,
  onReadArtifact,
  onBulkArchive,
  onRefresh,
  allSessions,
  onShutdownSession,
  showGitInfo,
}: Props) {
  // Hooks must run unconditionally — rules-of-hooks. Use a dummy session
  // when none is selected; the entire strip returns null below.
  const safeSession = session ?? (undefined as unknown as DashboardSession);
  // Git/JJ predicates (mirror sidecard) — hooks always called.
  const hasBadge = useSlotHasClaimsForSession("session-card-badge", safeSession);
  const hasJjActions = useSlotHasClaimsForSession("workspace-action-bar", safeSession);

  // 7.5: parent gate — strip renders nothing when no session selected.
  if (!session) return null;

  const attached = session.attachedProposal ?? null;
  const change = attached ? changes?.find((c) => c.name === attached) : undefined;
  const changeState = change ? deriveChangeState(change) : null;
  const streaming = session.status === "streaming";
  const isEnded = session.status === "ended";
  const hasAnyChanges = (changes?.length ?? 0) > 0;

  // 7.4: OpenSpec group hidden when cwd is not OpenSpec-applicable.
  const showOpenSpec = openspecHasDir !== false || openspecPending === true;

  const showJj = hasBadge || hasJjActions;
  const showGit = (!!showGitInfo || !!session.gitWorktree) && !!session.gitWorktree; // worktree-actions only for now

  const tips = buildOpenSpecTooltips({ attached, state: changeState, streaming });

  return (
    <div
      data-testid="composer-session-actions"
      className="mt-2 px-2 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] flex flex-col gap-1.5"
    >
      {/* Strip header: gradient dot + label + refresh */}
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
        <span
          aria-hidden="true"
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            backgroundImage: "linear-gradient(135deg, var(--accent-blue), var(--accent-purple), var(--accent-orange))",
          }}
        />
        <span>session actions · <span className="text-[var(--text-secondary)] normal-case tracking-normal">{getSessionDisplayName(session)}</span></span>
        <span className="flex-1" />
        {onRefresh && (
          <button
            onClick={(e) => { e.stopPropagation(); onRefresh(); }}
            title="Refresh"
            data-testid="composer-refresh-btn"
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] p-0.5"
          >
            <Icon path={mdiRefresh} size={0.5} />
          </button>
        )}
      </div>

      {/* Action row — flex-wrap so groups fall onto a second line on narrow widths. */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* OpenSpec group */}
        {showOpenSpec && !isEnded && (
          <>
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mr-1" data-testid="composer-openspec-group-label">OPENSPEC</span>
            {/* Compact stepper — only meaningful when attached, but render
                the empty/all-todo stepper anyway as a visual cue. */}
            <OpenSpecStepper
              variant="compact"
              change={change}
              attached={attached}
              hasAnyChanges={hasAnyChanges}
            />
            <StripButton
              icon={mdiCompassOutline}
              label="Explore"
              onClick={() => { /* defer to sidecard's dialog wiring; strip is action-trigger only */ }}
              disabled={!!attached || streaming}
              title={streaming ? "Session is streaming" : tips.explore}
              testId="composer-explore-btn"
            />
            {attached && changeState === ChangeState.PLANNING && (
              <>
                <StripButton
                  icon={mdiChevronRight}
                  label="Continue"
                  onClick={() => onSendPrompt?.(`/skill:openspec-continue-change ${attached}`)}
                  disabled={streaming}
                  testId="composer-continue-btn"
                />
                <StripButton
                  icon={mdiFastForward}
                  label="FF"
                  onClick={() => onSendPrompt?.(`/skill:openspec-ff-change ${attached}`)}
                  disabled={streaming}
                  testId="composer-ff-btn"
                />
              </>
            )}
            {attached && (changeState === ChangeState.READY || changeState === ChangeState.IMPLEMENTING) && (
              <StripButton
                icon={mdiPlayCircleOutline}
                label="Apply"
                onClick={() => onSendPrompt?.(`/skill:openspec-apply-change ${attached}`)}
                disabled={streaming}
                variant="primary"
                testId="composer-apply-btn"
              />
            )}
            {attached && changeState === ChangeState.COMPLETE && (
              <StripButton
                icon={mdiCheckCircleOutline}
                label="Verify"
                onClick={() => onSendPrompt?.(`/skill:openspec-verify-change ${attached}`)}
                disabled={streaming}
                testId="composer-verify-btn"
              />
            )}
            {attached && change && change.totalTasks > 0 && (
              <StripButton
                icon={mdiFormatListChecks}
                label={`Tasks ${change.completedTasks}/${change.totalTasks}`}
                onClick={() => { /* tasks popover lives on sidecard */ }}
                disabled={streaming}
                testId="composer-tasks-btn"
              />
            )}
            <StripButton
              icon={mdiArchiveOutline}
              label="Archive"
              onClick={() => attached && onSendPrompt?.(`/skill:openspec-archive-change ${attached}`)}
              disabled={!attached || streaming || changeState !== ChangeState.COMPLETE}
              title={tips.archive}
              testId="composer-archive-btn"
            />
          </>
        )}

        {/* Git group — render worktree menu when applicable. */}
        {showGit && (
          <>
            <Divider />
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mr-1" data-testid="composer-git-group-label">GIT</span>
            <WorktreeActionsMenu
              session={session}
              allSessions={allSessions ?? []}
              onShutdownSession={onShutdownSession ?? (() => { /* unwired */ })}
            />
          </>
        )}

        {/* JJ group — plugin claims. */}
        {showJj && (
          <>
            <Divider />
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mr-1" data-testid="composer-jj-group-label">JJ</span>
            {hasBadge && <SessionCardBadgeSlot session={session} />}
            {hasJjActions && <WorkspaceActionBarSlot session={session} />}
          </>
        )}
      </div>
    </div>
  );
}
