import React, { useState, useEffect, type ReactNode } from "react";
import { getApiBase } from "../lib/api-context.js";
import { Icon } from "@mdi/react";
import { mdiFlash, mdiOpenInNew, mdiPencil, mdiPencilOutline, mdiSourceBranch, mdiClose, mdiEyeOffOutline, mdiEyeOutline, mdiConsoleLine, mdiRobotOutline, mdiCodeTags, mdiApplicationOutline, mdiCommentQuestion, mdiPlayCircleOutline, mdiSourceFork, mdiPaperclip } from "@mdi/js";
import type { DashboardSession, ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getSessionDisplayName } from "../lib/session-display-name.js";
import { formatRelativeTime, formatTokens } from "../lib/format.js";
import { selectBadgeTimestamp } from "../lib/session-card-time.js";
import type { DetectedEditor } from "../lib/editor-api.js";
import { ContextUsageBar } from "./ContextUsageBar.js";
import type { ContextUsageInfo } from "./SessionList.js";
import type { OpenSpecData, OpenSpecChange } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { SessionOpenSpecActions } from "./SessionOpenSpecActions.js";
import { OpenSpecActivityBadge } from "./OpenSpecActivityBadge.js";
import { InlineRenameInput } from "./InlineRenameInput.js";
import {
  FlowActivityBadge,
  SessionFlowActions,
} from "@blackbelt-technology/pi-dashboard-flows-plugin/client";
import {
  JjWorkspaceBadge,
  JjActionBar,
  JjInitAffordance,
  isInJjRepo,
  isInJjWorkspace,
  isInGitRepoButNotJj,
} from "@blackbelt-technology/pi-dashboard-jj-plugin/client";
import { ProcessList, type ProcessEntry } from "./ProcessList.js";
import type { CommandInfo, FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useMobile } from "../hooks/useMobile.js";
import { SessionCardBadgeSlot, SessionCardActionBarSlot } from "@blackbelt-technology/dashboard-plugin-runtime";
import { CurrentPluginLayer } from "@blackbelt-technology/dashboard-plugin-runtime/context";

export const statusColors: Record<string, string> = {
  active: "bg-green-500",
  streaming: "bg-yellow-500 animate-pulse",
  idle: "bg-green-500",
  ended: "bg-[var(--bg-surface)]",
};

export const sourceBadgeColors: Record<string, string> = {
  tui: "text-blue-400",
  zed: "text-purple-400",
  tmux: "text-orange-400",
  dashboard: "text-blue-400",
  terminal: "text-cyan-400",
  unknown: "text-[var(--text-tertiary)]",
};

const sourceIcons: Record<string, string> = {
  tui: mdiConsoleLine,
  dashboard: mdiRobotOutline,
  tmux: mdiApplicationOutline,
  zed: mdiCodeTags,
  terminal: mdiConsoleLine,
};

const sourceLabels: Record<string, string> = {
  tui: "TUI",
  dashboard: "Headless",
  tmux: "tmux",
  zed: "Zed",
  terminal: "Terminal",
};

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
}) {
  const isSelected = selectedId === session.id;
  const [isRenaming, setIsRenaming] = useState(false);
  const canRename = session.status !== "ended" && !!onRename;
  const isAlive = session.status !== "ended";
  const isMobile = useMobile();
  const dotColor = session.resuming
    ? "bg-yellow-500 animate-pulse"
    : hasError
      ? "bg-red-500"
      : (statusColors[session.status] ?? "bg-[var(--bg-surface)]");

  function handleConfirmRename(name: string) {
    setIsRenaming(false);
    onRename?.(name);
  }

  // Simplified mobile card
  if (isMobile) {
    return (
      <li
        onClick={() => onSelect(session.id)}
        className={`px-4 py-3 cursor-pointer rounded-xl shadow-md shadow-[var(--shadow-card)] border hover:shadow-lg transition-all duration-200 ${
          isSelected ? "border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30" : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
        } ${isHidden ? "opacity-40" : ""} ${getCardPulseClass(session)}`}
      >
        {/* Line 1: status dot + name + age */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`}
          />
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
      onClick={() => onSelect(session.id)}
      className={`px-3 py-2.5 cursor-pointer rounded-xl shadow-md shadow-[var(--shadow-card)] border hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${
        isSelected ? "border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30" : "border-[var(--border-subtle)] bg-[var(--bg-tertiary)]"
      } ${isHidden ? "opacity-40" : ""} ${getCardPulseClass(session)}`}
    >
      <div className="flex gap-2">
      {/* Left gutter: source icon vertically centered */}
      <div className="flex flex-col items-center flex-shrink-0 w-4 pt-1">
        <span
          className={`w-2 h-2 rounded-full ${dotColor}`}
        />
        <span className="flex-1" />
        <span
          className={`${sourceBadgeColors[session.source] ?? "text-[var(--text-tertiary)]"}`}
          title={sourceLabels[session.source] ?? session.source}
        >
          <Icon path={sourceIcons[session.source] ?? mdiConsoleLine} size={0.55} />
        </span>
        <span className="flex-1" />
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

      {/* Line 4: git info (only for single-session groups) */}
      {showGitInfo && <GitInfo session={session} />}

      {/* jj-plugin row (badge + action bar in one inline row, before
          OpenSpec). Direct wiring mirrors the flows-plugin pattern until
          the slot runtime population lands; manifest claims describe the
          same contract for forward-compat. See change: add-jj-workspace-plugin. */}
      {(isInJjWorkspace(session) || isInJjRepo(session) || isInGitRepoButNotJj(session)) && (
        <CurrentPluginLayer pluginId="jj">
          <div className="flex items-center gap-1.5 flex-wrap" data-testid="jj-row">
            {isInJjWorkspace(session) && <JjWorkspaceBadge session={session} />}
            {isInJjRepo(session) && <JjActionBar session={session} />}
            {isInGitRepoButNotJj(session) && <JjInitAffordance session={session} />}
          </div>
        </CurrentPluginLayer>
      )}

      {/* Thin divider before action row */}
      {/* OpenSpec attach/actions */}
      {openspecChanges && onSendPrompt && onAttachProposal && onDetachProposal && (
        <SessionOpenSpecActions
          session={session}
          changes={openspecChanges}
          onAttach={onAttachProposal}
          onDetach={onDetachProposal}
          onSendPrompt={onSendPrompt}
          onReadArtifact={onReadArtifact}
          onBulkArchive={onBulkArchive}
        />
      )}
      {/* Plugin slot: session-card-badge (additive, coexists with OpenSpec/Flow badges) */}
      <SessionCardBadgeSlot session={session} />
      {/* Plugin slot: session-card-action-bar (additive, coexists with OpenSpec/Flow actions) */}
      <SessionCardActionBarSlot session={session} />

      {/* Flow launcher */}
      {flows && onFlowAction && (
        <SessionFlowActions
          flows={flows}
          hasFlowsNew={commands?.some(c => c.name === "flows:new") ?? false}
          hasFlowsEdit={commands?.some(c => c.name === "flows:edit") ?? false}
          hasFlowsDelete={commands?.some(c => c.name === "flows:delete") ?? false}
          onFlowAction={onFlowAction}
        />
      )}
      {/* Active child processes */}
      {processes && processes.length > 0 && onKillProcess && (
        <ProcessList processes={processes} onKill={onKillProcess} />
      )}
      </div>{/* end card content */}
      </div>{/* end flex row */}
    </li>
  );
}
