/**
 * OpenSpec Groups settings section.
 * Lists known cwds and lets the user manage groups per-cwd.
 *
 * See change: add-openspec-change-grouping (task 10.1).
 */

import type { OpenSpecGroup } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { createGroup, deleteGroup, fetchGroups, updateGroup } from "../../lib/openspec/openspec-groups-api.js";
import { OpenSpecGroupManager } from "./OpenSpecGroupManager.js";

interface CwdGroups {
  cwd: string;
  groups: OpenSpecGroup[];
}

export function OpenSpecGroupsSettingsSection() {
  const [cwdList, setCwdList] = useState<CwdGroups[]>([]);
  const [expandedCwd, setExpandedCwd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch pinned dirs + session cwds for known cwds
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Get known cwds from sessions
        const sessionsRes = await fetch(`${getApiBase()}/api/sessions`);
        const sessionsBody = await sessionsRes.json();
        const cwds = new Set<string>();
        if (sessionsBody.success && Array.isArray(sessionsBody.data)) {
          for (const s of sessionsBody.data) {
            if (s.cwd) cwds.add(s.cwd);
          }
        }

        // Fetch groups for each cwd
        const results: CwdGroups[] = [];
        for (const cwd of cwds) {
          try {
            const data = await fetchGroups(cwd);
            results.push({ cwd, groups: data.groups });
          } catch {
            results.push({ cwd, groups: [] });
          }
        }
        if (!cancelled) {
          setCwdList(results);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const refreshCwd = useCallback(async (cwd: string) => {
    try {
      const data = await fetchGroups(cwd);
      setCwdList((prev) =>
        prev.map((item) => (item.cwd === cwd ? { ...item, groups: data.groups } : item)),
      );
    } catch {/* tolerate */}
  }, []);

  const handleCreate = useCallback(async (cwd: string, name: string, color: string) => {
    await createGroup(cwd, { name, color });
    await refreshCwd(cwd);
  }, [refreshCwd]);

  const handleUpdate = useCallback(async (cwd: string, id: string, update: { name?: string; color?: string; order?: number }) => {
    await updateGroup(cwd, id, update);
    await refreshCwd(cwd);
  }, [refreshCwd]);

  const handleDelete = useCallback(async (cwd: string, id: string) => {
    await deleteGroup(cwd, id);
    await refreshCwd(cwd);
  }, [refreshCwd]);

  if (loading) {
    return (
      <div data-testid="openspec-groups-settings">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
          {i18nT("openspec.openspecGroups", undefined, "OpenSpec Groups")}
        </h2>
        <p className="text-xs text-[var(--text-muted)]">{i18nT("common.loading2", undefined, "Loading…")}</p>
      </div>
    );
  }

  if (cwdList.length === 0) {
    return (
      <div data-testid="openspec-groups-settings">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
          {i18nT("openspec.openspecGroups", undefined, "OpenSpec Groups")}
        </h2>
        <p className="text-xs text-[var(--text-muted)]">{i18nT("session.noProjectsWithActiveSessions", undefined, "No projects with active sessions.")}</p>
      </div>
    );
  }

  return (
    <div data-testid="openspec-groups-settings">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        {i18nT("openspec.openspecGroups", undefined, "OpenSpec Groups")}
      </h2>
      <div className="space-y-3">
        {cwdList.map(({ cwd, groups }) => (
          <div key={cwd}>
            <button
              type="button"
              onClick={() => setExpandedCwd((prev) => (prev === cwd ? null : cwd))}
              className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono truncate w-full text-left"
              data-testid={`settings-cwd-${cwd}`}
            >
              {cwd} ({groups.length} groups)
            </button>
            {expandedCwd === cwd && (
              <div className="mt-2 ml-2">
                <OpenSpecGroupManager
                  groups={[...groups].sort((a, b) => a.order - b.order)}
                  onCreateGroup={(name, color) => handleCreate(cwd, name, color)}
                  onUpdateGroup={(id, update) => handleUpdate(cwd, id, update)}
                  onDeleteGroup={(id) => handleDelete(cwd, id)}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
