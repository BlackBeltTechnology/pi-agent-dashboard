import { SidebarFolderSectionSlot } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { CommandInfo, DashboardSession, ImageContent, OpenSpecData, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { DndContext, type DragEndEvent, type DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { mdiChevronDown, mdiChevronRight, mdiChevronUp, mdiCog, mdiConsoleLine, mdiFolder, mdiFolderOpen, mdiOpenInNew, mdiPin, mdiPlus, mdiPuzzleOutline, mdiSortVariant } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useFolderUrgencySort } from "../../hooks/useFolderUrgencySort.js";
import { useInstallPrompt } from "../../hooks/useInstallPrompt.js";
import { maybeAutoInitWorktreeOnSpawn } from "../../lib/git/auto-init-worktree.js";
import { encodeFolderPath } from "../../lib/util/folder-encoding.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { buildFolderHomeUrl } from "../../lib/nav/route-builders.js";
// TerminalCard removed — terminals now in TerminalsView
import {
  getCollapsedGroups,
  pruneStaleCollapsedGroups,
  removeLegacyHiddenSessions,
  setCollapsedGroups,
} from "../../lib/session/session-filter-storage.js";
import {
  type DirectoryGroup,
  filterByQuery,
  filterSessions,
  groupSessionsByDirectory,
  groupSessionsByDirectoryWithWorkspaces,
  sortSessionsByOrder,
} from "../../lib/session/session-grouping.js";
import { selectedCardScrollFingerprint } from "../../lib/session/session-list-scroll.js";
import { floatAskUserFirst } from "../../lib/session/session-status-visuals.js";
import { resolveWorkspaceFolderReorder, resolveWorkspaceReorder, sameTypeClosestCenter } from "../../lib/layout/sidebar-dnd.js";
import { truncatePathMiddle } from "../../lib/util/truncate-path.js";
import { AddToWorkspaceMenu } from "../workspace/AddToWorkspaceMenu.js";
import { BranchSwitchDialog } from "../worktree/BranchSwitchDialog.js";
import { DashboardSpawnButtons } from "./DashboardSpawnButtons.js";
import { FolderActionBar } from "../folder/FolderActionBar.js";
import { FolderNeedsYouPill } from "../folder/FolderNeedsYouPill.js";
import { FolderOpenSpecSection } from "../openspec/FolderOpenSpecSection.js";
import { FolderSpawnButtons } from "../folder/FolderSpawnButtons.js";
import { FolderStatusRollup } from "../folder/FolderStatusRollup.js";
import { InstallButton } from "../packages/InstallButton.js";
import { NewWorkspaceDialog } from "../workspace/NewWorkspaceDialog.js";
import { PiLogo } from "../primitives/PiLogo.js";
import { PinDirectoryDialog } from "../workspace/PinDirectoryDialog.js";
import { PlaceholderSessionCard } from "./PlaceholderSessionCard.js";
import { branchCache, GroupGitInfo, SessionCard } from "./SessionCard.js";
import { SortablePinnedGroup, useFolderDragHandle } from "./SortablePinnedGroup.js";
import { SortableSessionCard } from "./SortableSessionCard.js";
import { SortableWorkspace } from "../workspace/SortableWorkspace.js";
import { SortableWorkspaceFolder } from "../workspace/SortableWorkspaceFolder.js";
import { SpawnErrorBanner } from "./SpawnErrorBanner.js";
import { ThemePicker } from "../settings/ThemePicker.js";
import { ThemeToggle } from "../settings/ThemeToggle.js";
import { Toast, useToast } from "../primitives/Toast.js";
import { TunnelButton } from "../connectivity/TunnelButton.js";
import { allTagsInUse } from "../tags/all-tags.js";
import { TagFilterGroup } from "../tags/TagFilterGroup.js";
import { WorkspaceHeader } from "../workspace/WorkspaceHeader.js";
import { WorktreeSpawnDialog } from "../worktree/WorktreeSpawnDialog.js";


export interface ContextUsageInfo {
  tokens: number | null;
  contextWindow: number;
  /** Compaction metadata for the ContextUsageBar badge (live sessions only).
   * See change: adopt-pi-074-080-features (C.1). */
  compaction?: import("../../lib/chat/event-reducer.js").CompactionState;
}

/** Escape a session id for a `[data-session-id="…"]` selector. */
function cssEscapeId(id: string): string {
  return (typeof window !== "undefined" && typeof window.CSS?.escape === "function")
    ? window.CSS.escape(id)
    : id.replace(/"/g, '\\"');
}

interface Props {
  sessions: DashboardSession[];
  selectedId?: string;
  onSelect: (sessionId: string) => void;
  /** One-shot seek-to-card request `{ sessionId, nonce }` from App. A bumped
   *  nonce re-fires the reveal even for the already-selected session.
   *  See change: add-seek-to-session-card. */
  revealRequest?: { sessionId: string; nonce: number } | null;
  /** Re-dispatch a seek for a session id (wired to App's `seekToCard`). Used
   *  by the reveal-timeout toast's Retry action. See change:
   *  add-seek-to-session-card. */
  onSeekToCard?: (sessionId: string) => void;
  contextUsageMap?: Map<string, ContextUsageInfo>;
  openspecMap?: Map<string, OpenSpecData>;
  /**
   * Folder-HEAD branch map (`cwd → branch | null`), synced via `git_head_update`.
   * Outranks child-session branches in `GroupGitInfo`. See change:
   * refresh-folder-header-branch.
   */
  folderGitMap?: Map<string, string | null>;
  openspecGroupsMap?: Map<string, { groups: OpenSpecGroup[]; assignments: Record<string, string>; changeOrder?: Record<string, string[]> }>;
  sessionOrderMap?: Map<string, string[]>;
  onReorderSessions?: (cwd: string, sessionIds: string[]) => void;
  onSendPrompt?: (sessionId: string, text: string, images?: ImageContent[]) => void;

  onOpenSpecRefresh?: (cwd: string) => void;
  onAttachProposal?: (sessionId: string, changeName: string) => void;
  onBulkArchive?: (cwd: string) => void;
  onReadArtifact?: (cwd: string, changeName: string, artifactId: string) => void;
  onOpenPiResources?: (cwd: string) => void;
  onDetachProposal?: (sessionId: string) => void;
  /** Accept/dismiss a suggested proposal replacement.
   *  See change: replace-proposal-dialog-with-race-handling. */
  onReplaceProposal?: (sessionId: string, accept: boolean, changeName: string) => void;
  onRename?: (sessionId: string, name: string) => void;
  onShutdown?: (sessionId: string) => void;
  onResume?: (sessionId: string, mode: "continue" | "fork") => void;
  /**
   * Drag-to-resume entry point. Distinct from `onResume` so the WS
   * message can carry `placement: "keep"`, preserving the dropped slot
   * through the resume round-trip.
   * See change: differentiate-resume-intent-by-trigger.
   */
  onResumeKeepPosition?: (sessionId: string) => void;
  onHideSession?: (sessionId: string) => void;
  onUnhideSession?: (sessionId: string) => void;
  onSpawnSession?: (cwd: string, attachProposal?: string, opts?: { gitWorktreeBase?: string; placeholderCwd?: string; initialPrompt?: string }) => void;
  spawningCwds?: Set<string>;
  /**
   * Add/remove a cwd from the spawning set (placeholder + disabled-button).
   * Wired to `WorktreeSpawnDialog`'s `onSpawnStart` / `onSpawnAbort` so a
   * placeholder appears under the PARENT group from dialog submit and is
   * removed on `createWorktree` failure.
   * See change: add-worktree-spawn-placeholder-card.
   */
  addSpawningCwd?: (cwd: string) => void;
  clearSpawningCwd?: (cwd: string) => void;
  spawnResult?: { success: boolean; message: string } | null;
  onSpawnResultSeen?: () => void;
  pinnedDirectories?: string[];
  onPinDirectory?: (dirPath: string) => void;
  /** Called when the "Add folder" button is clicked. Opens the app-level PinDirectoryDialog. */
  onOpenPinDialog?: () => void;
  onUnpinDirectory?: (dirPath: string) => void;
  onReorderPinnedDirs?: (paths: string[]) => void;
  // ── folder-workspaces ──────────────────────────────────
  /** Reorder workspace containers. Sends `reorder_workspaces`. */
  onReorderWorkspaces?: (ids: string[]) => void;
  /** Reorder folders within one workspace. Sends `reorder_workspace_folders`. */
  onReorderWorkspaceFolders?: (id: string, paths: string[]) => void;
  workspaces?: import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").Workspace[];
  onCreateWorkspace?: (name: string) => void;
  onRenameWorkspace?: (id: string, name: string) => void;
  onDeleteWorkspace?: (id: string) => void;
  onSetWorkspaceCollapsed?: (id: string, collapsed: boolean) => void;
  onAddFolderToWorkspace?: (id: string, path: string) => void;
  onRemoveFolderFromWorkspace?: (id: string, path: string) => void;
  terminals?: TerminalSession[];
  onKillTerminal?: (terminalId: string) => void;
  onRenameTerminal?: (terminalId: string, title: string) => void;
  onCollapseSidebar?: () => void;
  commandsMap?: Map<string, CommandInfo[]>;

  onKillProcess?: (sessionId: string, pgid: number) => void;
  /**
   * Persist the per-session background-processes drawer collapse toggle.
   * See change: persist-process-drawer-collapse.
   */
  onSetProcessDrawer?: (sessionId: string, collapsed: boolean) => void;
  /**
   * Per-session in-flight bash toolCalls for the SessionActivityBar.
   * See change: redesign-process-list-activity-bar.
   */
  inflightBashMap?: Map<string, import("../../hooks/useInflightBashTools.js").InflightBashTool[]>;
  /**
   * Stop-button handler for the SessionActivityBar. The toolCallId is
   * accepted for forward-compat; Phase 1 maps to the session-level abort.
   */
  onAbortTool?: (sessionId: string, toolCallId: string) => void;
  onOpenSpecs?: (cwd: string) => void;
  onOpenArchive?: (cwd: string) => void;
  /** Navigate to the full-page OpenSpec board for a cwd. See change: redesign-openspec-board. */
  onOpenBoard?: (cwd: string) => void;
  onOpenTerminals?: (cwd: string) => void;
  onOpenEditor?: (cwd: string) => void;
  /** Extra content rendered in the sidebar header toolbar */
  headerExtra?: React.ReactNode;
  /** Set of session IDs that have an active error */
  errorSessionIds?: Set<string>;
  /** Set of session IDs currently in a synthesized provider-retry phase (no terminal error). */
  retrySessionIds?: Set<string>;
  /** Set of session IDs whose last turn was only reasoning (non-error notice).
   *  See change: fix-gemini-subagent-silent-tool-schema-failure. */
  noticeSessionIds?: Set<string>;
  /** Per-workspace spawn errors (cwd → detail). See change: spawn-failure-diagnostics. */
  spawnErrors?: Map<string, import("../../hooks/useMessageHandler.js").SpawnErrorDetail>;
  /** Dismiss a spawn error for a workspace */
  onDismissSpawnError?: (cwd: string) => void;
  /** Per-session resume errors (sessionId → message) */
  resumeErrors?: Map<string, string>;
  /** Dismiss a resume error for a session */
  onDismissResumeError?: (sessionId: string) => void;
  /**
   * UI preference: show worktree spawn buttons (folder `+Worktree` and
   * per-change `⥂2+`). Defaults to `true` when undefined. App wires this
   * from `/api/config.gitWorktreeEnabled`. See change:
   * openspec-worktree-spawn-button.
   */
  gitWorktreeEnabled?: boolean;
}

// Re-export for backwards compatibility
export { type DirectoryGroup, filterSessions, groupSessionsByDirectory } from "../../lib/session/session-grouping.js";

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded border ${
        active
          ? "border-blue-500/50 text-blue-400 bg-blue-500/10"
          : "border-[var(--border-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {children}
    </button>
  );
}

export function SessionList({ sessions, selectedId, onSelect, revealRequest, onSeekToCard, contextUsageMap, openspecMap, folderGitMap, openspecGroupsMap, sessionOrderMap, onReorderSessions, onSendPrompt, onOpenSpecRefresh, onAttachProposal, onDetachProposal, onReplaceProposal, onBulkArchive, onReadArtifact, onOpenPiResources, onRename, onShutdown, onResume, onResumeKeepPosition, onHideSession, onUnhideSession, onSpawnSession, spawningCwds, addSpawningCwd, clearSpawningCwd, spawnResult, onSpawnResultSeen, pinnedDirectories, onPinDirectory, onOpenPinDialog, onUnpinDirectory, onReorderPinnedDirs, onReorderWorkspaces, onReorderWorkspaceFolders, workspaces, onCreateWorkspace, onRenameWorkspace, onDeleteWorkspace, onSetWorkspaceCollapsed, onAddFolderToWorkspace, onRemoveFolderFromWorkspace, terminals, onKillTerminal, onRenameTerminal, onCollapseSidebar, commandsMap, onKillProcess, onSetProcessDrawer, inflightBashMap, onAbortTool, onOpenSpecs, onOpenArchive, onOpenBoard, onOpenTerminals, onOpenEditor, headerExtra, errorSessionIds, retrySessionIds, noticeSessionIds, spawnErrors, onDismissSpawnError, resumeErrors, onDismissResumeError, gitWorktreeEnabled: gitWorktreeEnabledProp }: Props) {
  const { t } = useI18n();
  // UI preference flag, default-on. Gates folder `+Worktree` and per-change
  // `⥂2+` buttons. See change: openspec-worktree-spawn-button.
  const gitWorktreeEnabled = gitWorktreeEnabledProp ?? true;
  const now = Date.now();
  const [, navigate] = useLocation();
  const { messages, showToast, dismissToast } = useToast();
  const installPrompt = useInstallPrompt();

  // Scroll-to-selected-card wiring.
  // See change: auto-scroll-selected-session-card.
  // - Scroll on background re-sort of unchanged selection (status/hidden/cwd/order index).
  // - One-shot scroll on first mount when selectedId is set (deep-link arrival).
  // - Do NOT scroll on subsequent selectedId changes (user click / programmatic switch).
  const listRef = useRef<HTMLDivElement | null>(null);
  const prevSelectedRef = useRef<string | undefined>(selectedId);
  const firstMountRef = useRef(true);
  const scrollFingerprint = useMemo(
    () => selectedCardScrollFingerprint(selectedId, sessions, sessionOrderMap),
    [selectedId, sessions, sessionOrderMap],
  );
  useEffect(() => {
    if (scrollFingerprint === null) {
      // Even when noop'ing, keep prev-selected ref in sync so a subsequent
      // background re-sort of a newly-clicked selection scrolls correctly.
      prevSelectedRef.current = selectedId;
      firstMountRef.current = false;
      return;
    }
    const selectionChanged = prevSelectedRef.current !== selectedId;
    prevSelectedRef.current = selectedId;
    const isFirstMount = firstMountRef.current;
    firstMountRef.current = false;
    if (!isFirstMount && selectionChanged) {
      // User clicked / programmatic switch — do not hijack scroll position.
      return;
    }
    if (!selectedId) return;
    const escaped = cssEscapeId(selectedId);
    const el = listRef.current?.querySelector(`[data-session-id="${escaped}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
      (el as HTMLElement).scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [scrollFingerprint, selectedId]);


  // Remove legacy client-side hidden storage on mount
  useEffect(() => {
    removeLegacyHiddenSessions();
  }, []);

  // Show toast for spawn results
  useEffect(() => {
    if (spawnResult) {
      // Split the ternary so success/failure carry distinct severity variants
      // — a trailing single arg would tag BOTH branches. See change:
      // unify-message-severity-colors (D3).
      if (spawnResult.success) {
        showToast(spawnResult.message, "success");
      } else {
        showToast(
          `${t("sessionList.sessionFailed", undefined, "+Session failed")}: ${spawnResult.message}`,
          "error",
        );
      }
      onSpawnResultSeen?.();
    }
  }, [spawnResult, showToast, onSpawnResultSeen]);

  const [branchDialogCwd, setBranchDialogCwd] = useState<string | null>(null);
  // Worktree spawn dialog: when set, render the modal scoped to this cwd.
  // See change: add-worktree-spawn-dialog.
  const [worktreeDialogCwd, setWorktreeDialogCwd] = useState<string | null>(null);
  // Per-change worktree spawn state. When set, render the dialog prefilled
  // with `os/<changeName>` + `attachProposal=<changeName>`. Reuses the
  // existing `WorktreeSpawnDialog` component to avoid duplicate state.
  // See change: openspec-worktree-spawn-button.
  const [worktreeForChange, setWorktreeForChange] = useState<{ cwd: string; changeName: string } | null>(null);

  // Filter state - active-only defaults to ON
  // Single visibility toggle: `Show hidden`. The previous `Active only`
  // toggle was removed in favour of universal active-first ranking and
  // per-folder search. Ended sessions
  // are always visible but ranked below active ones; hidden sessions
  // are off by default and surfaced via this single toggle.
  // See change: pin-and-search-sessions (design D1 revised).
  const [showHidden, setShowHidden] = useState(false);
  // Sidebar-level search/filter.
  //   - workspaceFilter: substring match against the folder path.
  //     Narrows the folder list. Matching folders auto-expand.
  //   - sessionSearch: case-insensitive match against session.name /
  //     firstMessage. Sessions outside the matching set are hidden;
  //     the folder containing them auto-expands to reveal the match.
  // Both filters compose with `Show hidden`. AND-composition when both
  // are filled. See change: pin-and-search-sessions (design D1 revised).
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [sessionSearch, setSessionSearch] = useState("");
  // Tag + phase filter axes. Kept as TWO SEPARATE sets so a user tag named
  // `apply` and an openspecPhase of `apply` never collide. OR-within each
  // axis; AND-across axes and with folder/search. See change: add-session-tags.
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set());
  // Per-folder "show ended" expansion state. Ended sessions are collapsed
  // by default inside each folder; a minimal `Show N ended` row at the
  // bottom toggles. State is keyed by cwd; absent = collapsed (default).
  // The session-search query auto-expands ended in matching folders.
  const [endedExpanded, setEndedExpanded] = useState<Set<string>>(new Set());
  // Per-folder opt-in urgency sort (default off). See change:
  // improve-dashboard-attention-routing.
  const urgencySort = useFolderUrgencySort();
  const toggleEndedExpanded = useCallback((cwd: string) => {
    setEndedExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) next.delete(cwd);
      else next.add(cwd);
      return next;
    });
  }, []);

  // Collapsed groups state
  const [collapsedGroups, setCollapsedGroupsState] = useState(() => getCollapsedGroups());

  // Prune stale collapsed groups when sessions change
  useEffect(() => {
    if (sessions.length === 0) return;
    const knownCwds = new Set(sessions.map((s) => s.cwd));
    const prunedGroups = pruneStaleCollapsedGroups(knownCwds);
    setCollapsedGroupsState(prunedGroups);
  }, [sessions.length]);



  const handleHide = useCallback((id: string) => {
    onHideSession?.(id);
  }, [onHideSession]);

  const handleToggleCollapse = useCallback((cwd: string) => {
    setCollapsedGroupsState((prev) => {
      const next = new Set(prev);
      if (next.has(cwd)) {
        next.delete(cwd);
      } else {
        next.add(cwd);
      }
      setCollapsedGroups(next);
      return next;
    });
  }, []);

  const handleUnhide = useCallback((id: string) => {
    onUnhideSession?.(id);
  }, [onUnhideSession]);

  // `filterSessions` is called with `activeOnly: false` permanently —
  // active-first ranking now happens per-folder via `rankActiveFirst`,
  // so the global "hide ended" pre-filter is unnecessary.
  const filteredSessions = useMemo(
    () => filterSessions(sessions, false, showHidden),
    [sessions, showHidden],
  );

  const hiddenCount = useMemo(
    () => sessions.filter((s) => s.hidden).length,
    [sessions],
  );

  // Build a map of terminals by cwd for quick lookup
  const terminalsByCwd = useMemo(() => {
    const map = new Map<string, TerminalSession[]>();
    for (const t of terminals ?? []) {
      const existing = map.get(t.cwd);
      if (existing) existing.push(t);
      else map.set(t.cwd, [t]);
    }
    return map;
  }, [terminals]);

  const { pinned: pinnedGroups, unpinned: unpinnedGroups } = useMemo(
    () => groupSessionsByDirectory(filteredSessions, sessionOrderMap, pinnedDirectories),
    [filteredSessions, sessionOrderMap, pinnedDirectories],
  );
  // folder-workspaces: derive workspace tier and the top-level view that
  // EXCLUDES workspace-owned folders. The legacy `pinnedGroups` /
  // `unpinnedGroups` are kept for DnD wiring of the existing pin-reorder
  // behavior; workspace tier sits above them.
  const workspaceTiers = useMemo(() => {
    const list = workspaces ?? [];
    if (list.length === 0) return null;
    const result = groupSessionsByDirectoryWithWorkspaces(
      filteredSessions, list, sessionOrderMap, pinnedDirectories,
    );
    return result;
  }, [workspaces, filteredSessions, sessionOrderMap, pinnedDirectories]);
  // Top-level groups: when any workspace exists, strip out workspace-owned
  // folders so they don't double-render.
  const visibleTopPinned = useMemo(() => {
    if (!workspaceTiers) return pinnedGroups;
    const claimed = new Set<string>(
      (workspaces ?? []).flatMap((w) => w.folders),
    );
    return pinnedGroups.filter((g) => !claimed.has(g.cwd));
  }, [workspaceTiers, pinnedGroups, workspaces]);
  const visibleTopUnpinned = useMemo(() => {
    if (!workspaceTiers) return unpinnedGroups;
    const claimed = new Set<string>(
      (workspaces ?? []).flatMap((w) => w.folders),
    );
    return unpinnedGroups.filter((g) => !claimed.has(g.cwd));
  }, [workspaceTiers, unpinnedGroups, workspaces]);
  const allGroups = useMemo(() => [...pinnedGroups, ...unpinnedGroups], [pinnedGroups, unpinnedGroups]);

  // Reverse lookup: cwd → owning workspace id (or null).
  const folderWorkspaceMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of workspaces ?? []) for (const p of w.folders) m.set(p, w.id);
    return m;
  }, [workspaces]);

  // Inline state for AddToWorkspace popover and NewWorkspace dialog.
  // See change: folder-workspaces.
  const [addToWsMenuFor, setAddToWsMenuFor] = React.useState<string | null>(null);
  const [newWsOpen, setNewWsOpen] = React.useState<{ pendingFolder: string | null } | null>(null);
  // Workspace id awaiting a path-picker selection. When set, a
  // PinDirectoryDialog is open; on confirm the picked folder is added to
  // this workspace AND silently pinned. See change: folder-workspaces.
  const [pickFolderForWsId, setPickFolderForWsId] = React.useState<string | null>(null);
  // After creating a workspace from the AddToWorkspace flow, we need to
  // route the new id to add the pending folder. Server returns the new
  // workspace via `workspaces_updated` broadcast — we detect by ref-check
  // on the previous id set.
  const prevWsIdsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const ids = new Set((workspaces ?? []).map((w) => w.id));
    if (newWsOpen?.pendingFolder) {
      for (const id of ids) {
        if (!prevWsIdsRef.current.has(id)) {
          onAddFolderToWorkspace?.(id, newWsOpen.pendingFolder);
          setNewWsOpen(null);
          break;
        }
      }
    }
    prevWsIdsRef.current = ids;
  }, [workspaces, newWsOpen, onAddFolderToWorkspace]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  // Drag-collapse (workspace, local-only, visual). While a workspace is
  // dragged it renders collapsed regardless of its server-persisted state.
  // MUST NOT emit `set_workspace_collapsed` — only the dragged workspace is
  // affected; restore is automatic via fallback to the server value.
  // See change: workspace-directory-drag-reorder.
  const [forceCollapsed, setForceCollapsed] = useState<Set<string>>(() => new Set());

  const handleDragStart = useCallback((event: DragStartEvent) => {
    if (event.active.data.current?.type === "workspace") {
      setForceCollapsed(new Set([event.active.id as string]));
    }
  }, []);

  const handleDragCancel = useCallback(() => {
    setForceCollapsed((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setForceCollapsed((prev) => (prev.size === 0 ? prev : new Set()));
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    // Cross-type drag is a no-op
    if (activeType !== overType) return;

    if (activeType === "session") {
      for (const group of allGroups) {
        // Session IDs only (terminals moved to TerminalsView)
        const sessionIds = group.sessions.map((s) => s.id);
        const oldIndex = sessionIds.indexOf(active.id as string);
        const newIndex = sessionIds.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newOrder = arrayMove(sessionIds, oldIndex, newIndex);
          onReorderSessions?.(group.cwd, newOrder);
          // Drag-to-resume: if the user dragged an ENDED session onto
          // an ALIVE one (i.e., placed it inside the alive tier), treat
          // that as intent to bring the session back. Auto-resume in
          // continue mode. The persisted order (with the ended id now
          // in the alive zone) means the client filter will pick it up
          // at the dropped position once status flips to alive.
          // See change: pin-and-search-sessions.
          const draggedSession = group.sessions.find((s) => s.id === active.id);
          const overSession = group.sessions.find((s) => s.id === over.id);
          if (
            draggedSession?.status === "ended" &&
            draggedSession.sessionFile &&
            overSession && overSession.status !== "ended"
          ) {
            // Drag-to-resume — the dropped slot was just persisted by
            // the `onReorderSessions` call above; route through the
            // keep-position callback so the server's ended→alive
            // branch does NOT move the id to the front and clobber it.
            // Fallback to onResume for callers that haven't wired the
            // new callback yet (preserves legacy behavior).
            // See change: differentiate-resume-intent-by-trigger.
            if (onResumeKeepPosition) {
              onResumeKeepPosition(draggedSession.id);
            } else {
              onResume?.(draggedSession.id, "continue");
            }
          }
          break;
        }
      }
    } else if (activeType === "pinned-group") {
      const ids = pinnedGroups.map((g) => g.cwd);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(ids, oldIndex, newIndex);
        onReorderPinnedDirs?.(newOrder);
      }
    } else if (activeType === "workspace") {
      const ids = (workspaces ?? []).map((w) => w.id);
      const newOrder = resolveWorkspaceReorder(ids, active.id as string, over.id as string);
      if (newOrder) onReorderWorkspaces?.(newOrder);
    } else if (activeType === "workspace-folder") {
      const wsId = active.data.current?.wsId as string | undefined;
      const ws = (workspaces ?? []).find((w) => w.id === wsId);
      if (!ws) return;
      const newOrder = resolveWorkspaceFolderReorder(
        ws.folders,
        active.id as string,
        over.id as string,
        wsId,
        over.data.current?.wsId as string | undefined,
      );
      if (newOrder) onReorderWorkspaceFolders?.(wsId!, newOrder);
    }
  }, [allGroups, pinnedGroups, workspaces, onReorderSessions, onReorderPinnedDirs, onReorderWorkspaces, onReorderWorkspaceFolders, onResume, onResumeKeepPosition]);

  // Tag/phase axes derived flags + the per-session predicate. OR-within each
  // axis; AND-across. Empty axis = inert. See change: add-session-tags.
  const wantTag = selectedTags.size > 0;
  const wantPhase = selectedPhases.size > 0;
  const anyTagFilterActive = wantTag || wantPhase;
  const passesTagAxes = useCallback(
    (s: DashboardSession): boolean => {
      if (wantTag) {
        const tags = s.tags ?? [];
        if (!tags.some((t) => selectedTags.has(t))) return false;
      }
      if (wantPhase) {
        if (!s.openspecPhase || !selectedPhases.has(s.openspecPhase)) return false;
      }
      return true;
    },
    [wantTag, wantPhase, selectedTags, selectedPhases],
  );

  // Union of tags in use (autocomplete + sidebar filter group) and the phases
  // actually present. Recompute only when the session list changes.
  const allTags = useMemo(() => allTagsInUse(sessions), [sessions]);
  const phasesInUse = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) if (s.openspecPhase) set.add(s.openspecPhase);
    return [...set].sort();
  }, [sessions]);

  const toggleSelectedTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);
  const toggleSelectedPhase = useCallback((phase: string) => {
    setSelectedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  }, []);
  const clearTagFilters = useCallback(() => {
    setSelectedTags(new Set());
    setSelectedPhases(new Set());
  }, []);

  /**
   * Decide whether a folder should be visible given the active filters.
   * Workspace filter matches against folder path; session filter matches
   * against any session title within the folder; the tag/phase axes match
   * against session tags / openspecPhase. All AND'd when set. When any
   * session-level narrowing axis (search OR tag/phase) is active, the folder
   * is visible only when at least one session passes ALL of them (ended
   * included). See change: add-session-tags.
   */
  function folderMatchesFilters(group: DirectoryGroup): boolean {
    const wf = workspaceFilter.trim().toLowerCase();
    const sf = sessionSearch.trim().toLowerCase();
    const folderHit = wf.length === 0 || group.cwd.toLowerCase().includes(wf);
    if (!folderHit) return false;
    const needsSessionMatch = sf.length > 0 || anyTagFilterActive;
    if (!needsSessionMatch) return true;
    let pool = sf.length > 0 ? filterByQuery(group.sessions, sf) : group.sessions;
    if (anyTagFilterActive) pool = pool.filter(passesTagAxes);
    return pool.length > 0;
  }

  /**
   * Force-expand folders when a filter is active so users can immediately
   * see what matched without an extra click. The user-toggled
   * `collapsedGroups` set still controls behavior at rest.
   */
  function isFolderCollapsed(cwd: string): boolean {
    if (workspaceFilter.length > 0 || sessionSearch.length > 0 || anyTagFilterActive) return false;
    return collapsedGroups.has(cwd);
  }

  // ── Seek-to-card reveal (See change: add-seek-to-session-card) ────────────
  // A card can be buried under a collapsed workspace (async server echo),
  // folder, or ended group. `revealCard` GUARD-expands those ancestors, selects
  // the card, then waits for it to lay out — driven by the `workspaces` prop
  // echo, with a fixed 5s give-up backstop — before scrolling + flashing.
  // Presence = laid out (height > 0), NOT `offsetParent` — a collapsed
  // `grid-template-rows: 0fr` row keeps a non-null offsetParent at height 0.
  const findLaidOutCard = useCallback((id: string): HTMLElement | null => {
    const el = listRef.current?.querySelector(
      `[data-session-id="${cssEscapeId(id)}"]`,
    ) as HTMLElement | null;
    return el && el.getBoundingClientRect().height > 0 ? el : null;
  }, []);

  const pendingRevealRef = useRef<{ sessionId: string; nonce: number } | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealRafRef = useRef<number | null>(null);

  const clearPendingReveal = useCallback(() => {
    pendingRevealRef.current = null;
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    if (revealRafRef.current !== null) {
      cancelAnimationFrame(revealRafRef.current);
      revealRafRef.current = null;
    }
  }, []);

  // Try to reveal the pending card if it is laid out; no-op while it is still
  // absent / 0-height (the echo has not landed yet).
  const attemptReveal = useCallback(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    const el = findLaidOutCard(pending.sessionId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("card-seek-flash");
    window.setTimeout(() => el.classList.remove("card-seek-flash"), 1200);
    clearPendingReveal();
  }, [findLaidOutCard, clearPendingReveal]);

  // Flat 3-level ancestor lookup from cwd + status (no graph walk).
  const resolveFoldAncestors = useCallback(
    (s: DashboardSession): { workspaceId?: string; cwd: string; isEnded: boolean } => ({
      workspaceId: folderWorkspaceMap.get(s.cwd),
      cwd: s.cwd,
      isEnded: s.status === "ended",
    }),
    [folderWorkspaceMap],
  );

  // Classify whether the target is unreachable by fold-expansion alone: hidden
  // (needs the global Show-hidden toggle) or excluded by an active filter.
  // Both degrade to an informational toast; we never flip showHidden or clear
  // a filter (broad, unrequested side effects).
  const classifyDegrade = useCallback(
    (s: DashboardSession): "hidden" | "filtered" | null => {
      if (s.hidden && !showHidden) return "hidden";
      if (anyTagFilterActive && !passesTagAxes(s)) return "filtered";
      const sf = sessionSearch.trim().toLowerCase();
      if (sf.length > 0 && filterByQuery([s], sf).length === 0) return "filtered";
      const wf = workspaceFilter.trim().toLowerCase();
      if (wf.length > 0 && !s.cwd.toLowerCase().includes(wf)) return "filtered";
      return null;
    },
    [showHidden, anyTagFilterActive, passesTagAxes, sessionSearch, workspaceFilter],
  );

  // Reveal effect — keyed on `nonce` so re-seeking the same id re-fires;
  // captures the current snapshot at gesture time (no other deps by design).
  // biome-ignore lint/correctness/useExhaustiveDependencies: fires ONLY on a new nonce.
  useEffect(() => {
    if (!revealRequest) return;
    // A new gesture supersedes any in-flight reveal — cancel unconditionally,
    // before the missing-target / degrade early-returns, so a stale pending
    // reveal can never fire for a superseded session.
    clearPendingReveal();
    const target = sessions.find((s) => s.id === revealRequest.sessionId);
    if (!target) return;

    const degrade = classifyDegrade(target);
    if (degrade) {
      showToast(
        degrade === "hidden"
          ? t(
              "sessionList.seekHiddenToast",
              undefined,
              "This session is hidden. Enable “Show hidden” to reveal its card.",
            )
          : t(
              "sessionList.seekFilteredToast",
              undefined,
              "A filter is hiding this session’s card. Clear the filter to reveal it.",
            ),
        "info",
      );
      return;
    }

    // GUARDED ancestor expand: workspace only if collapsed (idempotent server
    // call); folder only if currently collapsed (the mutator is a TOGGLE);
    // ended via an ADD-ONLY setter (never the toggle) so a re-seek can't
    // re-collapse an already-open container.
    const { workspaceId, cwd, isEnded } = resolveFoldAncestors(target);
    if (workspaceId) {
      const ws = (workspaces ?? []).find((w) => w.id === workspaceId);
      if (ws?.collapsed) onSetWorkspaceCollapsed?.(workspaceId, false);
    }
    if (collapsedGroups.has(cwd)) handleToggleCollapse(cwd);
    if (isEnded) {
      setEndedExpanded((prev) => (prev.has(cwd) ? prev : new Set(prev).add(cwd)));
    }
    onSelect(target.id);

    pendingRevealRef.current = { sessionId: target.id, nonce: revealRequest.nonce };
    // Fixed give-up backstop — only catches a never-arriving echo; the event
    // (workspaces prop update) wins the happy path first.
    revealTimerRef.current = setTimeout(() => {
      revealTimerRef.current = null;
      const pending = pendingRevealRef.current;
      if (!pending) return;
      if (findLaidOutCard(pending.sessionId)) {
        attemptReveal();
        return;
      }
      clearPendingReveal();
      showToast(
        t("sessionList.seekTimeoutToast", undefined, "Couldn’t reveal the card."),
        "info",
        {
          action: {
            label: t("common.retry", undefined, "Retry"),
            onClick: () => onSeekToCard?.(pending.sessionId),
          },
          noAutoDismiss: true,
        },
      );
    }, 5000);
    // Immediate attempt after the sync-ancestor re-render paints.
    revealRafRef.current = requestAnimationFrame(() => {
      revealRafRef.current = null;
      attemptReveal();
    });
  }, [revealRequest?.nonce]);

  // The `workspaces` echo landing (async workspace expand resolving) is the
  // primary completion signal — re-check presence when it changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `workspaces` is the completion trigger (echo); pending state read via ref.
  useEffect(() => {
    if (!pendingRevealRef.current) return;
    const id = requestAnimationFrame(() => attemptReveal());
    return () => cancelAnimationFrame(id);
  }, [workspaces, attemptReveal]);

  // Cancel any pending frame/timer on unmount.
  useEffect(() => clearPendingReveal, [clearPendingReveal]);

  /**
   * folder-workspaces: same as renderGroup but injects an "Add to
   * workspace" affordance inside the header. Used for top-level groups
   * only. Workspace-tier folders use the plain renderGroup since their
   * membership is already established.
   */
  function renderGroupWithWorkspaceMenu(group: DirectoryGroup, isPinned: boolean) {
    const owningWsId = folderWorkspaceMap.get(group.cwd) ?? null;
    const menuOpen = addToWsMenuFor === group.cwd;
    return (
      <div className="relative">
        {renderGroup(group, isPinned)}
        {(onCreateWorkspace || (workspaces && workspaces.length > 0)) && (
          <div className="absolute top-1 right-7">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAddToWsMenuFor(menuOpen ? null : group.cwd);
              }}
              className="text-[10px] px-1 py-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--accent-blue)]"
              title={t("sessionList.addToWorkspace", undefined, "Add to workspace")}
              data-testid={`add-to-workspace-btn-${group.cwd}`}
            >
              +ws
            </button>
            {menuOpen && (
              <AddToWorkspaceMenu
                workspaces={workspaces ?? []}
                currentWorkspaceId={owningWsId}
                onPick={(wsId) => {
                  onAddFolderToWorkspace?.(wsId, group.cwd);
                  setAddToWsMenuFor(null);
                }}
                onNewWorkspace={() => {
                  setNewWsOpen({ pendingFolder: group.cwd });
                  setAddToWsMenuFor(null);
                }}
                onRemoveFromWorkspace={() => {
                  if (owningWsId) onRemoveFolderFromWorkspace?.(owningWsId, group.cwd);
                  setAddToWsMenuFor(null);
                }}
                onClose={() => setAddToWsMenuFor(null)}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  function renderGroup(group: DirectoryGroup, isPinned: boolean, inWorkspace: boolean = false) {
    const displayPath = truncatePathMiddle(group.cwd, 45);
    const lastSlash = displayPath.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? displayPath.slice(0, lastSlash + 1) : '';
    const lastSegment = lastSlash >= 0 ? displayPath.slice(lastSlash + 1) : displayPath;
    const isCollapsed = isFolderCollapsed(group.cwd);

    return (
      <div key={group.cwd} className="bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded-[14px] p-1.5 shadow-[inset_0_1px_0_var(--elevation-rim),0_2px_4px_var(--shadow-card)]">
        <div className="flex gap-1.5 px-1 py-1 min-h-[44px] md:min-h-0 rounded">
          {/* Left gutter — chevron at top, drag-handle column extending below */}
          <FolderDragGutter
            isCollapsed={isCollapsed}
            onToggle={() => handleToggleCollapse(group.cwd)}
          />
          <div className="flex-1 min-w-0">
          {/* Whole header row is clickable to open the directory home page —
              same affordance as clicking a session card selects its session.
              Collapse/expand now lives solely on the chevron in the drag
              gutter (folder-toggle-btn). The small mdiOpenInNew icon below is
              kept as a redundant explicit affordance. Child buttons/pills
              stopPropagation so they don't trigger navigation.
              See change: directory-card-clickable-select. */}
          <div
            className="flex items-center gap-1.5 cursor-pointer"
            onClick={() => navigate(buildFolderHomeUrl(group.cwd))}
            title={t("sessionList.openFolderHome", undefined, "Open folder home")}
            data-testid={`folder-home-row-${group.cwd}`}
          >
            <span className="text-xs font-medium text-[var(--text-secondary)] truncate flex items-center gap-1">
              <Icon path={isCollapsed ? mdiFolder : mdiFolderOpen} size={0.5} className="shrink-0" />
              <span className="truncate">{parentPath}</span>
              <span className="font-bold text-base truncate">{lastSegment}</span>
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">({group.sessions.length})</span>
            {/* Needs-you rollup: count of chat-routed ask_user children.
                Pill resolves the target id (widget-bar excluded) and passes it
                up; we select + scroll it into view.
                See change: improve-dashboard-attention-routing. */}
            <FolderNeedsYouPill
              sessions={group.sessions}
              onActivate={(sessionId) => {
                if (!sessionId) return;
                if (isCollapsed) handleToggleCollapse(group.cwd);
                onSelect(sessionId);
                const escaped = cssEscapeId(sessionId);
                requestAnimationFrame(() => {
                  document
                    .querySelector(`[data-session-id="${escaped}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
              }}
            />
            {/* Collapsed status rollup (variant B): working/idle dot-counts so a
                collapsed folder still shows liveness at a glance. Needs-you is
                covered by the pill above. See change:
                condense-collapsed-folder-header. */}
            {isCollapsed && <FolderStatusRollup sessions={group.sessions} />}
            {/* Opt-in per-folder urgency sort toggle (default off). Floats
                blocked sessions to the top. See change:
                improve-dashboard-attention-routing. */}
            <button
              onClick={(e) => { e.stopPropagation(); urgencySort.toggle(group.cwd); }}
              className={`px-1 py-0.5 rounded ${urgencySort.isOn(group.cwd) ? "text-[var(--status-needs-you)]" : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"}`}
              title={t("sessionList.urgencySort", undefined, "Float blocked sessions to top")}
              aria-label={t("sessionList.urgencySort", undefined, "Float blocked sessions to top")}
              aria-pressed={urgencySort.isOn(group.cwd)}
              data-testid={`folder-urgency-sort-${group.cwd}`}
            >
              <Icon path={mdiSortVariant} size={0.5} />
            </button>
            {/* Pin/Unpin toggle. Hidden inside a workspace container — pin
                is irrelevant for visibility/ordering there. The pin state
                itself is preserved on the server (orthogonal to workspace
                membership). See change: folder-workspaces. */}
            {/* Open the directory home page. Distinct from the collapse toggle
                (the name row) and the drag gutter (a sibling) — stopPropagation
                keeps the click from toggling collapse or starting a reorder.
                Pinned rows only. See change: add-directory-home-page (D3).
                Also shown on workspace-folder rows: an unpinned workspace
                folder has `folder.pinned === false`, so `isPinned` alone would
                hide it (change: enable-workspace-folder-home-page, D2). */}
            {(isPinned || inWorkspace) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(buildFolderHomeUrl(group.cwd));
                }}
                className="ml-auto px-1 py-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                title={t("sessionList.openFolderHome", undefined, "Open folder home")}
                aria-label={t("sessionList.openFolderHome", undefined, "Open folder home")}
                data-testid={`folder-open-home-${group.cwd}`}
              >
                <Icon path={mdiOpenInNew} size={0.5} />
              </button>
            )}
            {!inWorkspace && (isPinned || onPinDirectory) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPinned) onUnpinDirectory?.(group.cwd);
                  else onPinDirectory?.(group.cwd);
                }}
                className={`ml-auto px-1 py-0.5 rounded ${isPinned ? "text-yellow-400 hover:text-yellow-300" : "text-[var(--text-tertiary)] hover:text-yellow-400"}`}
                title={isPinned ? t("sessionList.unpinDirectory", undefined, "Unpin directory") : t("sessionList.pinDirectory", undefined, "Pin directory")}
                data-testid={isPinned ? "unpin-dir-btn" : "pin-dir-btn"}
              >
                <Icon path={mdiPin} size={0.55} />
              </button>
            )}
          </div>
          {/* Collapsed density (variant B): when collapsed, the heavy slots
              (git · action bar · plugin sections · OpenSpec proposal state ·
              spawn buttons) are hidden — the header keeps only name + status.
              The drag gutter/head row live ABOVE this block, so drag-reorder
              of a collapsed folder is unaffected.
              See change: condense-collapsed-folder-header. */}
          {!isCollapsed && (<>
          <div className="flex items-center gap-1">
            <GroupGitInfo
              sessions={group.sessions}
              cwd={group.cwd}
              folderBranch={folderGitMap?.has(group.cwd) ? folderGitMap.get(group.cwd) : undefined}
              onBranchClick={() => setBranchDialogCwd(group.cwd)}
            />
          </div>
          <div className="mt-1">
            <FolderActionBar
              cwd={group.cwd}
              terminalCount={terminalsByCwd.get(group.cwd)?.length ?? 0}
              onOpenTerminals={() => onOpenTerminals?.(group.cwd)}
              onOpenEditor={() => onOpenEditor?.(group.cwd)}
              onOpenPiResources={() => onOpenPiResources?.(group.cwd)}
              onInitializeProject={onSpawnSession ? (cwd) => onSpawnSession(cwd, undefined, { initialPrompt: "/skill:project-init" }) : undefined}
              brokenSessionCount={group.sessions.filter((s) => s.cwdMissing === true && s.status === "ended" && !s.hidden).length}
              onCleanUpBroken={onHideSession ? () => {
                for (const s of group.sessions) {
                  if (s.cwdMissing === true && s.status === "ended" && !s.hidden) onHideSession(s.id);
                }
              } : undefined}
            />
          </div>
          {/* Plugin slot: sidebar-folder-section (additive, coexists with FolderOpenSpecSection) */}
          <SidebarFolderSectionSlot folder={{ cwd: group.cwd }} />
          {/* Render for both initialized (full section) and pending (spinner).
              See change: fix-cold-boot-openspec-protocol. */}
          {(openspecMap?.get(group.cwd)?.initialized || openspecMap?.get(group.cwd)?.pending) && (
            <FolderOpenSpecSection
              data={openspecMap.get(group.cwd)!}
              cwd={group.cwd}
              onRefresh={() => onOpenSpecRefresh?.(group.cwd)}
              onOpenBoard={onOpenBoard}
              onOpenSpecs={onOpenSpecs ? () => onOpenSpecs(group.cwd) : undefined}
              onOpenArchive={onOpenArchive ? () => onOpenArchive(group.cwd) : undefined}
            />
          )}
          {/* Elevated spawn buttons: full-width stacked, always visible
              regardless of collapse state. Placed after OpenSpec section. */}
          <div className="mt-1">
            <FolderSpawnButtons
              spawningDisabled={spawningCwds?.has(group.cwd)}
              // Show unless EVERY session in the folder is a confirmed non-git
              // (`isGitRepo === false`). `true`/`undefined` keep the button, so
              // a real repo whose probe timed out / a legacy session never
              // hides it. NOT gated on `gitBranch` (data-arrival signal).
              // See change: gate-session-worktree-button-on-git.
              showWorktree={group.sessions.some((s) => s.isGitRepo !== false) && gitWorktreeEnabled && !!onSpawnSession}
              onSpawnSession={() => {
                if (isCollapsed) handleToggleCollapse(group.cwd);
                onSpawnSession?.(group.cwd);
              }}
              onSpawnWorktree={() => {
                if (isCollapsed) handleToggleCollapse(group.cwd);
                setWorktreeDialogCwd(group.cwd);
              }}
            />
          </div>
          </>)}

          </div>{/* end content column */}
        </div>
        {/* Session + terminal cards — animated collapse */}
        <div className={`group-collapse ${isCollapsed ? "collapsed" : "expanded"}`}>
        <div className="space-y-1 pt-1">
          {/* Spawn error banner — see change: spawn-failure-diagnostics */}
          {spawnErrors?.get(group.cwd) && (
            <SpawnErrorBanner
              detail={spawnErrors.get(group.cwd)!}
              onDismiss={onDismissSpawnError ? () => onDismissSpawnError(group.cwd) : undefined}
            />
          )}
          {spawningCwds?.has(group.cwd) && <PlaceholderSessionCard />}
          {(() => {
            // Render pipeline:
            //   1. Start from `group.sessions` (already filtered by `showHidden`).
            //   2. Narrow by global `sessionSearch` if one is typed.
            //   3. Split into active vs ended buckets.
            //   4. Ended bucket is collapsed by default per folder; the
            //      bottom "Show N ended" row toggles. A non-empty
            //      `sessionSearch` AUTO-EXPANDS ended (because the user's
            //      query may match an ended session). The user's explicit
            //      `endedExpanded` set also wins.
            //   5. Pin partition (§7) is applied to whichever buckets are
            //      currently rendered.
            // See change: pin-and-search-sessions §8.
            let matched = sessionSearch.length > 0
              ? filterByQuery(group.sessions, sessionSearch)
              : group.sessions;
            // Tag/phase axes narrow the in-folder set identically to search.
            // See change: add-session-tags.
            if (anyTagFilterActive) matched = matched.filter(passesTagAxes);
            // Flat-merge mode: when session-search is active AND no
            // folder filter is typed, don't apply the active-first sort —
            // ended results stay inline with active so the user sees
            // results in their natural order. The user opted into
            // searching across pinned folders by typing a session query;
            // they don't also want a status-based reshuffling.
            // See change: pin-and-search-sessions.
            const flatMergeMode = sessionSearch.length > 0 && workspaceFilter.length === 0;
            // Stable status-partition of the single stored order: each tier
            // is ordered by the flat `sessionOrder` (relative position
            // preserved), with ids absent from the order appended by
            // startedAt desc. Because the partition is stable, a server
            // `moveToFront` lands a card at the top of its OWN tier (active
            // or ended). The old endedAt-desc ended-tier sort is gone — the
            // ended tier now derives from the stored order, which the server
            // backfills by endedAt on first load (migration seed).
            // See change: simplify-session-card-ordering.
            const order = sessionOrderMap?.get(group.cwd);
            const activeSessionsOrdered = sortSessionsByOrder(
              matched.filter((s) => s.status !== "ended"),
              order,
            );
            // Opt-in urgency sort floats ask_user sessions to the top of the
            // active tier (stable within groups). See change:
            // improve-dashboard-attention-routing.
            const activeSessions = urgencySort.isOn(group.cwd)
              ? floatAskUserFirst(activeSessionsOrdered)
              : activeSessionsOrdered;
            const endedSessions = sortSessionsByOrder(
              matched.filter((s) => s.status === "ended"),
              order,
            );
            const showEnded =
              endedSessions.length > 0 &&
              (endedExpanded.has(group.cwd) || sessionSearch.length > 0 || anyTagFilterActive);
            const visibleSessions = flatMergeMode
              ? sortSessionsByOrder(matched, order) // mixed-status, flat stored order
              : (showEnded
                  ? [...activeSessions, ...endedSessions]
                  : activeSessions);
            // Empty-state: search query active but nothing matched in
            // this folder. Still rendered inline so the user can clear
            // and recover.
            if ((sessionSearch.length > 0 || anyTagFilterActive) && matched.length === 0) {
              return (
                <div
                  className="text-xs text-[var(--text-muted)] italic px-2 py-2 select-none"
                  data-testid="folder-search-empty"
                >
                  {t("sessionList.noSessionsMatch", undefined, "No sessions match your search")}
                </div>
              );
            }
            const sessionIds = visibleSessions.map((s) => s.id);
            const sessionMap = new Map(visibleSessions.map((s) => [s.id, s]));
            // `visibleSessions` is already in final render order — each tier
            // ordered by the stored flat order (status-partition), active
            // tier then ended tier. No further flat re-application (which
            // would re-interleave active and ended).
            // See change: simplify-session-card-ordering.
            const allIds = sessionIds;
            // Index of the first ended card in the rendered order — used
            // to inject a top "Hide ended" button when ended sessions are
            // currently expanded. Only meaningful in the non-flat layout
            // where active and ended are separated; in flat-merge mode
            // (search across pinned, mixed-status), no inline button.
            const firstEndedIdx = !flatMergeMode && showEnded
              ? allIds.findIndex((id) => sessionMap.get(id)?.status === "ended")
              : -1;
            // The top "Hide ended" button should appear:
            //   - only when ended sessions are expanded
            //   - only when the user manually expanded (not auto-expanded
            //     by a search query — in that mode the user expects
            //     results to stay visible until query is cleared)
            //   - only when at least one ended session exists in render
            const showInlineHideEnded =
              firstEndedIdx >= 0 &&
              endedExpanded.has(group.cwd) &&
              sessionSearch.length === 0 &&
              workspaceFilter.length === 0 &&
              !anyTagFilterActive;
            return (
              <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
                {allIds.map((id, idx) => {
                  const session = sessionMap.get(id);
                  if (!session) return null;
                  const renderTopHideEnded = showInlineHideEnded && idx === firstEndedIdx;
                  return (
                    <React.Fragment key={`f-${id}`}>
                      {renderTopHideEnded && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleEndedExpanded(group.cwd); }}
                          className="w-full text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] py-1 px-2 select-none flex items-center justify-center gap-1 border-t border-[var(--border-subtle)]"
                          data-testid={`folder-ended-toggle-top-${group.cwd}`}
                          aria-label={t("sessionList.hideEndedCount", { count: endedSessions.length }, `Hide ${endedSessions.length} ended sessions`)}
                        >
                          <Icon path={mdiChevronDown} size={0.4} />
                          <span>{t("sessionList.hideEnded", undefined, "Hide ended")}</span>
                        </button>
                      )}
                    <SortableSessionCard key={id} id={id}>
                      <SessionCard
                        session={session}
                        selectedId={selectedId}
                        onSelect={onSelect}
                        now={now}
                        showGitInfo={group.sessions.length === 1}
                        isHidden={!!session.hidden}
                        onHide={handleHide}
                        onUnhide={handleUnhide}

                        contextUsage={contextUsageMap?.get(session.id)}
                        openspecChanges={openspecMap?.get(session.cwd)?.changes}
                        openspecInitialized={openspecMap?.get(session.cwd)?.initialized}
                        openspecPending={openspecMap?.get(session.cwd)?.pending}
                        openspecHasDir={openspecMap?.get(session.cwd)?.hasOpenspecDir}
                        openspecGroups={openspecGroupsMap?.get(session.cwd)?.groups}
                        openspecAssignments={openspecGroupsMap?.get(session.cwd)?.assignments}
                        onSendPrompt={onSendPrompt ? (text, images) => onSendPrompt(session.id, text, images) : undefined}
                        onAttachProposal={onAttachProposal ? (changeName) => onAttachProposal(session.id, changeName) : undefined}
                        onDetachProposal={onDetachProposal ? () => onDetachProposal(session.id) : undefined}
                        onReplaceProposal={onReplaceProposal ? (accept, changeName) => onReplaceProposal(session.id, accept, changeName) : undefined}
                        onReadArtifact={onReadArtifact ? (changeName, artifactId) => onReadArtifact(session.cwd, changeName, artifactId) : undefined}
                        onBulkArchive={onBulkArchive ? () => onBulkArchive(session.cwd) : undefined}
                        onRename={onRename ? (name) => onRename(session.id, name) : undefined}
                        onShutdown={onShutdown}
                        onResume={onResume ? (mode) => onResume(session.id, mode) : undefined}
                        onSpawnSibling={onSpawnSession ? (s) => onSpawnSession(s.cwd, s.attachedProposal || undefined) : undefined}
                        onSpawnWorktree={onSpawnSession && gitWorktreeEnabled ? (s) => {
                          // Reuse existing worktree dialogs: proposal-aware path
                          // when attached, plain path otherwise. No new state.
                          if (s.attachedProposal) setWorktreeForChange({ cwd: s.cwd, changeName: s.attachedProposal });
                          else setWorktreeDialogCwd(s.cwd);
                        } : undefined}
                        commands={commandsMap?.get(session.id)}
                        processes={session.processes}
                        onKillProcess={onKillProcess ? (pgid) => onKillProcess(session.id, pgid) : undefined}
                        onSetProcessDrawerCollapsed={onSetProcessDrawer ? (collapsed) => onSetProcessDrawer(session.id, collapsed) : undefined}
                        inflightBashTools={inflightBashMap?.get(session.id)}
                        onAbortTool={onAbortTool ? (toolCallId) => onAbortTool(session.id, toolCallId) : undefined}
                        hasError={errorSessionIds?.has(session.id)}
                        isRetrying={retrySessionIds?.has(session.id)}
                        hasNotice={noticeSessionIds?.has(session.id)}
                      />
                      {resumeErrors?.get(session.id) && (
                        <div data-testid="resume-error-banner" className="mt-1 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5 flex items-center gap-2 text-xs text-red-300">
                          <span className="flex-1">{i18nT("session.resumeFailed", undefined, "Resume failed:")} {resumeErrors.get(session.id)}</span>
                          {onDismissResumeError && (
                            <button
                              data-testid="resume-error-dismiss"
                              onClick={() => onDismissResumeError(session.id)}
                              className="text-red-400 hover:text-red-300 shrink-0"
                            >✕</button>
                          )}
                        </div>
                      )}
                    </SortableSessionCard>
                    </React.Fragment>
                  );
                })}
              </SortableContext>
            );
          })()}
          {/* Minimal `Show N ended` expand row at the bottom of the folder.
              Hidden when there are no ended sessions, when the user has
              already expanded them, or when a search query is active
              (search auto-expands ended). Click toggles. */}
          {(() => {
            let matched = sessionSearch.length > 0
              ? filterByQuery(group.sessions, sessionSearch)
              : group.sessions;
            if (anyTagFilterActive) matched = matched.filter(passesTagAxes);
            const endedCount = matched.filter((s) => s.status === "ended").length;
            if (endedCount === 0) return null;
            if (sessionSearch.length > 0 || anyTagFilterActive) return null; // auto-expanded
            const expanded = endedExpanded.has(group.cwd);
            return (
              <button
                onClick={(e) => { e.stopPropagation(); toggleEndedExpanded(group.cwd); }}
                className="w-full text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] py-1 px-2 select-none flex items-center justify-center gap-1"
                data-testid={`folder-ended-toggle-${group.cwd}`}
                aria-label={expanded ? t("sessionList.hideEndedCount", { count: endedCount }, `Hide ${endedCount} ended sessions`) : t("sessionList.showEndedCount", { count: endedCount }, `Show ${endedCount} ended sessions`)}
              >
                {/* Bottom toggle: arrow points UP when expanded (collapse-up
                    direction — matches where the click takes the eye) and
                    RIGHT when collapsed (consistent with sidebar folder
                    chevrons). The top "Hide ended" button uses mdiChevronDown
                    deliberately because it sits ABOVE the ended group and
                    pointing down at it would still mean "this collapses what's
                    below me" — inverse direction is intentional. */}
                <Icon path={expanded ? mdiChevronUp : mdiChevronRight} size={0.4} />
                <span>{expanded ? t("sessionList.hideEnded", undefined, "Hide ended") : t("sessionList.showEnded", { count: endedCount }, `${endedCount} ended`)}</span>
              </button>
            );
          })()}
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full border-r border-[var(--border-primary)] flex flex-col min-h-0 h-full">
      <div className="border-b border-[var(--border-primary)]">
        <div className="flex items-center justify-between px-3 py-1.5" data-testid="header-app-bar">
          <div className="flex gap-1.5 items-center">
            <button onClick={() => navigate("/")} className="flex items-center leading-none text-blue-500 hover:text-blue-400 transition-colors" title={t("common.home", undefined, "Home")}>
              <PiLogo size={24} />
            </button>
            <ThemePicker />
            <ThemeToggle />
          </div>
          <div className="flex gap-1 items-center">
            <InstallButton canInstall={installPrompt.canInstall} isInstalled={installPrompt.isInstalled} prompt={installPrompt.prompt} />
            <TunnelButton showToast={showToast} />
            {headerExtra}
            <button
              onClick={() => navigate("/settings")}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              title={t("sessionList.settings", undefined, "Settings")}
              data-testid="settings-btn"
            >
              <Icon path={mdiCog} size={0.6} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 gap-2" data-testid="header-filter-bar">
          <input
            type="search"
            value={workspaceFilter}
            onChange={(e) => setWorkspaceFilter(e.target.value)}
            placeholder={t("sessionList.folderPlaceholder", undefined, "Folder...")}
            className="focus-ring min-w-0 flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            data-testid="workspace-filter-input"
            aria-label={t("sessionList.filterFolders", undefined, "Filter folders by path")}
          />
          <input
            type="search"
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            placeholder={t("sessionList.sessionPlaceholder", undefined, "Session...")}
            className="focus-ring min-w-0 flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            data-testid="session-search-input"
            aria-label={t("sessionList.searchSessions", undefined, "Search sessions across folders")}
          />
          <ToggleButton active={showHidden} onClick={() => setShowHidden((p) => !p)}>
            {t("common.hidden", undefined, "Hidden")}
          </ToggleButton>
        </div>
        {/* Tag + phase filter groups. Two SEPARATE selection sets (no user-tag
            vs phase collision). Phase chips write no session state.
            See change: add-session-tags. */}
        {(allTags.length > 0 || phasesInUse.length > 0) && (
          <div className="px-3 pb-2" data-testid="tag-filter-bar">
            <TagFilterGroup
              label={t("sessionList.yourTags", undefined, "Your tags")}
              tags={allTags}
              selected={selectedTags}
              onToggle={toggleSelectedTag}
              tone="user"
            />
            <TagFilterGroup
              label={t("sessionList.phaseReadOnly", undefined, "Phase (read-only)")}
              tags={phasesInUse}
              selected={selectedPhases}
              onToggle={toggleSelectedPhase}
              tone="exec"
            />
            {anyTagFilterActive && (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={clearTagFilters}
                  className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline"
                  data-testid="clear-tag-filters"
                >
                  {t("sessionList.clearTags", undefined, "Clear tags")}
                </button>
                {!sessions.some(passesTagAxes) && (
                  <span className="text-[10px] text-[var(--text-muted)] italic" data-testid="tag-filter-no-match">
                    {t("sessionList.zeroMatch", undefined, "0 match")}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto">
      {filteredSessions.length === 0 && pinnedGroups.length === 0 && (workspaces?.length ?? 0) === 0 ? (
        <div className="p-4 text-sm text-[var(--text-tertiary)]">{t("sessionList.noActiveSessions", undefined, "No active sessions")}</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={sameTypeClosestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
        <ul className="flex flex-col gap-2 p-2">
          {/* Elevated dashboard-scope add buttons: rendered as the FIRST list
              item, above workspace tiers and pinned folder groups.
              See change: elevate-dashboard-add-buttons. */}
          {onOpenPinDialog && (
            <li>
              <DashboardSpawnButtons
                onAddFolder={() => onOpenPinDialog?.()}
                onNewWorkspace={onCreateWorkspace ? () => setNewWsOpen({ pendingFolder: null }) : undefined}
              />
            </li>
          )}
          {/* Workspace tier (folder-workspaces): rendered ABOVE the top-level
              area when at least one workspace exists. */}
          {workspaceTiers && (
            <SortableContext items={workspaceTiers.workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
              {workspaceTiers.workspaces.map((ws) => {
                // Drag-collapse: dragged workspace renders collapsed locally
                // (OR of forceCollapsed and the server value). Never persisted.
                const displayCollapsed = forceCollapsed.has(ws.id) || ws.collapsed;
                return (
                <li key={`ws-${ws.id}`}>
                  <SortableWorkspace id={ws.id}>
                    <div className="bg-[var(--bg-tertiary)] rounded-lg">
                      <WorkspaceHeader
                        id={ws.id}
                        name={ws.name}
                        collapsed={displayCollapsed}
                        folderCount={ws.folders.length}
                        onToggleCollapsed={() => onSetWorkspaceCollapsed?.(ws.id, !ws.collapsed)}
                        onRename={(name) => onRenameWorkspace?.(ws.id, name)}
                        onDelete={() => onDeleteWorkspace?.(ws.id)}
                      />
                      {!displayCollapsed && (
                        <div className="flex flex-col gap-1 p-1.5">
                          {ws.folders.length === 0 && (
                            <div className="text-[11px] text-[var(--text-muted)] italic px-2 py-2 text-center">
                              {t("sessionList.emptyWorkspace", undefined, "Empty workspace. Use \"+ Add to workspace\" on a folder's actions to assign it here.")}
                            </div>
                          )}
                          <SortableContext items={ws.folders.filter((f) => !anyTagFilterActive || folderMatchesFilters(f)).map((f) => f.cwd)} strategy={verticalListSortingStrategy}>
                            {ws.folders.filter((folder) => !anyTagFilterActive || folderMatchesFilters(folder)).map((folder) => (
                              <SortableWorkspaceFolder key={`ws-${ws.id}-f-${folder.cwd}`} id={folder.cwd} wsId={ws.id}>
                                <div className="relative">
                                  {renderGroup(folder, folder.pinned, true)}
                                  {/* Quick "remove from workspace" affordance —
                                      full menu lives on the folder action bar. */}
                                  <button
                                    onClick={() => onRemoveFolderFromWorkspace?.(ws.id, folder.cwd)}
                                    className="absolute top-1 right-1 text-[10px] text-[var(--text-muted)] hover:text-red-400 px-1"
                                    title={t("sessionList.removeFromWorkspace", undefined, "Remove from workspace")}
                                    data-testid={`ws-remove-${ws.id}-${folder.cwd}`}
                                  >
                                    ×
                                  </button>
                                </div>
                              </SortableWorkspaceFolder>
                            ))}
                          </SortableContext>
                          {/* Workspace-scope Add Folder button at the bottom of the
                              expanded body. See change: elevate-dashboard-add-buttons. */}
                          {onAddFolderToWorkspace && (
                            <DashboardSpawnButtons
                              onAddFolder={() => setPickFolderForWsId(ws.id)}
                              addFolderTestId={`workspace-add-folder-btn-${ws.id}`}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  </SortableWorkspace>
                </li>
                );
              })}
            </SortableContext>
          )}
          {/* Pinned directory groups (filtered if workspace/session filter active).
              Workspace-owned folders are filtered out via visibleTopPinned. */}
          {visibleTopPinned.length > 0 && (
            <SortableContext items={visibleTopPinned.filter(folderMatchesFilters).map((g) => g.cwd)} strategy={verticalListSortingStrategy}>
              {visibleTopPinned.filter(folderMatchesFilters).map((group) => (
                <SortablePinnedGroup key={group.cwd} id={group.cwd}>
                  {renderGroupWithWorkspaceMenu(group, true)}
                </SortablePinnedGroup>
              ))}
            </SortableContext>
          )}
          {/* Gap between pinned and unpinned is handled by flex gap */}
          {/* Unpinned directory groups: rendered when the user is
              actively filtering folders, OR when the folder contains
              at least one alive session (active / idle / streaming).
              Folders with only ended sessions stay hidden by default to
              keep the sidebar focused on workspaces the user is
              currently working in.
              See change: pin-and-search-sessions. */}
          {visibleTopUnpinned
            .filter((g) => {
              // Tag/phase active: folder visible iff ≥1 session passes ALL active
              // narrowing axes (path + search + tag/phase), ENDED included — so an
              // ended-only tag match still reveals the folder, and zero-match
              // folders are hidden (no empty shell). See change: add-session-tags.
              if (anyTagFilterActive) return folderMatchesFilters(g);
              return workspaceFilter.length > 0
                ? folderMatchesFilters(g)
                : g.sessions.some((s) => s.status !== "ended");
            })
            .map((group) => renderGroupWithWorkspaceMenu(group, false))}
        </ul>
        </DndContext>
      )}
      {newWsOpen && (
        <NewWorkspaceDialog
          onCancel={() => setNewWsOpen(null)}
          onCreate={(name) => {
            onCreateWorkspace?.(name);
            // Effect above auto-routes pendingFolder once the new workspace
            // arrives via `workspaces_updated`. For the standalone "+ New
            // workspace…" case (no pending folder) we close immediately.
            if (!newWsOpen.pendingFolder) setNewWsOpen(null);
          }}
        />
      )}
      {pickFolderForWsId && (
        <PinDirectoryDialog
          onCancel={() => setPickFolderForWsId(null)}
          onPin={(path) => {
            // Workspace-scoped pin: add to workspace (authoritative) AND
            // silently pin (kept in pinnedDirectories so removal from the
            // workspace later returns the folder to top-level pinned).
            // Workspace folders don't display pin state, so the pin is
            // invisible to the user inside the container.
            onAddFolderToWorkspace?.(pickFolderForWsId, path);
            onPinDirectory?.(path);
            setPickFolderForWsId(null);
          }}
        />
      )}
      {hiddenCount > 0 && !showHidden && (
        <div className="p-2 text-center text-[11px] text-[var(--text-muted)]">
          {t("sessionList.hiddenCount", { count: hiddenCount }, `${hiddenCount} hidden`)}
        </div>
      )}
      {worktreeDialogCwd && (
        <WorktreeSpawnDialog
          cwd={worktreeDialogCwd}
          onCancel={() => setWorktreeDialogCwd(null)}
          onSpawnStart={(c) => addSpawningCwd?.(c)}
          onSpawnAbort={(c) => clearSpawningCwd?.(c)}
          onSpawn={(path, opts) => {
            // Capture the parent group cwd BEFORE clearing the dialog state;
            // the placeholder renders under this group, not the worktree
            // path. See change: add-worktree-spawn-placeholder-card.
            const placeholderCwd = worktreeDialogCwd;
            setWorktreeDialogCwd(null);
            onSpawnSession?.(path, opts?.attachProposal, { ...opts, placeholderCwd });
            // Opt-in trusted-only worktree auto-init. See change: auto-init-worktree-on-spawn.
            void maybeAutoInitWorktreeOnSpawn(path);
          }}
        />
      )}
      {worktreeForChange && (
        <WorktreeSpawnDialog
          cwd={worktreeForChange.cwd}
          initialBranch={`os/${worktreeForChange.changeName}`}
          attachProposal={worktreeForChange.changeName}
          onCancel={() => setWorktreeForChange(null)}
          onSpawnStart={(c) => addSpawningCwd?.(c)}
          onSpawnAbort={(c) => clearSpawningCwd?.(c)}
          onSpawn={(path, opts) => {
            const placeholderCwd = worktreeForChange.cwd;
            setWorktreeForChange(null);
            onSpawnSession?.(path, opts?.attachProposal, { ...opts, placeholderCwd });
            // Opt-in trusted-only worktree auto-init. See change: auto-init-worktree-on-spawn.
            void maybeAutoInitWorktreeOnSpawn(path);
          }}
        />
      )}
      {branchDialogCwd && (
        <BranchSwitchDialog
          cwd={branchDialogCwd}
          onClose={() => {
            branchCache.delete(branchDialogCwd);
            setBranchDialogCwd(null);
          }}
        />
      )}
      <Toast messages={messages} onDismiss={dismissToast} />

      </div>
    </div>
  );
}

/**
 * Folder header left gutter — chevron at top, drag-handle column extending
 * the full height of the header content. The chevron itself remains a
 * click-to-toggle button (pointer events stop propagation so the surrounding
 * drag listener doesn't compete on click). The empty space below the chevron
 * is the drag zone, mirroring the SessionCard gutter pattern.
 */
function FolderDragGutter({
  isCollapsed,
  onToggle,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const dragHandleProps = useFolderDragHandle();
  return (
    <div
      {...(dragHandleProps ?? {})}
      className={`flex flex-col items-center flex-shrink-0 w-3 pt-0.5 text-[var(--text-tertiary)] ${dragHandleProps ? "cursor-grab active:cursor-grabbing" : ""}`}
      data-testid={dragHandleProps ? "drag-handle-pinned" : undefined}
      title={dragHandleProps ? "Drag to reorder folder" : undefined}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center cursor-pointer hover:text-[var(--text-secondary)]"
        title={isCollapsed ? "Expand folder" : "Collapse folder"}
        data-testid="folder-toggle-btn"
      >
        <Icon path={isCollapsed ? mdiChevronRight : mdiChevronDown} size={0.6} />
      </button>
      {/* Remainder of the column is the drag area (no children needed). */}
      <span className="flex-1" />
    </div>
  );
}
