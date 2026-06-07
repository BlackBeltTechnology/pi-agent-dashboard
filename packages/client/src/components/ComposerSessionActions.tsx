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
import type { DashboardSession, OpenSpecChange, OpenSpecArtifact, ImageContent, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState, DEFAULT_OPENSPEC_CONFIG } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { buildOpenSpecTooltips } from "./SessionOpenSpecActions.js";
import { deriveStepperState } from "./OpenSpecStepper.js";
import {
  SessionCardBadgeSlot,
  WorkspaceActionBarSlot,
  useSlotHasClaimsForSession,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { WorktreeActionsMenu } from "./WorktreeActionsMenu.js";
import { TasksPopover } from "./TasksPopover.js";
import { ExploreDialog } from "./ExploreDialog.js";
import { DialogPortal } from "./DialogPortal.js";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";

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
  /**
   * OpenSpec workflow config — gates which buttons render.
   * Defaults to the full expanded set when unset / fetch-pending.
   * See change: redesign-session-card-and-composer (config-driven-workflow).
   */
  openspecConfig?: OpenSpecConfig;
}

/**
 * Semantic color palette taken from the mockup:
 *   primary (blue)   = fork / apply
 *   success (green)  = verify / merge / done states
 *   info    (cyan)   = explore / tasks
 *   warn    (orange) = push / open PR / current states
 *   accent  (purple) = archive
 *   danger  (red)    = close / destructive
 *   neutral          = refresh / continue / FF / todo states
 */
type BtnVariant = "primary" | "success" | "info" | "warn" | "accent" | "danger" | "neutral";

const VARIANT_CLASSES: Record<BtnVariant, string> = {
  primary: "text-blue-400 border-blue-500/40 hover:border-blue-500/70 hover:text-blue-300 bg-blue-500/5",
  success: "text-green-400 border-green-500/40 hover:border-green-500/70 hover:text-green-300 bg-green-500/5",
  info:    "text-cyan-400 border-cyan-500/40 hover:border-cyan-500/70 hover:text-cyan-300 bg-cyan-500/5",
  warn:    "text-orange-400 border-orange-500/40 hover:border-orange-500/70 hover:text-orange-300 bg-orange-500/5",
  accent:  "text-purple-400 border-purple-500/40 hover:border-purple-500/70 hover:text-purple-300 bg-purple-500/5",
  danger:  "text-red-400 border-red-500/40 hover:border-red-500/70 hover:text-red-300 bg-red-500/5",
  neutral: "text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-blue-400 hover:border-blue-500/50",
};

function IconButton({
  icon,
  label,
  onClick,
  disabled,
  title,
  testId,
  variant = "neutral",
}: {
  icon: string;
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  testId?: string;
  variant?: BtnVariant;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title ?? label}
      data-testid={testId}
      data-variant={variant}
      className={`inline-flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]}`}
    >
      <Icon path={icon} size={0.45} />
      {label && <span>{label}</span>}
    </button>
  );
}

/**
 * Inline artifact chip: P / D / S / T. Replaces the per-stepper-node
 * progress dots inside the composer (which has no stepper). Colour follows
 * the workflow state (green=done, orange=current/ready, dim=todo); click
 * opens the artifact or, for T, the tasks popover.
 */
function ArtifactChip({
  letter,
  state,
  onClick,
  disabled,
  title,
  testId,
  sub,
}: {
  letter: string;
  state: "done" | "current" | "todo";
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  testId: string;
  sub?: string;
}) {
  const cls =
    state === "done"    ? "text-green-400 border-green-500/50 bg-green-500/8"
    : state === "current" ? "text-orange-400 border-orange-500/50 bg-orange-500/8"
    : "text-[var(--text-muted)] border-[var(--border-secondary)]";
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled && onClick) onClick(); }}
      disabled={disabled || !onClick}
      title={title}
      data-testid={testId}
      data-state={state}
      className={`inline-flex items-baseline gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border disabled:opacity-50 disabled:cursor-not-allowed ${cls}`}
    >
      <span>{letter}</span>
      {sub && <span className="text-[8px] font-normal opacity-80">{sub}</span>}
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
  onReadArtifact,
  showGitInfo,
  allSessions,
  onShutdownSession,
  openspecConfig,
}: Props) {
  const cfg = openspecConfig ?? DEFAULT_OPENSPEC_CONFIG;
  const wf = (name: string) => cfg.workflows.includes(name);
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

  // Derive per-artifact-chip state via the shared stepper state derivation so
  // composer chips and sidecard stepper stay in sync.
  const stepperStates = deriveStepperState({
    attached,
    artifacts: change?.artifacts ?? [],
    completedTasks: change?.completedTasks ?? 0,
    totalTasks: change?.totalTasks ?? 0,
    changeState,
    hasAnyChanges: (changes?.length ?? 0) > 0,
  });
  const artifactChipState = (id: "proposal" | "design" | "specs" | "tasks"): "done" | "current" | "todo" => {
    const s = stepperStates[id];
    return s === "done" || s === "current" ? s : "todo";
  };

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
          {wf("explore") && (
            <IconButton
              icon={mdiCompassOutline}
              label="Explore"
              onClick={() => setExploreOpen(true)}
              disabled={!!attached || streaming}
              title={streaming ? "Session is streaming" : tips.explore}
              testId="composer-explore-btn"
              variant="info"
            />
          )}
          {/* Artifact chips (P/D/S/T) — replace the standalone PDST button.
              Colours mirror the stepper-node states (green=done, orange=current,
              dim=todo). Click opens the artifact / tasks popover. */}
          {attached && change && (
            <>
              <ArtifactChip
                letter="P"
                state={artifactChipState("proposal")}
                title="Open proposal.md"
                testId="composer-artifact-p"
                onClick={onReadArtifact ? () => onReadArtifact(change.name, "proposal") : undefined}
              />
              <ArtifactChip
                letter="D"
                state={artifactChipState("design")}
                title="Open design.md"
                testId="composer-artifact-d"
                onClick={onReadArtifact ? () => onReadArtifact(change.name, "design") : undefined}
              />
              <ArtifactChip
                letter="S"
                state={artifactChipState("specs")}
                title="Open specs"
                testId="composer-artifact-s"
                onClick={onReadArtifact ? () => onReadArtifact(change.name, "specs") : undefined}
              />
              {change.totalTasks > 0 && (
                <ArtifactChip
                  letter="T"
                  sub={`${change.completedTasks}/${change.totalTasks}`}
                  state={artifactChipState("tasks")}
                  title="Open task list"
                  testId="composer-artifact-t"
                  onClick={() => setTasksOpen(true)}
                  disabled={streaming}
                />
              )}
            </>
          )}
          {attached && changeState === ChangeState.PLANNING && (
            <>
              {wf("continue") && (
                <IconButton
                  icon={mdiChevronRight}
                  label="Continue"
                  onClick={() => onSendPrompt?.(`/skill:openspec-continue-change ${attached}`)}
                  disabled={streaming}
                  testId="composer-continue-btn"
                  variant="neutral"
                />
              )}
              {wf("ff") && (
                <IconButton
                  icon={mdiFastForward}
                  label="FF"
                  onClick={() => onSendPrompt?.(`/skill:openspec-ff-change ${attached}`)}
                  disabled={streaming}
                  testId="composer-ff-btn"
                  variant="neutral"
                />
              )}
            </>
          )}
          {wf("apply") && attached && (changeState === ChangeState.READY || changeState === ChangeState.IMPLEMENTING) && (
            <IconButton
              icon={mdiPlayCircleOutline}
              label="Apply"
              onClick={() => onSendPrompt?.(`/skill:openspec-apply-change ${attached}`)}
              disabled={streaming}
              testId="composer-apply-btn"
              variant="primary"
            />
          )}
          {wf("verify") && attached && changeState === ChangeState.COMPLETE && (
            <IconButton
              icon={mdiCheckCircleOutline}
              label="Verify"
              onClick={() => onSendPrompt?.(`/skill:openspec-verify-change ${attached}`)}
              disabled={streaming}
              testId="composer-verify-btn"
              variant="success"
            />
          )}
          {wf("archive") && (
            <IconButton
              icon={mdiArchiveOutline}
              label="Archive"
              onClick={() => setArchiveConfirm(true)}
              disabled={!attached || streaming || changeState !== ChangeState.COMPLETE}
              title={tips.archive}
              testId="composer-archive-btn"
              variant="accent"
            />
          )}
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
              disabled={streaming}
            />
          </span>
        </>
      )}

      {showJj && (
        <>
          <Divider />
          <GroupLabel testId="composer-jj-group-label">JJ</GroupLabel>
          {/* <fieldset disabled> natively disables every <button>/<input>
              inside per HTML spec. Used here to gate plugin-rendered
              JJ actions while the session is streaming, without coupling
              this strip to the jj-plugin's internal button rendering.
              See change: redesign-session-card-and-composer
              (statusbar-disable-on-streaming). */}
          <fieldset
            disabled={streaming}
            data-testid="composer-jj-group"
            title={streaming ? "Session is streaming" : undefined}
            className={`inline-flex items-center gap-1 flex-wrap p-0 m-0 border-0 min-w-0 ${streaming ? "opacity-40" : ""}`}
          >
            {hasBadge && <SessionCardBadgeSlot session={session} />}
            {hasJjActions && <WorkspaceActionBarSlot session={session} />}
          </fieldset>
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
        <Confirm
          open
          title="Archive change?"
          message={`Archive "${attached}"?`}
          confirmLabel="Archive"
          onConfirm={() => {
            onSendPrompt?.(`/skill:openspec-archive-change ${attached}`);
            setArchiveConfirm(false);
          }}
          onClose={() => setArchiveConfirm(false)}
        />
      )}
    </div>
  );
}
