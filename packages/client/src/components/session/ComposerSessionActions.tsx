import {
  SessionCardBadgeSlot,
  useSlotHasClaimsForSession,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import {
  statusAriaLabel,
  statusPresentation,
} from "@blackbelt-technology/pi-dashboard-client-utils/statusPresentation";
import type { DashboardSession, ImageContent, OpenSpecArtifact, OpenSpecChange, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, DEFAULT_OPENSPEC_CONFIG, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArchiveOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiCompassOutline,
  mdiFastForward,
  mdiFormatListChecks,
  mdiPlayCircleOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { ExploreDialog } from "../openspec/ExploreDialog.js";
import { deriveStepperState } from "../openspec/OpenSpecStepper.js";
import { buildOpenSpecTooltips } from "../openspec/SessionOpenSpecActions.js";
import { TasksPopover } from "./TasksPopover.js";
import { WorktreeActionsMenu } from "../worktree/WorktreeActionsMenu.js";

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
  name,
  state,
  onClick,
  disabled,
  title,
  testId,
  sub,
}: {
  letter: string;
  /** Full artifact name for the accessible label, e.g. "Proposal". */
  name: string;
  state: "done" | "current" | "todo";
  onClick?: () => void;
  disabled?: boolean;
  title: string;
  testId: string;
  sub?: string;
}) {
  // Color flows through the semantic --status-* token; the glyph (e.g. ✓ for
  // done) is the mandatory non-hue channel so done≠todo without color.
  const pres = statusPresentation(state);
  // Localize the status word so the aria-label is fully translated, not
  // mixed-language (e.g. "Propuesta, done").
  const stateLabel = i18nT(`auto.artifact_state_${state}`, undefined, state);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled && onClick) onClick(); }}
      disabled={disabled || !onClick}
      title={title}
      aria-label={statusAriaLabel(name, state, stateLabel)}
      data-testid={testId}
      data-state={state}
      className="focus-ring inline-flex items-baseline gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        color: pres.tokenVar,
        borderColor: `color-mix(in srgb, ${pres.tokenVar} 50%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${pres.tokenVar} 8%, transparent)`,
      }}
    >
      <span aria-hidden="true" className="text-[8px]">{pres.glyph}</span>
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
  const showStatus = hasBadge;
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
  if (!showOpenSpec && !showStatus && !showGit) return null;

  return (
    <div
      data-testid="composer-session-actions"
      className="flex items-center gap-1 flex-wrap"
    >
      {showOpenSpec && (
        <>
          <GroupLabel testId="composer-openspec-group-label">{i18nT("openspec.openspec", undefined, "OpenSpec")}</GroupLabel>
          {wf("explore") && (
            <IconButton
              icon={mdiCompassOutline}
              label={i18nT("common.explore", undefined, "Explore")}
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
                name={i18nT("openspec.artifactProposal", undefined, "Proposal")}
                state={artifactChipState("proposal")}
                title={i18nT("openspec.openProposalMd", undefined, "Open proposal.md")}
                testId="composer-artifact-p"
                onClick={onReadArtifact ? () => onReadArtifact(change.name, "proposal") : undefined}
              />
              <ArtifactChip
                letter="D"
                name={i18nT("openspec.artifactDesign", undefined, "Design")}
                state={artifactChipState("design")}
                title={i18nT("common.openDesignMd", undefined, "Open design.md")}
                testId="composer-artifact-d"
                onClick={onReadArtifact ? () => onReadArtifact(change.name, "design") : undefined}
              />
              <ArtifactChip
                letter="S"
                name={i18nT("openspec.artifactSpecs", undefined, "Specs")}
                state={artifactChipState("specs")}
                title={i18nT("openspec.openSpecs", undefined, "Open specs")}
                testId="composer-artifact-s"
                onClick={onReadArtifact ? () => onReadArtifact(change.name, "specs") : undefined}
              />
              {change.totalTasks > 0 && (
                <ArtifactChip
                  letter="T"
                  name={i18nT("openspec.artifactTasks", undefined, "Tasks")}
                  sub={`${change.completedTasks}/${change.totalTasks}`}
                  state={artifactChipState("tasks")}
                  title={i18nT("openspec.openTaskList", undefined, "Open task list")}
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
                  label={i18nT("common.continue", undefined, "Continue")}
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
              label={i18nT("common.apply", undefined, "Apply")}
              onClick={() => onSendPrompt?.(`/skill:openspec-apply-change ${attached}`)}
              disabled={streaming}
              testId="composer-apply-btn"
              variant="primary"
            />
          )}
          {wf("verify") && attached && changeState === ChangeState.COMPLETE && (
            <IconButton
              icon={mdiCheckCircleOutline}
              label={i18nT("common.verify", undefined, "Verify")}
              onClick={() => onSendPrompt?.(`/skill:openspec-verify-change ${attached}`)}
              disabled={streaming}
              testId="composer-verify-btn"
              variant="success"
            />
          )}
          {wf("archive") && (
            <IconButton
              icon={mdiArchiveOutline}
              label={i18nT("openspec.archive", undefined, "Archive")}
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
          <GroupLabel testId="composer-git-group-label">{i18nT("git.git", undefined, "Git")}</GroupLabel>
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

      {showStatus && (
        <>
          <Divider />
          <GroupLabel testId="composer-status-group-label">{i18nT("session.subcardStatus", undefined, "STATUS")}</GroupLabel>
          {/* <fieldset disabled> natively disables every <button>/<input>
              inside per HTML spec. Used here to gate plugin-rendered
              actions while the session is streaming, without coupling
              this strip to a plugin's internal button rendering.
              See change: redesign-session-card-and-composer
              (statusbar-disable-on-streaming). */}
          <fieldset
            disabled={streaming}
            data-testid="composer-status-group"
            title={streaming ? "Session is streaming" : undefined}
            className={`inline-flex items-center gap-1 flex-wrap p-0 m-0 border-0 min-w-0 ${streaming ? "opacity-40" : ""}`}
          >
            {hasBadge && <SessionCardBadgeSlot session={session} />}
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
          title={i18nT("openspec.archiveChange", undefined, "Archive change?")}
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
