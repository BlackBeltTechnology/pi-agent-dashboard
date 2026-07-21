import type { OpenSpecArtifact, OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft, mdiMagnify } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ArchiveEntry } from "../../hooks/useArchiveListing.js";
import { filterEntries, groupByDate, useArchiveListing } from "../../hooks/useArchiveListing.js";
import { useOpenSpecReader } from "../../hooks/useOpenSpecReader.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { fetchGroups } from "../../lib/openspec/openspec-groups-api.js";
import { MarkdownPreviewView } from "../preview/MarkdownPreviewView.js";
import { OpenSpecGroupPills } from "./OpenSpecGroupPills.js";
import { OpenSpecGroupSection } from "./OpenSpecGroupSection.js";
import { ArtifactLetters } from "./openspec-helpers.js";

interface Props {
  cwd: string;
  onBack: () => void;
  /** Externally-pushed groups (from WS broadcast). */
  groups?: OpenSpecGroup[];
  /** Externally-pushed assignments (from WS broadcast). */
  assignments?: Record<string, string>;
}

/** Inner reader for an archived change — wraps useOpenSpecReader with archive flag. */
function ArchiveArtifactReader({
  cwd,
  changeName,
  initialArtifact,
  artifacts,
  onBack,
}: {
  cwd: string;
  changeName: string;
  initialArtifact: string;
  artifacts: OpenSpecArtifact[];
  onBack: () => void;
}) {
  // Archive preview is local-state driven (not URL-routed for artifacts). The
  // reader hook now derives its active tab from `initialArtifact`, so hold the
  // active artifact here and feed it in. See change:
  // fix-openspec-artifact-tab-url-sync.
  const [activeArtifact, setActiveArtifact] = useState(initialArtifact);
  const reader = useOpenSpecReader(cwd, changeName, activeArtifact, artifacts, true);
  return (
    <MarkdownPreviewView
      title={changeName}
      content={reader.content}
      isLoading={reader.isLoading}
      error={reader.error}
      tabs={reader.tabs}
      activeTab={reader.activeTab}
      onTabChange={setActiveArtifact}
      onBack={onBack}
    />
  );
}

export function ArchiveBrowserView({ cwd, onBack, groups: externalGroups, assignments: externalAssignments }: Props) {
  const { entries, isLoading, error } = useArchiveListing(cwd);
  const [search, setSearch] = useState("");
  const [activePill, setActivePill] = useState<string | null>(null);
  const [collapseState, setCollapseState] = useState<Record<string, boolean>>({});
  const [localGroups, setLocalGroups] = useState<OpenSpecGroup[]>([]);
  const [localAssignments, setLocalAssignments] = useState<Record<string, string>>({});
  const [readerState, setReaderState] = useState<{
    changeName: string;
    artifactId: string;
    artifacts: OpenSpecArtifact[];
  } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = externalGroups ?? localGroups;
  const assignments = externalAssignments ?? localAssignments;
  const hasGroups = groups.length > 0;
  const sortedGroups = [...groups].sort((a, b) => a.order - b.order);

  // Fetch groups on mount
  useEffect(() => {
    if (externalGroups) return;
    let cancelled = false;
    fetchGroups(cwd).then((result) => {
      if (cancelled) return;
      setLocalGroups(result.groups);
      setLocalAssignments(result.assignments);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [cwd, externalGroups]);

  useEffect(() => { if (externalGroups) setLocalGroups(externalGroups); }, [externalGroups]);
  useEffect(() => { if (externalAssignments) setLocalAssignments(externalAssignments); }, [externalAssignments]);

  const handleReadArtifact = useCallback((changeName: string, artifactId: string) => {
    const entry = entries.find((e) => e.name === changeName);
    if (!entry) return;
    setReaderState({ changeName, artifactId, artifacts: entry.artifacts });
  }, [entries]);

  const handleBackFromReader = useCallback(() => {
    setReaderState(null);
  }, []);

  if (readerState) {
    return (
      <ArchiveArtifactReader
        cwd={cwd}
        changeName={readerState.changeName}
        initialArtifact={readerState.artifactId}
        artifacts={readerState.artifacts}
        onBack={handleBackFromReader}
      />
    );
  }

  const filtered = filterEntries(entries, search);

  // Get group for an entry
  const getEntryGroupId = (entry: ArchiveEntry): string | null =>
    assignments[entry.name] ?? null;

  // Filter by pill
  const pillFiltered = activePill === null
    ? filtered
    : activePill === "__ungrouped__"
      ? filtered.filter((e) => getEntryGroupId(e) === null)
      : filtered.filter((e) => getEntryGroupId(e) === activePill);

  const renderEntryRow = (entry: ArchiveEntry) => (
    <div
      key={entry.name}
      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--bg-tertiary)] cursor-pointer"
      data-testid="archive-entry"
      onClick={() => entry.artifacts.length > 0 && handleReadArtifact(entry.name, entry.artifacts[0].id)}
    >
      <span className="text-[11px] font-medium text-[var(--text-secondary)] truncate flex-1">
        {entry.name.replace(/^\d{4}-\d{2}-\d{2}-/, "")}
      </span>
      <ArtifactLetters
        artifacts={entry.artifacts}
        changeName={entry.name}
        onReadArtifact={handleReadArtifact}
      />
    </div>
  );

  const renderGroupedContent = () => {
    const partitioned = new Map<string, ArchiveEntry[]>();
    const ungroupedEntries: ArchiveEntry[] = [];
    for (const e of pillFiltered) {
      const gId = getEntryGroupId(e);
      if (gId && groups.find((g) => g.id === gId)) {
        const list = partitioned.get(gId) ?? [];
        list.push(e);
        partitioned.set(gId, list);
      } else {
        ungroupedEntries.push(e);
      }
    }

    return (
      <div className="space-y-2">
        {sortedGroups.map((g) => {
          const items = partitioned.get(g.id) ?? [];
          if (activePill !== null && activePill !== g.id) return null;
          const dateGroups = groupByDate(items);
          return (
            <OpenSpecGroupSection
              key={g.id}
              name={g.name}
              color={g.color}
              count={items.length}
              expanded={collapseState[g.id] !== false}
              onToggle={() => setCollapseState((prev) => ({ ...prev, [g.id]: !prev[g.id] }))}
              testId={`archive-group-${g.id}`}
            >
              {items.length > 0
                ? dateGroups.map((dg) => (
                    <div key={dg.date} className="mb-2" data-testid="archive-date-group">
                      <div className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase mb-0.5">
                        {dg.date}
                      </div>
                      <div className="space-y-0.5">{dg.entries.map(renderEntryRow)}</div>
                    </div>
                  ))
                : <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">{i18nT("common.noEntriesInThisGroup", undefined, "No entries in this group")}</p>}
            </OpenSpecGroupSection>
          );
        })}
        {/* Ungrouped last */}
        {(activePill === null || activePill === "__ungrouped__") && (
          <OpenSpecGroupSection
            name="Ungrouped"
            color={null}
            count={ungroupedEntries.length}
            expanded={collapseState["__ungrouped__"] !== false}
            onToggle={() => setCollapseState((prev) => ({ ...prev, ["__ungrouped__"]: !prev["__ungrouped__"] }))}
            testId="archive-group-ungrouped"
          >
            {ungroupedEntries.length > 0
              ? groupByDate(ungroupedEntries).map((dg) => (
                  <div key={dg.date} className="mb-2" data-testid="archive-date-group">
                    <div className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase mb-0.5">
                      {dg.date}
                    </div>
                    <div className="space-y-0.5">{dg.entries.map(renderEntryRow)}</div>
                  </div>
                ))
              : <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">{i18nT("common.noUngroupedEntries", undefined, "No ungrouped entries")}</p>}
          </OpenSpecGroupSection>
        )}
      </div>
    );
  };

  const renderFlatContent = () => {
    const dateGroups = groupByDate(pillFiltered);
    return dateGroups.map((group) => (
      <div key={group.date} className="mb-3" data-testid="archive-date-group">
        <div className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase mb-1">
          {group.date}
        </div>
        <div className="space-y-0.5">{group.entries.map(renderEntryRow)}</div>
      </div>
    ));
  };

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="archive-browser">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border-secondary)]">
        <button
          onClick={onBack}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          data-testid="archive-back-btn"
        >
          <Icon path={mdiArrowLeft} size={0.8} />
        </button>
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">
          {i18nT("openspec.archive", undefined, "Archive")}
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">
          {entries.length} changes
        </span>
      </div>

      {/* Pills */}
      {hasGroups && (
        <div className="px-4 pt-1">
          <OpenSpecGroupPills
            groups={sortedGroups}
            activeGroupId={activePill}
            onSelect={setActivePill}
          />
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--border-secondary)]">
        <Icon path={mdiMagnify} size={0.6} className="text-[var(--text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={i18nT("openspec.searchArchivedChanges", undefined, "Search archived changes...")}
          className="flex-1 text-xs bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          data-testid="archive-search-input"
        />
        {search && (
          <span className="text-[10px] text-[var(--text-muted)]">
            {filtered.length} matches
          </span>
        )}
      </div>

      {/* Content */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-2" data-testid="archive-list">
        {isLoading ? (
          <p className="text-xs text-[var(--text-muted)] py-4 text-center">{i18nT("openspec.loadingArchive", undefined, "Loading archive...")}</p>
        ) : error ? (
          <p className="text-xs text-red-400 py-4 text-center">{error}</p>
        ) : pillFiltered.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-4 text-center">
            {search ? "No matching entries" : "No archived changes"}
          </p>
        ) : hasGroups ? (
          renderGroupedContent()
        ) : (
          renderFlatContent()
        )}
      </div>
    </div>
  );
}
