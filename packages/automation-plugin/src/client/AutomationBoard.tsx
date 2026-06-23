/**
 * Automation board (shell-overlay-route `/folder/:encodedCwd/automations`).
 *
 * Redesigned (change: redesign-automation-editor-and-board) into per-automation
 * definition cards (trigger summary, next-run, model, action, scope, enabled
 * state) with per-row actions — Run now / Edit / Enable-Disable / Delete for
 * valid automations; Edit / Delete only for invalid ones — plus a recent-runs
 * table (status, runId, findings, relative time, result/log link) with the
 * archived-runs toggle preserved.
 *
 * See change: add-automation-plugin, fix-automation-slot-parity-and-routing,
 * redesign-automation-editor-and-board.
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  listAutomations,
  listRuns,
  deleteAutomation,
  runAutomationNow,
  getAutomationDefinition,
  updateAutomation,
  getRunResult,
} from "./api.js";
import { CreateAutomationDialog } from "./CreateAutomationDialog.js";
import { decodeFolderPath } from "./folder-encoding.js";
import { nextFire } from "../shared/cron.js";
import type { AutomationConfig, DiscoveredAutomation, RunRecord } from "../shared/automation-types.js";

export interface AutomationBoardProps {
  params?: Record<string, string>;
  onBack?: () => void;
}

const STATUS_LABEL: Record<RunRecord["status"], string> = {
  running: "running",
  done: "done",
  error: "error",
};

interface EditTarget {
  name: string;
  scope: DiscoveredAutomation["scope"];
  config: AutomationConfig;
  promptBody?: string;
}

export function AutomationBoard({ params, onBack }: AutomationBoardProps): React.ReactElement {
  const decoded = params?.encodedCwd ? decodeFolderPath(params.encodedCwd) : undefined;
  const invalidRoute = !!params?.encodedCwd && decoded === null;
  const cwd = decoded ?? undefined;
  const [automations, setAutomations] = useState<DiscoveredAutomation[]>([]);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [openResult, setOpenResult] = useState<{ runId: string; text: string } | null>(null);

  useEffect(() => {
    if (invalidRoute) return;
    let cancelled = false;
    async function load() {
      const a = await listAutomations(cwd);
      if (cancelled) return;
      setAutomations(a);
      const folderRuns = await listRuns("folder", cwd);
      const globalRuns = await listRuns("global", undefined);
      if (!cancelled) setRuns([...folderRuns, ...globalRuns]);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [cwd, reloadKey, invalidRoute]);

  const refresh = () => setReloadKey((k) => k + 1);

  const visibleRuns = useMemo(() => {
    const filtered = showAll ? runs : runs.filter((r) => !r.archived);
    return [...filtered].sort((a, b) => b.startedAt - a.startedAt);
  }, [runs, showAll]);

  const runningNames = useMemo(
    () => new Set(runs.filter((r) => r.status === "running").map((r) => r.name)),
    [runs],
  );

  async function onDelete(a: DiscoveredAutomation): Promise<void> {
    const ok = typeof window !== "undefined" ? window.confirm(`Delete automation "${a.name}"?`) : true;
    if (!ok) return;
    await deleteAutomation(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    refresh();
  }

  async function onEdit(a: DiscoveredAutomation): Promise<void> {
    const def = await getAutomationDefinition(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    if (!def) return;
    setEditTarget({ name: a.name, scope: a.scope, config: def.config, ...(def.promptBody !== undefined ? { promptBody: def.promptBody } : {}) });
  }

  async function onToggleEnabled(a: DiscoveredAutomation): Promise<void> {
    if (!a.config) return;
    const def = await getAutomationDefinition(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    if (!def) return;
    const nextConfig: AutomationConfig = { ...def.config, disabled: !def.config.disabled };
    await updateAutomation({
      scope: a.scope,
      ...(a.scope === "folder" && cwd ? { cwd } : {}),
      name: a.name,
      config: nextConfig,
      ...(def.promptBody !== undefined ? { promptBody: def.promptBody } : {}),
    });
    refresh();
  }

  async function onRunNow(a: DiscoveredAutomation): Promise<void> {
    await runAutomationNow(a.scope, a.scope === "folder" ? cwd : undefined, a.name);
    refresh();
  }

  async function onViewResult(r: RunRecord): Promise<void> {
    // Run records don't carry scope; try folder (cwd) first, then global.
    const text =
      (await getRunResult("folder", cwd, r.runId)) ?? (await getRunResult("global", undefined, r.runId));
    setOpenResult({ runId: r.runId, text: text ?? "(no result)" });
  }

  if (invalidRoute) {
    return (
      <div data-testid="automation-board" className="flex flex-col gap-3 p-3 text-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" data-testid="automation-board-back" onClick={onBack} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              ← Back
            </button>
          )}
          <p className="text-xs text-[var(--danger,#ef4444)]" data-testid="automation-board-invalid">
            Invalid folder route.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="automation-board" className="flex flex-col gap-3 p-3 text-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button type="button" data-testid="automation-board-back" onClick={onBack} className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              ← Back
            </button>
          )}
          <h2 className="text-base font-semibold">Automations</h2>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" data-testid="automation-create-btn" onClick={() => setCreating(true)} className="text-xs px-2 py-1 rounded bg-[var(--accent,#6366f1)] text-white">
            + Create Automation
          </button>
          <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} data-testid="automation-show-all" />
            Show archived
          </label>
        </div>
      </div>

      {creating && (
        <CreateAutomationDialog cwd={cwd} onClose={() => setCreating(false)} onCreated={refresh} />
      )}
      {editTarget && (
        <CreateAutomationDialog
          cwd={cwd}
          onClose={() => setEditTarget(null)}
          onCreated={refresh}
          initialName={editTarget.name}
          initialScope={editTarget.scope}
          initialConfig={editTarget.config}
          {...(editTarget.promptBody !== undefined ? { initialPromptBody: editTarget.promptBody } : {})}
        />
      )}

      <section data-testid="automation-list">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Definitions</h3>
        {automations.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">No automations in this folder.</p>
        ) : (
          <ul className="space-y-2">
            {automations.map((a) => (
              <AutomationCard
                key={`${a.scope}:${a.name}`}
                automation={a}
                running={runningNames.has(a.name)}
                onRunNow={() => void onRunNow(a)}
                onEdit={() => void onEdit(a)}
                onToggle={() => void onToggleEnabled(a)}
                onDelete={() => void onDelete(a)}
              />
            ))}
          </ul>
        )}
      </section>

      <section data-testid="automation-triage">
        <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)] mb-1">Recent runs</h3>
        {visibleRuns.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]" data-testid="automation-triage-empty">
            No runs yet.
          </p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {visibleRuns.map((r) => (
                <tr key={r.runId} data-testid={`automation-run-${r.runId}`} className="border-b border-[var(--border-secondary)]/40">
                  <td className="py-1 pr-2"><span className={statusClass(r.status)}>{STATUS_LABEL[r.status]}</span></td>
                  <td className="py-1 pr-2 font-mono">{r.runId}</td>
                  <td className="py-1 pr-2 text-[var(--text-muted)]">{relativeTime(r.startedAt)}</td>
                  <td className="py-1 pr-2">
                    {r.archived && (
                      <span className="text-[10px] text-[var(--text-muted)]" data-testid={`run-archived-${r.runId}`}>archived</span>
                    )}
                  </td>
                  <td className="py-1">
                    <button type="button" data-testid={`run-result-${r.runId}`} onClick={() => void onViewResult(r)} className="text-[10px] text-[var(--accent,#6366f1)] underline">
                      view ▸
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {openResult && (
        <div data-testid="run-result-panel" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenResult(null)}>
          <div className="w-full max-w-lg max-h-[80vh] overflow-auto rounded-lg bg-[var(--bg-primary)] p-4 text-xs" onClick={(e) => e.stopPropagation()}>
            <div className="font-mono mb-2">{openResult.runId}</div>
            <pre className="whitespace-pre-wrap">{openResult.text}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function AutomationCard({
  automation: a,
  running,
  onRunNow,
  onEdit,
  onToggle,
  onDelete,
}: {
  automation: DiscoveredAutomation;
  running: boolean;
  onRunNow: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const cfg = a.config;
  const disabled = !!cfg?.disabled;
  const summary = cfg ? triggerSummary(cfg) : a.error ?? "invalid";
  const next = cfg && cfg.on.kind === "schedule" && typeof cfg.on.cron === "string"
    ? nextFire(cfg.on.cron, new Date())
    : null;
  const statusColor = !a.valid ? "bg-red-500" : disabled ? "bg-[var(--bg-surface,#888)]" : running ? "bg-yellow-500" : "bg-green-500";

  return (
    <li data-testid={`automation-def-${a.name}`} className="rounded border border-[var(--border-secondary)] p-2 flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${statusColor} ${running ? "animate-pulse motion-reduce:animate-none" : ""}`} />
        <span className="font-mono font-medium">{a.name}</span>
        <span className="text-[10px] rounded px-1 bg-[var(--bg-subtle,rgba(0,0,0,0.06))]">{a.scope}</span>
        <span className="text-[10px] text-[var(--text-muted)]" data-testid={`automation-enabled-${a.name}`}>
          {!a.valid ? "invalid" : disabled ? "disabled" : "enabled"}
        </span>
      </div>
      {a.valid ? (
        <div className="text-[11px] text-[var(--text-muted)] flex flex-wrap gap-x-3">
          <span data-testid={`automation-summary-${a.name}`}>{summary}</span>
          {next && <span>next: {next.toLocaleString()}</span>}
          <span>model: {cfg?.model ?? "?"}</span>
          <span>action: {cfg?.action.kind ?? "?"}</span>
        </div>
      ) : (
        <p className="text-[11px] text-[var(--danger,#ef4444)]" data-testid={`automation-error-${a.name}`}>{a.error}</p>
      )}
      <div className="flex gap-2 pt-0.5">
        {a.valid && (
          <>
            <CardBtn testid={`run-now-${a.name}`} onClick={onRunNow} label="Run now" />
            <CardBtn testid={`toggle-${a.name}`} onClick={onToggle} label={disabled ? "Enable" : "Disable"} />
          </>
        )}
        <CardBtn testid={`edit-${a.name}`} onClick={onEdit} label="Edit" />
        <CardBtn testid={`delete-${a.name}`} onClick={onDelete} label="Delete" danger />
      </div>
    </li>
  );
}

function CardBtn({ testid, onClick, label, danger }: { testid: string; onClick: () => void; label: string; danger?: boolean }): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] ${danger ? "text-[var(--danger,#ef4444)]" : "text-[var(--text-secondary)]"}`}
    >
      {label}
    </button>
  );
}

function triggerSummary(cfg: AutomationConfig): string {
  if (cfg.on.kind === "schedule") return `schedule: ${cfg.on.cron ?? "?"}`;
  const events = (cfg.on.events as string[] | undefined) ?? [];
  return `${cfg.on.kind}: ${events.join(", ")}`;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
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
