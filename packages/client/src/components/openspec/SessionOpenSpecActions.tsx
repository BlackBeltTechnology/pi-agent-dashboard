import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type { DashboardSession, ImageContent, OpenSpecChange, OpenSpecConfig, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, DEFAULT_OPENSPEC_CONFIG, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArchiveArrowUp,
  mdiArchiveOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiCompassOutline,
  mdiFastForward,
  mdiFormatListChecks,
  mdiLightbulbOnOutline,
  mdiLinkOff,
  mdiPaperclip,
  mdiPlayCircleOutline,
  mdiPlus,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { ExploreDialog } from "./ExploreDialog.js";
import { GroupedAttachDialog } from "../workspace/GroupedAttachDialog.js";
// ArtifactLettersButton removed — stepper P/D/S nodes are now clickable
// and replace the standalone letters button. See change:
// redesign-session-card-and-composer (stepper-click-to-open).
import { NewChangeDialog } from "./NewChangeDialog.js";
import { OpenSpecStepper } from "./OpenSpecStepper.js";
import { ProposeDialog } from "./ProposeDialog.js";
import { SearchableSelectDialog, type SelectOption } from "../primitives/SearchableSelectDialog.js";
import { StatePill } from "../session/StatePill.js";
import { TasksPopover } from "../session/TasksPopover.js";

/**
 * Semantic palette — kept in sync with ComposerSessionActions so sidecard
 * and composer surfaces look identical. See change:
 * redesign-session-card-and-composer (sidecard-color-buttons).
 */
type BtnVariant = "primary" | "success" | "info" | "warn" | "accent" | "danger" | "neutral";

const SIDECARD_VARIANT_CLASSES: Record<BtnVariant, string> = {
  primary: "text-blue-400 border-blue-500/40 bg-blue-500/5 hover:text-blue-300 hover:border-blue-500/70",
  success: "text-green-400 border-green-500/40 bg-green-500/5 hover:text-green-300 hover:border-green-500/70",
  info:    "text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300 hover:border-cyan-500/70",
  warn:    "text-orange-400 border-orange-500/40 bg-orange-500/5 hover:text-orange-300 hover:border-orange-500/70",
  accent:  "text-purple-400 border-purple-500/40 bg-purple-500/5 hover:text-purple-300 hover:border-purple-500/70",
  danger:  "text-red-400 border-red-500/40 bg-red-500/5 hover:text-red-300 hover:border-red-500/70",
  neutral: "text-[var(--text-secondary)] border-[var(--border-secondary)] hover:text-blue-400 hover:border-blue-500/50",
};

function ActionButton({ label, icon, onClick, testId, disabled, title, variant = "neutral" }: { label: string; icon?: string; onClick: () => void; testId?: string; disabled?: boolean; title?: string; variant?: BtnVariant }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title}
      data-testid={testId}
      data-variant={variant}
      className={`text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${SIDECARD_VARIANT_CLASSES[variant]}`}
    >
      {icon && <Icon path={icon} size={0.4} className="inline mr-0.5" />}{label}
    </button>
  );
}

// Exported helper so ComposerSessionActions can reuse a single source of truth
// for OpenSpec action gating + tooltips.
export function buildOpenSpecTooltips(args: { attached: string | null; state: ChangeState | null; streaming: boolean }): { explore?: string; archive?: string } {
  const { attached, state, streaming } = args;
  const explore = attached ? i18nT("openspec.detachToExplore", undefined, "Detach proposal to explore freely") : undefined;
  let archive: string | undefined;
  if (streaming) archive = i18nT("session.sessionIsStreaming", undefined, "Session is streaming");
  else if (!attached) archive = i18nT("openspec.attachToArchive", undefined, "Attach a change to archive");
  else if (state !== ChangeState.COMPLETE) archive = i18nT("openspec.completeTasksFirst", undefined, "Complete tasks first");
  return { explore, archive };
}

/**
 * Replace-proposal dialog. Built on the shared `Confirm` shell with a custom
 * `body` slot for the divergence banner. Mounts only when both
 * `attachedProposal` and `pendingReplaceProposal` are set (parent-gated), so
 * the lazy `committedTarget` initialiser captures the FIRST suggestion the
 * dialog observed. The server may freely coalesce `pendingReplaceProposal`
 * (latest wins) while the dialog is open; `committedTarget` only moves on an
 * explicit `[Use latest]` click — what the button says is what attaches.
 * See change: replace-proposal-dialog-with-race-handling.
 */
function ReplaceProposalDialog({
  session,
  onAccept,
  onDismiss,
}: {
  session: DashboardSession;
  onAccept: (changeName: string) => void;
  onDismiss: (changeName: string) => void;
}) {
  const pending = session.pendingReplaceProposal;
  // Lazy init keyed by mount: captures the first observed suggestion. Parent
  // gates rendering on `pending != null`, so this is always a real name.
  // `[Use latest]` is the ONLY thing that advances this; the server's coalesced
  // `pending` updates never mutate it automatically (the core invariant).
  const [committedTarget, setCommittedTarget] = useState<string>(() => pending ?? "");
  // Server cleared the suggestion (accept / dismiss / agent_end) — unmount.
  if (session.attachedProposal == null || pending == null) return null;
  const diverged = pending !== committedTarget;
  return (
    <Confirm
      open
      testId="replace-proposal-dialog"
      title={i18nT("openspec.replaceAttachedProposal", undefined, "Replace attached proposal?")}
      message={i18nT("openspec.attachedDivergedMessage", { proposal: session.attachedProposal }, "This session is attached to “{proposal}”, but the agent is now working on a different change.")}
      confirmLabel={i18nT("openspec.replaceWith", { target: committedTarget }, "Replace with {target}")}
      body={
        diverged ? (
          <div
            data-testid="replace-divergence-banner"
            className="mt-2 flex items-center gap-2 rounded border border-orange-500/40 bg-orange-500/5 px-2 py-1 text-[11px] text-orange-300"
          >
            <span>
              {i18nT("common.newerChangeDetected", undefined, "Newer change detected:")} <code className="text-orange-200">{pending}</code>.
            </span>
            <button
              data-testid="use-latest-btn"
              onClick={() => setCommittedTarget(pending)}
              className="ml-auto rounded border border-orange-500/50 px-1.5 py-0.5 hover:border-orange-400 hover:text-orange-200"
            >
              {i18nT("common.useLatest", undefined, "Use latest")}
            </button>
          </div>
        ) : undefined
      }
      onConfirm={() => onAccept(committedTarget)}
      onClose={() => onDismiss(committedTarget)}
    />
  );
}

interface Props {
  session: DashboardSession;
  changes: OpenSpecChange[];
  onAttach: (changeName: string) => void;
  onDetach: () => void;
  /**
   * Accept (`accept=true`) or dismiss (`accept=false`) a suggested proposal
   * replacement. Sends the committed `changeName`, never the latest server
   * suggestion. See change: replace-proposal-dialog-with-race-handling.
   */
  onReplaceProposal?: (accept: boolean, changeName: string) => void;
  onSendPrompt: (text: string, images?: ImageContent[]) => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onBulkArchive?: () => void;
  /** Group definitions for grouped attach dialog. */
  groups?: OpenSpecGroup[];
  /** Group assignments map. */
  assignments?: Record<string, string>;
  /**
   * OpenSpec workflow config — used to gate which action buttons render.
   * Defaults to the full expanded set so missing config doesn't hide UI.
   * See change: redesign-session-card-and-composer (config-driven-workflow).
   */
  openspecConfig?: OpenSpecConfig;
}

export function SessionOpenSpecActions({ session, changes, onAttach, onDetach, onReplaceProposal, onSendPrompt, onReadArtifact, onBulkArchive, groups, assignments, openspecConfig }: Props) {
  const cfg = openspecConfig ?? DEFAULT_OPENSPEC_CONFIG;
  const wf = (name: string) => cfg.workflows.includes(name);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveAnywayConfirm, setArchiveAnywayConfirm] = useState(false);
  const [bulkArchiveConfirm, setBulkArchiveConfirm] = useState(false);
  const [attachingName, setAttachingName] = useState<string | null>(null);
  const [newChangeOpen, setNewChangeOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  // Overflow-menu plumbing removed — the only item ever rendered there was
  // Archive anyway, which is now a plain button. See change:
  // redesign-session-card-and-composer (cleanup-pass).

  const attached = session.attachedProposal;
  const isEnded = session.status === "ended";

  // Replace-proposal dialog: gated on both attached + pending so the dialog's
  // lazy committed-target init captures the first suggestion. Keyed by session
  // id so switching sessions remounts with fresh state (task 6.7).
  // See change: replace-proposal-dialog-with-race-handling.
  const replaceDialog =
    attached != null && session.pendingReplaceProposal != null && onReplaceProposal ? (
      <ReplaceProposalDialog
        key={session.id}
        session={session}
        onAccept={(name) => onReplaceProposal(true, name)}
        onDismiss={(name) => onReplaceProposal(false, name)}
      />
    ) : null;
  const hasCompletedChanges = changes.some((c) => c.status === "complete");
  const actionsDisabledGlobal = session.status === "streaming";

  const bulkArchiveButton = hasCompletedChanges && onBulkArchive && wf("bulk-archive") ? (
    <ActionButton
      label={i18nT("openspec.bulkArchive", undefined, "Bulk Archive")}
      icon={mdiArchiveArrowUp}
      onClick={() => setBulkArchiveConfirm(true)}
      testId="bulk-archive-btn"
      disabled={actionsDisabledGlobal}
    />
  ) : null;

  const bulkArchiveDialog = bulkArchiveConfirm ? (
    <Confirm
      open
      title={i18nT("openspec.bulkArchiveChanges", undefined, "Bulk archive changes?")}
      message={i18nT("openspec.bulkArchiveAllMessage", undefined, "Bulk archive all completed changes?")}
      confirmLabel={i18nT("openspec.bulkArchive", undefined, "Bulk Archive")}
      onConfirm={() => {
        onBulkArchive?.();
        setBulkArchiveConfirm(false);
      }}
      onClose={() => setBulkArchiveConfirm(false)}
    />
  ) : null;

  // Clear attaching state once the session reflects the attachment
  if (attachingName && attached === attachingName) {
    setAttachingName(null);
  }

  // Not attached: show combo box or attaching indicator
  if (!attached) {
    if (attachingName) {
      return (
        <div className="mt-1 text-[10px] text-blue-400 animate-pulse" data-testid="session-openspec-actions">
          {i18nT("common.attaching", undefined, "Attaching:")} {attachingName}…
        </div>
      );
    }

    const changeOptions: SelectOption[] = [
      ...changes.filter((c) => c.status !== "complete"),
      ...changes.filter((c) => c.status === "complete"),
    ].map((c) => {
      const state = deriveChangeState(c);
      const stateLabels: Record<string, string> = {
        PLANNING: i18nT("openspec.statePlanning", undefined, "Planning"),
        READY: i18nT("openspec.stateReady", undefined, "Ready to implement"),
        IMPLEMENTING: i18nT("openspec.stateImplementing", { completed: c.completedTasks, total: c.totalTasks }, "Implementing — {completed}/{total} tasks"),
        COMPLETE: i18nT("openspec.stateComplete", { completed: c.completedTasks, total: c.totalTasks }, "Complete — {completed}/{total} tasks"),
      };
      const desc = stateLabels[state] || c.status;
      const artifactNames = c.artifacts.map(a => a.id).join(", ");
      return {
        value: c.name,
        label: c.name,
        description: artifactNames ? `${desc} · ${artifactNames}` : desc,
        badge: c.status === "complete" ? "✓" : c.status === "in-progress" ? `${c.completedTasks}/${c.totalTasks}` : undefined,
        badgeColor: c.status === "complete" ? "text-green-400" : "text-blue-400",
      };
    });

    return (
      <div className="mt-1" data-testid="session-openspec-actions">
        <div className="flex items-center gap-1.5">
          <button
            data-testid="attach-combo"
            disabled={changes.length === 0}
            onClick={(e) => { e.stopPropagation(); setAttachPickerOpen(true); }}
            className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-blue-500/50 disabled:opacity-40"
          >
            <Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{changes.length === 0 ? i18nT("openspec.noChanges", undefined, "No changes") : i18nT("openspec.attachChange", undefined, "Attach change...")}
          </button>
          {!isEnded && (
            <>
              {wf("new") && (
                <ActionButton label={i18nT("common.change", undefined, "Change")} icon={mdiPlus} onClick={() => setNewChangeOpen(true)} testId="new-change-btn" variant="primary" />
              )}
              {wf("propose") && (
                <ActionButton label={i18nT("common.propose", undefined, "Propose")} icon={mdiLightbulbOnOutline} onClick={() => setProposeOpen(true)} testId="propose-btn" variant="primary" />
              )}
              {wf("explore") && (
                <ActionButton label={i18nT("common.explore", undefined, "Explore")} icon={mdiCompassOutline} onClick={() => setExploreOpen(true)} testId="explore-unattached-btn" variant="info" />
              )}
              {/* Archive + Bulk Archive intentionally hidden in the unattached
                  branch — they're meaningless without an attached proposal.
                  See change: redesign-session-card-and-composer (cleanup-pass). */}
            </>
          )}
        </div>
        {bulkArchiveDialog}
        {newChangeOpen && (
          <DialogPortal><NewChangeDialog
            onSend={(prompt) => {
              onSendPrompt(prompt);
              setNewChangeOpen(false);
            }}
            onClose={() => setNewChangeOpen(false)}
          /></DialogPortal>
        )}
        {proposeOpen && (
          <DialogPortal><ProposeDialog
            onSend={(prompt) => {
              onSendPrompt(prompt);
              setProposeOpen(false);
            }}
            onClose={() => setProposeOpen(false)}
          /></DialogPortal>
        )}
        {exploreOpen && (
          <DialogPortal><ExploreDialog
            changeName=""
            onSend={(text, images) => {
              onSendPrompt(`/skill:openspec-explore\n${text}`, images);
              setExploreOpen(false);
            }}
            onClose={() => setExploreOpen(false)}
          /></DialogPortal>
        )}
        {attachPickerOpen && (groups && groups.length > 0 ? (
          <GroupedAttachDialog
            changes={changes}
            groups={groups}
            assignments={assignments ?? {}}
            onSelect={(value) => {
              setAttachingName(value);
              onAttach(value);
              setAttachPickerOpen(false);
            }}
            onCancel={() => setAttachPickerOpen(false)}
          />
        ) : (
          <SearchableSelectDialog
            title={i18nT("openspec.attachOpenspecChange2", undefined, "Attach OpenSpec Change")}
            options={changeOptions}
            placeholder={i18nT("common.searchChanges", undefined, "Search changes...")}
            emptyMessage={i18nT("openspec.noChangesAvailable", undefined, "No changes available")}
            onSelect={(value) => {
              setAttachingName(value);
              onAttach(value);
              setAttachPickerOpen(false);
            }}
            onCancel={() => setAttachPickerOpen(false)}
          />
        ))}
      </div>
    );
  }

  // Attached: find the change
  const change = changes.find((c) => c.name === attached);

  // Attached but change not found in data
  if (!change) {
    return (
      <div className="mt-1" data-testid="session-openspec-actions">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-tertiary)]"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{attached}</span>
          <span className="flex-1" />
          <ActionButton label={i18nT("common.detach", undefined, "Detach")} icon={mdiLinkOff} onClick={onDetach} testId="detach-btn" />
        </div>
        {replaceDialog}
      </div>
    );
  }

  const state = deriveChangeState(change);
  const allArtifactsDone = change.artifacts.length > 0 && change.artifacts.every((a) => a.status === "done");
  const hasParseableTasks = change.totalTasks > 0;
  const showArchiveAnyway =
    state === ChangeState.IMPLEMENTING && change.isComplete === true && allArtifactsDone;
  const uncheckedCount = Math.max(0, change.totalTasks - change.completedTasks);

  const stepperHasAnyChanges = changes.length > 0;
  return (
    <div className="mt-1 space-y-1" data-testid="session-openspec-actions">
      {/* Line 1: badge + state pill + detach + artifact letters right-aligned */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]" data-testid="attached-badge"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" /><span className="text-blue-400">{attached}</span></span>
        <StatePill state={state} />
        <ActionButton label={i18nT("common.detach", undefined, "Detach")} icon={mdiLinkOff} onClick={onDetach} testId="detach-btn" />
        <span className="flex-1" />
      </div>
      {/* OpenSpec stepper — nodes are clickable for artifact + tasks open.
          See change: redesign-session-card-and-composer (stepper-click-to-open). */}
      <OpenSpecStepper
        variant="sidebar"
        change={change}
        attached={attached}
        hasAnyChanges={stepperHasAnyChanges}
        onReadArtifact={onReadArtifact}
        onOpenTasks={hasParseableTasks ? () => setTasksOpen(true) : undefined}
      />
      {/* Line 2: action buttons driven by ChangeState */}
      {!isEnded && (() => {
        const actionsDisabled = session.status === "streaming";
        const tips = buildOpenSpecTooltips({ attached, state, streaming: actionsDisabled });
        const archiveEnabled = !actionsDisabled && state === ChangeState.COMPLETE;
        return (
          <div className="flex items-center gap-1 flex-wrap">
            {wf("explore") && (
              <ActionButton
                label={i18nT("common.explore", undefined, "Explore")}
                icon={mdiCompassOutline}
                onClick={() => setExploreOpen(true)}
                testId="explore-btn"
                disabled={true /* attached path always disables Explore */}
                title={actionsDisabled ? i18nT("session.sessionIsStreaming", undefined, "Session is streaming") : tips.explore}
                variant="info"
              />
            )}
            {state === ChangeState.PLANNING && (
              <>
                {wf("continue") && <ActionButton label={i18nT("common.continue", undefined, "Continue")} icon={mdiChevronRight} onClick={() => onSendPrompt(`/skill:openspec-continue-change ${attached}`)} testId="continue-btn" disabled={actionsDisabled} variant="neutral" />}
                {wf("ff") && <ActionButton label={i18nT("openspec.ff", undefined, "FF")} icon={mdiFastForward} onClick={() => onSendPrompt(`/skill:openspec-ff-change ${attached}`)} testId="ff-btn" disabled={actionsDisabled} variant="neutral" />}
              </>
            )}
            {wf("apply") && (state === ChangeState.READY || state === ChangeState.IMPLEMENTING) && (
              <ActionButton label={i18nT("common.apply", undefined, "Apply")} icon={mdiPlayCircleOutline} onClick={() => onSendPrompt(`/skill:openspec-apply-change ${attached}`)} testId="apply-btn" disabled={actionsDisabled} variant="primary" />
            )}
            {wf("verify") && state === ChangeState.COMPLETE && (
              <ActionButton label={i18nT("common.verify", undefined, "Verify")} icon={mdiCheckCircleOutline} onClick={() => onSendPrompt(`/skill:openspec-verify-change ${attached}`)} testId="verify-btn" disabled={actionsDisabled} variant="success" />
            )}
            {wf("archive") && (
              <ActionButton
                label={i18nT("openspec.archive", undefined, "Archive")}
                icon={mdiArchiveOutline}
                onClick={() => setArchiveConfirm(true)}
                testId="archive-btn"
                disabled={!archiveEnabled}
                title={tips.archive}
                variant="accent"
              />
            )}
            {/* close Verify-only branch */}
            {/* Standalone Tasks button removed — the stepper's Tasks node is
                clickable and opens the same TasksPopover. Redundant button
                deleted per user feedback. See change:
                redesign-session-card-and-composer (cleanup-pass). */}
            {/* Archive anyway promoted from single-item overflow menu to a
                plain button. A menu with one item is meaningless. */}
            {showArchiveAnyway && (
              <ActionButton
                label={i18nT("openspec.archiveAnyway", undefined, "Archive anyway")}
                icon={mdiArchiveArrowUp}
                onClick={() => setArchiveAnywayConfirm(true)}
                testId="archive-anyway-btn"
                disabled={actionsDisabled}
                variant="accent"
              />
            )}
          </div>
        );
      })()}

      {exploreOpen && (
        <DialogPortal><ExploreDialog
          changeName={attached}
          onSend={(text, images) => {
            onSendPrompt(`/skill:openspec-explore ${attached}\n${text}`, images);
            setExploreOpen(false);
          }}
          onClose={() => setExploreOpen(false)}
        /></DialogPortal>
      )}

      {archiveConfirm && (
        <Confirm
          open
          title={i18nT("openspec.archiveChange", undefined, "Archive change?")}
          message={i18nT("openspec.archiveConfirmMessage", { name: attached }, 'Archive "{name}"?')}
          confirmLabel={i18nT("openspec.archive", undefined, "Archive")}
          onConfirm={() => {
            onSendPrompt(`/skill:openspec-archive-change ${attached}`);
            setArchiveConfirm(false);
          }}
          onClose={() => setArchiveConfirm(false)}
        />
      )}
      {archiveAnywayConfirm && (
        <Confirm
          open
          testId="archive-anyway-confirm"
          title={i18nT("openspec.archiveAnyway2", undefined, "Archive anyway?")}
          message={i18nT("openspec.archiveAnywayMessage", { unchecked: uncheckedCount, total: change.totalTasks }, "{unchecked} of {total} tasks are unchecked. Archive anyway?")}
          confirmLabel={i18nT("openspec.archiveAnyway", undefined, "Archive anyway")}
          onConfirm={() => {
            onSendPrompt(`/skill:openspec-archive-change ${attached}`);
            setArchiveAnywayConfirm(false);
          }}
          onClose={() => setArchiveAnywayConfirm(false)}
        />
      )}
      {tasksOpen && (
        <TasksPopover
          cwd={session.cwd}
          change={attached}
          onClose={() => setTasksOpen(false)}
        />
      )}
      {replaceDialog}
      {/* Overflow portal removed — Archive anyway promoted to inline button. */}
    </div>
  );
}
