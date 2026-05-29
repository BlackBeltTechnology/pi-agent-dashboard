import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@mdi/react";
import {
  mdiCompassOutline,
  mdiChevronRight,
  mdiFastForward,
  mdiPlayCircleOutline,
  mdiCheckCircleOutline,
  mdiArchiveOutline,
  mdiArchiveArrowUp,
  mdiLinkOff,
  mdiPlus,
  mdiPaperclip,
  mdiDotsHorizontal,
  mdiFormatListChecks,
} from "@mdi/js";
import type { DashboardSession, OpenSpecChange, OpenSpecGroup, ImageContent, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState, DEFAULT_OPENSPEC_CONFIG } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ExploreDialog } from "./ExploreDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DialogPortal } from "./DialogPortal.js";
// ArtifactLettersButton removed — stepper P/D/S nodes are now clickable
// and replace the standalone letters button. See change:
// redesign-session-card-and-composer (stepper-click-to-open).
import { NewChangeDialog } from "./NewChangeDialog.js";
import { SearchableSelectDialog, type SelectOption } from "./SearchableSelectDialog.js";
import { GroupedAttachDialog } from "./GroupedAttachDialog.js";
import { StatePill } from "./StatePill.js";
import { TasksPopover } from "./TasksPopover.js";
import { OpenSpecStepper } from "./OpenSpecStepper.js";

function ActionButton({ label, icon, onClick, testId, disabled, title }: { label: string; icon?: string; onClick: () => void; testId?: string; disabled?: boolean; title?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      title={title}
      className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--text-secondary)] disabled:hover:border-[var(--border-secondary)]"
      data-testid={testId}
    >
      {icon && <Icon path={icon} size={0.4} className="inline mr-0.5" />}{label}
    </button>
  );
}

// Exported helper so ComposerSessionActions can reuse a single source of truth
// for OpenSpec action gating + tooltips.
export function buildOpenSpecTooltips(args: { attached: string | null; state: ChangeState | null; streaming: boolean }): { explore?: string; archive?: string } {
  const { attached, state, streaming } = args;
  const explore = attached ? "Detach proposal to explore freely" : undefined;
  let archive: string | undefined;
  if (streaming) archive = "Session is streaming";
  else if (!attached) archive = "Attach a change to archive";
  else if (state !== ChangeState.COMPLETE) archive = "Complete tasks first";
  return { explore, archive };
}

interface Props {
  session: DashboardSession;
  changes: OpenSpecChange[];
  onAttach: (changeName: string) => void;
  onDetach: () => void;
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

export function SessionOpenSpecActions({ session, changes, onAttach, onDetach, onSendPrompt, onReadArtifact, onBulkArchive, groups, assignments, openspecConfig }: Props) {
  const cfg = openspecConfig ?? DEFAULT_OPENSPEC_CONFIG;
  const wf = (name: string) => cfg.workflows.includes(name);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveAnywayConfirm, setArchiveAnywayConfirm] = useState(false);
  const [bulkArchiveConfirm, setBulkArchiveConfirm] = useState(false);
  const [attachingName, setAttachingName] = useState<string | null>(null);
  const [newChangeOpen, setNewChangeOpen] = useState(false);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const [overflowPos, setOverflowPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    // Position menu under button (right-aligned), in viewport coords for fixed positioning.
    const btn = overflowBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      // Approx menu width 160; clamp to viewport.
      const menuWidth = 160;
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, r.right - menuWidth));
      setOverflowPos({ top: r.bottom + 4, left });
    }
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        overflowBtnRef.current?.contains(target) ||
        overflowMenuRef.current?.contains(target)
      ) return;
      setOverflowOpen(false);
    };
    const onScroll = () => setOverflowOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [overflowOpen]);

  const attached = session.attachedProposal;
  const isEnded = session.status === "ended";
  const hasCompletedChanges = changes.some((c) => c.status === "complete");
  const actionsDisabledGlobal = session.status === "streaming";

  const bulkArchiveButton = hasCompletedChanges && onBulkArchive && wf("bulk-archive") ? (
    <ActionButton
      label="Bulk Archive"
      icon={mdiArchiveArrowUp}
      onClick={() => setBulkArchiveConfirm(true)}
      testId="bulk-archive-btn"
      disabled={actionsDisabledGlobal}
    />
  ) : null;

  const bulkArchiveDialog = bulkArchiveConfirm ? (
    <DialogPortal><ConfirmDialog
      message="Bulk archive all completed changes?"
      confirmLabel="Bulk Archive"
      onConfirm={() => {
        onBulkArchive?.();
        setBulkArchiveConfirm(false);
      }}
      onCancel={() => setBulkArchiveConfirm(false)}
    /></DialogPortal>
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
          Attaching: {attachingName}…
        </div>
      );
    }

    const changeOptions: SelectOption[] = [
      ...changes.filter((c) => c.status !== "complete"),
      ...changes.filter((c) => c.status === "complete"),
    ].map((c) => {
      const state = deriveChangeState(c);
      const stateLabels: Record<string, string> = {
        PLANNING: "Planning",
        READY: "Ready to implement",
        IMPLEMENTING: `Implementing — ${c.completedTasks}/${c.totalTasks} tasks`,
        COMPLETE: `Complete — ${c.completedTasks}/${c.totalTasks} tasks`,
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
            <Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{changes.length === 0 ? "No changes" : "Attach change..."}
          </button>
          {!isEnded && (
            <>
              {(wf("new") || wf("propose")) && (
                <ActionButton label="Change" icon={mdiPlus} onClick={() => setNewChangeOpen(true)} testId="new-change-btn" />
              )}
              {wf("explore") && (
                <ActionButton label="Explore" icon={mdiCompassOutline} onClick={() => setExploreOpen(true)} testId="explore-unattached-btn" />
              )}
              {wf("archive") && (
                <ActionButton
                  label="Archive"
                  icon={mdiArchiveOutline}
                  onClick={() => { /* no-op when disabled */ }}
                  testId="archive-disabled-btn"
                  disabled
                  title={actionsDisabledGlobal ? "Session is streaming" : "Attach a change to archive"}
                />
              )}
              {bulkArchiveButton}
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
            title="Attach OpenSpec Change"
            options={changeOptions}
            placeholder="Search changes..."
            emptyMessage="No changes available"
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
          <ActionButton label="Detach" icon={mdiLinkOff} onClick={onDetach} testId="detach-btn" />
        </div>
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
        <ActionButton label="Detach" icon={mdiLinkOff} onClick={onDetach} testId="detach-btn" />
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
                label="Explore"
                icon={mdiCompassOutline}
                onClick={() => setExploreOpen(true)}
                testId="explore-btn"
                disabled={true /* attached path always disables Explore */}
                title={actionsDisabled ? "Session is streaming" : tips.explore}
              />
            )}
            {state === ChangeState.PLANNING && (
              <>
                {wf("continue") && <ActionButton label="Continue" icon={mdiChevronRight} onClick={() => onSendPrompt(`/skill:openspec-continue-change ${attached}`)} testId="continue-btn" disabled={actionsDisabled} />}
                {wf("ff") && <ActionButton label="FF" icon={mdiFastForward} onClick={() => onSendPrompt(`/skill:openspec-ff-change ${attached}`)} testId="ff-btn" disabled={actionsDisabled} />}
              </>
            )}
            {wf("apply") && (state === ChangeState.READY || state === ChangeState.IMPLEMENTING) && (
              <ActionButton label="Apply" icon={mdiPlayCircleOutline} onClick={() => onSendPrompt(`/skill:openspec-apply-change ${attached}`)} testId="apply-btn" disabled={actionsDisabled} />
            )}
            {wf("verify") && state === ChangeState.COMPLETE && (
              <ActionButton label="Verify" icon={mdiCheckCircleOutline} onClick={() => onSendPrompt(`/skill:openspec-verify-change ${attached}`)} testId="verify-btn" disabled={actionsDisabled} />
            )}
            {wf("archive") && (
              <ActionButton
                label="Archive"
                icon={mdiArchiveOutline}
                onClick={() => setArchiveConfirm(true)}
                testId="archive-btn"
                disabled={!archiveEnabled}
                title={tips.archive}
              />
            )}
            {/* close Verify-only branch */}
            {change.artifacts.length > 0 && hasParseableTasks && (
              <ActionButton
                label={`Tasks ${change.completedTasks}/${change.totalTasks}`}
                icon={mdiFormatListChecks}
                onClick={() => setTasksOpen(true)}
                testId="tasks-btn"
                disabled={actionsDisabled}
              />
            )}
            {showArchiveAnyway && (
              <button
                ref={overflowBtnRef}
                onClick={(e) => { e.stopPropagation(); setOverflowOpen((v) => !v); }}
                disabled={actionsDisabled}
                className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="overflow-btn"
                aria-label="More actions"
              >
                <Icon path={mdiDotsHorizontal} size={0.5} />
              </button>
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
        <DialogPortal><ConfirmDialog
          message={`Archive "${attached}"?`}
          confirmLabel="Archive"
          onConfirm={() => {
            onSendPrompt(`/skill:openspec-archive-change ${attached}`);
            setArchiveConfirm(false);
          }}
          onCancel={() => setArchiveConfirm(false)}
        /></DialogPortal>
      )}
      {archiveAnywayConfirm && (
        <DialogPortal><ConfirmDialog
          message={`${uncheckedCount} of ${change.totalTasks} tasks are unchecked. Archive anyway?`}
          confirmLabel="Archive anyway"
          onConfirm={() => {
            onSendPrompt(`/skill:openspec-archive-change ${attached}`);
            setArchiveAnywayConfirm(false);
          }}
          onCancel={() => setArchiveAnywayConfirm(false)}
        /></DialogPortal>
      )}
      {tasksOpen && (
        <TasksPopover
          cwd={session.cwd}
          change={attached}
          onClose={() => setTasksOpen(false)}
        />
      )}
      {overflowOpen && overflowPos && typeof document !== "undefined" && createPortal(
        <div
          ref={overflowMenuRef}
          className="fixed z-50 min-w-[160px] bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded shadow-lg"
          style={{ top: overflowPos.top, left: overflowPos.left }}
          data-testid="overflow-menu"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOverflowOpen(false);
              setArchiveAnywayConfirm(true);
            }}
            className="block w-full text-left text-[11px] px-2 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-blue-400"
            data-testid="archive-anyway-btn"
          >
            <Icon path={mdiArchiveArrowUp} size={0.4} className="inline mr-0.5" />Archive anyway
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
