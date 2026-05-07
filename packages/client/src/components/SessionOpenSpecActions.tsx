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
import type { DashboardSession, OpenSpecChange, OpenSpecGroup, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ExploreDialog } from "./ExploreDialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { DialogPortal } from "./DialogPortal.js";
import { ArtifactLettersButton } from "./openspec-helpers.js";
import { NewChangeDialog } from "./NewChangeDialog.js";
import { SearchableSelectDialog, type SelectOption } from "./SearchableSelectDialog.js";
import { GroupedAttachDialog } from "./GroupedAttachDialog.js";
import { StatePill } from "./StatePill.js";
import { TasksPopover } from "./TasksPopover.js";

function ActionButton({ label, icon, onClick, testId, disabled }: { label: string; icon?: string; onClick: () => void; testId?: string; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={disabled}
      className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-[var(--text-secondary)] disabled:hover:border-[var(--border-secondary)]"
      data-testid={testId}
    >
      {icon && <Icon path={icon} size={0.4} className="inline mr-0.5" />}{label}
    </button>
  );
}

interface Props {
  session: DashboardSession;
  changes: OpenSpecChange[];
  onAttach: (changeName: string) => void;
  onDetach: () => void;
  onSendPrompt: (text: string, images?: ImageContent[]) => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onBulkArchive?: (cleanupWorktree?: boolean) => void;
  /** Group definitions for grouped attach dialog. */
  groups?: OpenSpecGroup[];
  /** Group assignments map. */
  assignments?: Record<string, string>;
}

export function SessionOpenSpecActions({ session, changes, onAttach, onDetach, onSendPrompt, onReadArtifact, onBulkArchive, groups, assignments }: Props) {
  const [exploreOpen, setExploreOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveAnywayConfirm, setArchiveAnywayConfirm] = useState(false);
  const [bulkArchiveConfirm, setBulkArchiveConfirm] = useState(false);
  const [cleanupWorktree, setCleanupWorktree] = useState(false);
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

  const bulkArchiveButton = hasCompletedChanges && onBulkArchive ? (
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
        onBulkArchive?.(cleanupWorktree);
        setBulkArchiveConfirm(false);
        setCleanupWorktree(false);
      }}
      onCancel={() => { setBulkArchiveConfirm(false); setCleanupWorktree(false); }}
      extra={
        <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={cleanupWorktree}
            onChange={(e) => setCleanupWorktree(e.target.checked)}
            className="rounded"
            data-testid="cleanup-worktree-checkbox"
          />
          Remove associated worktrees
        </label>
      }
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
              <ActionButton label="Change" icon={mdiPlus} onClick={() => setNewChangeOpen(true)} testId="new-change-btn" />
              <ActionButton label="Explore" icon={mdiCompassOutline} onClick={() => setExploreOpen(true)} testId="explore-unattached-btn" />
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

  return (
    <div className="mt-1 space-y-1" data-testid="session-openspec-actions">
      {/* Line 1: badge + state pill + detach + artifact letters right-aligned */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px]" data-testid="attached-badge"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" /><span className="text-blue-400">{attached}</span></span>
        <StatePill state={state} />
        <ActionButton label="Detach" icon={mdiLinkOff} onClick={onDetach} testId="detach-btn" />
        <span className="flex-1" />
        <ArtifactLettersButton artifacts={change.artifacts} changeName={change.name} onReadArtifact={onReadArtifact} />
      </div>
      {/* Line 2: action buttons driven by ChangeState */}
      {!isEnded && (() => {
        const actionsDisabled = session.status === "streaming";
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <ActionButton label="Explore" icon={mdiCompassOutline} onClick={() => setExploreOpen(true)} testId="explore-btn" disabled={actionsDisabled} />
            {state === ChangeState.PLANNING && (
              <>
                <ActionButton label="Continue" icon={mdiChevronRight} onClick={() => onSendPrompt(`/opsx:continue ${attached}`)} testId="continue-btn" disabled={actionsDisabled} />
                <ActionButton label="FF" icon={mdiFastForward} onClick={() => onSendPrompt(`/opsx:ff ${attached}`)} testId="ff-btn" disabled={actionsDisabled} />
              </>
            )}
            {(state === ChangeState.READY || state === ChangeState.IMPLEMENTING) && (
              <ActionButton label="Apply" icon={mdiPlayCircleOutline} onClick={() => onSendPrompt(`/opsx:apply ${attached}`)} testId="apply-btn" disabled={actionsDisabled} />
            )}
            {state === ChangeState.COMPLETE && (
              <>
                <ActionButton label="Verify" icon={mdiCheckCircleOutline} onClick={() => onSendPrompt(`/opsx:verify ${attached}`)} testId="verify-btn" disabled={actionsDisabled} />
                <ActionButton label="Archive" icon={mdiArchiveOutline} onClick={() => setArchiveConfirm(true)} testId="archive-btn" disabled={actionsDisabled} />
              </>
            )}
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
            onSendPrompt(`/opsx:archive ${attached}`);
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
            onSendPrompt(`/opsx:archive ${attached}`);
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
