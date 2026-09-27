import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import type { DashboardSession, ImageContent, OpenSpecChange, OpenSpecConfig, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, DEFAULT_OPENSPEC_CONFIG, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiArchiveArrowUp,
  mdiArchiveOutline,
  mdiCheckCircleOutline,
  mdiChevronRight,
  mdiCompassOutline,
  mdiDotsHorizontal,
  mdiFastForward,
  mdiFormatListChecks,
  mdiLightbulbOnOutline,
  mdiLinkOff,
  mdiPaperclip,
  mdiPlayCircleOutline,
  mdiPlus,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import React, { useEffect, useRef, useState } from "react";
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

function ActionButton({ label, icon, onClick, testId, disabled, ariaDisabled, title, variant = "neutral" }: { label: string; icon?: string; onClick: () => void; testId?: string; disabled?: boolean; /** Inert but focusable (keeps the tooltip keyboard-reachable). */ ariaDisabled?: boolean; title?: string; variant?: BtnVariant }) {
  const inert = disabled || ariaDisabled;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!inert) onClick(); }}
      disabled={disabled}
      aria-disabled={ariaDisabled ? "true" : undefined}
      title={title}
      data-testid={testId}
      data-variant={variant}
      className={`text-[10px] px-1.5 py-0.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:cursor-not-allowed ${SIDECARD_VARIANT_CLASSES[variant]}`}
    >
      {icon && <Icon path={icon} size={0.4} className="inline mr-0.5" />}{label}
    </button>
  );
}

interface OverflowItem {
  testId: string;
  label: string;
  icon: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Render a divider above this item. */
  dividerBefore?: boolean;
}

/**
 * `⋯` overflow for the attached header. Uses the client-utils `Popover`
 * (body portal — escapes the card's `isolate`). Popover gives no focus
 * management: first enabled item is focused one frame after mount (Popover
 * stays `visibility:hidden` until measured), focus returns to `⋯` on dismiss.
 * Every handler stops propagation — React events bubble out of the portal to
 * `SessionCard`'s `onClick={onSelect}` and the board's dnd listeners.
 * See change: compact-openspec-lifecycle-bar (D4).
 */
function OverflowMenu({ items }: { items: OverflowItem[] }) {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const label = i18nT("openspec.moreActions", undefined, "More actions");
  const close = (refocus: boolean) => {
    setAnchorEl(null);
    if (refocus) btnRef.current?.focus();
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-testid="openspec-overflow-btn"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={anchorEl ? "true" : "false"}
        onClick={(e) => { e.stopPropagation(); setAnchorEl(anchorEl ? null : e.currentTarget); }}
        className={`text-[10px] px-1 py-0.5 rounded border ${SIDECARD_VARIANT_CLASSES.neutral}`}
      >
        <Icon path={mdiDotsHorizontal} size={0.45} />
      </button>
      {anchorEl && (
        <Popover anchorEl={anchorEl} onDismiss={() => close(true)}>
          <OverflowMenuBody items={items} onPick={() => close(false)} stop={stop} />
        </Popover>
      )}
    </>
  );
}

function OverflowMenuBody({ items, onPick, stop }: { items: OverflowItem[]; onPick: () => void; stop: (e: React.SyntheticEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      ref={ref}
      data-testid="openspec-overflow-menu"
      onClick={stop}
      onPointerDown={stop}
      className="min-w-[170px] p-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-secondary)] shadow-lg flex flex-col"
    >
      {items.map((item) => (
        <React.Fragment key={item.testId}>
          {item.dividerBefore && <hr className="my-1 mx-0.5 border-0 border-t border-[var(--border-primary)]" />}
          <button
            type="button"
            data-testid={item.testId}
            disabled={item.disabled}
            onClick={(e) => { e.stopPropagation(); onPick(); item.onSelect(); }}
            className="flex items-center gap-2 min-h-[26px] px-2 py-1 rounded text-[11px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-surface)] focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon path={item.icon} size={0.5} />
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
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
  // Detach is never workflow-gated and survives ended/streaming/not-found.
  const detachItem: OverflowItem = {
    testId: "detach-btn",
    label: i18nT("common.detach", undefined, "Detach"),
    icon: mdiLinkOff,
    onSelect: onDetach,
    dividerBefore: true,
  };

  // Attached but change not found in data
  if (!change) {
    return (
      <div className="mt-1" data-testid="session-openspec-actions">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-tertiary)]"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" />{attached}</span>
          <span className="flex-1" />
          <OverflowMenu items={[detachItem]} />
        </div>
        {replaceDialog}
      </div>
    );
  }

  const state = deriveChangeState(change);
  // `skipped` (skip_specs change) satisfies — mirrors the CLI's isPlanningComplete.
  const allArtifactsDone = change.artifacts.length > 0 && change.artifacts.every((a) => a.status === "done" || a.status === "skipped");
  const hasParseableTasks = change.totalTasks > 0;
  const showArchiveAnyway =
    state === ChangeState.IMPLEMENTING && change.isComplete === true && allArtifactsDone;
  const uncheckedCount = Math.max(0, change.totalTasks - change.completedTasks);

  const streaming = session.status === "streaming";
  const streamingTip = i18nT("session.sessionIsStreaming", undefined, "Session is streaming");
  const send = (skill: string) => () => onSendPrompt(`/skill:${skill} ${attached}`);

  // One primary per ChangeState: first workflow-enabled candidate wins; the
  // rest of the candidates move into ⋯. See change: compact-openspec-lifecycle-bar (D4b).
  type Candidate = { wf: string; testId: string; label: string; icon: string; onSelect: () => void; variant: BtnVariant };
  const C = {
    continue: { wf: "continue", testId: "continue-btn", label: i18nT("common.continue", undefined, "Continue"), icon: mdiChevronRight, onSelect: send("openspec-continue-change"), variant: "primary" },
    ff: { wf: "ff", testId: "ff-btn", label: i18nT("openspec.ff", undefined, "FF"), icon: mdiFastForward, onSelect: send("openspec-ff-change"), variant: "primary" },
    apply: { wf: "apply", testId: "apply-btn", label: i18nT("common.apply", undefined, "Apply"), icon: mdiPlayCircleOutline, onSelect: send("openspec-apply-change"), variant: "primary" },
    archive: { wf: "archive", testId: "archive-btn", label: i18nT("openspec.archive", undefined, "Archive"), icon: mdiArchiveOutline, onSelect: () => setArchiveConfirm(true), variant: "accent" },
    verify: { wf: "verify", testId: "verify-btn", label: i18nT("common.verify", undefined, "Verify"), icon: mdiCheckCircleOutline, onSelect: send("openspec-verify-change"), variant: "success" },
  } satisfies Record<string, Candidate>;
  const candidatesByState: Record<ChangeState, Candidate[]> = {
    [ChangeState.PLANNING]: [C.continue, C.ff],
    [ChangeState.READY]: [C.apply],
    [ChangeState.IMPLEMENTING]: [C.apply],
    [ChangeState.COMPLETE]: [C.archive, C.verify],
  };
  const enabled = isEnded ? [] : candidatesByState[state].filter((c) => wf(c.wf));
  const primary = enabled[0];
  const menuItems: OverflowItem[] = isEnded
    ? [{ ...detachItem, dividerBefore: false }]
    : [
        ...enabled.slice(1).map((c) => ({ testId: c.testId, label: c.label, icon: c.icon, onSelect: c.onSelect, disabled: streaming })),
        ...(showArchiveAnyway && wf("archive")
          ? [{ testId: "archive-anyway-btn", label: i18nT("openspec.archiveAnyway", undefined, "Archive anyway"), icon: mdiArchiveArrowUp, onSelect: () => setArchiveAnywayConfirm(true), disabled: streaming }]
          : []),
        ...(wf("explore")
          ? [{ testId: "explore-menu-item", label: i18nT("openspec.exploreChange", undefined, "Explore…"), icon: mdiCompassOutline, onSelect: () => setExploreOpen(true), disabled: streaming }]
          : []),
        detachItem,
      ];
  // Archive segment mirrors the primary's gate (D6); Tasks locked while streaming (D4d).
  const canArchive = state === ChangeState.COMPLETE && !streaming && !isEnded && wf("archive");

  return (
    <div className="mt-1 space-y-0.5" data-testid="session-openspec-actions">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[11px] truncate min-w-0" data-testid="attached-badge"><Icon path={mdiPaperclip} size={0.4} className="inline mr-0.5" /><span className="text-blue-400">{attached}</span></span>
        <span className="flex-1" />
        {primary && (
          <ActionButton
            label={primary.label}
            icon={primary.icon}
            onClick={primary.onSelect}
            testId={primary.testId}
            ariaDisabled={streaming}
            title={streaming ? streamingTip : undefined}
            variant={primary.variant}
          />
        )}
        <OverflowMenu items={menuItems} />
      </div>
      <OpenSpecStepper
        variant="sidebar"
        change={change}
        onReadArtifact={onReadArtifact}
        onOpenTasks={hasParseableTasks && !streaming ? () => setTasksOpen(true) : undefined}
        onArchive={canArchive ? () => setArchiveConfirm(true) : undefined}
      />

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
          testId="archive-confirm"
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
    </div>
  );
}
