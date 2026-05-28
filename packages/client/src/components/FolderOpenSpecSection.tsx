import React, { useCallback, useEffect, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiRefresh, mdiChevronDown, mdiChevronRight, mdiArchiveOutline, mdiFileDocumentOutline, mdiPlay, mdiPlus, mdiEyeOffOutline, mdiEyeOutline, mdiPlayCircleOutline, mdiSourceFork, mdiRobotOutline, mdiSourceBranchPlus } from "@mdi/js";
import {
  sourceIcons,
  deriveDotColor,
  deriveIconStatusColor,
  pulseClassForStatus,
} from "../lib/session-status-visuals.js";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { OpenSpecData, OpenSpecChange, OpenSpecGroup, DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ArtifactLettersButton } from "./openspec-helpers.js";
import { DialogPortal } from "./DialogPortal.js";
import { TasksPopover } from "./TasksPopover.js";
import { OpenSpecGroupPills } from "./OpenSpecGroupPills.js";
import { OpenSpecGroupSection } from "./OpenSpecGroupSection.js";
import { OpenSpecGroupPicker } from "./OpenSpecGroupPicker.js";
import { OpenSpecGroupManager } from "./OpenSpecGroupManager.js";
import { DraggableChangeRow } from "./DraggableChangeRow.js";
import { fetchGroups, createGroup, setAssignment, updateGroup, deleteGroup } from "../lib/openspec-groups-api.js";
import { GROUP_PALETTE } from "../lib/openspec-group-palette.js";

interface Props {
  data: OpenSpecData;
  cwd: string;
  onRefresh: () => void;
  onReadArtifact?: (changeName: string, artifactId: string) => void;
  sessions?: DashboardSession[];
  onNavigateToSession?: (sessionId: string) => void;
  onOpenSpecs?: () => void;
  onOpenArchive?: () => void;
  onSpawnAttached?: (cwd: string, changeName: string) => void;
  /**
   * Per-change `⥂2+` worktree-spawn handler. When set + `isGitRepo` +
   * `gitWorktreeEnabled` all true, renders an extra button alongside
   * `▶ spawn-attached` that calls `(cwd, changeName)` so the parent can
   * open `WorktreeSpawnDialog` with `initialBranch="os/<name>"` and
   * `attachProposal=<name>`. See change: openspec-worktree-spawn-button.
   */
  onSpawnAttachedWorktree?: (cwd: string, changeName: string) => void;
  /** Whether the folder is a git repo. Required for the `⥂2+` button to render. */
  isGitRepo?: boolean;
  /** Global UI preference (default true). Hides the `⥂2+` button when false. */
  gitWorktreeEnabled?: boolean;
  /** Hide a session (eye-off icon on linked-session pill). */
  onHideSession?: (sessionId: string) => void;
  /** Unhide a session (eye icon, shown when session.hidden). */
  onUnhideSession?: (sessionId: string) => void;
  /** Resume or fork a session (play-circle / source-fork icons). */
  onResumeSession?: (sessionId: string, mode: "continue" | "fork") => void;
  /** Externally-pushed groups (from WS broadcast). */
  groups?: OpenSpecGroup[];
  /** Externally-pushed assignments (from WS broadcast). */
  assignments?: Record<string, string>;
  /**
   * Currently selected session id. Linked-session rows whose `s.id` matches
   * this value render with `border-blue-500/60`; others with
   * `border-transparent`. See change: add-session-status-to-folder-proposal-rows.
   */
  selectedId?: string;
}

export function FolderOpenSpecSection({ data, cwd, onRefresh, onReadArtifact, sessions, onNavigateToSession, onOpenSpecs, onOpenArchive, onSpawnAttached, onSpawnAttachedWorktree, isGitRepo, gitWorktreeEnabled, onHideSession, onUnhideSession, onResumeSession, groups: externalGroups, assignments: externalAssignments, selectedId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tasksOpenForChange, setTasksOpenForChange] = useState<string | null>(null);
  const [activePill, setActivePill] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [collapseState, setCollapseState] = useState<Record<string, boolean>>({});
  const [localGroups, setLocalGroups] = useState<OpenSpecGroup[]>([]);
  const [localAssignments, setLocalAssignments] = useState<Record<string, string>>({});
  const [managerOpen, setManagerOpen] = useState(false);
  const [showBootstrapCreate, setShowBootstrapCreate] = useState(false);

  // Use external groups (from WS) if available, otherwise local fetch
  const groups = externalGroups ?? localGroups;
  const assignments = externalAssignments ?? localAssignments;

  // Fetch groups on mount (unless provided externally)
  useEffect(() => {
    if (externalGroups) return;
    let cancelled = false;
    fetchGroups(cwd).then((result) => {
      if (cancelled) return;
      setLocalGroups(result.groups);
      setLocalAssignments(result.assignments);
    }).catch(() => {/* tolerate */});
    return () => { cancelled = true; };
  }, [cwd, externalGroups]);

  // Sync external groups into local state
  useEffect(() => {
    if (externalGroups) setLocalGroups(externalGroups);
  }, [externalGroups]);
  useEffect(() => {
    if (externalAssignments) setLocalAssignments(externalAssignments);
  }, [externalAssignments]);

  const refreshGroups = useCallback(async () => {
    try {
      const result = await fetchGroups(cwd);
      setLocalGroups(result.groups);
      setLocalAssignments(result.assignments);
    } catch {/* tolerate */}
  }, [cwd]);

  const handleCreateGroup = useCallback(async (name: string, color: string) => {
    const group = await createGroup(cwd, { name, color });
    setLocalGroups((prev) => [...prev, group]);
    return group;
  }, [cwd]);

  const handleAssign = useCallback(async (changeName: string, groupId: string | null) => {
    await setAssignment(cwd, { changeName, groupId });
    setLocalAssignments((prev) => {
      const next = { ...prev };
      if (groupId === null) delete next[changeName];
      else next[changeName] = groupId;
      return next;
    });
  }, [cwd]);

  const handleUpdateGroup = useCallback(async (id: string, update: { name?: string; color?: string; order?: number }) => {
    await updateGroup(cwd, id, update);
    await refreshGroups();
  }, [cwd, refreshGroups]);

  const handleDeleteGroup = useCallback(async (id: string) => {
    await deleteGroup(cwd, id);
    await refreshGroups();
  }, [cwd, refreshGroups]);

  const toggleCollapse = useCallback((groupId: string) => {
    setCollapseState((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  // Drag-and-drop: move changes between groups
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Resolve effective groupId (defined early for drag handler)
  const resolveGroupId = useCallback((changeName: string): string | null =>
    assignments[changeName] ?? data.changes.find((c) => c.name === changeName)?.groupId ?? null,
  [assignments, data.changes]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const changeData = active.data.current;
    const groupData = over.data.current;
    if (changeData?.type !== "openspec-change" || groupData?.type !== "openspec-group") return;
    const changeName = changeData.changeName as string;
    const rawGroupId = groupData.groupId as string;
    const targetGroupId = rawGroupId === "__ungrouped__" ? null : rawGroupId || null;
    const currentGroupId = resolveGroupId(changeName);
    if (currentGroupId === targetGroupId) return;
    handleAssign(changeName, targetGroupId);
  }, [resolveGroupId, handleAssign]);

  // Pending state (cold boot)
  if (!data.initialized && data.pending) {
    return (
      <div data-testid="folder-openspec-section-pending" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1.5 mt-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-[var(--text-tertiary)] border-t-transparent animate-spin"
            data-testid="folder-openspec-pending-spinner"
            aria-label="OpenSpec loading"
          />
          <span className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">OpenSpec</span>
        </div>
      </div>
    );
  }

  if (!data.initialized) return null;

  const sortedChanges = [
    ...data.changes.filter((c) => c.status !== "complete"),
    ...data.changes.filter((c) => c.status === "complete"),
  ];

  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
  const hasGroups = groups.length > 0;

  // Resolve effective groupId for each change (prefer assignments map, fall back to change.groupId)
  const getGroupId = (c: OpenSpecChange): string | null =>
    assignments[c.name] ?? c.groupId ?? null;

  // Filter by pill + search
  const filterChanges = (changes: OpenSpecChange[]): OpenSpecChange[] => {
    let filtered = changes;
    if (activePill !== null) {
      if (activePill === "__ungrouped__") {
        filtered = filtered.filter((c) => getGroupId(c) === null);
      } else {
        filtered = filtered.filter((c) => getGroupId(c) === activePill);
      }
    }
    if (searchFilter) {
      const lower = searchFilter.toLowerCase();
      filtered = filtered.filter((c) => c.name.toLowerCase().includes(lower));
    }
    return filtered;
  };

  // Partition changes into groups
  const partitionByGroup = (changes: OpenSpecChange[]) => {
    const grouped = new Map<string, OpenSpecChange[]>();
    const ungrouped: OpenSpecChange[] = [];

    for (const c of changes) {
      const gId = getGroupId(c);
      if (gId && groups.find((g) => g.id === gId)) {
        const list = grouped.get(gId) ?? [];
        list.push(c);
        grouped.set(gId, list);
      } else {
        ungrouped.push(c);
      }
    }
    return { grouped, ungrouped };
  };

  const filteredChanges = filterChanges(sortedChanges);
  const { grouped, ungrouped } = partitionByGroup(filteredChanges);

  const renderChangeRow = (c: OpenSpecChange, opts?: { showGroupPicker?: boolean }) => {
    const showPicker = opts?.showGroupPicker ?? true;
    const linkedSessions = sessions?.filter((s) => s.attachedProposal === c.name) ?? [];
    return (
      <div key={c.name} className="px-2 py-1">
        {/* Line 1: change name + task count + controls */}
        <div className="flex items-center gap-2">
          <span data-testid="change-name" className="text-[11px] font-medium text-[var(--text-secondary)] truncate min-w-0">
            {c.name}
          </span>
          {c.totalTasks > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setTasksOpenForChange((current) => (current === c.name ? null : c.name));
              }}
              data-testid={`folder-tasks-counter-${c.name}`}
              title="Toggle tasks"
              className="text-[10px] text-[var(--text-tertiary)] hover:text-blue-400 whitespace-nowrap ml-auto cursor-pointer"
            >
              {c.completedTasks}/{c.totalTasks} tasks
            </button>
          ) : (
            <span className="ml-auto" />
          )}
          {hasGroups && showPicker && (
            <OpenSpecGroupPicker
              groups={groups}
              currentGroupId={getGroupId(c)}
              onAssign={(groupId) => handleAssign(c.name, groupId)}
              onCreateGroup={async (name, color) => {
                const g = await handleCreateGroup(name, color);
                return g;
              }}
            />
          )}
          <ArtifactLettersButton artifacts={c.artifacts} changeName={c.name} onReadArtifact={onReadArtifact} />
          {isGitRepo && gitWorktreeEnabled && onSpawnAttachedWorktree && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSpawnAttachedWorktree(cwd, c.name); }}
              data-testid={`spawn-attached-worktree-btn-${c.name}`}
              title="New worktree for this change"
              className="text-[var(--text-muted)] hover:text-yellow-400"
            >
              <Icon path={mdiSourceBranchPlus} size={0.5} />
            </button>
          )}
          {onSpawnAttached && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSpawnAttached(cwd, c.name); }}
              data-testid={`spawn-attached-btn-${c.name}`}
              title="Spawn session attached to this change"
              className="text-[var(--text-muted)] hover:text-green-400"
            >
              <Icon path={mdiPlay} size={0.5} />
            </button>
          )}
        </div>
        {/* Line 2+: linked sessions — always stack full-width for readable list of names.
            Each row: name (jump) + trailing lifecycle icon group (hide/unhide/resume/fork). */}
        {linkedSessions.length > 0 && (
          <div className="mt-0.5 flex flex-col items-stretch gap-0.5">
            {linkedSessions.map((s) => {
              const isHidden = !!s.hidden;
              const isAlive = s.status !== "ended";
              const hasSessionFile = !!s.sessionFile;
              const showResume = !!onResumeSession && hasSessionFile && (!isAlive || isHidden);
              const showFork = !!onResumeSession && hasSessionFile;
              // Source-icon-as-status indicator (mirrors SessionCard's
              // left-gutter idiom; status-only — no chat-panel error/retry).
              // See change: add-session-status-to-folder-proposal-rows.
              const iconColor = deriveIconStatusColor(deriveDotColor(s), s.status);
              const pulse = pulseClassForStatus(s);
              const isSelected = selectedId === s.id;
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-1 rounded bg-[var(--bg-tertiary)] pr-0.5 border ${isSelected ? "border-blue-500/60" : "border-transparent"}`}
                  data-testid="linked-session-row"
                  data-selected={isSelected ? "true" : undefined}
                >
                  <span
                    className={`flex-shrink-0 ml-1 ${iconColor} ${pulse}`.trimEnd()}
                    data-testid="linked-session-status-icon"
                  >
                    <Icon path={sourceIcons[s.source] ?? mdiRobotOutline} size={0.5} />
                  </span>
                  <button
                    data-testid="session-link"
                    onClick={(e) => { e.stopPropagation(); onNavigateToSession?.(s.id); }}
                    className="flex-1 min-w-0 text-[9px] px-1 py-0.5 text-blue-400 hover:text-blue-300 truncate text-left"
                    title={s.name || s.id}
                  >
                    {s.name || s.id.slice(0, 8)}
                  </button>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    {isHidden && onUnhideSession ? (
                      <button
                        data-testid="linked-session-unhide"
                        onClick={(e) => { e.stopPropagation(); onUnhideSession(s.id); }}
                        className="p-0.5 text-[var(--text-tertiary)] hover:text-green-400"
                        title="Show session"
                      >
                        <Icon path={mdiEyeOutline} size={0.4} />
                      </button>
                    ) : !isHidden && onHideSession ? (
                      <button
                        data-testid="linked-session-hide"
                        onClick={(e) => { e.stopPropagation(); onHideSession(s.id); }}
                        className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-muted)]"
                        title="Hide session"
                      >
                        <Icon path={mdiEyeOffOutline} size={0.4} />
                      </button>
                    ) : null}
                    {showResume && (
                      <button
                        data-testid="linked-session-resume"
                        onClick={(e) => { e.stopPropagation(); onResumeSession!(s.id, "continue"); }}
                        className="p-0.5 text-[var(--text-tertiary)] hover:text-green-400"
                        title="Resume session"
                      >
                        <Icon path={mdiPlayCircleOutline} size={0.4} />
                      </button>
                    )}
                    {showFork && (
                      <button
                        data-testid="linked-session-fork"
                        onClick={(e) => { e.stopPropagation(); onResumeSession!(s.id, "fork"); }}
                        className="p-0.5 text-[var(--text-tertiary)] hover:text-blue-400"
                        title="Fork session"
                      >
                        <Icon path={mdiSourceFork} size={0.4} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderDraggableChangeRow = (c: OpenSpecChange, opts?: { showGroupPicker?: boolean }) => (
    <DraggableChangeRow key={c.name} changeName={c.name}>
      {renderChangeRow(c, opts)}
    </DraggableChangeRow>
  );

  const renderGroupedView = () => (
    <DndContext sensors={dndSensors} onDragEnd={handleDragEnd}>
    <div className="space-y-1" data-testid="folder-openspec-grouped">
      {sortedGroups.map((g) => {
        const items = grouped.get(g.id) ?? [];
        const isExpanded = activePill === null || activePill === g.id
          ? collapseState[g.id] !== false  // default expanded
          : false;                          // inactive pill → collapsed

        // When a pill is active and this isn't the active group, show header but collapsed
        // Clicking switches pill (task 7.7)
        const handleHeaderClick = () => {
          if (activePill !== null && activePill !== g.id) {
            setActivePill(g.id);
            setCollapseState((prev) => ({ ...prev, [g.id]: true }));
          } else {
            toggleCollapse(g.id);
          }
        };

        return (
          <OpenSpecGroupSection
            key={g.id}
            name={g.name}
            color={g.color}
            count={items.length}
            expanded={isExpanded}
            onToggle={handleHeaderClick}
            testId={`group-section-${g.id}`}
            droppableId={g.id}
          >
            {items.length > 0
              ? items.map((c) => renderDraggableChangeRow(c, { showGroupPicker: false }))
              : (
                <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">
                  {searchFilter ? `No matching changes in '${g.name}'` : "No changes in this group yet"}
                </p>
              )}
          </OpenSpecGroupSection>
        );
      })}

      {/* Ungrouped section — always rendered as drop target. Collapsed when inactive pill. */}
      {(() => {
        const isUngroupedActive = activePill === null || activePill === "__ungrouped__";
        const isExpanded = isUngroupedActive ? collapseState["__ungrouped__"] !== false : false;
        const handleHeaderClick = () => {
          if (!isUngroupedActive) {
            setActivePill("__ungrouped__");
            setCollapseState((prev) => ({ ...prev, ["__ungrouped__"]: true }));
          } else {
            toggleCollapse("__ungrouped__");
          }
        };
        return (
        <OpenSpecGroupSection
          name="Ungrouped"
          color={null}
          count={ungrouped.length}
          expanded={isExpanded}
          onToggle={handleHeaderClick}
          testId="group-section-ungrouped"
          droppableId="__ungrouped__"
        >
          {ungrouped.length > 0
            ? ungrouped.map((c) => renderDraggableChangeRow(c, { showGroupPicker: true }))
            : (
              <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">
                {searchFilter ? "No matching ungrouped changes" : "No ungrouped changes"}
              </p>
            )}
        </OpenSpecGroupSection>
        );
      })()}
    </div>
    </DndContext>
  );

  const renderFlatView = () => (
    <div className="space-y-0.5" data-testid="folder-openspec-changes">
      {filteredChanges.map((c) => renderChangeRow(c))}
    </div>
  );

  // Bootstrap CTA (task 7.8): show "Create group" when 0 groups + ≥1 changes
  const showBootstrapCta = !hasGroups && data.changes.length > 0;

  return (
    <div data-testid="folder-openspec-section" onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className="flex items-center gap-1.5 mt-1">
        <button
          data-testid="folder-openspec-header"
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase hover:text-[var(--text-secondary)]"
        >
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.45} />
          <span>OpenSpec ({data.changes.length} changes)</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onRefresh(); refreshGroups(); }}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          title="Refresh"
          data-testid="folder-openspec-refresh"
        >
          <Icon path={mdiRefresh} size={0.5} />
        </button>
        {showBootstrapCta && expanded && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowBootstrapCreate(true); }}
            className="text-[10px] text-[var(--text-muted)] hover:text-blue-400 flex items-center gap-0.5"
            data-testid="bootstrap-create-group-btn"
          >
            <Icon path={mdiPlus} size={0.35} />Create group
          </button>
        )}
        <span className="flex-1" />
        {onOpenArchive && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenArchive(); }}
            className="text-[10px] px-1.5 py-0.5 rounded border text-purple-400 border-purple-500/40 bg-purple-500/5 hover:text-purple-300 hover:border-purple-500/70"
            data-testid="folder-archive-btn"
          >
            <Icon path={mdiArchiveOutline} size={0.4} className="inline mr-0.5" />Archive
          </button>
        )}
        {onOpenSpecs && (
          <button
            onClick={(e) => { e.stopPropagation(); onOpenSpecs(); }}
            className="text-[10px] px-1.5 py-0.5 rounded border text-cyan-400 border-cyan-500/40 bg-cyan-500/5 hover:text-cyan-300 hover:border-cyan-500/70"
            data-testid="folder-specs-btn"
          >
            <Icon path={mdiFileDocumentOutline} size={0.4} className="inline mr-0.5" />Specs
          </button>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-1">
          {/* Pills + search */}
          {hasGroups && (
            <div className="space-y-1 mb-1">
              <OpenSpecGroupPills
                groups={sortedGroups}
                activeGroupId={activePill}
                onSelect={setActivePill}
                onManageGroups={() => setManagerOpen(true)}
              />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter changes..."
                className="w-full text-[11px] bg-transparent border border-[var(--border-secondary)] rounded px-2 py-0.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-blue-500/50"
                onClick={(e) => e.stopPropagation()}
                data-testid="folder-openspec-search"
              />
            </div>
          )}

          {/* Changes list */}
          {hasGroups ? renderGroupedView() : renderFlatView()}
        </div>
      )}

      {/* Bootstrap inline create */}
      {showBootstrapCreate && (
        <DialogPortal>
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowBootstrapCreate(false)}>
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4 w-72" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">Create Group</h3>
              <BootstrapCreateForm
                onSave={async (name, color) => {
                  await handleCreateGroup(name, color);
                  setShowBootstrapCreate(false);
                }}
                onCancel={() => setShowBootstrapCreate(false)}
              />
            </div>
          </div>
        </DialogPortal>
      )}

      {tasksOpenForChange && (
        <DialogPortal>
          <TasksPopover
            cwd={cwd}
            change={tasksOpenForChange}
            onClose={() => setTasksOpenForChange(null)}
          />
        </DialogPortal>
      )}

      {managerOpen && (
        <DialogPortal>
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setManagerOpen(false)}>
            <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg p-4 w-80 max-h-[60vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Manage Groups</h3>
              <OpenSpecGroupManager
                groups={sortedGroups}
                onCreateGroup={async (name, color) => { await handleCreateGroup(name, color); }}
                onUpdateGroup={handleUpdateGroup}
                onDeleteGroup={handleDeleteGroup}
              />
              <div className="flex justify-end mt-3">
                <button
                  type="button"
                  onClick={() => setManagerOpen(false)}
                  className="text-[11px] px-3 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </DialogPortal>
      )}
    </div>
  );
}

/** Simple inline form for bootstrap create. */
function BootstrapCreateForm({ onSave, onCancel }: { onSave: (name: string, color: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(GROUP_PALETTE[0].hex);
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && name.trim()) onSave(name.trim(), color);
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Group name"
        className="w-full text-[12px] bg-transparent border border-[var(--border-secondary)] rounded px-2 py-1 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-blue-500/50"
        autoFocus
        data-testid="bootstrap-group-name-input"
      />
      <div className="flex gap-1.5">
        {GROUP_PALETTE.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setColor(p.hex)}
            className={`w-5 h-5 rounded-sm border-2 ${color === p.hex ? "border-white/60" : "border-transparent hover:border-white/30"}`}
            style={{ backgroundColor: p.hex }}
          />
        ))}
      </div>
      <div className="flex gap-1.5 justify-end">
        <button type="button" onClick={onCancel} className="text-[10px] px-2 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-muted)]">Cancel</button>
        <button
          type="button"
          onClick={() => name.trim() && onSave(name.trim(), color)}
          disabled={!name.trim()}
          className="text-[10px] px-2 py-0.5 rounded border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 disabled:opacity-40"
          data-testid="bootstrap-save-btn"
        >
          Create
        </button>
      </div>
    </div>
  );
}
