import {
  ComposerContextGroupSlot,
  SessionCardBadgeSlot,
  ToolbarGroup,
  useSlotHasClaimsForSession,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import type {
  DashboardSession,
  ImageContent,
  OpenSpecChange,
  OpenSpecConfig,
  OpenSpecGroup,
  OpenSpecReadiness,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, DEFAULT_OPENSPEC_CONFIG, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiFileDocumentOutline, mdiLinkOff, mdiMenuDown, mdiPaperclip } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { Suspense, useEffect, useRef, useState } from "react";
import { isMergePrimary } from "../../lib/git/merge-primary.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useAttachmentResolution } from "../../lib/openspec/useAttachmentResolution.js";
import { AttachmentTrace, isLiveActive } from "../openspec/AttachmentTrace.js";
import { LazyAttachChangePicker, LazyExploreDialog, LazyNewChangeDialog, LazyProposeDialog, LazyTasksPopover } from "../openspec/lazy-openspec-dialogs.js";
import { OpenSpecStepper } from "../openspec/OpenSpecStepper.js";
import { type ActionSpec, deriveOpenSpecActions, type OpenSpecActionKey } from "../openspec/openspec-actions.js";
import { type OverflowItem, OverflowMenu } from "../openspec/SessionOpenSpecActions.js";
import { DialogPortal } from "../primitives/DialogPortal.js";
import { WorktreeActionsMenu } from "../worktree/WorktreeActionsMenu.js";

/**
 * ComposerSessionActions — the composer context strip above the message
 * card: one labelled `ToolbarGroup` per concern (OpenSpec · Git · plugin
 * context groups · Status), spaced wider apart than the items inside them.
 *
 * - OpenSpec: #745's model — the 5-segment lifecycle bar in letters mode, ONE
 *   primary per `ChangeState` and a `⋯` overflow, derived by the same
 *   `deriveOpenSpecActions` as the session card. The change chip is the
 *   attach/detach surface (unattached: dashed "Attach change…").
 * - Git: worktree identity (branch, base, drift) + the PR status segment and
 *   PR-state-dependent actions (`WorktreeActionsMenu` in segments mode).
 * - Merge emphasis is decided ONCE here (`isMergePrimary`) and passed to both
 *   groups, so exactly one filled primary shows.
 * - Working = streaming ∨ retrying gates every action (aria-disabled, focusable).
 *
 * See changes: redesign-session-card-and-composer, compact-openspec-lifecycle-bar,
 *              redesign-composer-session-strip (D1–D4, D6, D8, D9).
 */
interface Props {
  session?: DashboardSession;
  changes?: OpenSpecChange[];
  openspecHasDir?: boolean;
  openspecPending?: boolean;
  /**
   * Server-derived readiness for the composer session's cwd. When present it
   * governs the OpenSpec group: only PENDING and READY render it.
   * `undefined` (older server) degrades to `hasDir !== false || pending`.
   * See change: add-openspec-init-affordances (D6/D7).
   */
  openspecReadiness?: OpenSpecReadiness;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onAttach?: (changeName: string) => void;
  onDetach?: () => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onBulkArchive?: () => void;
  onRefresh?: () => void;
  allSessions?: DashboardSession[];
  onShutdownSession?: (sessionId: string) => void;
  showGitInfo?: boolean;
  /** OpenSpec workflow config — gates which actions render. */
  openspecConfig?: OpenSpecConfig;
  /** Folder groups for the grouped attach picker (same source as the card). */
  groups?: OpenSpecGroup[];
  assignments?: Record<string, string>;
  /**
   * streaming ∨ retrying (design D9). Defaults to `status === "streaming"`.
   * See change: redesign-composer-session-strip.
   */
  working?: boolean;
}

type Tone = "primary" | "success" | "info" | "accent" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  primary: "text-blue-400 hover:text-blue-300",
  success: "text-green-400 hover:text-green-300",
  info: "text-cyan-400 hover:text-cyan-300",
  accent: "text-purple-400 hover:text-purple-300",
  neutral: "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
};

/** Borderless group segment (≥ 24 px target). Blocked = aria-disabled, focusable. */
function SegmentButton({
  icon,
  label,
  onClick,
  blocked,
  disabled,
  title,
  testId,
  tone = "neutral",
  emphasis,
  buttonRef,
  ariaHasPopup,
  ariaExpanded,
  dashed,
}: {
  icon: string;
  label?: React.ReactNode;
  onClick: () => void;
  blocked?: boolean;
  disabled?: boolean;
  title?: string;
  testId?: string;
  tone?: Tone;
  emphasis?: "filled" | "outlined";
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaHasPopup?: "dialog" | "menu";
  ariaExpanded?: boolean;
  dashed?: boolean;
}) {
  const filled = emphasis === "filled" && !blocked && !disabled;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (!blocked && !disabled) onClick();
      }}
      disabled={disabled}
      aria-disabled={blocked ? "true" : undefined}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded === undefined ? undefined : ariaExpanded ? "true" : "false"}
      title={title}
      data-testid={testId}
      data-tone={tone}
      data-emphasis={emphasis && (filled ? "filled" : "outlined")}
      className={`inline-flex items-center gap-0.5 self-stretch min-h-6 min-w-6 px-2 text-[10px] bg-transparent hover:bg-[var(--bg-hover)] disabled:opacity-40 disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:cursor-not-allowed ${TONE_TEXT[tone]}${
        dashed ? " outline-1 outline-dashed -outline-offset-4 outline-[var(--border-secondary)]" : ""
      }${filled ? " font-semibold !bg-[var(--accent-soft)] !text-[var(--text-primary)]" : ""}`}
    >
      <Icon path={icon} size={0.45} />
      {label !== undefined && <span className="truncate">{label}</span>}
    </button>
  );
}

/**
 * Attached change chip: the change name (+ ▾) opening a body-portalled
 * popover with Open proposal / Detach. Focus moves to the first item on open
 * and back to the chip on close. No "Switch change": detach, then attach.
 * See change: redesign-composer-session-strip (D3).
 */
function ChangeChip({
  name,
  onOpenProposal,
  onDetach,
  showOpenProposal = true,
}: {
  name: string;
  onOpenProposal?: () => void;
  onDetach?: () => void;
  /** False for an archived / main-checkout attachment: the active-preview route would not find it. */
  showOpenProposal?: boolean;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = (refocus: boolean) => {
    setAnchorEl(null);
    if (refocus) chipRef.current?.focus();
  };
  useEffect(() => {
    if (!anchorEl) return;
    const id = requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [anchorEl]);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const item = (testId: string, icon: string, label: string, onSelect?: () => void) => (
    <button
      type="button"
      data-testid={testId}
      disabled={!onSelect}
      onClick={(e) => {
        e.stopPropagation();
        close(true);
        onSelect?.();
      }}
      className="flex items-center gap-2 min-h-[26px] px-2 py-1 rounded text-[11px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-surface)] focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Icon path={icon} size={0.5} />
      {label}
    </button>
  );
  return (
    <>
      <SegmentButton
        buttonRef={chipRef}
        icon={mdiPaperclip}
        label={
          <>
            <span className="inline-block max-w-[18ch] truncate align-bottom">{name}</span>
            <Icon path={mdiMenuDown} size={0.45} className="inline" />
          </>
        }
        title={name}
        testId="composer-change-chip"
        tone="primary"
        ariaHasPopup="dialog"
        ariaExpanded={!!anchorEl}
        onClick={() => setAnchorEl(anchorEl ? null : chipRef.current)}
      />
      {anchorEl && (
        <Popover anchorEl={anchorEl} onDismiss={() => close(true)}>
          <div
            ref={menuRef}
            data-testid="composer-change-menu"
            onClick={stop}
            onPointerDown={stop}
            className="min-w-[160px] p-1 rounded-md border border-[var(--border-strong)] bg-[var(--bg-secondary)] shadow-lg flex flex-col"
          >
            {showOpenProposal && item("composer-change-open-proposal", mdiFileDocumentOutline, i18nT("openspec.openProposal", undefined, "Open proposal"), onOpenProposal)}
            {item("composer-change-detach", mdiLinkOff, i18nT("common.detach", undefined, "Detach"), onDetach)}
          </div>
        </Popover>
      )}
    </>
  );
}

/**
 * Worktree identity from existing fields (design D4). Every marker carries a
 * text alternative; "no local changes" never claims "in sync" (ahead/behind
 * are 0 without an upstream).
 */
function GitIdentity({ session }: { session: DashboardSession }) {
  const wt = session.gitWorktree;
  const st = session.gitStatus;
  const title = wt ? `${wt.name} — ${wt.mainPath}` : undefined;
  const clean = st && st.dirtyCount === 0 && st.ahead === 0 && st.behind === 0;
  const noChanges = i18nT("git.noLocalChanges", undefined, "no local changes");
  return (
    <span
      data-testid="composer-git-identity"
      title={title}
      className="inline-flex items-center gap-1.5 px-2 min-h-6 text-[10px] text-[var(--text-secondary)] min-w-0"
    >
      {session.gitBranch && (
        <span data-testid="composer-git-branch" className="truncate max-w-[24ch]">
          <span aria-hidden="true">⎇ </span>
          {session.gitBranch}
        </span>
      )}
      {wt?.base && (
        <span data-testid="composer-git-base" className="text-[var(--text-muted)]">
          <span aria-hidden="true">← </span>
          <span className="sr-only">{i18nT("git.fromBase", undefined, "from")} </span>
          {wt.base}
        </span>
      )}
      {st && st.dirtyCount > 0 && (
        <span
          data-testid="composer-git-dirty"
          className="text-orange-400"
          title={i18nT("git.changedFiles", { count: st.dirtyCount }, "{count} changed files")}
        >
          <span aria-hidden="true">● {st.dirtyCount}</span>
          <span className="sr-only">{i18nT("git.changedFiles", { count: st.dirtyCount }, "{count} changed files")}</span>
        </span>
      )}
      {st && st.ahead > 0 && (
        <span data-testid="composer-git-ahead" title={i18nT("git.commitsAhead", { count: st.ahead }, "{count} commits ahead")}>
          <span aria-hidden="true">↑{st.ahead}</span>
          <span className="sr-only">{i18nT("git.commitsAhead", { count: st.ahead }, "{count} commits ahead")}</span>
        </span>
      )}
      {st && st.behind > 0 && (
        <span data-testid="composer-git-behind" title={i18nT("git.commitsBehind", { count: st.behind }, "{count} commits behind")}>
          <span aria-hidden="true">↓{st.behind}</span>
          <span className="sr-only">{i18nT("git.commitsBehind", { count: st.behind }, "{count} commits behind")}</span>
        </span>
      )}
      {clean && (
        <span data-testid="composer-git-clean" className="text-green-400" title={noChanges}>
          <span aria-hidden="true">✓</span>
          <span className="sr-only">{noChanges}</span>
        </span>
      )}
    </span>
  );
}

const OVERFLOW_BTN_CLASS =
  "inline-flex items-center justify-center self-stretch min-h-6 min-w-6 px-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";

export function ComposerSessionActions({
  session,
  changes,
  openspecHasDir,
  openspecPending,
  openspecReadiness,
  onSendPrompt,
  onAttach,
  onDetach,
  onReadArtifact,
  showGitInfo,
  allSessions,
  onShutdownSession,
  openspecConfig,
  groups,
  assignments,
  working: workingProp,
}: Props) {
  const cfg = openspecConfig ?? DEFAULT_OPENSPEC_CONFIG;
  const wf = (name: string) => cfg.workflows.includes(name);
  // Hooks must run unconditionally.
  const safeSession = session ?? (undefined as unknown as DashboardSession);
  const hasBadge = useSlotHasClaimsForSession("session-card-badge", safeSession);
  // Read-only plugin context groups (e.g. quota) render between GIT and STATUS.
  // See change: move-quota-to-context-strip (design D3b).
  const hasContextGroup = useSlotHasClaimsForSession("composer-context-group", safeSession);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState(false);
  const [archiveAnywayConfirm, setArchiveAnywayConfirm] = useState(false);
  const [newChangeOpen, setNewChangeOpen] = useState(false);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);
  // active (own cwd) | archived | missing | unresolved. See change: resolve-archived-attached-proposal.
  const resolution = useAttachmentResolution(session, changes);

  if (!session) return null;

  const attached = session.attachedProposal ?? null;
  const change = resolution?.kind === "active" && isLiveActive(resolution, session.cwd) ? resolution.change : undefined;
  // Archived / not-found / in-main-checkout attachments stay traceable even when
  // the cwd's own OpenSpec state would hide the strip (ended, removed worktree).
  const showTrace =
    !!attached && !!resolution && resolution.kind !== "unresolved" && !isLiveActive(resolution, session.cwd);
  const changeState = change ? deriveChangeState(change) : undefined;
  const working = workingProp ?? session.status === "streaming";
  const isEnded = session.status === "ended";

  const showOpenSpec =
    showTrace ||
    (!isEnded &&
      (openspecReadiness
        ? openspecReadiness.state === "READY" || openspecReadiness.state === "PENDING"
        : openspecHasDir !== false || openspecPending === true));
  const showStatus = hasBadge;
  const showGit = (!!showGitInfo || !!session.gitWorktree) && !!session.gitWorktree;

  // Nothing to render? Bail early so we don't add an empty strip.
  if (!showOpenSpec && !showStatus && !showGit && !hasContextGroup) return null;

  // One Merge-emphasis decision for this surface (design D6).
  const mergeIsPrimary = isMergePrimary({
    hasWorktree: !!session.gitWorktree,
    prState: session.gitPrState,
    prDraft: session.gitPrDraft,
    prChecks: session.gitPrChecks,
    prCheckedAt: session.gitPrCheckedAt,
    working,
    attached: !!attached,
    attachedChangeState: changeState,
  });

  const allArtifactsDone =
    !!change && change.artifacts.length > 0 && change.artifacts.every((a) => a.status === "done" || a.status === "skipped");
  const showArchiveAnyway = changeState === ChangeState.IMPLEMENTING && change?.isComplete === true && allArtifactsDone;
  const actions = deriveOpenSpecActions({
    attached: !!attached,
    found: !!change,
    state: changeState,
    wf,
    isEnded,
    working,
    showArchiveAnyway,
    includeDetach: false,
    idPrefix: "composer-",
  });
  const send = (skill: string) => () => onSendPrompt?.(`/skill:${skill} ${attached}`);
  const handlers: Record<OpenSpecActionKey, () => void> = {
    continue: send("openspec-continue-change"),
    ff: send("openspec-ff-change"),
    apply: send("openspec-apply-change"),
    archive: () => setArchiveConfirm(true),
    verify: send("openspec-verify-change"),
    archiveAnyway: () => setArchiveAnywayConfirm(true),
    explore: () => setExploreOpen(true),
    detach: () => onDetach?.(),
    new: () => setNewChangeOpen(true),
    propose: () => setProposeOpen(true),
  };
  const label = (a: ActionSpec) => i18nT(a.labelKey, undefined, a.labelFallback);
  const reason = (a: ActionSpec) => (a.blockedReasonKey ? i18nT(a.blockedReasonKey, undefined, "Session is streaming") : undefined);
  const toItem = (a: ActionSpec): OverflowItem => ({
    testId: a.testId,
    label: label(a),
    icon: a.icon,
    onSelect: handlers[a.key],
    disabled: a.blocked,
    disabledReason: reason(a),
    dividerBefore: a.dividerBefore,
  });
  const segment = (a: ActionSpec, emphasis?: "filled" | "outlined") => (
    <SegmentButton
      key={a.key}
      icon={a.icon}
      label={label(a)}
      onClick={handlers[a.key]}
      blocked={a.blocked}
      title={reason(a)}
      testId={a.testId}
      tone={a.variant}
      emphasis={emphasis}
    />
  );

  const hasParseableTasks = (change?.totalTasks ?? 0) > 0;
  const canArchive = changeState === ChangeState.COMPLETE && !working && !isEnded && wf("archive");

  const openspecContent = attached ? (
    <>
      <ChangeChip
        name={attached}
        onOpenProposal={onReadArtifact ? () => onReadArtifact(attached, "proposal") : undefined}
        onDetach={onDetach}
        showOpenProposal={!showTrace}
      />
      {showTrace && <AttachmentTrace resolution={resolution} sessionCwd={session.cwd} />}
      {change && (
        <div
          data-testid="composer-lifecycle"
          className="flex-shrink-0 flex items-center px-1 self-stretch"
          style={{ width: "var(--composer-lifecycle-w)" }}
        >
          <OpenSpecStepper
            variant="sidebar"
            testIdPrefix="composer-"
            change={change}
            onReadArtifact={onReadArtifact}
            onOpenTasks={hasParseableTasks && !working ? () => setTasksOpen(true) : undefined}
            onArchive={canArchive ? () => setArchiveConfirm(true) : undefined}
          />
        </div>
      )}
      {actions.primary && segment(actions.primary, mergeIsPrimary ? "outlined" : "filled")}
      {actions.overflow.length > 0 && (
        <OverflowMenu items={actions.overflow.map(toItem)} idPrefix="composer-" ariaDisabled buttonClassName={OVERFLOW_BTN_CLASS} />
      )}
    </>
  ) : (
    <>
      <SegmentButton
        icon={mdiPaperclip}
        label={
          (changes?.length ?? 0) === 0
            ? i18nT("openspec.noChanges", undefined, "No changes")
            : i18nT("openspec.attachChange", undefined, "Attach change...")
        }
        onClick={() => setAttachPickerOpen(true)}
        disabled={(changes?.length ?? 0) === 0 || !onAttach}
        testId="composer-attach-chip"
        ariaHasPopup="dialog"
        dashed
      />
      {actions.unattached.filter((a) => a.key === "explore").map((a) => segment(a))}
      {actions.unattached.some((a) => a.key !== "explore") && (
        <OverflowMenu
          items={actions.unattached.filter((a) => a.key !== "explore").map(toItem)}
          idPrefix="composer-"
          ariaDisabled
          buttonClassName={OVERFLOW_BTN_CLASS}
        />
      )}
    </>
  );

  return (
    <div data-testid="composer-session-actions" className="flex items-start gap-x-2.5 gap-y-1 flex-wrap min-w-0">
      {showOpenSpec && (
        <ToolbarGroup
          label={i18nT("openspec.openspec", undefined, "OpenSpec")}
          testId="composer-openspec-container"
          labelTestId="composer-openspec-group-label"
        >
          {openspecContent}
        </ToolbarGroup>
      )}

      {showGit && (
        <ToolbarGroup
          label={i18nT("git.git", undefined, "Git")}
          testId="composer-git-container"
          labelTestId="composer-git-group-label"
          contentProps={{ "data-testid": "composer-git-group" }}
        >
          <GitIdentity session={session} />
          <WorktreeActionsMenu
            session={session}
            allSessions={allSessions ?? []}
            onShutdownSession={onShutdownSession ?? (() => { /* unwired */ })}
            disabled={working}
            mergeIsPrimary={mergeIsPrimary}
            appearance="segments"
          />
        </ToolbarGroup>
      )}

      {hasContextGroup && (
        // Read-only context groups (after GIT, before STATUS). Deliberately
        // OUTSIDE the working-gated Status fieldset: usage/context must stay
        // visible exactly while the session is running.
        // See change: move-quota-to-context-strip (design D1/D4).
        <ComposerContextGroupSlot session={session} />
      )}

      {showStatus && (
        // The fieldset IS the group content: `disabled` natively gates every
        // plugin-rendered control while working, and an all-null badge slot
        // leaves it `:empty` so the whole group hides (index.css, D8).
        <ToolbarGroup
          label={i18nT("session.subcardStatus", undefined, "STATUS")}
          testId="composer-status-container"
          labelTestId="composer-status-group-label"
          contentAs="fieldset"
          contentProps={{ disabled: working, "data-testid": "composer-status-group" }}
        >
          <SessionCardBadgeSlot session={session} />
        </ToolbarGroup>
      )}

      {tasksOpen && attached && <Suspense fallback={null}><LazyTasksPopover cwd={session.cwd} change={attached} onClose={() => setTasksOpen(false)} /></Suspense>}
      {exploreOpen && (
        <DialogPortal>
          <Suspense fallback={null}><LazyExploreDialog
            changeName={attached ?? ""}
            onSend={(text, images) => {
              const prefix = attached ? `/skill:openspec-explore ${attached}\n` : `/skill:openspec-explore\n`;
              onSendPrompt?.(`${prefix}${text}`, images);
              setExploreOpen(false);
            }}
            onClose={() => setExploreOpen(false)}
          /></Suspense>
        </DialogPortal>
      )}
      {newChangeOpen && (
        <DialogPortal>
          <Suspense fallback={null}><LazyNewChangeDialog
            onSend={(prompt) => {
              onSendPrompt?.(prompt);
              setNewChangeOpen(false);
            }}
            onClose={() => setNewChangeOpen(false)}
          /></Suspense>
        </DialogPortal>
      )}
      {proposeOpen && (
        <DialogPortal>
          <Suspense fallback={null}><LazyProposeDialog
            onSend={(prompt) => {
              onSendPrompt?.(prompt);
              setProposeOpen(false);
            }}
            onClose={() => setProposeOpen(false)}
          /></Suspense>
        </DialogPortal>
      )}
      {attachPickerOpen && onAttach && (
        <Suspense fallback={null}><LazyAttachChangePicker
          changes={changes ?? []}
          groups={groups}
          assignments={assignments}
          onSelect={(name) => {
            onAttach(name);
            setAttachPickerOpen(false);
          }}
          onCancel={() => setAttachPickerOpen(false)}
        /></Suspense>
      )}
      {archiveConfirm && attached && (
        <Confirm
          open
          title={i18nT("openspec.archiveChange", undefined, "Archive change?")}
          message={i18nT("openspec.archiveConfirmMessage", { name: attached }, 'Archive "{name}"?')}
          confirmLabel={i18nT("openspec.archive", undefined, "Archive")}
          onConfirm={() => {
            onSendPrompt?.(`/skill:openspec-archive-change ${attached}`);
            setArchiveConfirm(false);
          }}
          onClose={() => setArchiveConfirm(false)}
        />
      )}
      {archiveAnywayConfirm && attached && change && (
        <Confirm
          open
          title={i18nT("openspec.archiveAnyway2", undefined, "Archive anyway?")}
          message={i18nT(
            "openspec.archiveAnywayMessage",
            { unchecked: Math.max(0, change.totalTasks - change.completedTasks), total: change.totalTasks },
            "{unchecked} of {total} tasks are unchecked. Archive anyway?",
          )}
          confirmLabel={i18nT("openspec.archiveAnyway", undefined, "Archive anyway")}
          onConfirm={() => {
            onSendPrompt?.(`/skill:openspec-archive-change ${attached}`);
            setArchiveAnywayConfirm(false);
          }}
          onClose={() => setArchiveAnywayConfirm(false)}
        />
      )}
    </div>
  );
}
