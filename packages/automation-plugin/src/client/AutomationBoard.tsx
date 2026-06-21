/**
 * Automation board (command-route `/automation`): lists this folder's
 * automations + their runs (Triage). Auto-archived empty runs are filtered
 * out of the default (unread) view; a toggle reveals all runs.
 *
 * See change: add-automation-plugin.
 */
import React, { useEffect, useMemo, useState } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { listAutomations, listRuns } from "./api.js";
import { CreateAutomationDialog } from "./CreateAutomationDialog.js";
import type { DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";

export interface AutomationBoardProps {
  /** Active session (command-route slot prop) — its cwd scopes the folder view. */
  session?: DashboardSession;
  routeParams?: Record<string, string>;
  onClose?: () => void;
}

const STATUS_LABEL: Record<RunRecord["status"], string> = {
  running: "running",
  done: "done",
  error: "error",
};

export function AutomationBoard({ session }: AutomationBoardProps): React.ReactElement {
  const cwd = session?.cwd;
  const [automations, setAutomations] = useState<DiscoveredAutomation[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const a = await listAutomations(cwd);
      if (cancelled) return;
      setAutomations(a);
      // Gather runs across both scopes for the discovered automations.
      const folderRuns = await listRuns("folder", cwd);
      const globalRuns = await listRuns("global", undefined);
      if (!cancelled) setRuns([...folderRuns, ...globalRuns]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, reloadKey]);

  const visibleRuns = useMemo(() => {
    const filtered = showAll ? runs : runs.filter((r) => !r.archived);
    // newest-first for the Triage list.
    return [...filtered].sort((a, b) => b.startedAt - a.startedAt);
  }, [runs, showAll]);

  return (
    <div data-testid="automation-board" className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Automations</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-testid="automation-create-btn"
            onClick={() => setCreating(true)}
            className="text-xs px-2 py-1 rounded bg-[var(--accent,#6366f1)] text-white"
          >
            + Create Automation
          </button>
          <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
              data-testid="automation-show-all"
            />
            Show archived
          </label>
        </div>
      </div>

      {creating && (
        <CreateAutomationDialog
          cwd={cwd}
          onClose={() => setCreating(false)}
          onCreated={() => setReloadKey((k) => k + 1)}
        />
      )}

      <section data-testid="automation-list">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Definitions</h3>
        {automations.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No automations in this folder.</p>
        ) : (
          <ul className="space-y-1">
            {automations.map((a) => (
              <li
                key={`${a.scope}:${a.name}`}
                data-testid={`automation-def-${a.name}`}
                className="flex items-center gap-2"
              >
                <span className="font-mono">{a.name}</span>
                <span className="text-[10px] rounded px-1 bg-[var(--bg-subtle,rgba(0,0,0,0.06))]">{a.scope}</span>
                {!a.valid && (
                  <span className="text-[10px] text-[var(--danger,#ef4444)]" title={a.error}>
                    invalid
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="automation-triage">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Triage</h3>
        {visibleRuns.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]" data-testid="automation-triage-empty">
            No runs yet.
          </p>
        ) : (
          <ul className="space-y-1">
            {visibleRuns.map((r) => (
              <li
                key={r.runId}
                data-testid={`automation-run-${r.runId}`}
                className="flex items-center gap-2"
              >
                <span className={statusClass(r.status)}>{STATUS_LABEL[r.status]}</span>
                <span className="font-mono text-xs">{r.runId}</span>
                {r.archived && (
                  <span className="text-[10px] text-[var(--text-muted)]" data-testid={`run-archived-${r.runId}`}>
                    archived
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function statusClass(status: RunRecord["status"]): string {
  const base = "text-[10px] rounded px-1 font-medium ";
  switch (status) {
    case "running":
      return base + "bg-[var(--accent-soft,rgba(99,102,241,0.15))] text-[var(--accent,#6366f1)]";
    case "error":
      return base + "bg-[rgba(239,68,68,0.15)] text-[var(--danger,#ef4444)]";
    default:
      return base + "bg-[var(--bg-subtle,rgba(0,0,0,0.06))] text-[var(--text-secondary)]";
  }
}
