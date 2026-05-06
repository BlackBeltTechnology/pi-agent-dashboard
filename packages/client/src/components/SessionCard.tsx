import React, { useState, useEffect, type ReactNode } from "react";
import { getApiBase } from "../lib/api-context.js";
import { Icon } from "@mdi/react";
import { mdiFlash, mdiOpenInNew, mdiPencil, mdiPencilOutline, mdiSourceBranch, mdiClose, mdiEyeOffOutline, mdiEyeOutline, mdiConsoleLine, mdiRobotOutline, mdiCodeTags, mdiApplicationOutline, mdiCommentQuestion, mdiPlayCircleOutline, mdiSourceFork, mdiPaperclip, mdiFileTree } from "@mdi/js";
import {
  statusColors as statusColorsExt,
  sourceBadgeColors as sourceBadgeColorsExt,
  sourceIcons,
  sourceLabels,
  deriveDotColorWithFlags,
  deriveIconStatusColor,
  deriveRailBgColor,
} from "../lib/session-status-visuals.js";

// Re-export for any downstream consumers that historically imported these
// from SessionCard. See change: add-session-status-to-folder-proposal-rows.
export const statusColors = statusColorsExt;
export const sourceBadgeColors = sourceBadgeColorsExt;
import type { DashboardSession, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getSessionDisplayName } from "../lib/session-display-name.js";
import { formatRelativeTime, formatTokens } from "../lib/format.js";
import { selectBadgeTimestamp } from "../lib/session-card-time.js";
import type { DetectedEditor } from "../lib/editor-api.js";
import { ContextUsageBar } from "./ContextUsageBar.js";
import type { ContextUsageInfo } from "./SessionList.js";
import type { OpenSpecData, OpenSpecChange, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SessionOpenSpecActions } from "./SessionOpenSpecActions.js";
import { OpenSpecActivityBadge } from "./OpenSpecActivityBadge.js";
import { InlineRenameInput } from "./InlineRenameInput.js";
import {
  FlowActivityBadge,
  SessionFlowActions,
} from "@blackbelt-technology/pi-dashboard-flows-plugin/client";
// jj-plugin components (JjWorkspaceBadge, JjActionBar, JjInitAffordance) are
// rendered exclusively via plugin slots (SessionCardBadgeSlot /
// SessionCardActionBarSlot) once the registry is populated. Direct imports
// removed to avoid double-rendering. See change: wire-plugin-registry-into-shell.
import { ProcessList, type ProcessEntry } from "./ProcessList.js";
import type { CommandInfo, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useMobile } from "../hooks/useMobile.js";
import { SessionCardBadgeSlot, SessionCardActionBarSlot, SessionCardMemorySlot, WorkspaceActionBarSlot, useSlotHasClaimsForSession } from "@blackbelt-technology/dashboard-plugin-runtime";
import { SessionSubcard } from "./SessionSubcard.js";
import { useSessionCardDragHandle } from "./SortableSessionCard.js";

export function getCardPulseClass(session: DashboardSession): string {
  if (session.currentTool === "ask_user") return "card-input-pulse";
  if (session.status === "streaming" || session.resuming) return "card-working-pulse";
  // Unread state — gray scrolling stripes. Lower priority than the two above
  // so streaming/ask_user keep their stronger colors.
  // See change: session-card-unread-stripes.
  if (session.unread) return "card-unread-pulse";
  return "";
}

export function ActivityIndicator({ session }: { session: DashboardSession }) {
  if (session.resuming) {
    return <span className="text-yellow-400">Resuming…</span>;
  }

  if (session.status === "ended") return null;

  if (session.currentTool === "ask_user") {
    return <span className="text-purple-400 truncate inline-flex items-center gap-0.5"><Icon path={mdiCommentQuestion} size={0.5} /> Waiting for input</span>;
  }

  if (session.currentTool) {
    return <span className="text-yellow-400 truncate inline-flex items-center gap-0.5"><Icon path={mdiFlash} size={0.5} /> {session.currentTool}</span>;
  }

  if (session.status === "streaming") {
    return <span className="text-green-400">Thinking…</span>;
  }

  if (session.status === "idle" || session.status === "active") {
    return <span className="text-[var(--text-tertiary)]">Waiting for input</span>;
  }

  return null;
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

export function WorktreeIndicator({ session }: { session: DashboardSession }) {
  if (!session.worktree) return null;

  return (
    <div
      className="text-[11px] mt-0.5 ml-4 flex items-center gap-1.5 text-[var(--text-tertiary)]"
      title={`Worktree: ${session.worktree.path}`}
    >
      <Icon path={mdiFileTree} size={0.5} />
      <span className="px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 text-[10px] font-mono truncate max-w-[160px]">
        {session.worktree.branch}
      </span>
    </div>
  );
}

export function GitInfo({ session }: { session: DashboardSession }) {
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
    </div>
  );
}

// Simple cache to avoid redundant fetches across re-renders.
// Exported so the BranchSwitchDialog can invalidate on close.
export const branchCache = new Map<string, { branch: string | null; noGit: boolean }>();

interface GroupGitInfoProps {
  sessions: DashboardSession[];
  cwd: string;
  onBranchClick?: () => void;
}

export function GroupGitInfo({ sessions, cwd, onBranchClick }: GroupGitInfoProps) {
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
    if (!cwd) return;

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

  const branchName = session?.gitBranch ?? fetchedBranch;
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
          title={noGitRepo ? "Initialize git repository" : "Git branches"}
          data-testid="git-init-btn"
        >
          <Icon path={mdiSourceBranch} size={0.5} />
          {noGitRepo && <span className="text-[10px]">Init git</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="text-[11px] flex items-center gap-1.5 text-[var(--text-tertiary)]">
      <button
        onClick={(e) => { e.stopPropagation(); onBranchClick?.(); }}
        className="flex items-center gap-1 hover:text-blue-400 transition-colors"
        title="Switch branch"
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
    </div>
  );
}

const editorIcons: Record<string, ReactNode> = {
  zed: <Icon path={mdiOpenInNew} size={0.5} />,
  vscode: <Icon path={mdiOpenInNew} size={0.5} />,
  idea: <Icon path={mdiOpenInNew} size={0.5} />,
};

export function EditorButtons({
  editors,
  onOpen,
}: {
  editors: DetectedEditor[];
  onOpen: (editorId: string) => void;
}) {
  if (editors.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {editors.map((editor) => (
        <button
          key={editor.id}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(editor.id);
          }}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50"
          title={`Open in ${editor.name}`}
        >
          <span className="inline-flex items-center gap-0.5">{editorIcons[editor.id] ?? <Icon path={mdiOpenInNew} size={0.5} />} {editor.name}</span>
        </button>
      ))}
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
  onHide,
  onUnhide,
  contextUsage,
  openspecChanges,
  openspecGroups,
  openspecAssignments,
  onSendPrompt,
  onFlowAction,
  onAttachProposal,
  onDetachProposal,
  onReadArtifact,
  onBulkArchive,
  onRename,
  onShutdown,
  onResume,
  commands,
  flows,
  processes,
  onKillProcess,
  hasError,
  isRetrying,
}: {
  session: DashboardSession;
  selectedId?: string;
  onSelect: (id: string) => void;
  now: number;
  showGitInfo: boolean;
  isHidden: boolean;
  onHide: (id: string) => void;
  onUnhide: (id: string) => void;
  contextUsage?: ContextUsageInfo;
  openspecChanges?: OpenSpecChange[];
  openspecGroups?: OpenSpecGroup[];
  openspecAssignments?: Record<string, string>;
  onSendPrompt?: (text: string, images?: ImageContent[]) => void;
  onFlowAction?: (action: string, opts?: { flowName?: string; task?: string; description?: string }) => void;
  onAttachProposal?: (changeName: string) => void;
  onDetachProposal?: () => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  onBulkArchive?: () => void;
  onRename?: (name: string) => void;
  onShutdown?: (id: string) => void;
  onResume?: (mode: "continue" | "fork") => void;
  commands?: CommandInfo[];
  flows?: FlowInfo[];
  processes?: ProcessEntry[];
  onKillProcess?: (pgid: number) => void;
  hasError?: boolean;
  /** True iff a synthesized provider retry is in flight (retryState set, no error yet). */
  isRetrying?: boolean;
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
  const dotColor = deriveDotColorWithFlags(session, { hasError, isRetrying });
  // Source-icon text color mirrors the dot's status color so the icon
  // doubles as a status indicator. See `deriveIconStatusColor` for ended /
  // arbitrary-bg-token defenses.
  // See change: add-session-status-to-folder-proposal-rows.
  const iconStatusColor = deriveIconStatusColor(dotColor, session.status);
  // Status-tinted background color for the left-gutter mosaic rail. The
  // mosaic shape is carved by an SVG mask asset; the gutter element's
  // background-color supplies the colour. Selected cards use the brighter
  // -400 shade. See change: add-session-card-status-mosaic-rail.
  const railBgClass = deriveRailBgColor(session, { hasError, isRetrying }, isSelected);

  function handleConfirmRename(name: string) {
    setIsRenaming(false);
    onRename?.(name);
  }

  // Simplified mobile card
  if (isMobile) {
    return (
      <li
        data-session-id={session.id}
        onClick={() => onSelect(session.id)}
        className={`px-4 py-3 cursor-pointer rounded-xl shadow-md shadow-[var(--shadow-card)] border hover:shadow-lg transition-all duration-200 ${
          isSelected ? "border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30" : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
        } ${isHidden ? "opacity-40" : ""} ${getCardPulseClass(session)}`}
      >
        {/* Line 1: source icon (colored by status) + name + age */}
        <div className="flex items-center gap-2">
          <span
            className={`flex-shrink-0 ${iconStatusColor}`}
            title={`${sourceLabels[session.source] ?? session.source} — ${session.status}`}
            data-testid="session-status-icon"
          >
            <Icon path={sourceIcons[session.source] ?? mdiConsoleLine} size={0.5} />
          </span>
          <span className="text-sm truncate flex-1">
            {getSessionDisplayName(session)}
          </span>
          <span
            className="text-[11px] text-[var(--text-muted)] flex-shrink-0"
            title={`Started ${new Date(session.startedAt).toLocaleString()}`}
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
          <span className="flex-1" />
          <ContextUsageBar
            tokens={contextUsage?.tokens ?? null}
            contextWindow={contextUsage?.contextWindow}
            compact
          />
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
            title={`Attached: ${session.attachedProposal}`}
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
        {/* Flow activity badge */}
        {session.activeFlowName ? (
          <FlowActivityBadge
            flowName={session.activeFlowName}
            agentsDone={session.flowAgentsDone}
            agentsTotal={session.flowAgentsTotal}
            status={session.flowStatus}
          />
        ) : null}
        {/* Active child processes (mobile compact) */}
        {processes && processes.length > 0 && onKillProcess && (
          <ProcessList processes={processes} onKill={onKillProcess} compact />
        )}
      </li>
    );
  }

  return (
    <li
      data-session-id={session.id}
      onClick={() => onSelect(session.id)}
      className={`px-2 py-2 cursor-pointer rounded-xl shadow-md shadow-[var(--shadow-card)] border hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${
        isSelected ? "border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30" : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
      } ${isHidden ? "opacity-40" : ""} ${getCardPulseClass(session)}`}
    >
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
        >
          <Icon path={sourceIcons[session.source] ?? mdiConsoleLine} size={0.45} />
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
            className={`text-sm truncate flex-1 ${canRename ? "cursor-text" : ""}`}
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
            title="Rename session"
          >
            <Icon path={mdiPencilOutline} size={0.45} />
          </button>
        )}
        <span
          className="text-[10px] text-[var(--text-muted)]"
          title={`Started ${new Date(session.startedAt).toLocaleString()}`}
        >
          {formatRelativeTime(now - selectBadgeTimestamp(session))}
        </span>
        {/* Hide/unhide button */}
        {isHidden ? (
          <button
            onClick={(e) => { e.stopPropagation(); onUnhide(session.id); }}
            className="text-[var(--text-tertiary)] hover:text-green-400 p-0.5 flex-shrink-0"
            title="Show session"
            data-testid="session-unhide-btn"
          >
            <Icon path={mdiEyeOutline} size={0.45} />
          </button>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onHide(session.id); }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-muted)] p-0.5 flex-shrink-0"
            title="Hide session"
            data-testid="session-hide-btn"
          >
            <Icon path={mdiEyeOffOutline} size={0.45} />
          </button>
        )}
        {isAlive && onShutdown && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (session.status === "streaming") {
                if (!window.confirm("Session is currently running. Exit anyway?")) return;
              }
              onShutdown(session.id);
            }}
            className="text-[var(--text-muted)] hover:text-red-400 p-0.5 flex-shrink-0"
            title="Exit pi session"
            data-testid="session-close-btn"
          >
            <Icon path={mdiClose} size={0.5} />
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
                disabled={session.resuming}
                className="text-[10px] px-1.5 py-0.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Resume session (continue same session)"
              >
                <Icon path={mdiPlayCircleOutline} size={0.4} className="inline mr-0.5" />Resume
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onResume("fork"); }}
              disabled={session.resuming}
              className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Fork session (new session from this point)"
            >
              <Icon path={mdiSourceFork} size={0.4} className="inline mr-0.5" />Fork
            </button>
          </>
        )}
      </div>

      {/* Line 3: activity (left) | context bar + cost (right) */}
      <div className="flex items-center mt-0.5 text-[11px] gap-2">
        <ActivityIndicator session={session} />
        <span className="flex-1" />
        <ContextUsageBar
          tokens={contextUsage?.tokens ?? null}
          contextWindow={contextUsage?.contextWindow}
          compact
        />
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

      {/* Flow activity badge */}
      {session.activeFlowName ? (
        <FlowActivityBadge
          flowName={session.activeFlowName}
          agentsDone={session.flowAgentsDone}
          agentsTotal={session.flowAgentsTotal}
          status={session.flowStatus}
        />
      ) : null}

      {/* Subcard stack — see change: redesign-session-card-subcards */}
      {/* Worktree indicator */}
      <WorktreeIndicator session={session} />

      {/* OPENSPEC subcard */}
      {openspecChanges && onSendPrompt && onAttachProposal && onDetachProposal && (
        <SessionSubcard title="OPENSPEC">
          <SessionOpenSpecActions
            session={session}
            changes={openspecChanges}
            onAttach={onAttachProposal}
            onDetach={onDetachProposal}
            onSendPrompt={onSendPrompt}
            onReadArtifact={onReadArtifact}
            onBulkArchive={onBulkArchive}
            groups={openspecGroups}
            assignments={openspecAssignments}
          />
        </SessionSubcard>
      )}

      {/* WORKSPACE subcard — git info + plugin badge contributions */}
      <WorkspaceSubcard session={session} showGitInfo={showGitInfo} />

      {/* PROCESS subcard */}
      {processes && processes.length > 0 && onKillProcess && (
        <SessionSubcard title="PROCESS">
          <ProcessList processes={processes} onKill={onKillProcess} />
        </SessionSubcard>
      )}

      {/* MEMORY subcard — plugin slot only */}
      <MemorySubcard session={session} />

      {/* FLOWS subcard */}
      {flows && onFlowAction && (
        <SessionSubcard title="FLOWS">
          <SessionFlowActions
            flows={flows}
            hasFlowsNew={commands?.some(c => c.name === "flows:new") ?? false}
            hasFlowsEdit={commands?.some(c => c.name === "flows:edit") ?? false}
            hasFlowsDelete={commands?.some(c => c.name === "flows:delete") ?? false}
            onFlowAction={onFlowAction}
          />
        </SessionSubcard>
      )}

      {/* Plugin slot: session-card-action-bar — generic card footer.
          Currently no claimers after jj/honcho rerouted to workspace-action-bar /
          session-card-memory; kept rendered for future generic plugins. */}
      <SessionCardActionBarSlot session={session} />
      </div>{/* end card content */}
      </div>{/* end flex row */}
    </li>
  );
}

/**
 * WORKSPACE subcard — git/jj info plus plugin badge contributions.
 * Hidden when both showGitInfo is false AND no plugin claims session-card-badge.
 * See change: redesign-session-card-subcards (D4).
 */
function WorkspaceSubcard({ session, showGitInfo }: { session: DashboardSession; showGitInfo: boolean }) {
  const hasBadge = useSlotHasClaimsForSession("session-card-badge", session);
  const hasActions = useSlotHasClaimsForSession("workspace-action-bar", session);
  if (!showGitInfo && !hasBadge && !hasActions) return null;
  return (
    <SessionSubcard title="WORKSPACE">
      {showGitInfo ? <GitInfo session={session} /> : null}
      {hasBadge ? <SessionCardBadgeSlot session={session} /> : null}
      {hasActions ? <WorkspaceActionBarSlot session={session} /> : null}
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
    <SessionSubcard title="MEMORY">
      <SessionCardMemorySlot session={session} />
    </SessionSubcard>
  );
}
