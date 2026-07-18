import { mdiAlertOutline, mdiClose, mdiCommentQuestion, mdiConsoleLine, mdiEyeOffOutline, mdiEyeOutline, mdiFlash, mdiLoading, mdiPaperclip, mdiPencil, mdiPencilOutline, mdiPlay, mdiPlayCircleOutline, mdiPlus, mdiSourceBranch, mdiSourceBranchPlus, mdiSourceFork } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import {
  deriveDotColorWithFlags,
  deriveIconStatusColor,
  deriveRailBgColor,
  deriveStatusShape,
  getCardPulseClass,
  getCardStripeFxClass,
  type StatusShape,
  sourceBadgeColors as sourceBadgeColorsExt,
  sourceIcons,
  sourceLabels,
  statusColors as statusColorsExt,
  statusShapeIcon,
} from "../../lib/session/session-status-visuals.js";

// Re-export the relocated card-state helpers so existing test imports that
// reference them from SessionCard resolve unchanged.
// See change: port-session-card-state-visuals-to-openspec-board.
export { getCardPulseClass, getCardStripeFxClass } from "../../lib/session/session-status-visuals.js";

// Re-export for any downstream consumers that historically imported these
// from SessionCard. See change: add-session-status-to-folder-proposal-rows.
export const statusColors = statusColorsExt;
export const sourceBadgeColors = sourceBadgeColorsExt;

import { SessionCardActionBarSlot, SessionCardBadgeSlot, SessionCardFlowsSlot, SessionCardMemorySlot, useHasWidgetBarPrompt, useSlotHasClaimsForSession, WorktreeCardSectionSlot } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CommandInfo, DashboardSession, GitStatus, ImageContent, OpenSpecChange, OpenSpecData, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useDisplayPrefs } from "../../hooks/useDisplayPrefs.js";
import { useFxVisibility } from "../../hooks/useFxVisibility.js";
import type { InflightBashTool } from "../../hooks/useInflightBashTools.js";
import { useMobile } from "../../hooks/useMobile.js";
import { formatRelativeTime, formatTokens } from "../../lib/util/format.js";
import { refreshGitStatus, setCachedGitStatus, useGitStatus } from "../../lib/git/git-status-cache.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useOpenSpecConfig } from "../../lib/openspec/openspec-config-api.js";
import { selectBadgeTimestamp } from "../../lib/session/session-card-time.js";
import { getSessionDisplayName } from "../../lib/session/session-display-name.js";
import { useCommitDialog } from "../worktree/CommitDialog.js";
import { ContextUsageBar } from "./ContextUsageBar.js";
import { CwdGonePill } from "../folder/CwdGonePill.js";
// flows-plugin components (FlowActivityBadge, SessionFlowActions) are
// rendered exclusively via plugin slot consumers (SessionCardBadgeSlot /
// SessionCardActionBarSlot) per change pluginize-flows-via-registry.
import { CollapseSummary } from "../chat/collapse-summary.js";
import { GitDirtyPill } from "../worktree/GitDirtyPill.js";
import { InlineRenameInput } from "../primitives/InlineRenameInput.js";
import { OpenSpecActivityBadge } from "../openspec/OpenSpecActivityBadge.js";
import { type ProcessEntry, ProcessList } from "../terminal/ProcessList.js";
import { formatElapsed, SessionActivityBar, truncateCommand } from "./SessionActivityBar.js";
import type { ContextUsageInfo } from "./SessionList.js";
import { SessionOpenSpecActions } from "../openspec/SessionOpenSpecActions.js";
import { SessionSubcard } from "./SessionSubcard.js";
import { useSessionCardDragHandle } from "./SortableSessionCard.js";
import { TagStrip } from "../tags/TagStrip.js";
import { WorktreeActionsMenu } from "../worktree/WorktreeActionsMenu.js";

export function ActivityIndicator({ session }: { session: DashboardSession }) {
  // Suppress chat-routed indicators when a widget-bar slot owns the prompt.
  // Plugin-agnostic via the `placement` primitive. See change:
  // fix-flows-plugin-polish (B1).
  const hasWidgetBarPrompt = useHasWidgetBarPrompt(session.id);

  if (session.resuming) {
    return <span className="text-yellow-400">{i18nT("common.resuming", undefined, "Resuming…")}</span>;
  }

  if (session.status === "ended") return null;

  if (session.currentTool === "ask_user" && !hasWidgetBarPrompt) {
    // Blocked-on-you: distinct "Needs you" label + needs-you color + icon.
    // See change: improve-dashboard-attention-routing.
    return <span className="text-[var(--status-needs-you)] truncate inline-flex items-center gap-0.5"><Icon path={mdiCommentQuestion} size={0.5} /> {i18nT("common.needsYou", undefined, "Needs you")}</span>;
  }

  if (session.currentTool) {
    return <span className="text-[var(--status-working)] truncate inline-flex items-center gap-0.5"><Icon path={mdiFlash} size={0.5} /> {session.currentTool}</span>;
  }

  if (session.status === "streaming") {
    return <span className="text-[var(--status-working)]">{i18nT("session.thinking", undefined, "Thinking…")}</span>;
  }

  if (session.status === "idle" || session.status === "active") {
    // Turn-finished passive state: distinct "Idle" label, never "Waiting for
    // input". See change: improve-dashboard-attention-routing.
    return <span className="text-[var(--text-tertiary)]">{i18nT("status.idle", undefined, "Idle")}</span>;
  }

  return null;
}

/**
 * Small shape marker overlaid on the status icon. Encodes session state by
 * shape (filled / half / ring / ✕) so state survives grayscale + reduced
 * motion. `ended` renders nothing. The `data-status-shape` attribute is the
 * test hook. See change: improve-dashboard-attention-routing.
 */
export function StatusShapeBadge({ shape, colorClass }: { shape: StatusShape; colorClass: string }) {
  const path = statusShapeIcon[shape];
  if (!path) return null;
  return (
    <span
      data-status-shape={shape}
      aria-hidden="true"
      className={`absolute -bottom-1 -right-1 inline-flex rounded-full bg-[var(--bg-tertiary)] leading-none ${colorClass}`}
    >
      <Icon path={path} size={0.34} />
    </span>
  );
}

export function TokenStats({ session }: { session: DashboardSession }) {
  const hasStats = (session.tokensIn ?? 0) > 0 || (session.tokensOut ?? 0) > 0;
  if (!hasStats) return null;

  return (
    <span className="text-[var(--text-tertiary)] whitespace-nowrap">
      {formatTokens(session.tokensIn ?? 0)}↑ {formatTokens(session.tokensOut ?? 0)}↓
      {(session.cacheRead ?? 0) > 0 && (
        <span className="ml-1">R{formatTokens(session.cacheRead ?? 0)}</span>
      )}
      {(session.cacheWrite ?? 0) > 0 && (
        <span className="ml-1">W{formatTokens(session.cacheWrite ?? 0)}</span>
      )}
      {session.cost != null && session.cost > 0 && (
        <span className="ml-1">${session.cost.toFixed(2)}</span>
      )}
    </span>
  );
}

export function GitInfo({ session }: { session: DashboardSession }) {
  const dirtyStatus = useGitStatus(session.cwd, session.gitStatus);
  const { open: openCommitDialog } = useCommitDialog();
  // On-demand fresh read on mount/focus so the pill is not up-to-30s stale.
  useEffect(() => { void refreshGitStatus(session.cwd); }, [session.cwd]);
  // Fold each broadcast into the shared per-cwd cache so the folder header and
  // a solo card at the same path converge on one value.
  useEffect(() => {
    if (session.gitStatus) setCachedGitStatus(session.cwd, session.gitStatus);
  }, [session.cwd, session.gitStatus]);
  if (!session.gitBranch) return null;

  return (
    <div className="text-[11px] mt-0.5 ml-4 flex items-center gap-1.5 text-[var(--text-tertiary)]">
      <Icon path={mdiSourceBranch} size={0.5} />
      {session.gitBranchUrl ? (
        <a href={session.gitBranchUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
          {session.gitBranch}
        </a>
      ) : (
        <span className="truncate">{session.gitBranch}</span>
      )}
      {session.gitPrNumber != null && (
        <>
          <span className="text-[var(--text-muted)]">·</span>
          {session.gitPrUrl ? (
            <a href={session.gitPrUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              #{session.gitPrNumber}
            </a>
          ) : (
            <span>#{session.gitPrNumber}</span>
          )}
        </>
      )}
      <WorktreePill session={session} />
      <CwdGonePill session={session} />
      <GitDirtyPill status={dirtyStatus} onClick={() => openCommitDialog(session.cwd, session.id)} />
    </div>
  );
}

/**
 * Inline `worktree` pill that appears immediately after the branch/PR
 * line on the WORKSPACE subcard when the session's cwd is a git worktree.
 * Branch text on the GitInfo line is unchanged — branches remain the
 * primary identity; the pill is supplementary.
 *
 * Hover/long-press shows `created from <base>` when the worktree's base
 * ref is known (set at spawn time by the dashboard's worktree dialog),
 * otherwise the generic `git worktree`.
 *
 * See change: add-worktree-spawn-dialog.
 */
export function WorktreePill({ session }: { session: DashboardSession }) {
  const wt = session.gitWorktree;
  if (!wt) return null;
  const title = wt.base ? i18nT("worktree.createdFrom", { base: wt.base }, "created from {base}") : i18nT("worktree.gitWorktree", undefined, "git worktree");
  return (
    <span
      data-testid="worktree-pill"
      title={title}
      className="inline-flex items-center px-1.5 py-px rounded-full text-[9px] uppercase tracking-wider border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-tertiary)]"
    >
      <span>worktree</span>
      {wt.name && (
        <>
          <span className="mx-1 text-[var(--text-muted)] opacity-60">·</span>
          <span data-testid="worktree-pill-name" className="normal-case tracking-normal text-[var(--text-secondary)]">
            {wt.name}
          </span>
        </>
      )}
    </span>
  );
}

// Simple cache to avoid redundant fetches across re-renders.
// Exported so the BranchSwitchDialog can invalidate on close.
export const branchCache = new Map<string, { branch: string | null; noGit: boolean }>();

interface GroupGitInfoProps {
  sessions: DashboardSession[];
  cwd: string;
  /**
   * Folder's own HEAD branch from the server folder-head poll/watcher
   * (`git_head_update`). Precedence: `undefined` = no folder-HEAD entry yet
   * (fall back to child-session branch / REST seed); a string = the folder's
   * branch (outranks any child-session branch, e.g. a leaked worktree
   * branch); `null` = folder confirmed non-git (render the "Init git" state).
   * See change: refresh-folder-header-branch.
   */
  folderBranch?: string | null;
  onBranchClick?: () => void;
  /**
   * Folder-head working-tree status (from the folder-head poll). Rendered as
   * ONE dirty/drift pill + Commit action for all same-cwd sessions, never
   * duplicated on the child cards. See change:
   * add-session-uncommitted-indicator-and-commit.
   */
  folderStatus?: GitStatus;
}

export function GroupGitInfo({ sessions, cwd, folderBranch, onBranchClick, folderStatus }: GroupGitInfoProps) {
  // Folder status: prefer the explicit folder-head value, else any same-cwd
  // session's broadcast (all share one tree → identical). One on-demand read
  // per cwd erases staleness; no per-session redundancy.
  const seededStatus = folderStatus ?? sessions.find((s) => s.gitStatus)?.gitStatus;
  const dirtyStatus = useGitStatus(cwd, seededStatus);
  const { open: openCommitDialog } = useCommitDialog();
  // The dirty pill + Commit live on the folder header ONLY for GROUPED
  // same-cwd sessions (2+). For a solo session the header still renders (its
  // branch), but the pill belongs to the card's own `GitInfo` — rendering it
  // here too would duplicate it. Worktree sessions have a distinct cwd → own
  // 1-session group → card pill. See change:
  // add-session-uncommitted-indicator-and-commit.
  const showFolderPill = sessions.length > 1;
  // Seed AI-draft from any session sharing this cwd.
  const anySessionId = sessions[0]?.id ?? "";
  useEffect(() => { void refreshGitStatus(cwd); }, [cwd]);
  useEffect(() => {
    if (seededStatus) setCachedGitStatus(cwd, seededStatus);
  }, [cwd, seededStatus]);
  const session = sessions.find((s) => s.gitBranch);
  const cached = branchCache.get(cwd);
  const [fetchedBranch, setFetchedBranch] = useState<string | null>(cached?.branch ?? null);
  const [noGitRepo, setNoGitRepo] = useState(cached?.noGit ?? false);

  // When no session has branch info, fetch it directly from the server
  useEffect(() => {
    if (session?.gitBranch) {
      setFetchedBranch(null);
      setNoGitRepo(false);
      return;
    }
    // Use cache if available
    if (branchCache.has(cwd)) return;

    let cancelled = false;
    fetch(`${getApiBase()}/api/git/branches?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) {
          branchCache.set(cwd, { branch: json.data.current, noGit: false });
          setFetchedBranch(json.data.current);
          setNoGitRepo(false);
        } else {
          branchCache.set(cwd, { branch: null, noGit: true });
          setNoGitRepo(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          branchCache.set(cwd, { branch: null, noGit: true });
          setNoGitRepo(true);
        }
      });
    return () => { cancelled = true; };
  }, [cwd, session?.gitBranch]);

  // Precedence: the folder's own HEAD (when reported) outranks any child
  // session's branch (which may be a worktree branch leaked into the parent
  // folder header). `folderBranch === undefined` means no `git_head_update`
  // has arrived yet — fall back to the child branch, then the REST seed.
  // See change: refresh-folder-header-branch.
  const folderHasEntry = folderBranch !== undefined;
  const branchName = folderHasEntry ? folderBranch : (session?.gitBranch ?? fetchedBranch);
  // A confirmed-null folder HEAD is the non-git signal, same as `noGitRepo`.
  const showInitGit = folderBranch === null ? true : noGitRepo;
  const branchUrl = session?.gitBranchUrl;
  const prNumber = session?.gitPrNumber;
  const prUrl = session?.gitPrUrl;

  // No branch info at all: show dimmed icon (with "Init git" if confirmed not a repo)
  if (!branchName) {
    return (
      <div className="text-[11px] flex items-center gap-1.5 text-[var(--text-muted)]">
        <button
          onClick={(e) => { e.stopPropagation(); onBranchClick?.(); }}
          className="flex items-center gap-1 hover:text-[var(--text-secondary)] transition-colors"
          title={showInitGit ? i18nT("git.initializeRepo", undefined, "Initialize git repository") : i18nT("git.gitBranches", undefined, "Git branches")}
          data-testid="git-init-btn"
        >
          <Icon path={mdiSourceBranch} size={0.5} />
          {showInitGit && <span className="text-[10px]">{i18nT("git.initGit", undefined, "Init git")}</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="text-[11px] flex items-center gap-1.5 text-[var(--text-tertiary)]">
      <button
        onClick={(e) => { e.stopPropagation(); onBranchClick?.(); }}
        className="flex items-center gap-1 hover:text-blue-400 transition-colors"
        title={i18nT("git.switchBranch", undefined, "Switch branch")}
        data-testid="git-branch-btn"
      >
        <Icon path={mdiSourceBranch} size={0.5} />
      </button>
      {branchUrl ? (
        <a href={branchUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline truncate">
          {branchName}
        </a>
      ) : (
        <span className="truncate">{branchName}</span>
      )}
      {prNumber != null && (
        <>
          <span className="text-[var(--text-muted)]">·</span>
          {prUrl ? (
            <a href={prUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
              #{prNumber}
            </a>
          ) : (
            <span>#{prNumber}</span>
          )}
        </>
      )}
      {showFolderPill && (
        <GitDirtyPill status={dirtyStatus} onClick={() => openCommitDialog(cwd, anySessionId)} />
      )}
      {showFolderPill && (dirtyStatus?.dirtyCount ?? 0) > 0 && (
        <button
          type="button"
          data-testid="group-commit-btn"
          onClick={(e) => { e.stopPropagation(); openCommitDialog(cwd, anySessionId); }}
          className="text-[10px] text-blue-400 hover:underline"
          title={i18nT("common.commitChanges", undefined, "Commit changes")}
        >
          {i18nT("git.commit", undefined, "Commit")}
        </button>
      )}
    </div>
  );
}


export function SessionCard({
  session,
  selectedId,
  onSelect,
  now,
  showGitInfo,
  isHidden,
  allSessions,
  onHide,
  onUnhide,
  contextUsage,
  openspecChanges,
  openspecInitialized,
  openspecPending,
  openspecHasDir,
  openspecGroups,
  openspecAssignments,
  onSendPrompt,
  onAttachProposal,
  onDetachProposal,
  onReplaceProposal,
  onReadArtifact,
  onBulkArchive,
  onRename,
  onShutdown,
  onResume,
  onSpawnSibling,
  onSpawnWorktree,
  commands,
  processes,
  onKillProcess,
  onSetProcessDrawerCollapsed,
  inflightBashTools,
  onAbortTool,
  hasError,
  isRetrying,
  hasNotice,
}: {
  session: DashboardSession;
  selectedId?: string;
  onSelect: (id: string) => void;
  now: number;
  showGitInfo: boolean;
  isHidden: boolean;
  /** Full session list — forwarded into WorktreeActionsMenu / CloseWorktreeDialog
   *  so the dialog can render active-session names. Optional; safe default `[]`.
   *  See change: add-worktree-lifecycle-actions. */
  allSessions?: DashboardSession[];
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
  contextUsage?: ContextUsageInfo;
  openspecChanges?: OpenSpecChange[];
  /**
   * Whether `openspec list` returned authoritative data for this cwd.
   * Requires both `openspec/` AND `openspec/changes/` to exist AND CLI to
   * succeed. Does NOT capture the case "openspec project, no changes yet"
   * — see `openspecHasDir` for the broader applicability signal.
   */
  openspecInitialized?: boolean;
  /**
   * Whether the server is still polling OpenSpec for this cwd (cold-boot).
   * Subcard remains visible while pending so the user sees a placeholder
   * rather than a flash of hide-then-show.
   */
  openspecPending?: boolean;
  /**
   * Whether the session's cwd is an OpenSpec project at all (server-confirmed
   * `<cwd>/openspec/` directory exists). Strictly weaker than
   * `openspecInitialized` — `true` when the user has run `openspec init` even
   * before any proposals are authored. This is the primary visibility gate
   * for the OPENSPEC subcard: when `false` (and `openspec.enabled === false`
   * also broadcasts `false`), the subcard hides.
   *
   * `undefined` means the parent hasn't migrated yet; legacy fallback uses
   * `openspecInitialized || openspecPending` to preserve current visibility.
   *
   * See change: auto-hide-empty-session-subcards.
   */
  openspecHasDir?: boolean;
  openspecGroups?: OpenSpecGroup[];
  openspecAssignments?: Record<string, string>;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onAttachProposal?: (changeName: string) => void;
  onDetachProposal?: () => void;
  /** Accept/dismiss a suggested proposal replacement (committed changeName).
   *  See change: replace-proposal-dialog-with-race-handling. */
  onReplaceProposal?: (accept: boolean, changeName: string) => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onBulkArchive?: () => void;
  onRename?: (name: string) => void;
  onShutdown?: (id: string) => void;
  onResume?: (mode: "continue" | "fork") => void;
  /**
   * Spawn a clean sibling session in the parent's cwd, inheriting the
   * parent's `attachedProposal` when set. Always-visible `+Session` button —
   * NOT gated on `status === "ended"` or `sessionFile` (unlike Fork/Resume).
   * See change: session-card-plus-session-button.
   */
  onSpawnSibling?: (session: DashboardSession) => void;
  /**
   * Open the worktree-spawn dialog scoped to this session's cwd. Always-
   * visible `+Worktree` button (gated upstream by `gitWorktreeEnabled`).
   * Reuses `WorktreeSpawnDialog` — create worktree (if needed) + bootstrap
   * + spawn session inside it, pre-attaching the session's proposal.
   * See change: session-card-plus-session-button.
   */
  onSpawnWorktree?: (session: DashboardSession) => void;
  commands?: CommandInfo[];
  processes?: ProcessEntry[];
  onKillProcess?: (pgid: number) => void;
  /**
   * Unresolved `bash` toolCalls for this session, surfaced by
   * `selectInflightBashTools` over the client-side event reducer.
   * Drives the SessionActivityBar inside the PROCESS subcard.
   * See change: redesign-process-list-activity-bar.
   */
  inflightBashTools?: InflightBashTool[];
  /**
   * Invoked when the activity bar's stop button is clicked. Receives the
   * toolCallId for forward-compat; Phase 1 maps every invocation to the
   * session-level abort because no per-toolCall abort message exists yet
   * (design.md Q2 path b). See change: redesign-process-list-activity-bar.
   */
  onAbortTool?: (toolCallId: string) => void;
  /**
   * Persist the per-session background-processes drawer collapse toggle.
   * See change: persist-process-drawer-collapse.
   */
  onSetProcessDrawerCollapsed?: (collapsed: boolean) => void;
  hasError?: boolean;
  /** True iff a synthesized provider retry is in flight (retryState set, no error yet). */
  isRetrying?: boolean;
  /** True iff the model returned only reasoning, no answer (non-error notice). */
  hasNotice?: boolean;
}) {
  // dnd-kit drag handle props (attributes + listeners) supplied by
  // SortableSessionCard via context. When non-null, the desktop card's left
  // gutter (status dot + source icon column) becomes the drag zone.
  const dragHandleProps = useSessionCardDragHandle();
  const isSelected = selectedId === session.id;
  const [isRenaming, setIsRenaming] = useState(false);
  const canRename = session.status !== "ended" && !!onRename;
  const isAlive = session.status !== "ended";
  const isMobile = useMobile();
  const prefs = useDisplayPrefs(session.id);
  // Suppress purple `card-input-stripes` when a widget-bar slot owns the
  // pending prompt. Plugin-agnostic. See change: fix-flows-plugin-polish (B1).
  // Also gates the chat-routed `ask_user` → needs-you color in dot/rail.
  // See change: improve-dashboard-attention-routing.
  const hasWidgetBarPrompt = useHasWidgetBarPrompt(session.id);
  const dotColor = deriveDotColorWithFlags(session, { hasError, isRetrying, hasWidgetBarPrompt, hasNotice });
  // State marker class stays on the <li>; the matching color class drives the
  // compositor-only `.card-stripes-fx` overlay rendered behind card content.
  // See change: throttle-idle-ui-animations.
  const pulseClass = getCardPulseClass(session, hasWidgetBarPrompt);
  const stripeFxClass = getCardStripeFxClass(pulseClass);
  // Pause the card's compositor FX (neon glow/ring when selected, stripe sweep
  // when active) while the card is scrolled off-screen in the sidebar. Only
  // cards that actually carry an animation are observed. See change:
  // reduce-chat-render-cpu-umbrella (Phase 1, task 2.5).
  const cardFxRef = useFxVisibility<HTMLLIElement>();
  const hasAnimatedFx = isSelected || !!stripeFxClass;
  // OpenSpec workflow config gates which action buttons render in the
  // OPENSPEC subcard. See change: redesign-session-card-and-composer
  // (config-driven-workflow).
  const openspecConfig = useOpenSpecConfig(session.cwd);
  // Source-icon text color mirrors the dot's status color so the icon
  // doubles as a status indicator. See `deriveIconStatusColor` for ended /
  // arbitrary-bg-token defenses.
  // See change: add-session-status-to-folder-proposal-rows.
  const iconStatusColor = deriveIconStatusColor(dotColor, session.status);
  // Non-hue state channel: a shape marker (filled/half/ring/✕) so state is
  // distinguishable without color and under reduced motion.
  // See change: improve-dashboard-attention-routing.
  const statusShape = deriveStatusShape(session, { hasError, isRetrying, hasWidgetBarPrompt, hasNotice });
  // Status-tinted background color for the left-gutter mosaic rail. The
  // mosaic shape is carved by an SVG mask asset; the gutter element's
  // background-color supplies the colour. Selected cards use the brighter
  // -400 shade. See change: add-session-card-status-mosaic-rail.
  const railBgClass = deriveRailBgColor(session, { hasError, isRetrying, hasWidgetBarPrompt, hasNotice }, isSelected);

  function handleConfirmRename(name: string) {
    setIsRenaming(false);
    onRename?.(name);
  }

  // Simplified mobile card
  if (isMobile) {
    return (
      <li
        ref={hasAnimatedFx ? cardFxRef : undefined}
        data-session-id={session.id}
        onClick={() => onSelect(session.id)}
        className={`relative isolate px-4 py-3 cursor-pointer rounded-xl shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)] border hover:shadow-[inset_0_1px_0_var(--elevation-rim),0_6px_12px_var(--shadow-card)] transition-all duration-200 ${
          isSelected ? "border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30" : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
        } ${isHidden ? "opacity-40" : ""} ${session.closing ? "opacity-50" : ""} ${pulseClass}`}
      >
        {stripeFxClass ? <div className={`card-stripes-fx ${stripeFxClass}`} aria-hidden="true" /> : null}
        {/* Line 1: source icon (colored by status) + name + age */}
        <div className="flex items-center gap-2">
          <span
            className={`relative flex-shrink-0 ${iconStatusColor}`}
            title={`${sourceLabels[session.source] ?? session.source} — ${session.status}`}
            data-testid="session-status-icon"
            data-status-shape={statusShape}
          >
            <Icon path={sourceIcons[session.source] ?? mdiConsoleLine} size={0.5} />
            <StatusShapeBadge shape={statusShape} colorClass={iconStatusColor} />
          </span>
          <span className="text-sm font-semibold truncate flex-1">
            {getSessionDisplayName(session)}
          </span>
          <span
            className="text-[11px] text-[var(--text-muted)] flex-shrink-0"
            title={i18nT("session.startedAtTime", { time: new Date(session.startedAt).toLocaleString() }, "Started {time}")}
          >
            {formatRelativeTime(now - selectBadgeTimestamp(session))}
          </span>
        </div>

        {/* Line 2: model + activity (left) | context bar + cost (right) */}
        <div className="flex items-center mt-1 gap-2 text-[12px]">
          {session.model && (
            <span className="text-[var(--text-tertiary)] truncate">
              {session.model}
            </span>
          )}
          <ActivityIndicator session={session} />
          {/* Pi-native queue count badge — sum of steering + follow-up depth.
              Hidden when both queues empty. See change: add-followup-edit-and-steer-cancel. */}
          {(() => {
            const totalQueued = (session.pendingQueues?.steering.length ?? 0) + (session.pendingQueues?.followUp.length ?? 0);
            if (totalQueued === 0) return null;
            return (
              <span
                data-testid="queue-count-badge"
                className="flex-shrink-0 inline-flex items-center px-1.5 py-0 text-[10px] rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30"
                title={i18nT("session.queuedMessages", { count: totalQueued }, `${totalQueued} queued message${totalQueued === 1 ? "" : "s"}`)}
              >
                {totalQueued}
              </span>
            );
          })()}
          <span className="flex-1" />
          {prefs.contextUsageBar && (
            <ContextUsageBar
              tokens={contextUsage?.tokens ?? null}
              contextWindow={contextUsage?.contextWindow}
              compaction={contextUsage?.compaction}
              compact
            />
          )}
          {session.cost != null && session.cost > 0 && (
            <span className="text-[var(--text-tertiary)] flex-shrink-0">${session.cost.toFixed(2)}</span>
          )}
        </div>

        {/* Mobile attached-proposal chip (read-only) — see change: */}
        {/* fix-mobile-attach-proposal-display. Coexists with OpenSpecActivityBadge */}
        {/* below (which reads openspecPhase/openspecChange, not attachedProposal). */}
        {/* Mirror in SessionHeader.tsx → MobileHeader (mobile-header-attached-chip). */}
        {session.attachedProposal && (
          <div
            className="mt-1 flex items-center gap-1 text-[11px] text-blue-400"
            data-testid="mobile-card-attached-chip"
            title={i18nT("session.attachedProposal", { proposal: session.attachedProposal }, "Attached: {proposal}")}
          >
            <Icon path={mdiPaperclip} size={0.4} />
            <span className="truncate">{session.attachedProposal}</span>
          </div>
        )}
        {/* OpenSpec activity badge */}
        {(session.openspecPhase || session.openspecChange) ? (
          <OpenSpecActivityBadge
            phase={session.openspecPhase ?? undefined}
            changeName={session.openspecChange ?? undefined}
            completedTasks={
              session.openspecChange
                ? openspecChanges?.find((c) => c.name === session.openspecChange)?.completedTasks
                : undefined
            }
            totalTasks={
              session.openspecChange
                ? openspecChanges?.find((c) => c.name === session.openspecChange)?.totalTasks
                : undefined
            }
          />
        ) : null}
        {/* Compact read-only tag strip: user chips + `+N` overflow + read-only
            phase pseudo-tag (openspecPhase only). See change: add-session-tags. */}
        {((session.tags?.length ?? 0) > 0 || session.openspecPhase) ? (
          <div className="mt-1">
            <TagStrip tags={session.tags ?? []} phase={session.openspecPhase} />
          </div>
        ) : null}
        {/* PROCESS subcard (mobile compact) — activity bar + drawer.
            See change: redesign-process-list-activity-bar. */}
        <MobileProcessSubcard
          activity={inflightBashTools ?? EMPTY_BASH_TOOLS}
          processes={processes ?? EMPTY_PROCESSES}
          onKill={onKillProcess}
          onAbortTool={onAbortTool}
          now={now}
          onNavigateToSession={onSelect}
        />
      </li>
    );
  }

  return (
    <li
      ref={hasAnimatedFx ? cardFxRef : undefined}
      data-session-id={session.id}
      onClick={() => onSelect(session.id)}
      className={`relative isolate px-2 py-2 cursor-pointer rounded-xl shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)] border hover:shadow-[inset_0_1px_0_var(--elevation-rim),0_6px_12px_var(--shadow-card)] hover:-translate-y-0.5 transition-all duration-200 ${
        isSelected
          ? "border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30 card-selected-ring"
          : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
      } ${isHidden ? "opacity-40" : ""} ${session.closing ? "opacity-50" : ""} ${pulseClass}`}
      data-testid="session-card-desktop"
    >
      {isSelected ? <div className="card-glow-fx card-glow-fx-outer" aria-hidden="true" /> : null}
      {isSelected ? <div className="card-glow-fx" aria-hidden="true" /> : null}
      {stripeFxClass ? <div className={`card-stripes-fx ${stripeFxClass}`} aria-hidden="true" /> : null}
      {isSelected ? <div className="card-ring-fx" aria-hidden="true" /> : null}
      <div className="flex gap-1.5">
      {/* Left gutter: a status-tinted capsule rail with a circular icon chip
          at the top. The rail is a 6px-wide rounded vertical bar centered in
          a 20px-wide gutter, capped above and below the chip. The icon sits
          in its own circular chip with an opaque dark backing so it reads
          clearly. Doubles as drag handle when dragHandleProps is provided.
          See change: add-session-card-status-mosaic-rail. */}
      <div
        {...(dragHandleProps ?? {})}
        className={`relative flex flex-col items-center flex-shrink-0 w-5 pt-2 pb-2 ${dragHandleProps ? "cursor-grab active:cursor-grabbing" : ""}`}
        onClick={(e) => { if (dragHandleProps) e.stopPropagation(); }}
        title={`${sourceLabels[session.source] ?? session.source} — ${session.status}`}
        data-testid={dragHandleProps ? "drag-handle-session" : undefined}
        data-rail-bg={railBgClass}
      >
        {/* Capsule rail: 6 px wide, centered, rounded-full both ends. Starts
            below the icon chip (top-7 = 28 px = pt-2 + chip h-4 + ~4 px
            gap) so the chip and the bar do not visually run into each other. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1/2 top-7 bottom-2 -translate-x-1/2 w-1.5 rounded-full ${railBgClass}`}
        />
        {/* Icon chip: opaque tertiary surface so the icon stays clear of the
            colored rail behind it. */}
        <span
          className={`relative z-10 inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--bg-tertiary)] shadow-sm ${iconStatusColor}`}
          data-testid="session-status-icon"
          data-status-shape={statusShape}
        >
          <Icon path={sourceIcons[session.source] ?? mdiConsoleLine} size={0.45} />
          <StatusShapeBadge shape={statusShape} colorClass={iconStatusColor} />
        </span>
      </div>
      {/* Card content */}
      <div className="flex-1 min-w-0">
      {/* Line 1: name + time */}
      <div className="flex items-center gap-2">
        {isRenaming ? (
          <InlineRenameInput
            currentName={getSessionDisplayName(session)}
            onConfirm={handleConfirmRename}
            onCancel={() => setIsRenaming(false)}
            className="flex-1"
          />
        ) : (
          <span
            className={`text-sm font-semibold truncate flex-1 ${canRename ? "cursor-text" : ""}`}
            onDoubleClick={(e) => {
              if (canRename) {
                e.stopPropagation();
                setIsRenaming(true);
              }
            }}
          >
            {getSessionDisplayName(session)}
          </span>
        )}
        {canRename && !isRenaming && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsRenaming(true); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] p-0.5 flex-shrink-0"
            title={i18nT("session.renameSession", undefined, "Rename session")}
          >
            <Icon path={mdiPencilOutline} size={0.45} />
          </button>
        )}
        <span
          className="text-[10px] text-[var(--text-muted)]"
          title={i18nT("session.startedAtTime", { time: new Date(session.startedAt).toLocaleString() }, "Started {time}")}
        >
          {formatRelativeTime(now - selectBadgeTimestamp(session))}
        </span>
        {/* Hide/unhide button */}
        {isHidden ? (
          <button
            onClick={(e) => { e.stopPropagation(); onUnhide(session.id); }}
            className="text-[var(--text-tertiary)] hover:text-green-400 p-0.5 flex-shrink-0"
            title={i18nT("session.showSession", undefined, "Show session")}
            data-testid="session-unhide-btn"
          >
            <Icon path={mdiEyeOutline} size={0.45} />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onHide(session.id); }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-muted)] p-0.5 flex-shrink-0"
            title={i18nT("session.hideSession", undefined, "Hide session")}
            data-testid="session-hide-btn"
          >
            <Icon path={mdiEyeOffOutline} size={0.45} />
          </button>
        )}
        {isAlive && onShutdown && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (session.closing) return;
              if (session.status === "streaming") {
                if (!window.confirm(i18nT("session.exitWhileRunningConfirm", undefined, "Session is currently running. Exit anyway?"))) return;
              }
              onShutdown(session.id);
            }}
            disabled={session.closing}
            className="text-[var(--text-muted)] hover:text-red-400 p-0.5 flex-shrink-0 disabled:cursor-default disabled:hover:text-[var(--text-muted)]"
            title={session.closing ? i18nT("session.closing", undefined, "Closing…") : i18nT("session.exitPiSession", undefined, "Exit pi session")}
            data-testid="session-close-btn"
          >
            <Icon path={session.closing ? mdiLoading : mdiClose} size={0.5} className={session.closing ? "animate-spin" : undefined} />
          </button>
        )}
      </div>

      {/* Line 2: model + thinking level + source/fork right-aligned */}
      <div className="flex items-center mt-0.5 gap-1.5">
        {session.model && (
          <span className="text-xs text-[var(--text-tertiary)] truncate">
            {session.model}{session.thinkingLevel ? ` (${session.thinkingLevel})` : ""}
          </span>
        )}
        <span className="flex-1" />
        {onResume && session.sessionFile && (
          <>
            {(!isAlive || isHidden) && (
              <button
                onClick={(e) => { e.stopPropagation(); onResume("continue"); }}
                disabled={session.resuming || session.cwdMissing === true}
                className="text-[9px] px-1 py-px rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title={session.cwdMissing ? i18nT("session.cwdMissing", undefined, "session's directory no longer exists") : i18nT("session.resumeTitle", undefined, "Resume session (continue same session)")}
              >
                <Icon path={mdiPlayCircleOutline} size={0.35} className="inline mr-px" />{i18nT("session.resume", undefined, "Resume")}
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onResume("fork"); }}
              disabled={session.resuming || session.cwdMissing === true}
              className="text-[9px] px-1 py-px rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              title={session.cwdMissing ? i18nT("session.cwdMissing", undefined, "session's directory no longer exists") : i18nT("session.forkTitle", undefined, "Fork session (new session from this point)")}
            >
              <Icon path={mdiSourceFork} size={0.35} className="inline mr-px" />{i18nT("session.fork", undefined, "Fork")}
            </button>
          </>
        )}
        {/* +Session — clean sibling spawn. Always visible (no ended/sessionFile
            gate, unlike Fork/Resume above). Inherits cwd + attachedProposal.
            See change: session-card-plus-session-button. */}
        {onSpawnSibling && (
          <button
            onClick={(e) => { e.stopPropagation(); onSpawnSibling(session); }}
            disabled={!!session.cwdMissing}
            className="text-[9px] px-1 py-px rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={session.cwdMissing ? i18nT("session.cwdMissing", undefined, "session's directory no longer exists") : i18nT("session.spawnSiblingTitle", undefined, "+Session clean sibling in same folder")}
            data-testid="session-card-spawn-sibling"
          >
            <Icon path={mdiPlus} size={0.35} className="inline mr-px" />{i18nT("session.session", undefined, "Session")}
          </button>
        )}
        {/* +Worktree — create git worktree (if needed) + spawn session inside
            it via WorktreeSpawnDialog. Gated upstream by gitWorktreeEnabled.
            Hidden when the session is ALREADY a worktree session
            (`session.gitWorktree` set) — spawning a worktree from inside a
            worktree is redundant. Also hidden ONLY when the cwd is a
            confirmed non-git directory (`isGitRepo === false`); `true` and
            `undefined` (unknown / probe-timed-out / legacy) keep the button
            so a real repo never loses it. NOT gated on `gitBranch` — that is
            a data-arrival signal (absent during the register race, on probe
            failure, and after restart for cold sessions).
            See changes: session-card-plus-session-button,
            gate-session-worktree-button-on-git. */}
        {onSpawnWorktree && !session.gitWorktree && session.isGitRepo !== false && (
          <button
            onClick={(e) => { e.stopPropagation(); onSpawnWorktree(session); }}
            disabled={!!session.cwdMissing}
            className="text-[9px] px-1 py-px rounded border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            title={session.cwdMissing ? i18nT("session.cwdMissing", undefined, "session's directory no longer exists") : i18nT("session.spawnWorktreeTitle", undefined, "Create git worktree + spawn session inside it")}
            data-testid="session-card-spawn-worktree"
          >
            <Icon path={mdiSourceBranchPlus} size={0.35} className="inline mr-px" />{i18nT("worktree.worktree", undefined, "Worktree")}
          </button>
        )}
      </div>

      {/* Line 3: activity (left) | context bar + cost (right) */}
      <div className="flex items-center mt-0.5 text-[11px] gap-2">
        <ActivityIndicator session={session} />
        <span className="flex-1" />
        {prefs.contextUsageBar && (
          <ContextUsageBar
            tokens={contextUsage?.tokens ?? null}
            contextWindow={contextUsage?.contextWindow}
            compaction={contextUsage?.compaction}
            compact
          />
        )}
        {session.cost != null && session.cost > 0 && (
          <span className="text-[var(--text-tertiary)] flex-shrink-0">${session.cost.toFixed(2)}</span>
        )}
      </div>

      {/* OpenSpec activity badge */}
      {(session.openspecPhase || session.openspecChange) ? (
        <OpenSpecActivityBadge
          phase={session.openspecPhase ?? undefined}
          changeName={session.openspecChange ?? undefined}
          completedTasks={
            session.openspecChange
              ? openspecChanges?.find((c) => c.name === session.openspecChange)?.completedTasks
              : undefined
          }
          totalTasks={
            session.openspecChange
              ? openspecChanges?.find((c) => c.name === session.openspecChange)?.totalTasks
              : undefined
          }
        />
      ) : null}

      {/* Compact read-only tag strip: user chips + `+N` overflow + read-only
          phase pseudo-tag (openspecPhase only). See change: add-session-tags. */}
      {((session.tags?.length ?? 0) > 0 || session.openspecPhase) ? (
        <div className="mt-1 px-1">
          <TagStrip tags={session.tags ?? []} phase={session.openspecPhase} />
        </div>
      ) : null}

      {/* Subcard stack — see change: redesign-session-card-subcards.
          Flow activity badge has been removed from the shell — it is now
          rendered via SessionCardBadgeSlot (inside WorkspaceSubcard below)
          which receives the FlowActivityBadgeClaim contribution from
          flows-plugin. See change: pluginize-flows-via-registry. */}

      {/* OPENSPEC subcard
          Hides when the cwd is not OpenSpec-applicable. Primary signal:
          `openspecHasDir` (server-confirmed `<cwd>/openspec/` existence).
          When the user disables OpenSpec globally, server broadcasts
          `hasOpenspecDir: false` for every cwd — same gate, same outcome.
          Legacy fallback (when `openspecHasDir` undefined): use the previous
          `initialized || pending` heuristic so old clients/parents that
          haven't migrated still see the subcard.
          See change: auto-hide-empty-session-subcards. */}
      {openspecChanges && onSendPrompt && onAttachProposal && onDetachProposal && (
        openspecHasDir !== undefined
          ? Boolean(openspecHasDir) || Boolean(openspecPending)
          : openspecInitialized === undefined
            ? true
            : Boolean(openspecInitialized) || Boolean(openspecPending)
      ) && (
        <SessionSubcard title={i18nT("session.subcardOpenspec", undefined, "OPENSPEC")}>
          <SessionOpenSpecActions
            session={session}
            changes={openspecChanges}
            onAttach={onAttachProposal}
            onDetach={onDetachProposal}
            onReplaceProposal={onReplaceProposal}
            onSendPrompt={onSendPrompt}
            onReadArtifact={onReadArtifact}
            onBulkArchive={onBulkArchive}
            groups={openspecGroups}
            assignments={openspecAssignments}
            openspecConfig={openspecConfig}
            /* See change: redesign-session-card-and-composer (config-driven-workflow). */
          />
        </SessionSubcard>
      )}

      {/* WORKTREE folder-scoped sections (KB row) — only for worktree
          sessions, scoped to the worktree's OWN cwd. A worktree groups under
          its `gitWorktree.mainPath` and never gets its own sidebar folder
          card, so this is the only surface that reaches the worktree's KB.
          See change: kb-row-on-worktree-session-card. */}
      {session.gitWorktree && (
        <WorktreeCardSectionSlot folder={{ cwd: session.cwd }} />
      )}

      {/* GIT subcard. See change: redesign-session-card-and-composer (5.1–5.3). */}
      <GitSubcard
        session={session}
        showGitInfo={showGitInfo}
        allSessions={allSessions ?? []}
        onShutdownSession={onShutdown ?? (() => { /* unwired */ })}
      />
      <BadgeSubcard session={session} />

      {/* PROCESS subcard — activity bar (in-flight bash toolCalls) +
          background processes drawer. Subcard hides only when BOTH the
          activity bar's inflight list and the drawer's process list are
          empty. See change: redesign-process-list-activity-bar. */}
      <ProcessSubcard
        activity={inflightBashTools ?? EMPTY_BASH_TOOLS}
        processes={processes ?? EMPTY_PROCESSES}
        onKill={onKillProcess}
        onAbortTool={onAbortTool}
        now={now}
        collapsed={session.processDrawerCollapsed}
        onSetCollapsed={onSetProcessDrawerCollapsed}
        onNavigateToSession={onSelect}
        reserveAtIdle={prefs.reserveProcessLineAtIdle}
      />

      {/* FLOWS subcard — plugin slot only.
          Populated by flows-plugin's SessionFlowActionsClaim via the
          dedicated `session-card-flows` slot. See change: add-flows-subcard. */}
      <FlowsSubcard session={session} />

      {/* MEMORY subcard — plugin slot only */}
      <MemorySubcard session={session} />

      {/* Plugin slot: session-card-action-bar — generic card footer.
          Kept rendered for future generic plugins. */}
      <SessionCardActionBarSlot session={session} />
      </div>{/* end card content */}
      </div>{/* end flex row */}
    </li>
  );
}

// Module-level stable empty references for default-prop normalization — avoid
// allocating new arrays on every render so React.memo / useMemo equality
// downstream doesn't churn. See change: redesign-process-list-activity-bar.
const EMPTY_BASH_TOOLS: readonly InflightBashTool[] = [];
const EMPTY_PROCESSES: readonly ProcessEntry[] = [];

/**
 * useDrawerExpansion — resolves the background-processes drawer's
 * expanded state from the per-session persisted `processDrawerCollapsed`
 * value (absent ⇒ collapsed by default). A user toggle flips local state
 * optimistically and persists server-side via `onSetCollapsed`; the next
 * `session_updated` broadcast reconciles `persistedCollapsed`.
 *
 * See change: persist-process-drawer-collapse (supersedes Decision 4 of
 * redesign-process-list-activity-bar).
 */
function useDrawerExpansion(
  persistedCollapsed: boolean | undefined,
  onSetCollapsed?: (collapsed: boolean) => void,
) {
  const [collapsed, setCollapsed] = useState(persistedCollapsed ?? true);
  // Reconcile with the authoritative server value when it changes
  // (another client toggled, or our optimistic write echoed back).
  useEffect(() => {
    if (persistedCollapsed !== undefined) setCollapsed(persistedCollapsed);
  }, [persistedCollapsed]);
  const onToggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      onSetCollapsed?.(next);
      return next;
    });
  }, [onSetCollapsed]);
  return { expanded: !collapsed, onToggle };
}

interface ProcessSubcardProps {
  activity: readonly InflightBashTool[];
  processes: readonly ProcessEntry[];
  onKill?: (pgid: number) => void;
  onAbortTool?: (toolCallId: string) => void;
  now: number;
  /** Per-session persisted drawer collapse state (absent ⇒ collapsed). */
  collapsed?: boolean;
  /** Persist the user's collapse toggle server-side. */
  onSetCollapsed?: (collapsed: boolean) => void;
  /** Focus/scroll to a referenced session (for `sub-session` rows). */
  onNavigateToSession?: (sessionId: string) => void;
  /**
   * Effective `reserveProcessLineAtIdle` pref. When true the desktop subcard
   * renders a reserved `⏵ idle` line even when both surfaces are empty, so the
   * grid never reflows. Mobile ignores it.
   */
  reserveAtIdle?: boolean;
}

/**
 * Compose the stable-width counts pill for the collapsed process line:
 * `N running`, `⚠M`, or both joined by ` · `. Returns null when neither
 * segment applies. Pure; exported for unit tests.
 * See change: stable-process-line.
 */
export function formatCountsPill(running: number, bg: number): string | null {
  const segs: string[] = [];
  if (running > 0) segs.push(`${running} running`);
  if (bg > 0) segs.push(`⚠${bg}`);
  return segs.length > 0 ? segs.join(" · ") : null;
}

/**
 * Desktop PROCESS subcard — ONE fixed-height summary line that folds the
 * in-flight bash activity and the background-process drawer together. Collapsed
 * height is invariant across tool count (the core goal of stable-process-line):
 * the line shows the newest running command + a counts pill + elapsed, or
 * `⚠ M background process(es)`, or `⏵ idle`. Expanding reveals the activity
 * rows (each `⏹` → session abort) then the bg-process rows (each `✕` → PGID
 * kill). Expand state persists per session via `useDrawerExpansion`.
 *
 * Unmounts (returns null) only when both surfaces are empty AND `reserveAtIdle`
 * is false. See change: stable-process-line.
 */
function ProcessSubcard({ activity, processes, onKill, onAbortTool, now, collapsed, onSetCollapsed, onNavigateToSession, reserveAtIdle }: ProcessSubcardProps) {
  const hasActivity = activity.length > 0;
  const hasProcesses = processes.length > 0;
  const { expanded, onToggle } = useDrawerExpansion(collapsed, onSetCollapsed);
  if (!hasActivity && !hasProcesses && !reserveAtIdle) return null;

  const primary = activity[0];
  // Pill only when a bash is running — in the bg-only case the line text already
  // carries the count, so a `⚠M` pill would duplicate it.
  const pill = hasActivity ? formatCountsPill(activity.length, processes.length) : null;

  let lineIcon = mdiPlay;
  let lineIconClass = "text-green-400";
  let lineText: string;
  if (primary) {
    lineText = truncateCommand(primary.command, 60);
  } else if (hasProcesses) {
    lineIcon = mdiAlertOutline;
    lineIconClass = "text-amber-500/80";
    lineText = i18nT(
      "session.backgroundProcessCount",
      { count: processes.length },
      `${processes.length} background process${processes.length === 1 ? "" : "es"}`,
    );
  } else {
    lineText = i18nT("session.processIdle", undefined, "idle");
  }

  return (
    <SessionSubcard title={i18nT("session.subcardProcess", undefined, "PROCESS")}>
      <CollapseSummary expanded={expanded} onToggle={onToggle} testId="process-summary-line">
        <Icon path={lineIcon} size={0.4} className={`${lineIconClass} flex-shrink-0`} />
        <span className="text-[var(--text-secondary)] truncate flex-1" title={primary?.command ?? lineText}>
          {lineText}
        </span>
        {pill ? (
          <span className="flex-shrink-0 text-[10px] text-[var(--text-tertiary)] tabular-nums" data-testid="process-counts-pill">
            [{pill}]
          </span>
        ) : null}
        {primary ? (
          <span className="flex-shrink-0 text-[var(--text-tertiary)]">{formatElapsed(now - primary.startedAt)}</span>
        ) : null}
      </CollapseSummary>
      {expanded && (hasActivity || hasProcesses) ? (
        <div className="mt-1.5 space-y-0.5" data-testid="process-expanded-body">
          {hasActivity && onAbortTool ? (
            <SessionActivityBar tools={[...activity]} onAbort={onAbortTool} now={now} />
          ) : null}
          {hasProcesses && onKill ? (
            <ProcessList processes={[...processes]} onKill={onKill} onNavigateToSession={onNavigateToSession} />
          ) : null}
        </div>
      ) : null}
    </SessionSubcard>
  );
}

/**
 * Mobile PROCESS subcard — compact activity rows + drawer-as-chip.
 * Tapping the chip opens a sheet (modal overlay) with the full drawer.
 *
 * Implementation note: chip + sheet are inline rather than a separate
 * file because the surface is small and tied to this card's state.
 */
function MobileProcessSubcard({ activity, processes, onKill, onAbortTool, now, onNavigateToSession }: ProcessSubcardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const hasActivity = activity.length > 0;
  const hasProcesses = processes.length > 0;
  if (!hasActivity && !hasProcesses) return null;
  return (
    <>
      {hasActivity && onAbortTool && (
        <SessionActivityBar tools={[...activity]} onAbort={onAbortTool} now={now} compact />
      )}
      {hasProcesses && onKill && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setSheetOpen(true); }}
          className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
          data-testid="background-drawer-chip"
          aria-label={i18nT("session.backgroundProcessesTapToView", { count: processes.length }, "{count} background processes — tap to view")}
        >
          ⚠ {processes.length}
        </button>
      )}
      {sheetOpen && hasProcesses && onKill && (
        <div
          className="fixed inset-0 bg-[var(--bg-overlay)] flex items-end justify-center z-[60]"
          onClick={(e) => { e.stopPropagation(); setSheetOpen(false); }}
          data-testid="background-drawer-sheet"
        >
          <div
            className="bg-[var(--bg-secondary)] rounded-t-lg p-4 w-full max-w-lg border-t border-[var(--border-secondary)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold mb-2 text-[var(--text-secondary)]">{i18nT("common.backgroundProcesses", undefined, "Background processes")}</h3>
            <ProcessList
              processes={[...processes]}
              onKill={onKill}
              compact
              onNavigateToSession={onNavigateToSession}
            />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * GIT subcard — git branch / PR / worktree pill + worktree actions menu.
 * Strictly git-scoped: never considers plugin slot claims.
 * See change: redesign-session-card-and-composer (5.1).
 */
function GitSubcard({ session, showGitInfo, allSessions, onShutdownSession }: { session: DashboardSession; showGitInfo: boolean; allSessions: DashboardSession[]; onShutdownSession: (sessionId: string) => void }) {
  // Worktree sessions need their own GitInfo line even in multi-session
  // groups (parent group header shows the main checkout's branch).
  const renderGitInfo = showGitInfo || !!session.gitWorktree;
  const hasWorktreeActions = !!session.gitWorktree;
  if (!renderGitInfo && !hasWorktreeActions) return null;
  return (
    <SessionSubcard title={i18nT("session.subcardGit", undefined, "GIT")}>
      {renderGitInfo ? <GitInfo session={session} /> : null}
      {hasWorktreeActions ? <WorktreeActionsMenu session={session} allSessions={allSessions} onShutdownSession={onShutdownSession} /> : null}
    </SessionSubcard>
  );
}

/**
 * STATUS subcard — session-card-badge slot contributions (goal/automation).
 * Strictly plugin-scoped: never considers git state.
 * See change: redesign-session-card-and-composer (5.1).
 */
function BadgeSubcard({ session }: { session: DashboardSession }) {
  const hasBadge = useSlotHasClaimsForSession("session-card-badge", session);
  if (!hasBadge) return null;
  return (
    <SessionSubcard title={i18nT("session.subcardStatus", undefined, "STATUS")}>
      <SessionCardBadgeSlot session={session} />
    </SessionSubcard>
  );
}

/**
 * MEMORY subcard — renders only when a plugin claims session-card-memory.
 * See change: redesign-session-card-subcards (D3).
 */
function MemorySubcard({ session }: { session: DashboardSession }) {
  const hasMemory = useSlotHasClaimsForSession("session-card-memory", session);
  if (!hasMemory) return null;
  return (
    <SessionSubcard title={i18nT("session.subcardMemory", undefined, "MEMORY")}>
      <SessionCardMemorySlot session={session} />
    </SessionSubcard>
  );
}

/**
 * FLOWS subcard — renders only when a plugin claims session-card-flows AND
 * at least one claim's `shouldRender(session)` returns true. See change:
 * add-flows-subcard.
 */
function FlowsSubcard({ session }: { session: DashboardSession }) {
  const hasFlows = useSlotHasClaimsForSession("session-card-flows", session);
  if (!hasFlows) return null;
  return (
    <SessionSubcard title={i18nT("session.subcardFlows", undefined, "FLOWS")}>
      <SessionCardFlowsSlot session={session} />
    </SessionSubcard>
  );
}
