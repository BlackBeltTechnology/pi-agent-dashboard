/**
 * Tools settings section — inspect, override, and rescan every tool the
 * dashboard resolves (pi, pi-coding-agent, openspec, npm, node, git, …).
 *
 * Rendered inside the SettingsPanel General tab. Talks to /api/tools*.
 * See change: consolidate-tool-resolution (specs/tool-settings-ui).
 */
import React, { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../lib/api-context.js";
import { Icon } from "@mdi/react";
import {
  mdiCheck, mdiClose, mdiAlert, mdiRefresh, mdiChevronDown, mdiChevronRight,
  mdiContentSaveEdit, mdiDownload, mdiBackspaceOutline,
} from "@mdi/js";
import type { Resolution } from "../lib/tools-api.js";
import {
  fetchTools,
  rescanAll,
  rescanOne,
  setOverride,
  clearOverride,
  downloadDiagnostics,
} from "../lib/tools-api.js";

export function ToolsSection() {
  const [tools, setTools] = useState<Resolution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [globalBusy, setGlobalBusy] = useState<"rescan" | "reset" | "export" | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setTools(await fetchTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const onRescanOne = useCallback(async (name: string) => {
    setBusyName(name);
    try { setTools(await rescanOne(name)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyName(null); }
  }, []);

  const onRescanAll = useCallback(async () => {
    setGlobalBusy("rescan");
    try { setTools(await rescanAll()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setGlobalBusy(null); }
  }, []);

  const onResetOverrides = useCallback(async () => {
    const overridden = tools.filter((t) => t.source === "override" ||
      t.tried.some((x) => x.strategy === "override" && x.result.startsWith("invalid:")));
    if (overridden.length === 0) return;
    if (!window.confirm(`Clear ${overridden.length} override(s)?`)) return;
    setGlobalBusy("reset");
    try {
      for (const t of overridden) await clearOverride(t.name);
      setTools(await rescanAll());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGlobalBusy(null);
    }
  }, [tools]);

  const onExport = useCallback(async () => {
    setGlobalBusy("export");
    try { await downloadDiagnostics(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setGlobalBusy(null); }
  }, []);

  const onSetOverride = useCallback(async (name: string, path: string) => {
    setBusyName(name);
    try {
      await setOverride(name, path);
      setTools(await fetchTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  }, []);

  const onClearOverride = useCallback(async (name: string) => {
    setBusyName(name);
    try {
      await clearOverride(name);
      setTools(await fetchTools());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyName(null);
    }
  }, []);

  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
        Tools
      </h2>
      <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--text-secondary)]">
          External binaries and modules the dashboard resolves. Click a row to see the full resolution trail or set an override.
        </div>
        <div className="flex gap-1 flex-shrink-0 ml-2">
          <button
            onClick={onRescanAll}
            disabled={globalBusy !== null}
            className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
            title="Re-run every tool's strategy chain"
          >
            <Icon path={mdiRefresh} size={0.6} /> Rescan
          </button>
          <button
            onClick={onResetOverrides}
            disabled={globalBusy !== null}
            className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
            title="Clear every per-tool path override"
          >
            <Icon path={mdiBackspaceOutline} size={0.6} /> Reset
          </button>
          <button
            onClick={onExport}
            disabled={globalBusy !== null}
            className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
            title="Download a text file with every tool's resolution trail"
          >
            <Icon path={mdiDownload} size={0.6} /> Export
          </button>
        </div>
      </div>

      {loading && <div className="text-xs text-[var(--text-secondary)]">Loading tool resolutions…</div>}
      {error && (
        <div className="text-xs text-red-500 border border-red-500/40 rounded px-2 py-1">
          {error}
        </div>
      )}

      {!loading && tools.length > 0 && (
        <div className="divide-y divide-[var(--border-secondary)]">
          {tools.map((t) => (
            <ToolRow
              key={t.name}
              tool={t}
              busy={busyName === t.name}
              onRescan={() => onRescanOne(t.name)}
              onSetOverride={(p) => onSetOverride(t.name, p)}
              onClearOverride={() => onClearOverride(t.name)}
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface ToolRowProps {
  tool: Resolution;
  busy: boolean;
  onRescan: () => void;
  onSetOverride: (path: string) => void;
  onClearOverride: () => void;
}

function ToolRow({ tool, busy, onRescan, onSetOverride, onClearOverride }: ToolRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [draftPath, setDraftPath] = useState("");

  const invalidOverride = tool.tried.some(
    (x) => x.strategy === "override" && typeof x.result === "string" && x.result.startsWith("invalid:"),
  );
  const hasOverride = tool.source === "override" || invalidOverride;

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <button
          className="flex-shrink-0 p-0.5 hover:bg-[var(--bg-hover)] rounded"
          onClick={() => setExpanded((x) => !x)}
          title={expanded ? "Collapse" : "Show resolution trail"}
        >
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.55} />
        </button>
        <StatusBadge tool={tool} invalidOverride={invalidOverride} />
        <span className="font-mono font-medium flex-shrink-0 w-32 truncate">{tool.name}</span>
        <SourceBadge source={tool.source} />
        <span className="font-mono text-[var(--text-secondary)] truncate flex-1" title={tool.path ?? "not found"}>
          {tool.path ?? "not found"}
        </span>
        <button
          onClick={onRescan}
          disabled={busy}
          className="flex-shrink-0 px-1.5 py-0.5 border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
          title="Re-run this tool's strategy chain"
        >
          <Icon path={mdiRefresh} size={0.55} />
        </button>
      </div>

      {expanded && (
        <div className="pl-8 pr-2 pt-2 space-y-2">
          {/* Trail */}
          <div className="text-[11px] font-mono space-y-0.5">
            {tool.tried.map((entry, i) => (
              <div key={i} className={entry.result === "ok" ? "text-green-500" : "text-[var(--text-secondary)]"}>
                <span className="inline-block w-20">{entry.strategy}</span>
                <span>{entry.result}</span>
              </div>
            ))}
          </div>

          {/* Override input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={draftPath}
              onChange={(e) => setDraftPath(e.target.value)}
              placeholder={hasOverride ? "Current override in use" : "Set override path…"}
              className="flex-1 px-2 py-1 text-xs font-mono bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded"
            />
            <button
              onClick={() => { if (draftPath.trim()) { onSetOverride(draftPath.trim()); setDraftPath(""); } }}
              disabled={busy || !draftPath.trim()}
              className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
              title="Save override"
            >
              <Icon path={mdiContentSaveEdit} size={0.55} /> Save
            </button>
            {hasOverride && (
              <button
                onClick={onClearOverride}
                disabled={busy}
                className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
                title="Remove override"
              >
                <Icon path={mdiClose} size={0.55} /> Clear
              </button>
            )}
          </div>

          {invalidOverride && (
            <div className="text-[11px] text-amber-500 flex items-center gap-1">
              <Icon path={mdiAlert} size={0.5} />
              Override path didn't validate — fell through to the next strategy.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Per-source colored pill for the tool row. `bundled` (Electron-bundled
 * Node toolchain at <resourcesPath>/node/) is rendered as a neutral-blue
 * badge to distinguish it from `system`, `managed`, `override`,
 * `npm-global`, and `bare-import`.
 * See change: fix-node-resolution-under-electron (task 5.1).
 */
export function SourceBadge({ source }: { source: Resolution["source"] }) {
  if (!source) {
    return (
      <span className="text-[var(--text-secondary)] flex-shrink-0 w-24 truncate">—</span>
    );
  }
  const style = sourceBadgeStyle(source);
  return (
    <span
      className={`flex-shrink-0 w-24 truncate ${style.className}`}
      title={style.tooltip}
    >
      {source}
    </span>
  );
}

export function sourceBadgeStyle(source: NonNullable<Resolution["source"]>): { className: string; tooltip: string } {
  switch (source) {
    case "bundled":
      return {
        className: "text-sky-500",
        tooltip: "Shipped with this Electron install.",
      };
    case "override":
      return { className: "text-purple-500", tooltip: "User-pinned override." };
    case "managed":
      return { className: "text-emerald-500", tooltip: "Installed under ~/.pi-dashboard/." };
    case "npm-global":
      return { className: "text-amber-500", tooltip: "Found in the global npm prefix." };
    case "bare-import":
      return { className: "text-cyan-500", tooltip: "Resolved via Node module resolution." };
    case "system":
    default:
      return { className: "text-[var(--text-secondary)]", tooltip: "Found on PATH." };
  }
}

function StatusBadge({ tool, invalidOverride }: { tool: Resolution; invalidOverride: boolean }) {
  if (tool.ok && invalidOverride) {
    return (
      <span className="flex-shrink-0 text-amber-500" title="Override invalid; using fallback">
        <Icon path={mdiAlert} size={0.6} />
      </span>
    );
  }
  if (tool.ok) {
    return (
      <span className="flex-shrink-0 text-green-500" title={`Resolved via ${tool.source}`}>
        <Icon path={mdiCheck} size={0.6} />
      </span>
    );
  }
  return (
    <span className="flex-shrink-0 text-red-500" title="Not found">
      <Icon path={mdiClose} size={0.6} />
    </span>
  );
}

// ── Spawn Failures Panel ────────────────────────────────────────────────────────────

interface SpawnFailureEntry {
  ts: string;
  cwd: string;
  strategy: string;
  code: string;
  message: string;
  stderrTail?: string;
  pid?: number;
}

/**
 * Collapsible list of the last 50 failed spawn attempts.
 * Fetched from GET /api/spawn-failures. See change: spawn-failure-diagnostics.
 */
export function SpawnFailuresSection() {
  const [entries, setEntries] = useState<SpawnFailureEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    if (entries !== null) { setExpanded(true); return; }
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/api/spawn-failures?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { entries: SpawnFailureEntry[] };
      setEntries(data.entries ?? []);
      setExpanded(true);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [entries]);

  return (
    <div className="border border-[var(--border-secondary)] rounded-lg overflow-hidden">
      <button
        onClick={expanded ? () => setExpanded(false) : load}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-sm font-medium text-[var(--text-primary)]"
      >
        <span>Recent +Session Failures</span>
        <span className="text-[var(--text-tertiary)] text-xs">{loading ? "Loading…" : expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && entries !== null && (
        <div className="divide-y divide-[var(--border-secondary)]">
          {entries.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--text-tertiary)]">No spawn failures recorded.</p>
          ) : (
            entries.map((e, i) => <SpawnFailureRow key={i} entry={e} />)
          )}
        </div>
      )}
    </div>
  );
}

function SpawnFailureRow({ entry }: { entry: SpawnFailureEntry }) {
  const [open, setOpen] = useState(false);
  const date = new Date(entry.ts).toLocaleString();
  return (
    <div className="px-4 py-2 text-xs">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 text-left hover:text-[var(--text-primary)]"
      >
        <span className="font-mono text-[var(--text-tertiary)] shrink-0">{date}</span>
        <span className="font-medium text-red-400 shrink-0">[{entry.code}]</span>
        <span className="text-[var(--text-secondary)] truncate">{entry.cwd}</span>
        <span className="ml-auto shrink-0 text-[var(--text-tertiary)]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1 pl-2">
          <p className="text-[var(--text-secondary)]">{entry.message}</p>
          {entry.stderrTail && (
            <details>
              <summary className="cursor-pointer text-[var(--text-tertiary)]">Pi stderr</summary>
              <pre className="mt-1 text-[10px] font-mono text-[var(--text-tertiary)] whitespace-pre-wrap break-all max-h-24 overflow-y-auto">{entry.stderrTail}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
