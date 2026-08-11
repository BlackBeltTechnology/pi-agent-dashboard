import { SidebarFolderSectionSlot } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CommandInfo, DashboardSession, ImageContent, OpenSpecData, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { DndContext, type DragEndEvent, type DragOverEvent, type DragStartEvent, MeasuringStrategy, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { mdiChevronDown, mdiChevronRight, mdiChevronUp, mdiClose, mdiCog, mdiConsoleLine, mdiFolder, mdiFolderOpen, mdiPin, mdiPlus, mdiPuzzleOutline, mdiSortVariant, mdiViewGridPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useFolderUrgencySort } from "../../hooks/useFolderUrgencySort.js";
import { useInstallPrompt } from "../../hooks/useInstallPrompt.js";
import { maybeAutoInitWorktreeOnSpawn } from "../../lib/git/auto-init-worktree.js";
import { t as i18nT, useI18n } from "../../lib/i18n/i18n.js";
import { compatibleClosestCenter, resolveFolderMove, resolveWorkspaceFolderReorder, resolveWorkspaceReorder, SPRING_LOAD_DWELL_MS } from "../../lib/layout/sidebar-dnd.js";
import { buildFolderHomeUrl } from "../../lib/nav/route-builders.js";
// TerminalCard removed — terminals now in TerminalsView
import {
  getCollapsedGroups,
  getTagAreaOpen,
  pruneStaleCollapsedGroups,
  removeLegacyHiddenSessions,
  setCollapsedGroups,
  setTagAreaOpen,
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
import { encodeFolderPath } from "../../lib/util/folder-encoding.js";
import { truncatePathMiddle } from "../../lib/util/truncate-path.js";
import { TunnelButton } from "../connectivity/TunnelButton.js";
import { FolderActionBar } from "../folder/FolderActionBar.js";
import { FolderActionsMenu, type FolderMenuItem } from "../folder/FolderActionsMenu.js";
import { FolderSpawnButtons } from "../folder/FolderSpawnButtons.js";
import { FolderStatusCapsule } from "../folder/FolderStatusCapsule.js";
import { FolderOpenSpecSection } from "../openspec/FolderOpenSpecSection.js";
import { InstallButton } from "../packages/InstallButton.js";
import { PiLogo } from "../primitives/PiLogo.js";
import { Toast, useToast } from "../primitives/Toast.js";
import { ThemePicker } from "../settings/ThemePicker.js";
import { ThemeToggle } from "../settings/ThemeToggle.js";
import { allTagsInUse } from "../tags/all-tags.js";
import { TagDeleteConfirmDialog } from "../tags/TagDeleteConfirmDialog.js";
import { TagFilterGroup } from "../tags/TagFilterGroup.js";
import { AddFoldersDialog } from "../workspace/AddFoldersDialog.js";
import { AddToWorkspaceMenu } from "../workspace/AddToWorkspaceMenu.js";
import { NewWorkspaceDialog } from "../workspace/NewWorkspaceDialog.js";
import { PinnedTierDropZone } from "../workspace/PinnedTierDropZone.js";
import { SortableWorkspace } from "../workspace/SortableWorkspace.js";
import { SortableWorkspaceFolder } from "../workspace/SortableWorkspaceFolder.js";
import { WorkspaceHeader } from "../workspace/WorkspaceHeader.js";
import { BranchSwitchDialog } from "../worktree/BranchSwitchDialog.js";
import { WorktreeSpawnDialog } from "../worktree/WorktreeSpawnDialog.js";
import { DashboardSpawnButtons } from "./DashboardSpawnButtons.js";
import { PlaceholderSessionCard } from "./PlaceholderSessionCard.js";
import { branchCache, GroupGitInfo, SessionCard } from "./SessionCard.js";
import { SortablePinnedGroup, useFolderDragHandle } from "./SortablePinnedGroup.js";
import { SortableSessionCard } from "./SortableSessionCard.js";
import { SpawnErrorBanner } from "./SpawnErrorBanner.js";


export interface ContextUsageInfo {
  tokens: number | null;
  contextWindow: number;
  /** Compaction metadata for the ContextUsageBar badge (live sessions only).
   * See change: adopt-pi-074-080-features (C.1). */
  compaction?: import("../../lib/chat/event-reducer.js").CompactionState;
}

/** Escape a session id for a `[data-session-id="…"]` selector. */
/** Draggable types that can change workspace membership. See change: drag-folders-across-workspaces. */
function isFolderLike(t: unknown): boolean {
  return t === "workspace-folder" || t === "pinned-group";
}

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
  /** Opens the directory's settings page. Renamed from `onOpenPiResources`:
   *  the control's label and route have said "Directory Settings" since change
   *  `directory-settings-page-and-scoped-md-editing`; only the prop name lagged.
   *  See change: add-folder-actions-menu (D12). */
  onOpenDirectorySettings?: (cwd: string) => void;
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
  /** Move a folder into a workspace, or eject it (`toWorkspaceId: null`). See change: drag-folders-across-workspaces. */
  onMoveFolderToWorkspace?: (path: string, toWorkspaceId: string | null, index?: number) => void;
  workspaces?: import("@blackbelt-technology/pi-dashboard-shared/browser-protocol.js").Workspace[];
  onCreateWorkspace?: (name: string) => void;
  onRenameWorkspace?: (id: string, name: string) => void;
  onDeleteWorkspace?: (id: string) => void;
  onSetWorkspaceCollapsed?: (id: string, collapsed: boolean) => void;
  onAddFolderToWorkspace?: (id: string, path: string) => void;
  onRemoveFolderFromWorkspace?: (id: string, path: string) => void;
  // onKillTerminal/onRenameTerminal are pre-existing unused props (terminals
  // moved to the editor pane); left as-is, out of scope for this change.
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
   * Strip a tag from every carrying session (server fan-out). Wired to the
   * per-chip destructive ✕ in the sidebar tag filter, gated by a confirm
   * dialog. See change: sidebar-tag-collapse-and-delete.
   */
  onRemoveTagGlobally?: (tag: string) => void;
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

export function SessionList({ sessions, selectedId, onSelect, revealRequest, onSeekToCard, contextUsageMap, openspecMap, folderGitMap, openspecGroupsMap, sessionOrderMap, onReorderSessions, onSendPrompt, onOpenSpecRefresh, onAttachProposal, onDetachProposal, onReplaceProposal, onBulkArchive, onReadArtifact, onOpenDirectorySettings, onRename, onShutdown, onResume, onResumeKeepPosition, onHideSession, onUnhideSession, onSpawnSession, spawningCwds, addSpawningCwd, clearSpawningCwd, spawnResult, onSpawnResultSeen, pinnedDirectories, onPinDirectory, onOpenPinDialog, onUnpinDirectory, onReorderPinnedDirs, onReorderWorkspaces, onReorderWorkspaceFolders, onMoveFolderToWorkspace, workspaces, onCreateWorkspace, onRenameWorkspace, onDeleteWorkspace, onSetWorkspaceCollapsed, onAddFolderToWorkspace, onRemoveFolderFromWorkspace, onKillTerminal, onRenameTerminal, onCollapseSidebar, commandsMap, onKillProcess, onSetProcessDrawer, onRemoveTagGlobally, inflightBashMap, onAbortTool, onOpenSpecs, onOpenArchive, onOpenBoard, headerExtra, errorSessionIds, retrySessionIds, noticeSessionIds, spawnErrors, onDismissSpawnError, resumeErrors, onDismissResumeError, gitWorktreeEnabled: gitWorktreeEnabledProp }: Props) {
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
  // Folder actions menu open flag, keyed by folder SCOPE (`folder:<cwd>`) the
  // same way `addToWsMenuFor` is — a cwd key would co-open a folder row and a
  // same-cwd card. See change: add-folder-actions-menu.
  const [folderMenuFor, setFolderMenuFor] = React.useState<string | null>(null);
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

  // Spring-load (folder drags, local-only, visual). Hovering a collapsed
  // workspace's header for SPRING_LOAD_DWELL_MS reveals its folders so the
  // user can drop positionally. Like forceCollapsed this NEVER emits
  // `set_workspace_collapsed`. The two pieces of state have deliberately
  // different lifetimes: the dwell timer is keyed on the resolved WORKSPACE
  // id (closestCenter jitters `over.id` at Voronoi boundaries, which would
  // otherwise re-arm a timer that never completes) and is cleared when that
  // workspace changes; `springOpen` is add-only for the whole drag, because
  // clearing it on `over` change would re-collapse the instant the cursor
  // entered the just-revealed children — a flicker loop.
  // See design D6 / change: drag-folders-across-workspaces.
  const [springOpen, setSpringOpen] = useState<Set<string>>(() => new Set());
  /** Active draggable's `type` for the duration of a drag; gates the empty-tier eject zone. */
  const [activeDragType, setActiveDragType] = useState<string | null>(null);
  const springTimerRef = useRef<{ wsId: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const clearSpringTimer = useCallback(() => {
    if (springTimerRef.current) {
      clearTimeout(springTimerRef.current.timer);
      springTimerRef.current = null;
    }
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragType((event.active.data.current?.type as string | undefined) ?? null);
    if (event.active.data.current?.type === "workspace") {
      setForceCollapsed(new Set([event.active.id as string]));
    }
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!isFolderLike(active.data.current?.type)) return;
    const overType = over?.data.current?.type;
    const wsId = overType === "workspace-header" ? (over?.data.current?.wsId as string | undefined) : undefined;
    const ws = wsId ? (workspaces ?? []).find((w) => w.id === wsId) : undefined;
    // Only a COLLAPSED workspace's header arms the timer.
    if (!wsId || !ws || !ws.collapsed || springOpen.has(wsId)) {
      clearSpringTimer();
      return;
    }
    // Jitter within the same workspace's targets must not re-arm.
    if (springTimerRef.current?.wsId === wsId) return;
    clearSpringTimer();
    springTimerRef.current = {
      wsId,
      timer: setTimeout(() => {
        springTimerRef.current = null;
        setSpringOpen((prev) => (prev.has(wsId) ? prev : new Set(prev).add(wsId)));
      }, SPRING_LOAD_DWELL_MS),
    };
  }, [workspaces, springOpen, clearSpringTimer]);

  const handleDragCancel = useCallback(() => {
    clearSpringTimer();
    setActiveDragType(null);
    setForceCollapsed((prev) => (prev.size === 0 ? prev : new Set()));
    setSpringOpen((prev) => (prev.size === 0 ? prev : new Set()));
  }, [clearSpringTimer]);

  // Unmount safety: a pending dwell timer must not fire after teardown.
  useEffect(() => clearSpringTimer, [clearSpringTimer]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    clearSpringTimer();
    setActiveDragType(null);
    setForceCollapsed((prev) => (prev.size === 0 ? prev : new Set()));
    setSpringOpen((prev) => (prev.size === 0 ? prev : new Set()));
    if (!over || active.id === over.id) return;

    const activeType = active.data.current?.type;
    const overType = over.data.current?.type;

    // Per-active-type dispatch. The shipped `session` / `workspace` gestures
    // keep their same-type wall as a per-branch guard; folder-like actives
    // route through `resolveFolderMove`, which is keyed on the (active, over)
    // PAIR. See design D5 / change: drag-folders-across-workspaces.
    if (activeType === "session") {
      if (overType !== "session") return;
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
    } else if (activeType === "workspace") {
      if (overType !== "workspace") return;
      const ids = (workspaces ?? []).map((w) => w.id);
      const newOrder = resolveWorkspaceReorder(ids, active.id as string, over.id as string);
      if (newOrder) onReorderWorkspaces?.(newOrder);
    } else if (activeType === "pinned-group" || activeType === "workspace-folder") {
      const activeWsId = active.data.current?.wsId as string | undefined;
      const move = resolveFolderMove({
        activeId: active.id as string,
        activeType,
        activeWsId,
        overId: over.id as string,
        overType,
        overWsId: over.data.current?.wsId as string | undefined,
        workspaces: workspaces ?? [],
      });
      if (!move) return;
      if (move.kind === "reorder-pinned") {
        const ids = pinnedGroups.map((g) => g.cwd);
        const oldIndex = ids.indexOf(active.id as string);
        const newIndex = ids.indexOf(over.id as string);
        if (oldIndex !== -1 && newIndex !== -1) {
          onReorderPinnedDirs?.(arrayMove(ids, oldIndex, newIndex));
        }
      } else if (move.kind === "reorder-folders") {
        const ws = (workspaces ?? []).find((w) => w.id === move.wsId);
        if (!ws) return;
        const newOrder = resolveWorkspaceFolderReorder(
          ws.folders,
          active.id as string,
          over.id as string,
          activeWsId,
          over.data.current?.wsId as string | undefined,
        );
        if (newOrder) onReorderWorkspaceFolders?.(move.wsId, newOrder);
      } else {
        onMoveFolderToWorkspace?.(active.id as string, move.toWorkspaceId, move.index);
      }
    }
  }, [allGroups, pinnedGroups, workspaces, onReorderSessions, onReorderPinnedDirs, onReorderWorkspaces, onReorderWorkspaceFolders, onMoveFolderToWorkspace, onResume, onResumeKeepPosition, clearSpringTimer]);

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

  // Sidebar tag-area master collapse. Default collapsed (absent key ⇒ false).
  // See change: sidebar-tag-collapse-and-delete.
  const [tagAreaOpen, setTagAreaOpenState] = useState<boolean>(() => getTagAreaOpen());
  const toggleTagArea = useCallback(() => {
    setTagAreaOpenState((prev) => {
      const next = !prev;
      setTagAreaOpen(next);
      return next;
    });
  }, []);
  // Tag pending a global-delete confirm (null = dialog closed).
  const [pendingDeleteTag, setPendingDeleteTag] = useState<string | null>(null);
  // Carrying-session count for the confirm dialog blast-radius copy (task 6.3).
  const deleteTagCount = useMemo(
    () => (pendingDeleteTag == null ? 0 : sessions.filter((s) => (s.tags ?? []).includes(pendingDeleteTag)).length),
    [pendingDeleteTag, sessions],
  );
  const activeFilterCount = selectedTags.size + selectedPhases.size;

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
   * folder-workspaces: same as renderGroup but with the "Add to workspace"
   * affordance switched on. Used for top-level groups only — workspace-tier
   * folders use the plain renderGroup since their membership is already
   * established.
   *
   * The affordance used to be a `+ws` text token, then a button in the header
   * cluster. It now lands in the folder actions menu's WORKSPACE group;
   * renderGroup decides where the node goes, so the gating here (and therefore
   * `add-to-workspace-affordance`'s contract) is untouched.
   * See change: redesign-folder-workspace-add-flow, add-folder-actions-menu.
   */
  function renderGroupWithWorkspaceMenu(group: DirectoryGroup, isPinned: boolean) {
    const workspaceAction =
      onCreateWorkspace || (workspaces && workspaces.length > 0)
        ? renderAddToWorkspaceButton(
            group.cwd,
            t("sessionList.addToWorkspace", undefined, "Add to workspace"),
            `folder:${group.cwd}`,
            `add-to-workspace-btn-${group.cwd}`,
            "",
            true,
          )
        : null;
    return renderGroup(group, isPinned, false, undefined, workspaceAction);
  }

  /**
   * Add-to-workspace affordance: an `mdiViewGridPlus` + "Workspace" pill.
   * PRESENTATION is add-to-workspace-affordance's labelled pill (a bare icon
   * or the old `+ws` token did not read as "add to a workspace"). BEHAVIOUR is
   * ours: the popover flag is keyed by SCOPE, and `aria-label`/`title` carry
   * the full verb while `aria-expanded` tracks the popover.
   * See change: redesign-folder-workspace-add-flow.
   */
  function renderAddToWorkspaceButton(cwd: string, label: string, scopeKey: string, testId: string, wrapperClass = "", asMenuItem = false) {
    const owningWsId = folderWorkspaceMap.get(cwd) ?? null;
    // Keyed by SCOPE, not by cwd: a session card and its folder row share a cwd,
    // so a cwd-keyed flag would pop both menus at once.
    const menuOpen = addToWsMenuFor === scopeKey;
    return (
      <span className={`relative inline-flex ${wrapperClass}`}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setAddToWsMenuFor(menuOpen ? null : scopeKey);
          }}
          className="focus-ring text-xs px-2 py-1 min-h-[44px] md:min-h-0 rounded border inline-flex items-center gap-0.5 text-blue-500 border-blue-500/40 bg-blue-500/5 hover:text-blue-400 hover:border-blue-500/70"
          title={label}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          // When hosted inside FolderActionsMenu this button IS the menu item.
          role={asMenuItem ? "menuitem" : undefined}
          data-testid={testId}
        >
          <Icon path={mdiViewGridPlus} size={0.55} /> {t("sessionList.workspace", undefined, "Workspace")}
        </button>
        {menuOpen && (
          <AddToWorkspaceMenu
            workspaces={workspaces ?? []}
            currentWorkspaceId={owningWsId}
            // Each terminal action also closes the hosting folder actions menu
            // — otherwise picking a workspace leaves the outer menu open behind
            // the dismissed popover. See change: add-folder-actions-menu.
            onPick={(wsId) => {
              onAddFolderToWorkspace?.(wsId, cwd);
              setAddToWsMenuFor(null);
              setFolderMenuFor(null);
            }}
            onNewWorkspace={() => {
              setNewWsOpen({ pendingFolder: cwd });
              setAddToWsMenuFor(null);
              setFolderMenuFor(null);
            }}
            onRemoveFromWorkspace={() => {
              if (owningWsId) onRemoveFolderFromWorkspace?.(owningWsId, cwd);
              setAddToWsMenuFor(null);
              setFolderMenuFor(null);
            }}
            onClose={() => setAddToWsMenuFor(null)}
          />
        )}
      </span>
    );
  }

  /**
   * Builds the folder actions menu's items for one folder row.
   *
   * Placement gating is PRESERVED, not widened: add-to-workspace only where the
   * affordance rendered before (its node is supplied by
   * `renderGroupWithWorkspaceMenu`, i.e. top-level rows gated on
   * `onCreateWorkspace || workspaces.length`), remove-from-workspace only on
   * workspace-owned rows, pin only outside a workspace container.
   * Directory-group order is pin · urgency sort · directory settings.
   * See change: add-folder-actions-menu.
   */
  function folderMenuItems({ group, isPinned, inWorkspace, workspaceId, headerAction }: {
    group: DirectoryGroup;
    isPinned: boolean;
    inWorkspace: boolean;
    workspaceId?: string;
    headerAction?: React.ReactNode;
  }): FolderMenuItem[] {
    const items: FolderMenuItem[] = [];

    if (headerAction) {
      items.push({
        id: "add-to-workspace",
        group: "workspace",
        label: t("sessionList.addToWorkspace", undefined, "Add to workspace"),
        icon: mdiViewGridPlus,
        onSelect: () => {},
        node: headerAction,
      });
    }
    if (inWorkspace && workspaceId && onRemoveFolderFromWorkspace) {
      items.push({
        id: "remove-from-workspace",
        group: "workspace",
        label: t("sessionList.removeFromWorkspace", undefined, "Remove from workspace"),
        icon: mdiClose,
        onSelect: () => onRemoveFolderFromWorkspace(workspaceId, group.cwd),
      });
    }
    if (!inWorkspace && (isPinned || onPinDirectory)) {
      items.push({
        id: "pin",
        group: "directory",
        label: isPinned
          ? t("sessionList.unpinDirectory", undefined, "Unpin directory")
          : t("sessionList.pinDirectory", undefined, "Pin directory"),
        icon: mdiPin,
        onSelect: () => {
          if (isPinned) onUnpinDirectory?.(group.cwd);
          else onPinDirectory?.(group.cwd);
        },
      });
    }
    items.push({
      id: "urgency-sort",
      group: "directory",
      label: t("sessionList.urgencySort", undefined, "Float blocked sessions to top"),
      icon: mdiSortVariant,
      pressed: urgencySort.isOn(group.cwd),
      onSelect: () => urgencySort.toggle(group.cwd),
    });
    items.push({
      id: "directory-settings",
      group: "directory",
      label: t("folders.directorySettings", undefined, "Directory Settings"),
      icon: mdiCog,
      onSelect: () => onOpenDirectorySettings?.(group.cwd),
    });
    return items;
  }

  function renderGroup(group: DirectoryGroup, isPinned: boolean, inWorkspace: boolean = false, workspaceId?: string, headerAction?: React.ReactNode) {
    const displayPath = truncatePathMiddle(group.cwd, 45);
    const lastSlash = displayPath.lastIndexOf('/');
    const parentPath = lastSlash >= 0 ? displayPath.slice(0, lastSlash + 1) : '';
    const lastSegment = lastSlash >= 0 ? displayPath.slice(lastSlash + 1) : displayPath;
    const isCollapsed = isFolderCollapsed(group.cwd);
    // Root (non-workspace) folders get a subtle accent-tinted surface so their
    // boundary stays legible across themes, incl. low-contrast/warm ones where
    // --bg-primary blends into the page (change: folder-card-enclosure, C).
    const folderTint = !inWorkspace
      ? {
          background: "color-mix(in srgb, var(--accent-blue) 5%, var(--bg-primary))",
          borderColor: "color-mix(in srgb, var(--accent-blue) 22%, var(--border-subtle))",
        }
      : undefined;
    const folderHasSessions = group.sessions.length > 0;

    return (
      <div key={group.cwd} className="space-y-1">
        {/* Folder-tab nub — a small tab peeking above the card's top-left
            corner so the directory card reads as a folder. Sits behind the
            bordered card (which paints on top, hiding the nub's lower edge)
            and is non-interactive. The pt-[9px] on the wrapper reserves the
            space the nub occupies above the card. See change: folder-card-tab-nub. */}
        <div className="relative pt-[9px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-3.5 w-[78px] h-3 bg-[var(--bg-primary)] border border-[var(--border-subtle)] border-b-0 rounded-t-lg"
          style={folderTint}
        />
        <div
          // NO `overflow-hidden`: the folder actions menu is an absolutely
          // positioned popover inside this card and would be clipped to the
          // card bounds. Nothing inside needs clipping (the tab nub is a
          // sibling, not a child).
          className={`relative bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-1.5 ${isCollapsed ? "rounded-[14px] shadow-[inset_0_1px_0_var(--elevation-rim),0_2px_4px_var(--shadow-card)]" : "pb-0 rounded-t-[14px] border-b-0 shadow-[inset_0_1px_0_var(--elevation-rim)]"}`}
          style={folderTint}
        >
        <div className="relative z-[1]">
        <div className="flex gap-1.5 px-1 py-1 min-h-[44px] md:min-h-0 rounded">
          {/* Left gutter — chevron at top, drag-handle column extending below */}
          <FolderDragGutter
            isCollapsed={isCollapsed}
            onToggle={() => handleToggleCollapse(group.cwd)}
          />
          <div className="flex-1 min-w-0">
          {/* Whole header row is clickable to open the directory home page —
              same affordance as clicking a session card selects its session.
              Collapse/expand lives solely on the chevron in the drag gutter
              (folder-toggle-btn). The redundant mdiOpenInNew icon is DELETED —
              the row is the only open affordance and the leaf name underlines
              on hover to say so. Child buttons/pills stopPropagation so they
              don't trigger navigation.
              See change: directory-card-clickable-select, add-folder-actions-menu (D3). */}
          <div
            className="group flex items-center gap-1.5 cursor-pointer"
            onClick={() => navigate(buildFolderHomeUrl(group.cwd))}
            title={t("sessionList.openFolderHome", undefined, "Open folder home")}
            data-testid={`folder-home-row-${group.cwd}`}
          >
            {/* Name region absorbs ALL horizontal squeeze (`min-w-0`) so the
                action cluster below never wraps. Truncation priority: the
                parent path may collapse entirely, the leaf folder name keeps a
                legible 6ch floor — the name is the payload, the path is only
                context. See change: redesign-folder-workspace-add-flow.

                It also carries the KEYBOARD route to the directory home. The
                row's `onClick` serves pointers, but a bare `div` is not
                focusable — and deleting `folder-open-home` removed the only
                focusable open control, so keyboard users would otherwise have
                lost the gesture entirely. Semantics live here rather than on
                the row because the row also contains the menu trigger, and
                nesting a button inside a `role="link"` is invalid.
                See change: add-folder-actions-menu (D3). */}
            <span
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                e.stopPropagation();
                navigate(buildFolderHomeUrl(group.cwd));
              }}
              className="focus-ring rounded text-xs font-medium text-[var(--text-secondary)] min-w-0 overflow-hidden flex items-center gap-1"
              data-testid={`folder-header-name-${group.cwd}`}
            >
              <Icon path={isCollapsed ? mdiFolder : mdiFolderOpen} size={0.5} className="shrink-0" />
              <span
                className="truncate flex-[0_1_auto] min-w-0"
                data-testid={`folder-header-parent-${group.cwd}`}
              >
                {parentPath}
              </span>
              <span
                className="font-bold text-base truncate flex-[0_1_auto] min-w-[6ch] group-hover:underline"
                data-testid={`folder-header-leaf-${group.cwd}`}
              >
                {lastSegment}
              </span>
            </span>
            {/* Pinned state is an INERT indicator, not a control — the pin/unpin
                action lives in the folder actions menu. It sits in the name
                region, not the cluster, so the cluster stays exactly one
                control. See change: add-folder-actions-menu (3.12). */}
            {isPinned && (
              <span
                aria-hidden="true"
                data-testid={`folder-pinned-indicator-${group.cwd}`}
                className="shrink-0 text-yellow-400"
              >
                <Icon path={mdiPin} size={0.5} />
              </span>
            )}
            {/* The folder's ONE liveness surface: severity-ordered segment
                counts, unconditional on collapse state. Replaces the raw (N)
                count, the needs-you pill and the collapsed-only status rollup.
                Activation routes through the EXISTING reveal machinery
                (`onSeekToCard` -> `revealRequest`), which already owns guarded
                ancestor expand, layout-settled detection, the give-up backstop
                and the hidden/filtered degrade notices — a bespoke
                expand-then-rAF would no-op against a body that has not mounted.
                See change: unify-folder-status-capsule. */}
            <FolderStatusCapsule
              cwd={group.cwd}
              sessions={group.sessions}
              errorSessionIds={errorSessionIds}
              retrySessionIds={retrySessionIds}
              noticeSessionIds={noticeSessionIds}
              onActivate={(sessionId) => {
                if (!sessionId) return;
                if (onSeekToCard) {
                  onSeekToCard(sessionId);
                  return;
                }
                // No reveal wiring (standalone render): fall back to the
                // guarded expand + select the pill used.
                if (isCollapsed) handleToggleCollapse(group.cwd);
                onSelect(sessionId);
              }}
            />
            {/* Trailing action cluster — `flex-none` + `whitespace-nowrap` pins
                it to the top-right at any sidebar width; it never wraps to a
                second row and never leaves the card. It now holds EXACTLY ONE
                control: the folder actions menu trigger. Urgency sort, pin,
                add-to-workspace, remove-from-workspace and Directory Settings
                are its items. See change: add-folder-actions-menu. */}
            <span
              className="ml-auto flex items-center gap-px flex-none whitespace-nowrap"
              data-testid={`folder-header-cluster-${group.cwd}`}
            >
              <FolderActionsMenu
                cwd={group.cwd}
                open={folderMenuFor === `folder:${group.cwd}`}
                onOpenChange={(next) => setFolderMenuFor(next ? `folder:${group.cwd}` : null)}
                items={folderMenuItems({ group, isPinned, inWorkspace, workspaceId, headerAction })}
              />
            </span>
          </div>
          {/* Collapsed density (variant B): when collapsed, the heavy slots
              (git · action bar · plugin sections · OpenSpec proposal state ·
              spawn buttons) are hidden — the header keeps only name + status.
              The drag gutter/head row live ABOVE this block, so drag-reorder
              of a collapsed folder is unaffected.
              See change: condense-collapsed-folder-header. */}
          {!isCollapsed && (<>
          {/* Git info + folder actions share ONE compact row (variant B):
              branch/commit left, Initialize + settings gear right-grouped.
              Terminals + Editor buttons removed — that pane is reachable from
              the Directory home page and ChatView.
              `flex-wrap` + `justify-between`: the small idle Initialize button
              sits inline right of the git info, but a wide init state (the
              running / failed `WorktreeInitChip`, min-w ~240px) wraps to its own
              line instead of overflowing and overlapping the git row.
              See change: compact-folder-header-actions. */}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="min-w-0">
              <GroupGitInfo
                sessions={group.sessions}
                cwd={group.cwd}
                folderBranch={folderGitMap?.has(group.cwd) ? folderGitMap.get(group.cwd) : undefined}
                onBranchClick={() => setBranchDialogCwd(group.cwd)}
              />
            </div>
            <FolderActionBar
              cwd={group.cwd}
              onInitializeProject={onSpawnSession ? (cwd) => onSpawnSession(cwd, undefined, { initialPrompt: "/skill:project-init" }) : undefined}
              brokenSessionCount={group.sessions.filter((s) => s.cwdMissing === true && s.status === "ended" && !s.hidden).length}
              onCleanUpBroken={onHideSession ? () => {
                for (const s of group.sessions) {
                  if (s.cwdMissing === true && s.status === "ended" && !s.hidden) onHideSession(s.id);
                }
              } : undefined}
            />
          </div>
          {/* Slot-pill grid: the plugin slot sections (Automations / Goals /
              KB) + OpenSpec render as single-concern pills in a 2-col grid that
              collapses to 1-col at mobile width. A section that renders null
              (plugin disabled / not yet loaded) simply leaves no cell.
              See change: redesign-directory-card. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-2 gap-y-3 mt-3">
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
          </div>
          </>)}

          </div>{/* end content column */}
        </div>
        </div>{/* end content layer (relative z-1) */}
        </div>{/* end bordered info card */}
        {/* Folder body — encloses the Create tray + sessions + ended row so the
            card reads as a folder holding its contents. Shares the header's
            --bg-primary surface with one continuous border (header is border-b-0
            when expanded); no seam shading — the CREATE separator alone marks
            the header/body junction. See change: folder-card-enclosure. */}
        {!isCollapsed && (
        <div
          className="relative bg-[var(--bg-primary)] border border-[var(--border-subtle)] border-t-0 rounded-b-[14px] px-1.5 pb-1.5 shadow-[0_2px_4px_var(--shadow-card)]"
          style={folderTint}
          data-testid={`folder-body-${group.cwd}`}
        >
            <div className="relative text-center text-[9.5px] font-semibold tracking-[.1em] uppercase text-[var(--text-muted)] mt-0 mb-2 before:content-[''] before:absolute before:top-1/2 before:left-0 before:w-[38%] before:h-px before:bg-[var(--border-subtle)] after:content-[''] after:absolute after:top-1/2 after:right-0 after:w-[38%] after:h-px after:bg-[var(--border-subtle)]">
              {t("sessionList.create", undefined, "Create")}
            </div>
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
            {/* Sessions separator — mirrors the Create separator; labels the
                folder's session cards inside the body. */}
            {folderHasSessions && (
            <div className="relative text-center text-[9.5px] font-semibold tracking-[.1em] uppercase text-[var(--text-muted)] my-2 before:content-[''] before:absolute before:top-1/2 before:left-0 before:w-[38%] before:h-px before:bg-[var(--border-subtle)] after:content-[''] after:absolute after:top-1/2 after:right-0 after:w-[38%] after:h-px after:bg-[var(--border-subtle)]">
              {t("sessionList.sessions", undefined, "Sessions")}
            </div>
            )}
        {/* Session + terminal cards */}
        <div className="group-collapse expanded">
        {/* Directory rail: ONE 2px gray vertical line standing for the folder
            that owns these sessions. Each card draws a 9px tick into it (see
            SessionCard `before:`), and the 18px left inset is the band the
            card's hover drag bead parks in. Replaces the per-card status
            gutter. See change: session-card-directory-rail. */}
        <div className="relative space-y-1 pt-1 pl-[18px] before:content-[''] before:absolute before:left-[7px] before:top-0.5 before:bottom-3.5 before:w-0.5 before:rounded-full before:bg-[var(--rail-directory)]">
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
        )}
        </div>{/* end folder-tab nub wrapper */}
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
        {/* Master tag-area collapse. ONE header folds BOTH the user-tag group
            and the read-only phase group (default collapsed, persisted). The
            collapsed header signals `N tags · M phases` plus, when a filter is
            active, a distinct active-selection badge + clear affordance so a
            folded area never silently hides an active filter (D8). Phases stay
            a distinct read-only sub-group (D9). Two SEPARATE selection sets
            (no user-tag vs phase collision).
            See change: add-session-tags · sidebar-tag-collapse-and-delete. */}
        {(allTags.length > 0 || phasesInUse.length > 0) && (
          <div className="px-3 pb-2" data-testid="tag-filter-bar">
            <button
              type="button"
              onClick={toggleTagArea}
              aria-expanded={tagAreaOpen}
              className="flex w-full items-center gap-1.5 py-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              data-testid="tag-area-toggle"
            >
              <Icon path={tagAreaOpen ? mdiChevronDown : mdiChevronRight} size={0.55} className="shrink-0 motion-reduce:transition-none" />
              <span className="font-medium">{t("sessionList.tags", undefined, "Tags")}</span>
              <span className="text-[var(--text-muted)] normal-case tracking-normal" data-testid="tag-area-count">
                {t(
                  "sessionList.tagAreaCount",
                  { tags: allTags.length, phases: phasesInUse.length },
                  `${allTags.length} tag${allTags.length === 1 ? "" : "s"} · ${phasesInUse.length} phase${phasesInUse.length === 1 ? "" : "s"}`,
                )}
              </span>
              {activeFilterCount > 0 && (
                <span
                  className="ml-auto rounded-full bg-[var(--accent-blue)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--accent-blue)] normal-case tracking-normal"
                  data-testid="tag-area-active-indicator"
                >
                  {t("sessionList.tagAreaActiveCount", { count: activeFilterCount }, `${activeFilterCount} active`)}
                </span>
              )}
            </button>
            {/* Clear affordance reachable while collapsed (D8) — only when a
                filter is active AND the area is folded. */}
            {!tagAreaOpen && activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearTagFilters}
                className="mt-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] underline"
                data-testid="clear-tag-filters-collapsed"
              >
                {t("sessionList.clearTags", undefined, "Clear tags")}
              </button>
            )}
            {tagAreaOpen && (
              <>
                <TagFilterGroup
                  label={t("sessionList.yourTags", undefined, "Your tags")}
                  tags={allTags}
                  selected={selectedTags}
                  onToggle={toggleSelectedTag}
                  tone="user"
                  cap={10}
                  onRemove={onRemoveTagGlobally ? (tag) => setPendingDeleteTag(tag) : undefined}
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
              </>
            )}
            {pendingDeleteTag != null && onRemoveTagGlobally && (
              <TagDeleteConfirmDialog
                tag={pendingDeleteTag}
                count={deleteTagCount}
                onConfirm={() => {
                  onRemoveTagGlobally(pendingDeleteTag);
                  // Drop the just-deleted tag from the active filter selection so a
                  // now-nonexistent tag can't leave the list filtered to 0 with no
                  // chip left to deselect (CodeRabbit #5).
                  setSelectedTags((prev) => {
                    if (!prev.has(pendingDeleteTag)) return prev;
                    const next = new Set(prev);
                    next.delete(pendingDeleteTag);
                    return next;
                  });
                }}
                onClose={() => setPendingDeleteTag(null)}
              />
            )}
          </div>
        )}
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto">
      {filteredSessions.length === 0 && pinnedGroups.length === 0 && (workspaces?.length ?? 0) === 0 ? (
        <div className="p-4 text-sm text-[var(--text-tertiary)]">{t("sessionList.noActiveSessions", undefined, "No active sessions")}</div>
      ) : (
        // `measuring.droppable.strategy = Always`: spring-load mounts folder
        // droppables MID-DRAG, and the default `Optimized` strategy does not
        // remeasure newly-registered containers, so a drop inside a revealed
        // body would resolve against stale rects.
        // See change: drag-folders-across-workspaces.
        <DndContext sensors={sensors} collisionDetection={compatibleClosestCenter} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
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
                // Spring-load wins over both the local drag-collapse and the
                // server value; stated as a total precedence rather than an
                // accidentally-exclusive one. See design D6.
                const displayCollapsed = springOpen.has(ws.id)
                  ? false
                  : (forceCollapsed.has(ws.id) || ws.collapsed);
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
                                <div>
                                  {renderGroup(folder, folder.pinned, true, ws.id)}
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
          {/* Eject affordance for the EMPTY pinned tier — mounted OUTSIDE the
              gate above, which renders nothing exactly when it is needed.
              Sole eject target in this case, so it never coexists with the
              pinned groups. See design D4. */}
          {visibleTopPinned.length === 0 && activeDragType === "workspace-folder" && (
            <li><PinnedTierDropZone /></li>
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
        // Workspace-scoped `+ Add Folder` — the same multi-select dialog with
        // THIS workspace preselected as the destination (still retargetable).
        // Pin is implicit and sent first, so removing the folder from the
        // workspace later leaves it visible at root instead of vanishing.
        // See change: redesign-folder-workspace-add-flow.
        <AddFoldersDialog
          workspaces={workspaces ?? []}
          initialWorkspaceId={pickFolderForWsId}
          sessionCwds={sessions.map((s) => s.cwd)}
          onCancel={() => setPickFolderForWsId(null)}
          onPin={(path) => onPinDirectory?.(path)}
          onAddFolderToWorkspace={(wsId, path) => onAddFolderToWorkspace?.(wsId, path)}
          onCreateWorkspace={onCreateWorkspace ? (name) => onCreateWorkspace(name) : undefined}
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
 * the full height of the header content. Both the chevron AND the column
 * below it are drag handles: pointerdown bubbles to this div's dnd-kit
 * listeners, and the PointerSensor's 5px activation distance means a plain
 * click still toggles collapse while a drag (>5px) reorders — so collapsed
 * folders stay reorderable via their always-visible chevron. Mirrors the
 * SessionCard gutter pattern.
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
        className="inline-flex items-center justify-center cursor-grab active:cursor-grabbing hover:text-[var(--text-secondary)]"
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
