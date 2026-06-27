/**
 * Full-page OpenSpec board (kanban). Replaces the inline accordion in
 * `FolderOpenSpecSection`. Groups render as columns; changes render as
 * draggable proposal cards carrying a lifecycle stepper, task progress, a
 * session list (with per-session OpenSpec actions + worktree state), card
 * actions, a filter bar, and a new-proposal dialog.
 *
 * Frontend design source: `openspec/changes/redesign-openspec-board/mockups/board.html`.
 * See change: redesign-openspec-board.
 */

import { EmptyState } from "@blackbelt-technology/pi-dashboard-client-utils/EmptyState";
import {
  type StatusKind,
  statusPresentation,
} from "@blackbelt-technology/pi-dashboard-client-utils/statusPresentation";
import type {
  DashboardSession,
  OpenSpecChange,
  OpenSpecData,
  OpenSpecGroup,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState, OPENSPEC_UNGROUPED_KEY } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  mdiArchiveOutline,
  mdiArrowLeft,
  mdiCog,
  mdiDotsHorizontal,
  mdiDragVertical,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFileDocumentOutline,
  mdiPlay,
  mdiPlayCircleOutline,
  mdiPlus,
  mdiRefresh,
  mdiRobotOutline,
  mdiSourceBranchPlus,
  mdiSourceFork,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatRelativeTime, formatTokens } from "../lib/format.js";
import { t as i18nT } from "../lib/i18n";
import { computeReorder, orderChangesForGroup } from "../lib/openspec-board-order.js";
import { deriveWorktreeProgress } from "../lib/openspec-board-worktree.js";
import { useOpenSpecConfig } from "../lib/openspec-config-api.js";
import { GROUP_PALETTE, resolveGroupColor } from "../lib/openspec-group-palette.js";
import { createGroup, deleteGroup, fetchGroups, setAssignment, setChangeOrder, updateGroup } from "../lib/openspec-groups-api.js";
import { selectBadgeTimestamp } from "../lib/session-card-time.js";
import { deriveDotColor, deriveIconStatusColor, deriveProposalCardState, getCardPulseClass, getCardStripeFxClass, pulseClassForStatus, sourceIcons } from "../lib/session-status-visuals.js";
import { DialogPortal } from "./DialogPortal.js";
import { OpenSpecActivityBadge } from "./OpenSpecActivityBadge.js";
import { OpenSpecGroupManager } from "./OpenSpecGroupManager.js";
import { OpenSpecStepper } from "./OpenSpecStepper.js";
import { SessionOpenSpecActions } from "./SessionOpenSpecActions.js";
import { TasksPopover } from "./TasksPopover.js";

const UNGROUPED = OPENSPEC_UNGROUPED_KEY;

type GroupsState = { groups: OpenSpecGroup[]; assignments: Record<string, string>; changeOrder?: Record<string, string[]> };

export interface OpenSpecBoardViewProps {
  cwd: string;
  data: OpenSpecData;
  sessions: DashboardSession[];
  /** Per-cwd OpenSpec data (worktree dirs keyed by session cwd) for worktree delta. */
  openspecMap: Map<string, OpenSpecData>;
  /** Externally-pushed groups state (from WS). Board fetches on mount as fallback. */
  groupsState?: GroupsState;
  onBack: () => void;
  onRefresh: () => void;
  onReadArtifact: (changeName: string, artifactId: string) => void;
  onNavigateToSession: (sessionId: string) => void;
  onOpenSpecs: () => void;
  onOpenArchive: () => void;
  /** Spawn a session attached to a change (+ optional worktree opts). */
  onSpawnSession: (cwd: string, attachProposal?: string, opts?: { gitWorktreeBase?: string; placeholderCwd?: string }) => void;
  onSpawnAttachedWorktree: (cwd: string, changeName: string) => void;
  onResumeSession: (sessionId: string, mode: "continue" | "fork") => void;
  onHideSession: (sessionId: string) => void;
  onUnhideSession: (sessionId: string) => void;
  onSendPrompt: (sessionId: string, text: string) => void;
  onAttachProposal: (sessionId: string, changeName: string) => void;
  onDetachProposal: (sessionId: string) => void;
  onReplaceProposal?: (sessionId: string, accept: boolean, changeName: string) => void;
  onBulkArchive: () => void;
  isGitRepo: boolean;
  gitWorktreeEnabled: boolean;
  selectedId?: string;
}

const STATE_PILLS: Array<{ value: ChangeState | null; label: string }> = [
  { value: null, label: "All" },
  { value: ChangeState.PLANNING, label: "planning" },
  { value: ChangeState.READY, label: "ready" },
  { value: ChangeState.IMPLEMENTING, label: "implementing" },
  { value: ChangeState.COMPLETE, label: "complete" },
];

type SessStatus = "live" | "waiting" | "ended";
const SESS_PILLS: Array<{ value: SessStatus | null; label: string }> = [
  { value: null, label: "Any" },
  { value: "live", label: "Live" },
  { value: "waiting", label: "Waiting" },
  { value: "ended", label: "Ended" },
];

function sessStatus(s: DashboardSession): SessStatus {
  if (s.status === "ended") return "ended";
  if (s.status === "idle") return "waiting";
  return "live";
}

// Board change states -> shared status vocabulary. Color flows through the
// semantic --status-* token; the glyph is the mandatory non-hue channel so
// COMPLETE (done) stays distinguishable from PLANNING/READY (todo) in
// grayscale. See change: extend-client-utils-state-feedback-primitives.
const CHANGE_STATE_KIND: Record<ChangeState, StatusKind> = {
  [ChangeState.PLANNING]: "todo",
  [ChangeState.READY]: "todo",
  [ChangeState.IMPLEMENTING]: "current",
  [ChangeState.COMPLETE]: "done",
};

function BoardStatePill({ state, testId }: { state: ChangeState; testId?: string }) {
  const pres = statusPresentation(CHANGE_STATE_KIND[state]);
  return (
    <span
      data-testid={testId}
      data-state={state}
      className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-px rounded-full"
      style={{
        color: pres.tokenVar,
        backgroundColor: `color-mix(in srgb, ${pres.tokenVar} 14%, transparent)`,
      }}
    >
      <span aria-hidden="true">{pres.glyph}</span>
      <span>{state.toLowerCase()}</span>
    </span>
  );
}

export function OpenSpecBoardView(props: OpenSpecBoardViewProps) {
  const {
    cwd, data, sessions, openspecMap, groupsState, onBack, onRefresh, onReadArtifact,
    onNavigateToSession, onOpenSpecs, onOpenArchive, onSpawnSession, onSpawnAttachedWorktree,
    onResumeSession, onHideSession, onUnhideSession, onSendPrompt, onAttachProposal,
    onDetachProposal, onReplaceProposal, onBulkArchive, isGitRepo, gitWorktreeEnabled, selectedId,
  } = props;

  const openspecConfig = useOpenSpecConfig(cwd);
  const [local, setLocal] = useState<GroupsState>(groupsState ?? { groups: [], assignments: {}, changeOrder: {} });
  const [tasksOpenFor, setTasksOpenFor] = useState<string | null>(null);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);
  const [proposalDialogGroup, setProposalDialogGroup] = useState<{ open: boolean; groupId: string } | null>(null);
  const [addGroupOpen, setAddGroupOpen] = useState(false);

  // Filters
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<ChangeState | null>(null);
  const [sessFilter, setSessFilter] = useState<SessStatus | null>(null);

  // Auto-scroll the active board item into view, mirroring SessionList. The
  // board gets its own small effect (its trigger set differs from the
  // sidebar's re-sort fingerprint): scroll on external selection change or
  // when a session transitions into ask_user, but NOT on a user row click.
  // See change: port-session-card-state-visuals-to-openspec-board.
  const boardScrollRef = useRef<HTMLDivElement | null>(null);
  const lastClickedRef = useRef<string | null>(null);
  const firstMountRef = useRef(true);
  const prevSelectedIdRef = useRef<string | undefined>(selectedId);
  const askUserFingerprint = useMemo(
    () => sessions.filter((s) => s.currentTool === "ask_user").map((s) => s.id).sort().join(","),
    [sessions],
  );
  useEffect(() => {
    const isFirstMount = firstMountRef.current;
    firstMountRef.current = false;
    // Only treat as a click when the selection actually changed to the clicked
    // id. A re-run driven by askUserFingerprint (selectedId unchanged) must NOT
    // inherit a stale click marker, or attention scrolls get suppressed.
    const selectedChanged = prevSelectedIdRef.current !== selectedId;
    prevSelectedIdRef.current = selectedId;
    const wasClick = selectedChanged && lastClickedRef.current === selectedId;
    lastClickedRef.current = null;
    if (!selectedId) return;
    if (wasClick && !isFirstMount) return;
    const escaped = (window.CSS && typeof window.CSS.escape === "function")
      ? window.CSS.escape(selectedId)
      : selectedId.replace(/"/g, '\\"');
    const el = boardScrollRef.current?.querySelector(`[data-session-id="${escaped}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
      (el as HTMLElement).scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }, [selectedId, askUserFingerprint]);

  // Fetch groups on mount as fallback; sync external WS updates in.
  useEffect(() => {
    if (groupsState) { setLocal(groupsState); return; }
    let cancelled = false;
    fetchGroups(cwd).then((f) => {
      if (!cancelled) setLocal({ groups: f.groups, assignments: f.assignments, changeOrder: f.changeOrder ?? {} });
    }).catch(() => {/* tolerate */});
    return () => { cancelled = true; };
  }, [cwd, groupsState]);

  const groups = useMemo(() => [...local.groups].sort((a, b) => a.order - b.order), [local.groups]);
  const assignments = local.assignments;
  const changeOrder = local.changeOrder ?? {};

  const resolveGroupKey = useCallback((c: OpenSpecChange): string => {
    const gid = assignments[c.name] ?? c.groupId ?? null;
    return gid && groups.some((g) => g.id === gid) ? gid : UNGROUPED;
  }, [assignments, groups]);

  // Filtering ------------------------------------------------------
  const q = query.trim().toLowerCase();
  const sessionsForChange = useCallback(
    (name: string) => sessions.filter((s) => s.attachedProposal === name),
    [sessions],
  );
  const matchSession = useCallback((s: DashboardSession): boolean => {
    if (sessFilter && sessStatus(s) !== sessFilter) return false;
    if (q && !(s.name ?? "").toLowerCase().includes(q)) return false;
    return true;
  }, [sessFilter, q]);

  const cardVisible = useCallback((c: OpenSpecChange): boolean => {
    const sess = sessionsForChange(c.name);
    if (q) {
      const nameHit = c.name.toLowerCase().includes(q) || sess.some((s) => (s.name ?? "").toLowerCase().includes(q));
      if (!nameHit) return false;
    }
    if (stateFilter && deriveChangeState(c) !== stateFilter) return false;
    if (sessFilter && !sess.some((s) => sessStatus(s) === sessFilter)) return false;
    return true;
  }, [q, stateFilter, sessFilter, sessionsForChange]);

  // Partition + order changes per column ---------------------------
  const columns = useMemo(() => {
    const visible = data.changes.filter(cardVisible);
    const byKey = new Map<string, OpenSpecChange[]>();
    for (const c of visible) {
      const key = resolveGroupKey(c);
      const list = byKey.get(key) ?? [];
      list.push(c);
      byKey.set(key, list);
    }
    const cols: Array<{ key: string; group: OpenSpecGroup | null; changes: OpenSpecChange[] }> = [];
    for (const g of groups) {
      cols.push({ key: g.id, group: g, changes: orderChangesForGroup(byKey.get(g.id) ?? [], changeOrder[g.id]) });
    }
    cols.push({ key: UNGROUPED, group: null, changes: orderChangesForGroup(byKey.get(UNGROUPED) ?? [], changeOrder[UNGROUPED]) });
    return cols;
  }, [data.changes, groups, changeOrder, cardVisible, resolveGroupKey]);

  // DnD ------------------------------------------------------------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeDrag, setActiveDrag] = useState<{ type: "column" | "card"; id: string } | null>(null);

  const persistGroupOrder = useCallback(async (ordered: OpenSpecGroup[]) => {
    await Promise.all(ordered.map((g, i) => (g.order === i ? null : updateGroup(cwd, g.id, { order: i }))).filter(Boolean) as Promise<unknown>[]);
  }, [cwd]);

  const handleDragStart = useCallback((e: DragStartEvent) => {
    const t = e.active.data.current?.type;
    if (t === "column" || t === "card") setActiveDrag({ type: t, id: String(e.active.id) });
  }, []);

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = e;
    if (!over) return;
    const aType = active.data.current?.type as string | undefined;

    // Column reorder (real groups only) -----------------------------
    if (aType === "column") {
      const fromId = String(active.id);
      const overId = String(over.id);
      if (fromId === overId) return;
      const ids = groups.map((g) => g.id);
      const from = ids.indexOf(fromId);
      const to = ids.indexOf(overId);
      if (from < 0 || to < 0) return;
      const reordered = arrayMove(groups, from, to);
      setLocal((prev) => ({ ...prev, groups: reordered.map((g, i) => ({ ...g, order: i })) }));
      void persistGroupOrder(reordered);
      return;
    }

    // Card move / reorder -------------------------------------------
    if (aType === "card") {
      const movedName = String(active.id);
      const sourceKey = active.data.current?.groupKey as string;
      const overType = over.data.current?.type as string | undefined;
      const targetKey = overType === "card" ? (over.data.current?.groupKey as string) : String(over.id);
      if (!targetKey) return;

      const targetCol = columns.find((c) => c.key === targetKey);
      const targetNames = (targetCol?.changes ?? []).map((c) => c.name).filter((n) => n !== movedName);
      let insertIndex = targetNames.length;
      if (overType === "card") {
        const overName = String(over.id);
        const idx = targetNames.indexOf(overName);
        if (idx >= 0) insertIndex = idx; // drop before the hovered card
      }

      const groupChanged = sourceKey !== targetKey;
      const newTargetOrder = computeReorder(
        (targetCol?.changes ?? []).map((c) => c.name),
        movedName,
        insertIndex + ((targetCol?.changes ?? []).some((c) => c.name === movedName) && insertIndex > (targetCol?.changes ?? []).findIndex((c) => c.name === movedName) ? 1 : 0),
      );

      // Optimistic local update.
      setLocal((prev) => {
        const next: GroupsState = { ...prev, assignments: { ...prev.assignments }, changeOrder: { ...(prev.changeOrder ?? {}) } };
        if (groupChanged) {
          if (targetKey === UNGROUPED) delete next.assignments[movedName];
          else next.assignments[movedName] = targetKey;
          // prune from source order
          const srcOrder = (prev.changeOrder?.[sourceKey] ?? columns.find((c) => c.key === sourceKey)?.changes.map((c) => c.name) ?? []).filter((n) => n !== movedName);
          next.changeOrder![sourceKey] = srcOrder;
        }
        next.changeOrder![targetKey] = newTargetOrder;
        return next;
      });

      // Persist.
      void (async () => {
        try {
          if (groupChanged) {
            await setAssignment(cwd, { changeName: movedName, groupId: targetKey === UNGROUPED ? null : targetKey });
            const srcCol = columns.find((c) => c.key === sourceKey);
            const srcOrder = (srcCol?.changes ?? []).map((c) => c.name).filter((n) => n !== movedName);
            await setChangeOrder(cwd, { groupId: sourceKey, order: srcOrder });
          }
          await setChangeOrder(cwd, { groupId: targetKey, order: newTargetOrder });
        } catch {/* tolerate; WS will reconcile */}
      })();
    }
  }, [groups, columns, cwd, persistGroupOrder]);

  // Group mutations ------------------------------------------------
  const handleCreateGroup = useCallback(async (name: string, color: string) => {
    const g = await createGroup(cwd, { name, color });
    setLocal((prev) => ({ ...prev, groups: [...prev.groups, g] }));
    return g;
  }, [cwd]);
  const handleUpdateGroup = useCallback(async (id: string, update: { name?: string; color?: string; order?: number }) => {
    const g = await updateGroup(cwd, id, update);
    setLocal((prev) => ({ ...prev, groups: prev.groups.map((x) => (x.id === id ? g : x)) }));
  }, [cwd]);
  const handleDeleteGroup = useCallback(async (id: string) => {
    await deleteGroup(cwd, id);
    setLocal((prev) => {
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev.assignments)) if (v !== id) trimmed[k] = v;
      return { ...prev, groups: prev.groups.filter((g) => g.id !== id), assignments: trimmed };
    });
  }, [cwd]);

  const folderName = cwd.split("/").filter(Boolean).pop() ?? cwd;
  const manageGroup = manageGroupId ? groups.find((g) => g.id === manageGroupId) ?? null : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--bg-primary)]" data-testid="openspec-board">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] sticky top-0 z-10 flex-wrap">
        <button onClick={onBack} className="text-blue-400 hover:text-blue-300 text-[13px] flex items-center gap-1" data-testid="board-back">
          <Icon path={mdiArrowLeft} size={0.6} /> {i18nT("auto.back", undefined, "Back")}
        </button>
        <span className="text-[var(--text-primary)] font-semibold text-[13px]">
          {i18nT("auto.openspec", undefined, "OpenSpec")} <span className="text-[var(--text-tertiary)] font-normal board-crumb-dim">· {folderName} · {data.changes.length} changes</span>
        </span>
        <span className="flex-1" />
        <button onClick={() => { onRefresh(); }} className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[#555]" data-testid="board-refresh">
          <Icon path={mdiRefresh} size={0.5} className="inline mr-0.5" />{i18nT("auto.refresh", undefined, "Refresh")}
        </button>
        <button onClick={onOpenSpecs} className="text-[11px] px-2.5 py-1 rounded-md border text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300" data-testid="board-specs">
          <Icon path={mdiFileDocumentOutline} size={0.5} className="inline mr-0.5" />{i18nT("auto.specs", undefined, "Specs")}
        </button>
        <button onClick={onOpenArchive} className="text-[11px] px-2.5 py-1 rounded-md border text-purple-400 border-purple-500/40 bg-purple-500/5 hover:text-purple-300" data-testid="board-archive">
          <Icon path={mdiArchiveOutline} size={0.5} className="inline mr-0.5" />{i18nT("auto.archive", undefined, "Archive")}
        </button>
        <button onClick={() => setProposalDialogGroup({ open: true, groupId: UNGROUPED })} className="text-[11px] px-2.5 py-1 rounded-md border text-blue-400 border-blue-500/40 bg-blue-500/5 hover:text-blue-300" data-testid="board-new-proposal">
          <Icon path={mdiPlus} size={0.5} className="inline mr-0.5" />{i18nT("auto.new_proposal", undefined, "New proposal")}
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2.5 px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] flex-wrap" data-testid="board-filterbar">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={i18nT("auto.filter_proposals_sessions", undefined, "Filter proposals & sessions…")}
          className="bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-md text-[var(--text-primary)] text-[12px] px-2.5 py-1.5 w-[230px] outline-none focus:border-blue-500/50"
          data-testid="board-filter-text"
        />
        <span className="w-px h-[18px] bg-[var(--border-secondary)]" />
        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{i18nT("auto.state", undefined, "State")}</span>
        <div className="flex gap-1">
          {STATE_PILLS.map((p) => (
            <FilterPill key={p.label} active={stateFilter === p.value} onClick={() => setStateFilter(p.value)} testId={`state-pill-${p.label}`}>{p.label}</FilterPill>
          ))}
        </div>
        <span className="w-px h-[18px] bg-[var(--border-secondary)]" />
        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">{i18nT("auto.session", undefined, "Session")}</span>
        <div className="flex gap-1">
          {SESS_PILLS.map((p) => (
            <FilterPill key={p.label} active={sessFilter === p.value} onClick={() => setSessFilter(p.value)} testId={`sess-pill-${p.label}`}>{p.label}</FilterPill>
          ))}
        </div>
      </div>

      {/* Board */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div ref={boardScrollRef} className="flex gap-3 p-4 items-start overflow-x-auto flex-1 min-h-0 board-columns" data-testid="board-columns">
          <SortableContext items={groups.map((g) => g.id)} strategy={horizontalListSortingStrategy}>
            {columns.map((col) => (
              <BoardColumn
                key={col.key}
                colKey={col.key}
                group={col.group}
                changes={col.changes}
                draggableHeader={col.group != null}
                isDragging={activeDrag?.type === "column" && activeDrag.id === col.key}
                onNewProposal={() => setProposalDialogGroup({ open: true, groupId: col.key })}
                onManage={col.group ? () => setManageGroupId(col.group!.id) : undefined}
                renderCard={(c) => (
                  <ProposalCard
                    key={c.name}
                    cwd={cwd}
                    change={c}
                    groupKey={col.key}
                    sessions={sessionsForChange(c.name).filter(matchSession)}
                    openspecMap={openspecMap}
                    selectedId={selectedId}
                    lastClickedRef={lastClickedRef}
                    onReadArtifact={onReadArtifact}
                    onOpenTasks={() => setTasksOpenFor(c.name)}
                    onNavigateToSession={onNavigateToSession}
                    onSpawnSession={onSpawnSession}
                    onSpawnAttachedWorktree={onSpawnAttachedWorktree}
                    onResumeSession={onResumeSession}
                    onHideSession={onHideSession}
                    onUnhideSession={onUnhideSession}
                    onSendPrompt={onSendPrompt}
                    onAttachProposal={onAttachProposal}
                    onDetachProposal={onDetachProposal}
                    onReplaceProposal={onReplaceProposal}
                    onBulkArchive={onBulkArchive}
                    allChanges={data.changes}
                    groups={groups}
                    assignments={assignments}
                    openspecConfig={openspecConfig}
                    isGitRepo={isGitRepo}
                    gitWorktreeEnabled={gitWorktreeEnabled}
                  />
                )}
              />
            ))}
          </SortableContext>
          <button
            onClick={() => setAddGroupOpen(true)}
            className="flex-[0_0_200px] max-w-[200px] self-start border border-dashed border-[var(--border-secondary)] rounded-xl text-[var(--text-muted)] text-[12px] text-center p-3.5 hover:text-blue-400 hover:border-blue-400 board-addgroup"
            data-testid="board-add-group"
          >
            {i18nT("auto.add_group", undefined, "+ Add group")}
          </button>
        </div>
        <DragOverlay>
          {activeDrag ? (
            <DragChip
              activeDrag={activeDrag}
              changes={data.changes}
              groups={groups}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <div className="px-4 pb-3 text-[var(--text-muted)] text-[11px]">
        {i18nT("auto.drag_column_headers_to_reorder_groups", undefined, "Drag column headers to reorder groups. Drag proposal cards between columns to reassign group. Click a session row to open its chat view.")}
      </div>

      {/* Dialogs */}
      {tasksOpenFor && (
        <DialogPortal>
          <TasksPopover cwd={cwd} change={tasksOpenFor} onClose={() => setTasksOpenFor(null)} />
        </DialogPortal>
      )}
      {manageGroup && (
        <DialogPortal>
          <ModalShell onClose={() => setManageGroupId(null)} title={`Manage · ${manageGroup.name}`}>
            <OpenSpecGroupManager
              groups={[manageGroup]}
              onCreateGroup={async (name, color) => { await handleCreateGroup(name, color); }}
              onUpdateGroup={handleUpdateGroup}
              onDeleteGroup={async (id) => { await handleDeleteGroup(id); setManageGroupId(null); }}
            />
          </ModalShell>
        </DialogPortal>
      )}
      {addGroupOpen && (
        <DialogPortal>
          <ModalShell onClose={() => setAddGroupOpen(false)} title={i18nT("auto.add_group_2", undefined, "Add group")}>
            <GroupCreateForm onSave={async (name, color) => { await handleCreateGroup(name, color); setAddGroupOpen(false); }} onCancel={() => setAddGroupOpen(false)} />
          </ModalShell>
        </DialogPortal>
      )}
      {proposalDialogGroup?.open && (
        <DialogPortal>
          <NewProposalDialog
            groups={groups}
            defaultGroupId={proposalDialogGroup.groupId}
            gitWorktreeEnabled={gitWorktreeEnabled && isGitRepo}
            onCancel={() => setProposalDialogGroup(null)}
            onCreate={(name, groupId, worktree) => {
              setProposalDialogGroup(null);
              // Spawn a session running the new-change flow. The created change
              // is assigned to the chosen group optimistically + persisted.
              if (worktree) {
                onSpawnAttachedWorktree(cwd, name);
              } else {
                onSpawnSession(cwd, name);
              }
              if (groupId !== UNGROUPED) {
                setLocal((prev) => ({ ...prev, assignments: { ...prev.assignments, [name]: groupId } }));
                setAssignment(cwd, { changeName: name, groupId }).catch(() => {});
              }
            }}
          />
        </DialogPortal>
      )}
    </div>
  );
}

// ── Filter pill ───────────────────────────────────────────────────
function FilterPill({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      data-active={active ? "true" : undefined}
      className={`text-[10px] px-2.5 py-[3px] rounded-full border ${active ? "text-blue-400 border-blue-500/50 bg-blue-500/8" : "text-[var(--text-tertiary)] border-[var(--border-secondary)] hover:text-[var(--text-secondary)]"}`}
    >
      {children}
    </button>
  );
}

// ── Drag overlay chip ─────────────────────────────────────────────
// Lightweight pointer-following preview rendered inside <DragOverlay>.
// Shows just the name + a state pill (card) or color dot (column) — never
// the full ProposalCard subtree, so it stays cheap during a 60fps drag.
function DragChip({ activeDrag, changes, groups }: {
  activeDrag: { type: "column" | "card"; id: string };
  changes: OpenSpecChange[];
  groups: OpenSpecGroup[];
}) {
  if (activeDrag.type === "card") {
    const c = changes.find((x) => x.name === activeDrag.id);
    if (!c) return null;
    const state = deriveChangeState(c);
    return (
      <div
        className="bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-[10px] px-2.5 py-2 shadow-lg cursor-grabbing flex items-center gap-1.5 max-w-[300px]"
        data-testid="board-drag-chip"
      >
        <span className="text-[var(--text-primary)] font-semibold text-[12px] flex-1 min-w-0 truncate">{c.name}</span>
        <BoardStatePill state={state} />
      </div>
    );
  }
  const g = groups.find((x) => x.id === activeDrag.id);
  if (!g) return null;
  return (
    <div
      className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl px-3 py-2.5 shadow-lg cursor-grabbing flex items-center gap-2 max-w-[300px]"
      data-testid="board-drag-chip"
    >
      <span className="w-2.5 h-2.5 rounded-[3px] flex-none" style={{ background: resolveGroupColor(g.color) }} />
      <span className="font-semibold text-[var(--text-primary)] text-[12px] truncate">{g.name}</span>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────
function BoardColumn({
  colKey, group, changes, draggableHeader, isDragging, onNewProposal, onManage, renderCard,
}: {
  colKey: string;
  group: OpenSpecGroup | null;
  changes: OpenSpecChange[];
  draggableHeader: boolean;
  isDragging: boolean;
  onNewProposal: () => void;
  onManage?: () => void;
  renderCard: (c: OpenSpecChange) => React.ReactNode;
}) {
  const sortable = useSortable({ id: colKey, data: { type: "column" }, disabled: !draggableHeader });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: colKey, data: { type: "column", groupKey: colKey } });
  const dotColor = group ? resolveGroupColor(group.color) : "var(--text-muted)";
  const name = group ? group.name : "Ungrouped";

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={`flex-[0_0_300px] max-w-[300px] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl flex flex-col max-h-full board-column ${sortable.isDragging || isDragging ? "opacity-50" : ""}`}
      data-testid={`board-column-${colKey}`}
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-primary)]"
        {...(draggableHeader ? { ...sortable.attributes, ...sortable.listeners } : {})}
        style={draggableHeader ? { cursor: "grab" } : undefined}
        data-testid={`board-column-head-${colKey}`}
      >
        <span className="w-2.5 h-2.5 rounded-[3px] flex-none" style={{ background: dotColor }} />
        <span className="font-semibold text-[var(--text-primary)] text-[12px] truncate">{name}</span>
        <span className="text-[var(--text-muted)] text-[11px]">{changes.length}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); onNewProposal(); }} title={i18nT("auto.new_proposal_in_this_group", undefined, "New proposal in this group")} className="text-[var(--text-muted)] hover:text-green-400 text-[13px] font-bold" data-testid={`col-new-proposal-${colKey}`}>＋</button>
          {onManage && (
            <button onClick={(e) => { e.stopPropagation(); onManage(); }} title={i18nT("auto.rename_recolor_delete_group", undefined, "Rename · recolor · delete group")} className="text-[var(--text-muted)] hover:text-blue-400" data-testid={`col-manage-${colKey}`}>
              <Icon path={mdiCog} size={0.5} />
            </button>
          )}
          {draggableHeader && <Icon path={mdiDragVertical} size={0.6} className="text-[var(--text-muted)]" />}
        </span>
      </div>
      <div ref={setDropRef} className={`p-2 flex flex-col gap-2 overflow-y-auto board-column-body rounded-b-xl ${isOver ? "ring-2 ring-inset ring-blue-500/60 bg-blue-500/5" : ""}`} data-testid={`board-column-body-${colKey}`} data-over={isOver ? "true" : undefined}>
        <SortableContext items={changes.map((c) => c.name)} strategy={verticalListSortingStrategy}>
          {changes.length > 0
            ? changes.map((c) => renderCard(c))
            : <EmptyState
                className="py-3.5"
                title={i18nT("auto.no_proposals", undefined, "No proposals")}
              />}
        </SortableContext>
      </div>
    </div>
  );
}

// ── Proposal card ─────────────────────────────────────────────────
function ProposalCard(props: {
  cwd: string;
  change: OpenSpecChange;
  groupKey: string;
  sessions: DashboardSession[];
  openspecMap: Map<string, OpenSpecData>;
  selectedId?: string;
  lastClickedRef: React.MutableRefObject<string | null>;
  onReadArtifact: (changeName: string, artifactId: string) => void;
  onOpenTasks: () => void;
  onNavigateToSession: (id: string) => void;
  onSpawnSession: (cwd: string, attachProposal?: string, opts?: { gitWorktreeBase?: string; placeholderCwd?: string }) => void;
  onSpawnAttachedWorktree: (cwd: string, changeName: string) => void;
  onResumeSession: (id: string, mode: "continue" | "fork") => void;
  onHideSession: (id: string) => void;
  onUnhideSession: (id: string) => void;
  onSendPrompt: (sessionId: string, text: string) => void;
  onAttachProposal: (sessionId: string, changeName: string) => void;
  onDetachProposal: (sessionId: string) => void;
  onReplaceProposal?: (sessionId: string, accept: boolean, changeName: string) => void;
  onBulkArchive: () => void;
  allChanges: OpenSpecChange[];
  groups: OpenSpecGroup[];
  assignments: Record<string, string>;
  openspecConfig: ReturnType<typeof useOpenSpecConfig>;
  isGitRepo: boolean;
  gitWorktreeEnabled: boolean;
}) {
  const { change: c, groupKey, sessions, openspecMap } = props;
  const sortable = useSortable({ id: c.name, data: { type: "card", groupKey } });
  const state = deriveChangeState(c);
  const pct = c.totalTasks > 0 ? Math.round((100 * c.completedTasks) / c.totalTasks) : 0;
  // Aggregate the most-urgent child-session state into one card-level stripe.
  // See change: port-session-card-state-visuals-to-openspec-board.
  const cardStripeFx = deriveProposalCardState(sessions);

  return (
    <div
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={`relative isolate bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-[10px] px-2.5 py-2 board-card cursor-grab active:cursor-grabbing ${sortable.isDragging ? "opacity-40" : ""}`}
      data-testid={`board-card-${c.name}`}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      {cardStripeFx ? <div className={`card-stripes-fx ${cardStripeFx}`} aria-hidden="true" /> : null}
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-primary)] font-semibold text-[12px] flex-1 min-w-0 truncate" data-testid="board-card-name">{c.name}</span>
        <BoardStatePill state={state} testId="board-card-state" />
      </div>

      {/* Lifecycle stepper */}
      <div className="mt-2" onPointerDown={(e) => e.stopPropagation()}>
        <OpenSpecStepper
          variant="compact"
          change={c}
          attached={null}
          hasAnyChanges
          onReadArtifact={props.onReadArtifact}
          onOpenTasks={props.onOpenTasks}
        />
      </div>

      {/* Task progress */}
      {c.totalTasks > 0 && (
        <div className="mt-1.5" data-testid="board-card-progress">
          <div className="h-1 rounded-[3px] bg-[var(--bg-secondary)] overflow-hidden">
            <i className="block h-full bg-green-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="text-[9px] text-[var(--text-tertiary)] mt-0.5">{c.completedTasks}/{c.totalTasks} {i18nT("auto.tasks_2", undefined, "tasks ·")} {pct}%</div>
        </div>
      )}

      {/* Sessions */}
      {sessions.length > 0 && (
        <div className="mt-2 flex flex-col gap-1" data-testid="board-card-sessions">
          {sessions.map((s) => (
            <BoardSessionRow key={s.id} {...props} session={s} change={c} />
          ))}
        </div>
      )}

      {/* Card actions */}
      <div className="flex gap-1.5 mt-2 pt-1.5 border-t border-[var(--border-subtle)]" onPointerDown={(e) => e.stopPropagation()}>
        <button
          onClick={() => props.onSpawnSession(props.cwd, c.name)}
          className="flex-1 text-[9px] px-1 py-[3px] rounded-md text-green-400 border border-green-500/30 hover:bg-green-500/8 whitespace-nowrap"
          data-testid={`card-new-session-${c.name}`}
          title={i18nT("auto.spawn_a_session_attached_to_this", undefined, "Spawn a session attached to this proposal")}
        >
          <Icon path={mdiPlay} size={0.4} className="inline mr-0.5" />{i18nT("auto.new_session", undefined, "New session")}
        </button>
        {props.isGitRepo && props.gitWorktreeEnabled && (
          <button
            onClick={() => props.onSpawnAttachedWorktree(props.cwd, c.name)}
            className="flex-1 text-[9px] px-1 py-[3px] rounded-md text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/8 whitespace-nowrap"
            data-testid={`card-new-worktree-${c.name}`}
            title={i18nT("auto.spawn_a_worktree_for_this_proposal", undefined, "Spawn a worktree for this proposal")}
          >
            <Icon path={mdiSourceBranchPlus} size={0.4} className="inline mr-0.5" />{i18nT("auto.new_worktree", undefined, "New worktree")}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Session row ───────────────────────────────────────────────────
function BoardSessionRow({
  session: s, change: c, cwd, openspecMap, selectedId, lastClickedRef, onNavigateToSession,
  onResumeSession, onHideSession, onUnhideSession, onSendPrompt, onReadArtifact,
  onAttachProposal, onDetachProposal, onReplaceProposal, onBulkArchive, allChanges, groups, assignments, openspecConfig,
}: {
  session: DashboardSession;
  change: OpenSpecChange;
} & React.ComponentProps<typeof ProposalCard>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isHidden = !!s.hidden;
  const isAlive = s.status !== "ended";
  const hasFile = !!s.sessionFile;
  const showResume = hasFile && (!isAlive || isHidden);
  const iconColor = deriveIconStatusColor(deriveDotColor(s), s.status);
  const pulse = pulseClassForStatus(s);
  const isSelected = selectedId === s.id;
  const wt = deriveWorktreeProgress(s, c.name, c.completedTasks, openspecMap);
  // Status-stripe overlay identical to the sidebar SessionCard.
  // See change: port-session-card-state-visuals-to-openspec-board.
  const stripeFx = getCardStripeFxClass(getCardPulseClass(s));

  return (
    <div
      className={`relative isolate bg-[var(--bg-secondary)] border rounded-[7px] px-1.5 py-1 cursor-pointer ${isSelected ? "border-blue-500/60" : "border-[var(--border-subtle)] hover:border-blue-500"}`}
      data-testid="board-session-row"
      data-session-id={s.id}
      data-selected={isSelected ? "true" : undefined}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => { lastClickedRef.current = s.id; onNavigateToSession(s.id); }}
    >
      {stripeFx ? <div className={`card-stripes-fx ${stripeFx}`} aria-hidden="true" /> : null}
      {/* Row 1: status + name + age + actions */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`flex-none ${iconColor} ${pulse}`.trimEnd()}>
          <Icon path={sourceIcons[s.source] ?? mdiRobotOutline} size={0.45} />
        </span>
        <span className="text-blue-400 text-[10px] flex-1 min-w-0 truncate" title={s.name || s.id}>{s.name || s.id.slice(0, 8)}</span>
        <span className="text-[9px] text-[var(--text-muted)] flex-none">{formatRelativeTime(Date.now() - selectBadgeTimestamp(s))}</span>
        <span className="flex items-center gap-1 flex-none" onClick={(e) => e.stopPropagation()}>
          {showResume && (
            <button title={i18nT("auto.resume_continue_session", undefined, "Resume / continue session")} onClick={() => onResumeSession(s.id, "continue")} className="text-[var(--text-muted)] hover:text-green-400"><Icon path={mdiPlayCircleOutline} size={0.42} /></button>
          )}
          {hasFile && (
            <button title={i18nT("auto.fork_session", undefined, "Fork session")} onClick={() => onResumeSession(s.id, "fork")} className="text-[var(--text-muted)] hover:text-blue-400"><Icon path={mdiSourceFork} size={0.42} /></button>
          )}
          {isHidden
            ? <button title={i18nT("auto.show_session", undefined, "Show session")} onClick={() => onUnhideSession(s.id)} className="text-[var(--text-muted)] hover:text-green-400"><Icon path={mdiEyeOutline} size={0.42} /></button>
            : <button title={i18nT("auto.hide_session", undefined, "Hide session")} onClick={() => onHideSession(s.id)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"><Icon path={mdiEyeOffOutline} size={0.42} /></button>}
          <span className="relative">
            <button title={i18nT("auto.openspec_commands", undefined, "OpenSpec commands")} onClick={() => setMenuOpen((v) => !v)} className="text-[var(--text-muted)] hover:text-purple-400" data-testid={`session-os-menu-${s.id}`}><Icon path={mdiDotsHorizontal} size={0.5} /></button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50" onClick={(e) => e.stopPropagation()} data-testid="session-os-menu-panel">
                <SessionOpenSpecActions
                  session={s}
                  changes={allChanges}
                  onAttach={(name) => onAttachProposal(s.id, name)}
                  onDetach={() => onDetachProposal(s.id)}
                  onReplaceProposal={onReplaceProposal ? (accept, name) => onReplaceProposal(s.id, accept, name) : undefined}
                  onSendPrompt={(text) => onSendPrompt(s.id, text)}
                  onReadArtifact={onReadArtifact}
                  onBulkArchive={onBulkArchive}
                  groups={groups}
                  assignments={assignments}
                  openspecConfig={openspecConfig}
                />
              </div>
            )}
          </span>
        </span>
      </div>

      {/* Row 2: phase chip */}
      {(s.openspecPhase || s.openspecChange) && (
        <OpenSpecActivityBadge phase={s.openspecPhase ?? undefined} completedTasks={c.completedTasks} totalTasks={c.totalTasks} />
      )}

      {/* Row 3: stats */}
      <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-[var(--text-tertiary)]" onClick={(e) => e.stopPropagation()}>
        <span className="whitespace-nowrap">{formatTokens(s.tokensIn ?? 0)}↑ {formatTokens(s.tokensOut ?? 0)}↓</span>
        {s.contextTokens != null && s.contextWindow ? (
          <span className="w-[26px] h-1 rounded-[3px] bg-[var(--bg-tertiary)] overflow-hidden" title={`context ${Math.round((100 * s.contextTokens) / s.contextWindow)}%`}>
            <i className="block h-full bg-blue-500" style={{ width: `${Math.min(100, Math.round((100 * s.contextTokens) / s.contextWindow))}%` }} />
          </span>
        ) : null}
        {s.cost != null && s.cost > 0 && <span className="whitespace-nowrap">${s.cost.toFixed(2)}</span>}
      </div>

      {/* Row 4: worktree marker + delta */}
      {wt && (
        <div className="flex items-center gap-1.5 mt-0.5" data-testid="board-session-worktree" title={wt.base ? `Worktree tasks.md — from ${wt.base}` : "Worktree tasks.md — may differ from proposal (main)"}>
          <span className="text-yellow-400 text-[9px] flex-1 min-w-0 truncate">⎇ {wt.name}</span>
          {wt.total != null && wt.total > 0 && wt.done != null && (
            <>
              <span className="w-[30px] h-1 rounded-[3px] bg-[var(--bg-tertiary)] overflow-hidden flex-none">
                <i className="block h-full bg-yellow-500" style={{ width: `${Math.round((100 * wt.done) / wt.total)}%` }} />
              </span>
              <span className="text-[8px] text-[var(--text-muted)] flex-none">{wt.done}/{wt.total}</span>
              {wt.delta != null && wt.delta !== 0 && (
                <span className={`text-[8px] font-bold flex-none ${wt.delta > 0 ? "text-green-400" : "text-orange-400"}`} data-testid="board-session-worktree-delta">
                  {wt.delta > 0 ? `+${wt.delta}` : `${wt.delta}`}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal shell + forms ───────────────────────────────────────────
function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[60]" onClick={onClose}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-4 w-80 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function GroupCreateForm({ onSave, onCancel }: { onSave: (name: string, color: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_PALETTE[0].hex);
  return (
    <div className="space-y-2">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={i18nT("auto.group_name", undefined, "Group name")}
        onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim(), color); if (e.key === "Escape") onCancel(); }}
        className="w-full text-[12px] bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-[var(--text-primary)] outline-none focus:border-blue-500/50" data-testid="add-group-name" />
      <div className="flex gap-1.5">
        {GROUP_PALETTE.map((p) => (
          <button key={p.id} onClick={() => setColor(p.hex)} className={`w-5 h-5 rounded-sm border-2 ${color === p.hex ? "border-white/60" : "border-transparent hover:border-white/30"}`} style={{ backgroundColor: p.hex }} />
        ))}
      </div>
      <div className="flex gap-1.5 justify-end">
        <button onClick={onCancel} className="text-[10px] px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)]">{i18nT("auto.cancel", undefined, "Cancel")}</button>
        <button disabled={!name.trim()} onClick={() => name.trim() && onSave(name.trim(), color)} className="text-[10px] px-2 py-0.5 rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40" data-testid="add-group-save">{i18nT("auto.create", undefined, "Create")}</button>
      </div>
    </div>
  );
}

function NewProposalDialog({ groups, defaultGroupId, gitWorktreeEnabled, onCancel, onCreate }: {
  groups: OpenSpecGroup[];
  defaultGroupId: string;
  gitWorktreeEnabled: boolean;
  onCancel: () => void;
  onCreate: (name: string, groupId: string, worktree: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [worktree, setWorktree] = useState(false);
  const submit = () => { const n = name.trim(); if (n) onCreate(n, groupId, worktree); };
  return (
    <div className="fixed inset-0 bg-black/55 flex items-center justify-center z-[60]" onClick={onCancel}>
      <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl p-4 w-[330px]" onClick={(e) => e.stopPropagation()} data-testid="new-proposal-dialog">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{i18nT("auto.new_proposal", undefined, "New proposal")}</h3>
        <p className="text-[10px] text-[var(--text-muted)] mb-3">{i18nT("auto.spawns_a_session_running_the_new", undefined, "Spawns a session running the new-change flow. The created change lands in the chosen group.")}</p>
        <div className="mb-2.5">
          <label className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{i18nT("auto.name", undefined, "Name")}</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="kebab-case-name"
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") onCancel(); }}
            className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-md text-[var(--text-primary)] text-[12px] px-2 py-1.5 outline-none focus:border-blue-500/50" data-testid="np-name" />
        </div>
        <div className="mb-2.5">
          <label className="block text-[9px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{i18nT("auto.group", undefined, "Group")}</label>
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded-md text-[var(--text-primary)] text-[12px] px-2 py-1.5 outline-none focus:border-blue-500/50" data-testid="np-group">
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value={UNGROUPED}>{i18nT("auto.ungrouped", undefined, "Ungrouped")}</option>
          </select>
        </div>
        {gitWorktreeEnabled && (
          <div className="flex items-center gap-2 mb-2.5">
            <input id="np-wt" type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} data-testid="np-worktree" />
            <label htmlFor="np-wt" className="text-[12px] text-[var(--text-secondary)]">{i18nT("auto.create_in_a_new_worktree_os", undefined, "Create in a new worktree (os/<name>)")}</label>
          </div>
        )}
        <div className="flex gap-2 justify-end mt-3.5">
          <button onClick={onCancel} className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--border-secondary)] text-[var(--text-secondary)]">{i18nT("auto.cancel", undefined, "Cancel")}</button>
          <button onClick={submit} disabled={!name.trim()} className="text-[11px] px-2.5 py-1 rounded-md border border-blue-500/40 text-blue-400 bg-blue-500/6 hover:text-blue-300 disabled:opacity-40" data-testid="np-create">{i18nT("auto.create_spawn", undefined, "Create & spawn")}</button>
        </div>
      </div>
    </div>
  );
}
